/** mid core — public API. */

export { type Mermaid, toMermaid } from "./convert.ts";
export {
	type LaidOutEdge,
	type LaidOutNode,
	type Layout,
	layout,
} from "./layout.ts";
export { ParseError, parseMarkdown } from "./markdown.ts";
export { parseMermaid } from "./mermaid.ts";
export { type Edge, Graph, type Node, type Span } from "./model.ts";
export {
	type Cell,
	type GraphJSON,
	type RenderOptions,
	type RenderResult,
	render,
	renderAscii,
	renderGrid,
	toJSON,
} from "./render.ts";

import { parseMarkdown } from "./markdown.ts";
import { parseMermaid } from "./mermaid.ts";
import type { Graph } from "./model.ts";

export type Format = "md" | "mmd";

/** Sniff the format from text: Mermaid starts with `graph`/`flowchart`. */
export function sniffFormat(text: string): Format {
	const first = text.trim().split("\n")[0]?.trim() ?? "";
	return /^(graph|flowchart)\b/.test(first) ? "mmd" : "md";
}

export function parse(text: string, format?: Format): Graph {
	const fmt = format ?? sniffFormat(text);
	return fmt === "mmd" ? parseMermaid(text) : parseMarkdown(text);
}
