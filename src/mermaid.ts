/**
 * mid core — parse Mermaid flowchart syntax into a graph.
 *
 * Supports `graph TD/LR` / `flowchart TD/LR`, node shapes (`[Label]`, `(Label)`,
 * `{Label}`), edges (`-->`, `---`, `-.->`) with optional `|label|`, and `%%`
 * comments. Nodes are named by their label when present, else their id.
 *
 * Like markdown, mermaid is edge-oriented: a line such as `A --> B` names two
 * nodes, and a node recurs on every edge line. So each node accumulates a
 * **span** (see `model.ts`) per occurrence — located at that occurrence's *id
 * token* in the raw line (the structural anchor; the label sits just after it).
 * Two spans on one line are disambiguated by cursor column at the client.
 */

import { ParseError } from "./markdown.ts";
import { Graph, type Span } from "./model.ts";

interface MNode {
	id: string;
	label?: string;
}

const ARROWS = ["-.->", "-->", "---", "-.."];

/** Parse a node reference like `A`, `A[Label]`, `A(Label)`, `A{Label}`. */
function parseNodeRef(text: string): MNode {
	const t = text.trim();
	const shapes = [
		/^(\w+)\[([^\]]+)\]/,
		/^(\w+)\(([^)]+)\)/,
		/^(\w+)\{([^}]+)\}/,
	];
	for (const re of shapes) {
		const m = re.exec(t);
		if (m) return { id: m[1]!, label: m[2]!.trim() };
	}
	return { id: t };
}

interface MEdge {
	src: MNode;
	dst: MNode;
	label?: string;
	labelSpan?: Span; // where the `|label|` text sits in the raw line
}

function parseEdgeLine(line: string): MEdge | null {
	for (const arrow of ARROWS) {
		const a = arrow.replace(/[.]/g, "\\.");
		// with label: A -->|label| B  (surrounding spaces optional)
		let m = new RegExp(`^(.+?)\\s*${a}\\s*\\|([^|]+)\\|\\s*(.+)$`).exec(line);
		if (m) {
			return {
				src: parseNodeRef(m[1]!),
				dst: parseNodeRef(m[3]!),
				label: m[2]!.trim(),
			};
		}
		// without label: A --> B  (surrounding spaces optional)
		m = new RegExp(`^(.+?)\\s*${a}\\s*(.+)$`).exec(line);
		if (m) {
			return { src: parseNodeRef(m[1]!), dst: parseNodeRef(m[2]!) };
		}
	}
	return null;
}

function parseNodeDecl(line: string): MNode | null {
	const ref = parseNodeRef(line);
	// only a standalone declaration if it actually carried a shape/label
	return ref.label !== undefined ? ref : /^\w+$/.test(line.trim()) ? ref : null;
}

/** Byte column + length of an id token in a raw line, searching from `from`. */
function idSpan(rawLine: string, from: number, line: number): Span | null {
	const m = /(\w+)/.exec(rawLine.slice(from));
	if (!m) return null;
	return { line, col: from + m.index, len: m[1]!.length };
}

export function parseMermaid(text: string): Graph {
	// Raw (un-trimmed) lines so span line/col align with the editor's view.
	const rawLines = text.split("\n");
	const headerIdx = rawLines.findIndex((l) => l.trim() !== "");
	if (headerIdx === -1) throw new ParseError("Empty Mermaid file");
	const first = rawLines[headerIdx]!.trim();
	if (!(first.startsWith("graph ") || first.startsWith("flowchart "))) {
		throw new ParseError(
			`Expected 'graph' or 'flowchart' declaration, got: ${first}`,
		);
	}

	const nodes = new Map<string, MNode>();
	const edges: MEdge[] = [];
	// id -> the spans where that id's token appears (1-indexed raw line + col)
	const spans = new Map<string, Span[]>();
	const register = (n: MNode, span: Span | null) => {
		const cur = nodes.get(n.id);
		if (!cur) nodes.set(n.id, n);
		else if (cur.label === undefined && n.label !== undefined)
			nodes.set(n.id, n);
		if (span) {
			if (!spans.has(n.id)) spans.set(n.id, []);
			spans.get(n.id)!.push(span);
		}
	};

	for (let i = headerIdx + 1; i < rawLines.length; i++) {
		const raw = rawLines[i]!;
		const line = raw.trim();
		if (!line || line.startsWith("%")) continue;
		const lineNo = i + 1;

		const e = parseEdgeLine(line);
		if (e) {
			// locate src id (from the start) then dst id (after the arrow)
			const srcSpan = idSpan(raw, raw.search(/\S/), lineNo);
			let arrowEnd = -1;
			for (const arrow of ARROWS) {
				const ai = raw.indexOf(arrow);
				if (ai >= 0) {
					arrowEnd = ai + arrow.length;
					break;
				}
			}
			// skip an optional |label| between the arrow and the dst id, recording the
			// label text's span (the edge's source location)
			let dstFrom = arrowEnd >= 0 ? arrowEnd : raw.length;
			const lbl = /^(\s*)\|([^|]*)\|/.exec(raw.slice(dstFrom));
			if (lbl) {
				e.labelSpan = {
					line: lineNo,
					col: dstFrom + lbl[1]!.length + 1,
					len: lbl[2]!.length,
				};
				dstFrom += lbl[0]!.length;
			}
			const dstSpan = idSpan(raw, dstFrom, lineNo);
			register(e.src, srcSpan);
			register(e.dst, dstSpan);
			edges.push(e);
			continue;
		}
		const n = parseNodeDecl(line);
		if (n) register(n, idSpan(raw, raw.search(/\S/), lineNo));
	}

	const graph = new Graph();
	const nameOf = (id: string) => nodes.get(id)?.label ?? id;
	for (const id of nodes.keys()) {
		const name = nameOf(id);
		const ss = spans.get(id) ?? [];
		if (ss.length === 0) graph.addNode({ name });
		else for (const s of ss) graph.addNode({ name, span: s });
	}
	for (const e of edges) {
		graph.addEdge({
			src: nameOf(e.src.id),
			dst: nameOf(e.dst.id),
			label: e.label,
			span: e.labelSpan,
		});
	}
	return graph;
}
