/**
 * mid core — parse the sequence-diagram syntax into a `SeqDiagram`.
 *
 * Unlike the flowchart formats (markdown, mermaid), this doesn't produce a
 * `Graph`: a `Graph`'s edges dedup by `(src,dst)`, but a sequence diagram's
 * messages are ordered *events* — the same actor pair can send several distinct
 * messages, and every one must survive. So `messages` is a plain ordered array,
 * never deduped.
 *
 * Detected (see `sniffFormat` in `index.ts`) by the *absence* of bullet markers
 * — a mid bullet list always has at least one `-`/`*`/`+` line; a sequence block
 * never does.
 *
 * v1 supports exactly one arrow, `>` (a synchronous call) — no return/async/
 * lost arrows yet (`>>` / `~>` / `x>`), no comment syntax (a line that's neither
 * an actor declaration nor a message is silently skipped, same as markdown's
 * "non-bullet lines ignored" and mermaid's unmatched-line handling).
 *
 *   Client
 *   [Authentication Server](Auth)
 *
 *   Client > Auth: Login request   # message, with text
 *   Client > Auth                  # silent call, no text
 *   Client > Client: retry         # self-message
 *
 * `[Label](id)` mirrors the markdown link-bullet convention: brackets carry the
 * display label, parens carry the identity actors are referenced by. A bare
 * declaration (no brackets) must be a single word, same restriction mermaid.ts
 * places on a plain node decl — otherwise a stray prose/heading line would
 * silently become a phantom actor instead of being skipped.
 */
import type { Span } from "./model.ts";

export interface Actor {
	id: string;
	label?: string;
	spans: Span[];
}

export interface Message {
	from: string;
	to: string;
	text?: string;
	/** where this message's text token sits in the source (empty for a silent
	 *  call — it has no token of its own). */
	spans: Span[];
}

export class SeqDiagram {
	readonly actors = new Map<string, Actor>();
	readonly messages: Message[] = [];

	/** Add (or look up) an actor by id, accumulating an optional source span and
	 *  filling in a label the first time one is seen. */
	addActor(actor: { id: string; label?: string; span?: Span }): Actor {
		let existing = this.actors.get(actor.id);
		if (!existing) {
			existing = { id: actor.id, spans: [] };
			this.actors.set(actor.id, existing);
		}
		if (actor.label !== undefined && existing.label === undefined)
			existing.label = actor.label;
		if (actor.span) addSpan(existing, actor.span);
		return existing;
	}

	addMessage(message: {
		from: string;
		to: string;
		text?: string;
		span?: Span;
	}): void {
		const created: Message = {
			from: message.from,
			to: message.to,
			text: message.text,
			spans: [],
		};
		if (message.span) addSpan(created, message.span);
		this.messages.push(created);
	}
}

/** Insert a span, keeping `spans` sorted and de-duped (mirrors model.ts). */
function addSpan(target: { spans: Span[] }, span: Span): void {
	const spans = target.spans;
	for (const s of spans) {
		if (s.line === span.line && s.col === span.col) return;
	}
	const i = spans.findIndex(
		(s) => s.line > span.line || (s.line === span.line && s.col > span.col),
	);
	if (i < 0) spans.push(span);
	else spans.splice(i, 0, span);
}

const LINK = /^\[(.+?)\]\((.+?)\)$/;

/** A declaration line's actor id + optional label + the id token's span.
 *  `[Label](id)` → id from the parens, label from the brackets; plain text →
 *  the whole trimmed line is the id, no label. */
function parseDecl(
	raw: string,
	line: number,
): { id: string; label?: string; span: Span } | null {
	const leading = raw.length - raw.trimStart().length;
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const m = LINK.exec(trimmed);
	if (m) {
		const label = m[1]!.trim();
		const id = m[2]!.trim();
		if (!id) return null;
		const marker = trimmed.indexOf("](");
		const idStart = leading + marker + 2;
		return { id, label, span: { line, col: idStart, len: id.length } };
	}
	// a bare declaration (no brackets) must be a single word — same restriction
	// mermaid.ts places on a plain node decl, so free-text lines (headings,
	// prose) don't silently become phantom actors; a multi-word display name
	// needs the `[Label](id)` form.
	if (!/^\w+$/.test(trimmed)) return null;
	return { id: trimmed, span: { line, col: leading, len: trimmed.length } };
}

interface MessageLine {
	from: string;
	fromSpan: Span;
	to: string;
	toSpan: Span;
	text?: string;
	textSpan?: Span;
}

/** `From > To: Message text` or `From > To` (silent call, no text). The text
 *  after the first `:` is taken verbatim, so it may itself contain colons. */
function parseMessageLine(raw: string, line: number): MessageLine | null {
	const gt = raw.indexOf(">");
	if (gt < 0) return null;

	const fromSeg = raw.slice(0, gt);
	const from = fromSeg.trim();
	if (!from) return null;
	const fromCol = fromSeg.length - fromSeg.trimStart().length;

	const rest = raw.slice(gt + 1);
	const colon = rest.indexOf(":");
	const toSeg = colon < 0 ? rest : rest.slice(0, colon);
	const to = toSeg.trim();
	if (!to) return null;
	const toCol = gt + 1 + (toSeg.length - toSeg.trimStart().length);

	const base: MessageLine = {
		from,
		fromSpan: { line, col: fromCol, len: from.length },
		to,
		toSpan: { line, col: toCol, len: to.length },
	};
	if (colon < 0) return base;

	const afterColon = rest.slice(colon + 1);
	const text = afterColon.trim();
	if (!text) return base;
	const textCol =
		gt + 1 + colon + 1 + (afterColon.length - afterColon.trimStart().length);
	return {
		...base,
		text,
		textSpan: { line, col: textCol, len: text.length },
	};
}

export function parseSequence(text: string): SeqDiagram {
	const diagram = new SeqDiagram();
	const lines = text.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		if (!raw.trim()) continue;
		const lineNo = i + 1;

		const msg = parseMessageLine(raw, lineNo);
		if (msg) {
			diagram.addActor({ id: msg.from, span: msg.fromSpan });
			diagram.addActor({ id: msg.to, span: msg.toSpan });
			diagram.addMessage({
				from: msg.from,
				to: msg.to,
				text: msg.text,
				span: msg.textSpan,
			});
			continue;
		}

		const decl = parseDecl(raw, lineNo);
		if (decl) diagram.addActor(decl);
		// neither a message nor a declaration — skip (comment/prose)
	}

	return diagram;
}
