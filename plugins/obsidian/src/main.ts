/*
 * mid — Obsidian plugin.
 *
 * A ```mid fenced block (markdown bullets / nested [label](target) edges) or a
 * ```maid fenced block (mermaid flowchart syntax) is shown as a graph by converting
 * the parsed graph to Mermaid (mid core's `toMermaid`) and letting Obsidian render
 * its built-in Mermaid **SVG** — so the diagram looks native. The mid TS core
 * (../../../src) is imported directly (Electron); no subprocess.
 *
 * UX mirrors mid.nvim's "fences" model, identically for both block types:
 *   - the Mermaid SVG sits **above** the block and stays visible while editing;
 *   - the fenced source below is the editor's own text — fully editable; edits
 *     re-render the graph live;
 *   - cursor mirror: moving the cursor through the source highlights the matching
 *     SVG node (the column disambiguates a line that names several nodes);
 *   - click a node → move + center the editor cursor on its source line.
 *
 * Two render surfaces:
 *   - Live Preview — a CM6 ViewPlugin is the *primary* renderer: a block-widget
 *     decoration above each fence holds the SVG, the fence lines stay editable CM
 *     text. This deliberately does NOT use Obsidian's native code-block widget
 *     (which collapses the block to an SVG when the cursor leaves) — that lifecycle
 *     is exactly what prevents "graph above + always-editable source below". We
 *     still use the native Mermaid *engine* for the pixels (MarkdownRenderer).
 *   - Reading view — there's no editor, so a code-block processor renders the SVG
 *     + a static source copy; interactions there are inert. The processor bails in
 *     Live Preview so it never fights the StateField.
 *
 * `mid` and `maid` are owned; ` ```mermaid ` itself is rendered by Obsidian's own
 * live-preview renderer, which a plugin can't suppress without hiding the editable
 * source, so mermaid is left native — `maid` is the escape hatch for mermaid-syntax
 * content that wants the mid UX instead (see FENCE_LANGS).
 */

