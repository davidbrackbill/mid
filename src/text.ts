/**
 * mid core — node display text.
 *
 * A node's name may contain a literal `\n` (a backslash followed by `n`, as typed
 * in the source) to request a line break *inside* the node. This is the single
 * place that decision lives: the ASCII renderer splits the name into rows here,
 * and `toMermaid` turns the same `\n` into `<br/>`. The node *identity* (its name)
 * is unchanged — only how it's drawn.
 */

/** Split a node name into display rows on each literal `\n`. */
export function nodeLines(name: string): string[] {
	return name.split(/\\n/);
}

/** Display width = the widest row (in characters). */
export function nodeWidth(name: string): number {
	let w = 0;
	for (const line of nodeLines(name)) w = Math.max(w, line.length);
	return w;
}

/** Display height = number of rows. */
export function nodeHeight(name: string): number {
	return nodeLines(name).length;
}
