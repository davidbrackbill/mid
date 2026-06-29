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
import type { Graph } from "./model.ts";

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