import {
	type EditorState,
	type Extension,
	RangeSetBuilder,
	StateField,
	type Text,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import {
	type Editor,
	type MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
} from "obsidian";

import {
	type Edge,
	type Format,
	type Graph,
	type Node,
	parse,
	toMermaid,
} from "../../../src/index.ts";

const HL = "mid-hl"; // class toggled on the selected SVG node
const HL_EDGE = "mid-hl-edge"; // class toggled on the selected SVG edge path

// We own ` ```mid ` (markdown bullets) and ` ```maid ` (mermaid syntax) blocks. A
// ` ```mermaid ` block is rendered by Obsidian's own live-preview CM extension, which
// a plugin can't suppress without a block-*replace* decoration over the whole block
// — and that would hide the editable source we want. So `mermaid` itself is left to
// the native renderer; `maid` is the escape hatch for mermaid-syntax content that
// wants the mid UX (cursor mirror, click-to-source) instead. Mirrors mid.nvim's
// `languages = { mid = "md", mermaid = "mmd" }` table, minus the taken `mermaid` tag.
const FENCE_LANGS: Record<string, Format> = { mid: "md", maid: "mmd" };
const FENCE_OPEN = /^\s*`{3,}\s*(mid|maid)\s*$/;
const FENCE_CLOSE = /^\s*`{3,}\s*$/;

/** Synthetic node id (`n0`) from a rendered mermaid `<g id="flowchart-n0-3">`. */
function synthId(gId: string): string | null {
	const m = /flowchart-(n\d+)-/.exec(gId) ?? /^(n\d+)$/.exec(gId);
	return m ? m[1]! : null;
}

/** A cursor target: a graph node (by name) or an edge. */
type Target = { kind: "node"; name: string } | { kind: "edge"; edge: Edge };

/** What's at a content line + column? A mid bullet `- [label](target)` carries two
 *  tokens — the edge label and the target node — so the cursor column disambiguates:
 *  a token that *contains* the cursor wins (on the label → the edge); otherwise the
 *  line's node (its destination), else the nearest token. Mirrors the nvim logic. */
function targetAtCursor(
	graph: Graph,
	contentLine: number,
	col: number,
): Target | null {
	const toks: Array<{ col: number; len: number; t: Target }> = [];
	for (const node of graph.nodes.values())
		for (const sp of node.spans)
			if (sp.line === contentLine)
				toks.push({
					col: sp.col,
					len: sp.len,
					t: { kind: "node", name: node.name },
				});
	for (const edge of graph.edges)
		for (const sp of edge.spans)
			if (sp.line === contentLine)
				toks.push({ col: sp.col, len: sp.len, t: { kind: "edge", edge } });
	if (!toks.length) return null;
	for (const tk of toks)
		if (col >= tk.col && col < tk.col + tk.len) return tk.t; // containing wins
	const nearest = (pool: typeof toks): Target | null => {
		let best: Target | null = null;
		let bd = Infinity;
		for (const tk of pool) {
			const d = Math.min(
				Math.abs(col - tk.col),
				Math.abs(col - (tk.col + tk.len)),
			);
			if (d < bd) {
				bd = d;
				best = tk.t;
			}
		}
		return best;
	};
	return nearest(toks.filter((tk) => tk.t.kind === "node")) ?? nearest(toks);
}

/** Wrap mermaid source in a fenced block so MarkdownRenderer renders it as SVG
 *  (using Obsidian's themed mermaid engine — so the diagram looks native). */
function fence(mermaid: string): string {
	return `\`\`\`mermaid\n${mermaid}\n\`\`\``;
}

/** Render `graph` as a native Mermaid SVG into `el`. Returns the name→synthetic-id
 *  map so callers can find a node's `<g>` afterwards. */
async function renderSvg(
	plugin: Plugin,
	graph: Graph,
	el: HTMLElement,
	sourcePath: string,
): Promise<Map<string, string>> {
	const { text, ids } = toMermaid(graph);
	await MarkdownRenderer.render(
		plugin.app,
		fence(text),
		el,
		sourcePath,
		plugin,
	);
	return ids;
}

/** Remove any node/edge highlight under `root`. */
function clearHl(root: HTMLElement): void {
	root.querySelectorAll(`.${HL}, .${HL_EDGE}`).forEach((n) => {
		n.classList.remove(HL, HL_EDGE);
	});
}

/** Highlight the cursor's target — a node `<g>` or an edge `<path>` — within `root`
 *  (clearing any previous). Edge paths are `id="L_<src>_<dst>_<i>"` (some Mermaid
 *  builds use hyphens), so we match both separators. */
function highlightTarget(
	root: HTMLElement,
	ids: Map<string, string>,
	target: Target | null,
): void {
	clearHl(root);
	if (!target) return;
	if (target.kind === "node") {
		const id = ids.get(target.name);
		if (!id) return;
		root
			.querySelector<SVGElement>(
				`g.node[id^="flowchart-${id}-"], g.node[id="${id}"]`,
			)
			?.classList.add(HL);
	} else {
		const s = ids.get(target.edge.src);
		const d = ids.get(target.edge.dst);
		if (!s || !d) return;
		root
			.querySelector<SVGElement>(
				`path[id^="L_${s}_${d}_"], path[id^="L-${s}-${d}-"]`,
			)
			?.classList.add(HL_EDGE);
	}
}

export default class MidPlugin extends Plugin {
	onload(): void {
		// Reading view: render the SVG + a static source copy. (`mid` and `maid`;
		// `mermaid` itself is left to Obsidian's native renderer.) The processor bails
		// in Live Preview, where the StateField/ViewPlugin renders instead.
		for (const [lang, format] of Object.entries(FENCE_LANGS))
			this.registerMarkdownCodeBlockProcessor(lang, (src, el, ctx) =>
				this.renderReadingBlock(src, el, ctx, format),
			);
		// Live Preview (primary renderer for mid blocks).
		this.registerEditorExtension(livePreviewExtension(this));
		// Command: wrap the current selection (a bullet list) in a ```mid block so it
		// renders as a diagram. Available whenever an editor is focused; with no
		// selection it inserts an empty scaffold at the cursor.
		this.addCommand({
			id: "make-mid-diagram",
			name: "Make mid diagram",
			editorCallback: (editor: Editor) => this.makeDiagram(editor),
		});
	}

	/** Turn the editor's selected text into a ```mid fenced block (so it renders as a
	 *  diagram). With a selection, the selected lines become the block body; with no
	 *  selection, a one-bullet scaffold is inserted at the cursor. */
	private makeDiagram(editor: Editor): void {
		const sel = editor.getSelection().replace(/^\n+|\n+$/g, ""); // trim blank edges
		const body = sel.length ? sel : "- node";
		editor.replaceSelection(`\`\`\`mid\n${body}\n\`\`\`\n`);
		if (!sel.length)
			new Notice(
				"Inserted an empty mid block — add bullets to build the diagram.",
			);
	}

	/** Reading-view render: native-mermaid SVG + a static source copy beneath it.
	 *  Bails in Live Preview, where the StateField/ViewPlugin is the renderer (else
	 *  the block would render twice — once here, once as the CM widget). */
	private async renderReadingBlock(
		src: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		format: Format,
	): Promise<void> {
		// Detecting Live Preview by DOM ancestry is unreliable: the processor's `el`
		// is still detached when this runs, so `.markdown-source-view` isn't found
		// yet. The active view's mode ("source" covers both source and live preview)
		// is the dependable signal — bail there and let the CM extension own it.
		if (
			this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() ===
			"source"
		)
			return;
		if (el.closest(".markdown-source-view")) return; // belt-and-braces

		el.empty();
		el.addClass("mid-container");
		let graph: Graph;
		try {
			graph = parse(src, format);
		} catch (e) {
			el.createEl("pre", { cls: "mid-error" }).setText(
				`mid: ${e instanceof Error ? e.message : String(e)}`,
			);
			return;
		}
		const graphEl = el.createDiv({ cls: "mid-graph" });
		const ids = await renderSvg(this, graph, graphEl, ctx.sourcePath);
		el.createEl("pre", { cls: "mid-source" }).setText(src);

		// Click a node → jump the editor cursor to that node's primary span (only
		// possible when an editor exists; in pure reading view this is inert).
		const id2name = new Map([...ids].map(([n, i]) => [i, n] as const));
		graphEl.addEventListener("click", (e) => {
			const g = (e.target as HTMLElement).closest?.(
				"g.node",
			) as SVGElement | null;
			const sid = g?.id ? synthId(g.id) : null;
			const name = sid ? id2name.get(sid) : undefined;
			const sp = name ? graph.nodes.get(name)?.spans[0] : undefined;
			const info = ctx.getSectionInfo(el);
			const editor =
				this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (sp && info && editor) {
				editor.focus();
				editor.setCursor({ line: info.lineStart + sp.line, ch: sp.col });
			}
		});
	}
}

// --- Live Preview: ViewPlugin owns mid blocks --------------------------------

interface Block {
	open: number;
	close: number;
	format: Format;
} // 1-indexed fence lines

/** Find ```mid / ```maid fenced blocks (terminated only). Lines are 1-indexed;
 *  `open`/`close` are the fence lines, content is the lines strictly between. */
function findBlocks(doc: Text): Block[] {
	const out: Block[] = [];
	for (let i = 1; i <= doc.lines; i++) {
		const m = FENCE_OPEN.exec(doc.line(i).text);
		if (!m) continue;
		let j = i + 1;
		while (j <= doc.lines && !FENCE_CLOSE.test(doc.line(j).text)) j++;
		if (j > doc.lines) break; // unterminated: don't render a half-typed block
		out.push({ open: i, close: j, format: FENCE_LANGS[m[1]!]! });
		i = j;
	}
	return out;
}

function blockContent(doc: Text, b: Block): string {
	const lines: string[] = [];
	for (let l = b.open + 1; l < b.close; l++) lines.push(doc.line(l).text);
	return lines.join("\n");
}

/** A native-mermaid SVG drawn as a block widget above a fence. `eq` is by source
 *  so cursor moves never re-render the SVG; the ViewPlugin toggles the highlight
 *  class separately. A click on a node moves+centers the cursor. */
/** Per-wrap render state, stashed on the DOM so it survives `updateDOM` (the click
 *  handler and successive renders read the current graph/ids from here). */
interface WrapState {
	graph?: Graph;
	ids?: Map<string, string>;
	token: number;
	timer?: ReturnType<typeof setTimeout>;
}
const wrapState = (wrap: HTMLElement): WrapState =>
	(wrap as unknown as { _mid: WrapState })._mid;

/** Reverse a synthetic node id (`n0`) back to its graph node, via the wrap's ids. */
function spanForNode(st: WrapState, sid: string): Node | undefined {
	if (!st.ids || !st.graph) return undefined;
	for (const [name, id] of st.ids)
		if (id === sid) return st.graph.nodes.get(name);
	return undefined;
}
/** Reverse a pair of synthetic ids (`n0`,`n1`) back to the edge between them. */
function spanForEdge(
	st: WrapState,
	sId: string,
	dId: string,
): Edge | undefined {
	if (!st.ids || !st.graph) return undefined;
	let src: string | undefined;
	let dst: string | undefined;
	for (const [name, id] of st.ids) {
		if (id === sId) src = name;
		if (id === dId) dst = name;
	}
	if (src === undefined || dst === undefined) return undefined;
	return st.graph.edges.find((e) => e.src === src && e.dst === dst);
}

/** (Re)render `source` into `wrap`, **debounced**, keeping the previously rendered
 *  SVG visible until the new one is ready — so editing the source never flashes the
 *  graph. The new SVG renders into an offscreen slot (still laid out, so mermaid can
 *  measure), then swaps in; a token drops superseded (out-of-order) renders. */
function scheduleRender(
	plugin: MidPlugin,
	wrap: HTMLElement,
	source: string,
	format: Format,
): void {
	const st = wrapState(wrap);
	const token = ++st.token;
	if (st.timer) clearTimeout(st.timer);
	st.timer = setTimeout(() => {
		let graph: Graph;
		try {
			graph = parse(source, format);
		} catch (e) {
			const err = document.createElement("pre");
			err.className = "mid-error";
			err.textContent = `mid: ${e instanceof Error ? e.message : String(e)}`;
			wrap.replaceChildren(err);
			st.graph = undefined;
			st.ids = undefined;
			return;
		}
		const slot = document.createElement("div");
		slot.style.position = "absolute";
		slot.style.visibility = "hidden"; // off-flow + invisible, but still measurable
		wrap.appendChild(slot);
		void renderSvg(plugin, graph, slot, "").then((ids) => {
			if (st.token !== token) {
				slot.remove();
				return;
			} // a newer edit superseded us
			slot.style.position = "";
			slot.style.visibility = "";
			for (const c of Array.from(wrap.children)) if (c !== slot) c.remove();
			st.graph = graph;
			st.ids = ids;
		});
	}, 100);
}

class GraphWidget extends WidgetType {
	constructor(
		readonly plugin: MidPlugin,
		readonly source: string,
		readonly format: Format,
	) {
		super();
	}
	eq(o: GraphWidget): boolean {
		return o.source === this.source && o.format === this.format;
	}
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement("div");
		wrap.className = "mid-lp-wrap mid-graph";
		wrap.setAttribute("contenteditable", "false");
		(wrap as unknown as { _mid: WrapState })._mid = { token: 0 };
		// Click a node box or an edge path → move + center the editor cursor on its
		// source span. Attached once; reads the *current* graph/ids off the wrap (they
		// change as it re-renders).
		wrap.addEventListener("click", (e) => {
			const st = wrapState(wrap);
			if (!st.graph || !st.ids) return;
			const el = e.target as HTMLElement;
			// 1) a node box
			const g = el.closest?.("g.node") as SVGElement | null;
			const sid = g?.id ? synthId(g.id) : null;
			let sp = sid ? spanForNode(st, sid)?.spans[0] : undefined;
			// 2) else an edge path (id `L_<src>_<dst>_<i>`)
			if (!sp) {
				const path = el.closest?.("path[id]") as SVGElement | null;
				const m = path?.id ? /^L[-_](n\d+)[-_](n\d+)/.exec(path.id) : null;
				if (m) sp = spanForEdge(st, m[1]!, m[2]!)?.spans[0];
			}
			// 3) else an edge *label* (the big, easy target) — map by its text. The path
			//    carries the endpoint ids; the label doesn't, so we match on label text.
			if (!sp) {
				const lbl = el.closest?.(".edgeLabel") as HTMLElement | null;
				const text = lbl?.textContent?.trim();
				if (text) sp = st.graph.edges.find((ed) => ed.label === text)?.spans[0];
			}
			if (!sp) return;
			const pos = view.posAtDOM(wrap);
			if (pos < 0) return;
			const doc = view.state.doc;
			const lineNo = doc.lineAt(pos).number + sp.line; // open fence + content-relative line
			if (lineNo < 1 || lineNo > doc.lines) return;
			const line = doc.line(lineNo);
			const target = Math.min(line.from + sp.col, line.to);
			view.dispatch({
				selection: { anchor: target },
				effects: EditorView.scrollIntoView(target, { y: "center" }),
			});
			view.focus();
		});
		scheduleRender(this.plugin, wrap, this.source, this.format);
		return wrap;
	}
	/** Reuse the existing DOM (and its click handler) and re-render in place — this is
	 *  what kills the flicker; without it CM tears the node down and rebuilds it. */
	updateDOM(dom: HTMLElement, _view: EditorView): boolean {
		if (!wrapState(dom)) return false; // not one of ours; let CM replace it
		scheduleRender(this.plugin, dom, this.source, this.format);
		return true;
	}
	ignoreEvent(): boolean {
		return true; // passive: the editable source below handles editor input
	}
}

