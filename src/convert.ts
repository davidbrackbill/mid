/**
 * mid core — serialize a parsed graph back out to Mermaid flowchart syntax.
 *
 * Since both syntaxes parse into the same `Graph`, this makes mid a converter
 * (bullets → mermaid, mermaid → normalized mermaid). The Obsidian plugin uses it
 * to hand graphs to Obsidian's built-in mermaid SVG renderer.
 *
 * Nodes are emitted with **stable synthetic ids** (`n0`, `n1`, …) and the name
 * as the label, so a node name can contain spaces/punctuation safely and a
 * client can map name → id (via the returned map) to find the rendered SVG node.
 */
import type { Edge, Graph } from "./model.ts";
import type { SeqDiagram } from "./sequence.ts";

export interface Mermaid {
	/** the `graph TD …` source */
	text: string;
	/** node name → synthetic id used in `text` (e.g. "cache hit" → "n2") */
	ids: Map<string, string>;
}

/** Render a name/label for a Mermaid `[label]` / `|label|`. A literal `\n`
 *  (backslash-n, as typed in the source) becomes a `<br/>` so the node/edge text
 *  wraps onto multiple lines. The node *identity* (the `ids` key) is unchanged —
 *  only the displayed label is rewritten. */
function label(s: string): string {
	return s.replace(/\\n/g, "<br/>");
}

export function toMermaid(graph: Graph): Mermaid {
	const ids = new Map<string, string>();
	let i = 0;
	for (const name of graph.nodes.keys()) ids.set(name, `n${i++}`);

	// Unquoted labels: Mermaid accepts spaces in `[label]` and `|label|`, and our
	// own parser round-trips them. (Names containing `]`/`|` aren't handled — rare.)
	const lines = ["graph TD"];
	for (const [name, id] of ids) lines.push(`  ${id}[${label(name)}]`); // declare (keeps isolated nodes)
	for (const e of graph.edges) {
		const s = ids.get(e.src)!;
		const d = ids.get(e.dst)!;
		lines.push(
			e.label ? `  ${s} -->|${label(e.label)}| ${d}` : `  ${s} --> ${d}`,
		);
	}
	return { text: lines.join("\n"), ids };
}

/**
 * Render a parsed sequence diagram out to Mermaid `sequenceDiagram` syntax, the
 * same way `toMermaid` does for flowcharts — the Obsidian plugin hands this
 * straight to Mermaid's built-in renderer, so `mid` never needs its own
 * sequence-diagram layout/drawing code.
 *
 * Actor ids get the same stable-synthetic-id treatment as flowchart nodes
 * (`n0`, `n1`, …), since a bare actor declaration's id is the whole line and
 * may contain spaces, which Mermaid participant ids can't.
 */
export function toMermaidSequence(diagram: SeqDiagram): Mermaid {
	const ids = new Map<string, string>();
	let i = 0;
	for (const id of diagram.actors.keys()) ids.set(id, `n${i++}`);

	const lines = ["sequenceDiagram"];
	for (const [actorId, mid] of ids) {
		const actor = diagram.actors.get(actorId)!;
		lines.push(
			actor.label
				? `  participant ${mid} as ${label(actor.label)}`
				: `  participant ${mid}`,
		);
	}
	for (const m of diagram.messages) {
		const s = ids.get(m.from)!;
		const d = ids.get(m.to)!;
		lines.push(`  ${s}->>${d}: ${m.text ? label(m.text) : ""}`);
	}
	return { text: lines.join("\n"), ids };
}

/** Render a `<br/>` (Mermaid's line break) back to a literal `\n` — the
 *  inverse of `label()`'s <br/> rewrite, so round-tripping through mermaid and back
 *  reproduces the original mid bullet text. */
function unbreak(s: string): string {
	return s.replace(/<br\s*\/?>/gi, "\\n");
}

/**
 * Render a graph back out to a mid bullet list. Since the bullet grammar is a
 * tree (indentation) with reuse-by-name for DAGs/cycles, each node is fully
 * expanded (its children rendered as nested bullets) only at its **first**
 * visit; every later reference to that name is a leaf bullet, matching how the
 * parser treats a repeated name as "same node, no new children" once it's on
 * the stack.
 */
export function toMarkdown(graph: Graph): string {
	const outgoing = new Map<string, Edge[]>();
	for (const e of graph.edges) {
		if (!outgoing.has(e.src)) outgoing.set(e.src, []);
		outgoing.get(e.src)!.push(e);
	}

	const lines: string[] = [];
	const expanded = new Set<string>();

	function visit(name: string, depth: number, edgeLabel: string | undefined) {
		const indent = "  ".repeat(depth);
		const text = edgeLabel ? `[${unbreak(edgeLabel)}](${name})` : unbreak(name);
		lines.push(`${indent}- ${text}`);
		if (expanded.has(name)) return; // already expanded elsewhere — leaf reference
		expanded.add(name);
		for (const e of outgoing.get(name) ?? []) visit(e.dst, depth + 1, e.label);
	}

	// Roots first (stable, readable output), then anything left over — isolated
	// nodes, or nodes only reachable via a cycle with no entry point.
	for (const n of graph.entryNodes())
		if (!expanded.has(n.name)) visit(n.name, 0, undefined);
	for (const name of graph.nodes.keys())
		if (!expanded.has(name)) visit(name, 0, undefined);

	return lines.join("\n");
}
