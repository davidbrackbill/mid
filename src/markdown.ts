/**
 * mid core — parse Markdown bullet lists into a graph.
 *
 *   - A
 *     - B        # A → B
 *       - C      # B → C
 *     - D        # A → D
 *
 * Indentation defines parent/child. A name used twice is the same node (so
 * trees become DAGs). The link form `- [label](target)` adds `parent → target`
 * carrying `label`; the node is `target`. Non-bullet lines are ignored.
 *
 * Each bullet contributes one node and one **span** — the location of that
 * node's name token in the source (for a plain bullet, the text; for a link,
 * the `target` inside the parens). A reused node accumulates a span per line it
 * appears on. See `model.ts` for why spans are the universal source map.
 */
import { Graph, type Span } from "./model.ts";

export class ParseError extends Error {}

const BULLET = /^(\s*)[-*+]\s+(.*\S)\s*$/;
const LINK = /^\[(.+?)\]\((.+?)\)$/;
// the marker + following whitespace prefix, measured on the *raw* line so the
// span column matches what an editor sees (no tab expansion applied to cols).
const PREFIX = /^\s*[-*+]\s+/;

/** Expand tabs to the next multiple of `width` (matches Python str.expandtabs). */
function expandTabs(s: string, width = 4): string {
	let out = "";
	let col = 0;
	for (const ch of s) {
		if (ch === "\t") {
			const n = width - (col % width);
			out += " ".repeat(n);
			col += n;
		} else {
			out += ch;
			col = ch === "\n" ? 0 : col + 1;
		}
	}
	return out;
}

/** `[label](target)` → [target, label]; plain text → [text, undefined]. */
function parseContent(content: string): [string, string | undefined] {
	const m = LINK.exec(content);
	if (m) return [m[2]!.trim(), m[1]!.trim()];
	return [content.trim(), undefined];
}

/**
 * The span of a bullet's node-name token on its raw source line. For a plain
 * bullet that's the trimmed content; for `[label](target)` it's `target` inside
 * the parens. Falls back to the content start if we can't locate the token.
 */
function nodeSpan(rawLine: string, line: number, name: string): Span {
	const pre = PREFIX.exec(rawLine);
	const contentStart = pre
		? pre[0]!.length
		: rawLine.length - rawLine.trimStart().length;
	const content = rawLine.slice(contentStart);

	// link form: point at `target` (after the `](`)
	const link = LINK.exec(content.trim());
	if (link) {
		const marker = content.indexOf("](");
		if (marker >= 0) {
			const after = marker + 2;
			const tokenStart =
				after +
				(content.slice(after).length - content.slice(after).trimStart().length);
			return { line, col: contentStart + tokenStart, len: name.length };
		}
	}
	// plain bullet: the trimmed text
	const lead = content.length - content.trimStart().length;
	return { line, col: contentStart + lead, len: name.length };
}

/** The span of a `[label]` token on a `- [label](target)` line (the edge's source
 *  location), or undefined for a plain bullet. Points at the label text between the
 *  brackets, on the raw line (so columns match the editor). */
function edgeLabelSpan(rawLine: string, line: number): Span | undefined {
	const pre = PREFIX.exec(rawLine);
	const contentStart = pre
		? pre[0]!.length
		: rawLine.length - rawLine.trimStart().length;
	const content = rawLine.slice(contentStart);
	if (!LINK.exec(content.trim())) return undefined;
	const lb = content.indexOf("[");
	const rb = content.indexOf("]", lb + 1);
	if (lb < 0 || rb < 0) return undefined;
	return { line, col: contentStart + lb + 1, len: rb - lb - 1 };
}

export function parseMarkdown(text: string): Graph {
	const graph = new Graph();
	const stack: Array<{ indent: number; name: string }> = [];

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const m = BULLET.exec(expandTabs(raw));
		if (!m) continue; // blank lines, headings, prose

		const indent = m[1]!.length;
		const [name, label] = parseContent(m[2]!);
		if (!name) throw new ParseError(`Empty node on line ${i + 1}`);

		while (stack.length && stack[stack.length - 1]!.indent >= indent)
			stack.pop();

		graph.addNode({ name, span: nodeSpan(raw, i + 1, name) });
		const parent = stack[stack.length - 1];
		if (parent)
			graph.addEdge({
				src: parent.name,
				dst: name,
				label,
				span: label ? edgeLabelSpan(raw, i + 1) : undefined,
			});
		stack.push({ indent, name });
	}

	return graph;
}