/** One block widget above every mid/mermaid fence in the document. Built from the
 *  document state alone (no view) so it can live in a StateField. */
function buildDecos(plugin: MidPlugin, state: EditorState): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = state.doc;
	for (const b of findBlocks(doc)) {
		const at = doc.line(b.open).from;
		builder.add(
			at,
			at,
			Decoration.widget({
				widget: new GraphWidget(plugin, blockContent(doc, b), b.format),
				block: true,
				side: -1,
			}),
		);
	}
	return builder.finish();
}

/** The graph widgets. CodeMirror requires **block** decorations to be served from
 *  a StateField via the `EditorView.decorations` facet — a ViewPlugin may only
 *  provide inline decorations ("Block decorations may not be specified via
 *  plugins"). Rebuild on a document change (so eq-by-source reuses unchanged
 *  widgets); a selection-only transaction keeps the existing set untouched, so the
 *  SVG is never re-rendered on cursor moves. */
function midDecorations(plugin: MidPlugin): StateField<DecorationSet> {
	return StateField.define<DecorationSet>({
		create: (state) => buildDecos(plugin, state),
		update: (deco, tr) => (tr.docChanged ? buildDecos(plugin, tr.state) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}

/** Cursor mirror + enter-block snap. Provides no decorations (those come from the
 *  StateField above); it only reacts to selection changes by recoloring the SVG and
 *  nudging the cursor into a block. */
function midInteraction() {
	return ViewPlugin.fromClass(
		class {
			update(u: ViewUpdate): void {
				this.snapIntoBlock(u);
				this.mirror(u.view);
			}
			/** Entering a block from outside: if the cursor lands on the opening fence,
			 *  drop it onto the first content line so it's "in the graph". Deferred — a
			 *  ViewPlugin may not dispatch during an update — and guarded so it never
			 *  fights ordinary motion within a block (Up onto the fence is allowed). */
			snapIntoBlock(u: ViewUpdate): void {
				if (!u.selectionSet) return;
				const view = u.view;
				const doc = view.state.doc;
				const head = view.state.selection.main.head;
				const headLine = doc.lineAt(head).number;
				const b = findBlocks(doc).find((x) => headLine === x.open);
				if (!b) return; // only when sitting exactly on the open fence
				if (b.open + 1 >= b.close) return; // empty block
				const prevDoc = u.startState.doc;
				const prev = Math.min(u.startState.selection.main.head, prevDoc.length);
				const prevLine = prevDoc.lineAt(prev).number;
				if (prevLine > b.open && prevLine < b.close) return; // was inside → don't snap
				const target = doc.line(b.open + 1).from;
				queueMicrotask(() => {
					if (view.state.selection.main.head !== head) return; // moved meanwhile
					view.dispatch({ selection: { anchor: target } });
				});
			}
			/** Highlight the node under the cursor in its block's SVG (no re-render). */
			mirror(view: EditorView): void {
				const wraps = Array.from(
					view.dom.querySelectorAll<HTMLElement>(".mid-lp-wrap"),
				);
				wraps.forEach(clearHl);
				const doc = view.state.doc;
				const head = view.state.selection.main.head;
				const headLine = doc.lineAt(head).number;
				const b = findBlocks(doc).find(
					(x) => headLine > x.open && headLine < x.close,
				);
				if (!b) return; // cursor not on a content line of any block
				let graph: Graph;
				try {
					graph = parse(blockContent(doc, b), b.format);
				} catch {
					return; // mid-edit parse error: leave the last good highlight
				}
				const { ids } = toMermaid(graph);
				const col = head - doc.line(headLine).from;
				const target = targetAtCursor(graph, headLine - b.open, col);
				for (const w of wraps) {
					const pos = view.posAtDOM(w);
					if (pos < 0) continue;
					if (doc.lineAt(pos).number !== b.open) continue;
					highlightTarget(w, ids, target);
					break;
				}
			}
		},
	);
}

/** The Live Preview editor extension: block widgets (StateField) + cursor
 *  interaction (ViewPlugin). */
function livePreviewExtension(plugin: MidPlugin): Extension {
	return [midDecorations(plugin), midInteraction()];
}
