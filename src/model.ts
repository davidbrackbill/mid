/**
 * mid core — graph model.
 *
 * A Node's identity is its name. An Edge stores src/dst by name. Re-adding a
 * name returns the existing node; re-adding an edge (same src,dst) keeps the
 * first (so the first label wins).
 *
 * **Source spans.** Both the markdown and mermaid syntaxes are edge-oriented: a
 * line names one or more nodes, and a node recurs on every line that references
 * it (`- [ok](respond)` and `- [hit](respond)` are two edges into `respond`;
 * `A --> B` then `B --> C` mention `B` twice). So each node carries *every*
 * place its name token appears in the source, as `{ line, col, len }` spans.
 * This one primitive drives highlight (which node is at a cursor position),
 * traversal (jump to a node's primary span), and editing — identically for both
 * syntaxes. `spans[0]` is the earliest occurrence (the "primary" / home span).
 */

/** A node-name token's location in the source, within one parsed block.
 *  `line` is 1-indexed; `col` is a 0-indexed byte column; `len` is in bytes. */
export interface Span {
	line: number;
	col: number;
	len: number;
}

export interface Node {
	name: string;
	spans: Span[];
}

export interface Edge {
	src: string;
	dst: string;
	label?: string;
	/** where this edge's **label** token appears in the source (the `[label]` in a
	 *  mid bullet, the `|label|` in a mermaid arrow). Empty for an unlabeled edge —
	 *  it has no token of its own, so the node on that line represents it. Drives
	 *  edge highlight + jump-to-source, exactly like a node's spans. */
	spans: Span[];
}

export class Graph {
	readonly nodes = new Map<string, Node>();
	readonly edges: Edge[] = [];

	/** Add (or look up) a node by name, accumulating an optional source span. */
	addNode(node: { name: string; span?: Span }): Node {
		let existing = this.nodes.get(node.name);
		if (!existing) {
			existing = { name: node.name, spans: [] };
			this.nodes.set(node.name, existing);
		}
		if (node.span) addSpan(existing, node.span);
		return existing;
	}

	/** Add an edge, or (on a `(src,dst)` dup) keep the first — but still accumulate
	 *  the new occurrence's label `span`, so a reused edge collects every location. */
	addEdge(edge: {
		src: string;
		dst: string;
		label?: string;
		span?: Span;
	}): void {
		for (const e of this.edges) {
			if (e.src === edge.src && e.dst === edge.dst) {
				if (edge.span) addSpan(e, edge.span);
				return;
			}
		}
		const created: Edge = {
			src: edge.src,
			dst: edge.dst,
			label: edge.label,
			spans: [],
		};
		if (edge.span) addSpan(created, edge.span);
		this.edges.push(created);
	}

	/** Root nodes — those with no incoming edge. */
	entryNodes(): Node[] {
		const hasIncoming = new Set(this.edges.map((e) => e.dst));
		return [...this.nodes.values()].filter((n) => !hasIncoming.has(n.name));
	}
}

/** Insert a span into a node or edge, keeping `spans` sorted by (line, col) and
 *  de-duped, so `spans[0]` is always the earliest occurrence. */
function addSpan(target: { spans: Span[] }, span: Span): void {
	const spans = target.spans;
	for (const s of spans) {
		if (s.line === span.line && s.col === span.col) return; // already have it
	}
	const i = spans.findIndex(
		(s) => s.line > span.line || (s.line === span.line && s.col > span.col),
	);
	if (i < 0) spans.push(span);
	else spans.splice(i, 0, span);
}
