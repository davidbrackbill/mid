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
export {
	type Actor,
	type Message,
	parseSequence,
	SeqDiagram,
} from "./sequence.ts";

import { parseMarkdown } from "./markdown.ts";
import { parseMermaid } from "./mermaid.ts";
import type { Graph } from "./model.ts";

export type Format = "md" | "mmd" | "seq";

/** Sniff the format from text: Mermaid starts with `graph`/`flowchart`; a mid
 *  bullet list always has at least one `-`/`*`/`+` bullet line; a sequence
 *  block never does. */
export function sniffFormat(text: string): Format {
	const first = text.trim().split("\n")[0]?.trim() ?? "";
	if (/^(graph|flowchart)\b/.test(first)) return "mmd";
	const hasBullet = text.split("\n").some((l) => /^\s*[-*+]\s/.test(l));
	return hasBullet ? "md" : "seq";
}

/** Parse a flowchart format (markdown or mermaid) into a `Graph`. For `seq`,
 *  use `parseSequence` directly — a sequence diagram isn't a `Graph` (its
 *  messages are ordered events, not deduped edges). */
export function parse(text: string, format?: Format): Graph {
	const fmt = format ?? sniffFormat(text);
	if (fmt === "seq")
		throw new Error(
			"parse(): sequence diagrams use parseSequence(), not parse()",
		);
	return fmt === "mmd" ? parseMermaid(text) : parseMarkdown(text);
}
