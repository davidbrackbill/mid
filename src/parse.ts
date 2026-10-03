import { isSeparator, readOutline, readTable, splitNode, trimmedSpan } from "./mid.ts";

export class ParseError extends Error {}

export interface Span {
  start: number;
  end: number;
}

export interface Warning {
  line: number;
  message: string;
}

interface Edge {
  src: string;
  dst: string;
  label?: string;
  span?: Span;
}

export const ARROWS = [
  "<<-->>",
  "<<->>",
  "-->>",
  "->>",
  "--x",
  "-x",
  "--)",
  "-)",
  "-->",
  "->",
] as const;

export type Arrow = (typeof ARROWS)[number];

export interface Message {
  from: string;
  to: string;
  text: string;
  arrow: Arrow;
  activation?: "+" | "-";
  span?: Span;
}

export type Format = "mid" | "mermaid";
export type Kind = "flowchart" | "sequence";

export class Graph {
  constructor(
    readonly format: Format = "mid",
    readonly kind: Kind = "flowchart",
  ) {}

  readonly nodes = new Set<string>();
  readonly edges: Edge[] = [];
  readonly messages: Message[] = [];
  readonly actors = new Set<string>();
  autonumber = false;
  readonly spans = new Map<string, Span[]>();
  readonly warnings: Warning[] = [];

  addNode(name: string, span?: Span): void {
    this.nodes.add(name);
    if (span) this.spans.set(name, [...(this.spans.get(name) ?? []), span]);
  }

  addEdge(edge: Edge): void {
    if (this.edges.some((e) => e.src === edge.src && e.dst === edge.dst)) return;
    this.edges.push(edge);
  }
}

export function detect(text: string): { format: Format; kind: Kind } {
  const lines = text.split("\n").map((l) => l.trim());
  const first = lines.find((l) => l && !l.startsWith("%")) ?? "";
  if (/^sequenceDiagram\b/.test(first)) return { format: "mermaid", kind: "sequence" };
  if (/^(graph|flowchart)\b/.test(first)) return { format: "mermaid", kind: "flowchart" };
  if (lines.some((l) => l.startsWith("|"))) return { format: "mid", kind: "sequence" };
  return { format: "mid", kind: "flowchart" };
}

export function parse(text: string): Graph {
  const { format, kind } = detect(text);
  if (format === "mermaid")
    return kind === "sequence" ? parseMermaidSequence(text) : parseMermaid(text);
  return kind === "sequence" ? parseTable(text) : parseMarkdown(text);
}

function parseMarkdown(text: string): Graph {
  const graph = new Graph();
  const stack: Array<{ level: number; name: string }> = [];

  for (const bullet of readOutline(text, false)!) {
    const { text: content, start: at } = bullet;
    if (!content) continue;
    const { name, nameSpan, label, labelSpan } = splitNode(content);
    if (!name) throw new ParseError(`Empty node on line ${bullet.line}`);
    const span = ([start, end]: [number, number]) => ({ start: at + start, end: at + end });

    while (stack.length && stack[stack.length - 1]!.level >= bullet.level) stack.pop();

    graph.addNode(name, span(nameSpan));
    const parent = stack[stack.length - 1];
    if (parent)
      graph.addEdge({ src: parent.name, dst: name, label, span: labelSpan && span(labelSpan) });
    stack.push({ level: bullet.level, name });
  }

  return graph;
}

interface MNode {
  id: string;
  label?: string;
}

interface Ref {
  node: MNode;
  span: Span;
}

const LINKS = ["-.->", "-->", "---", "-.-"];
const SHAPES = [/^(\w+)\[([^\]]+)\]$/, /^(\w+)\(([^)]+)\)$/, /^(\w+)\{([^}]+)\}$/];

function parseNodeRef(text: string): MNode | null {
  for (const re of SHAPES) {
    const m = re.exec(text);
    if (m) return { id: m[1]!, label: m[2]!.trim() };
  }
  return /^\w+$/.test(text) ? { id: text } : null;
}

function ref(line: string, at: number, [start, end]: [number, number]): Ref | null {
  const raw = line.slice(start, end);
  const node = parseNodeRef(raw.trim());
  return node && { node, span: trimmedSpan(raw, at + start) };
}

function parseEdgeLine(
  line: string,
  at: number,
): { src: Ref; dst: Ref; label?: string; span?: Span } | null {
  for (const arrow of LINKS) {
    const a = arrow.replace(/[.]/g, "\\.");
    const labeled = new RegExp(`^(.+?)\\s*${a}\\s*\\|([^|]+)\\|\\s*(.+)$`, "d").exec(line);
    const m = labeled ?? new RegExp(`^(.+?)\\s*${a}\\s*(.+)$`, "d").exec(line);
    if (!m) continue;
    const src = ref(line, at, m.indices![1]!);
    const dst = ref(line, at, m.indices![labeled ? 3 : 2]!);
    if (!src || !dst) return null;
    if (!labeled) return { src, dst };
    const [start, end] = m.indices![2]!;
    return { src, dst, label: m[2]!.trim(), span: trimmedSpan(line.slice(start, end), at + start) };
  }
  return null;
}

function parseMermaid(text: string): Graph {
  const graph = new Graph("mermaid");
  const nodes = new Map<string, MNode>();
  const spans = new Map<string, Span[]>();
  const edges: Edge[] = [];
  const register = ({ node, span }: Ref) => {
    const cur = nodes.get(node.id);
    if (!cur || (cur.label === undefined && node.label !== undefined)) nodes.set(node.id, node);
    spans.set(node.id, [...(spans.get(node.id) ?? []), span]);
  };

  let header = false;
  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineStart = offset;
    offset += raw.length + 1;
    const line = raw.trim().replace(/;$/, "").trimEnd();
    if (!line || line.startsWith("%")) continue;
    if (!header) {
      if (!/^(graph|flowchart)\b/.test(line))
        throw new ParseError(`Expected 'graph' or 'flowchart' declaration, got: ${line}`);
      header = true;
      continue;
    }

    const at = lineStart + raw.length - raw.trimStart().length;
    const e = parseEdgeLine(line, at);
    if (e) {
      register(e.src);
      register(e.dst);
      edges.push({ src: e.src.node.id, dst: e.dst.node.id, label: e.label, span: e.span });
      continue;
    }
    const n = line === "end" ? null : ref(line, at, [0, line.length]);
    if (n) register(n);
    else graph.warnings.push({ line: i + 1, message: `not understood: ${line}` });
  }
  if (!header) throw new ParseError("Empty Mermaid file");

  const nameOf = (id: string) => nodes.get(id)?.label ?? id;
  for (const [id, list] of spans) for (const span of list) graph.addNode(nameOf(id), span);
  for (const e of edges) graph.addEdge({ ...e, src: nameOf(e.src), dst: nameOf(e.dst) });
  return graph;
}

const ARROW_ALT = ARROWS.map((a) => a.replace(/[()]/g, "\\$&")).join("|");
const ARROW_CELL = new RegExp(`^(${ARROW_ALT})([+-])?$`);
const SELF_ARROW = new RegExp(`^(.*?)\\s+(${ARROW_ALT})([+-])?$`);
const ACTOR = /^actor:\s*/;

class Activations {
  private depth = new Map<string, number>();

  apply(m: Message, line: number): void {
    if (m.activation === "+") this.depth.set(m.to, (this.depth.get(m.to) ?? 0) + 1);
    if (m.activation !== "-") return;
    const d = this.depth.get(m.from) ?? 0;
    if (!d) throw new ParseError(`Line ${line}: "${m.from}" isn't active, so it can't deactivate`);
    this.depth.set(m.from, d - 1);
  }
}

function parseTable(text: string): Graph {
  const graph = new Graph("mid", "sequence");
  const table = readTable(text)!;
  for (const line of `${table.before}${table.after}`.split("\n"))
    if (line.trim() === "autonumber") graph.autonumber = true;

  const [head, separator, ...body] = table.rows;
  if (!isSeparator(separator))
    throw new ParseError(`Line ${head!.line + 1}: expected a | --- | row under the participants`);

  const names = head!.cells.map((cell, i) => {
    const prefix = ACTOR.exec(cell.text)?.[0] ?? "";
    const name = cell.text.slice(prefix.length);
    if (!name) throw new ParseError(`Line ${head!.line}: column ${i + 1} has no participant`);
    if (graph.nodes.has(name))
      throw new ParseError(`Line ${head!.line}: "${name}" is listed twice`);
    graph.addNode(name, { start: cell.span.start + prefix.length, end: cell.span.end });
    if (prefix) graph.actors.add(name);
    return name;
  });

  const activations = new Activations();
  for (const { line, cells } of body) {
    const filled = cells.map((cell, col) => ({ cell, col })).filter(({ cell }) => cell.text);
    if (!filled.length) continue;
    const extra = filled.find(({ col }) => col >= names.length);
    if (extra) throw new ParseError(`Line ${line}: no participant for column ${extra.col + 1}`);

    const arrows = filled.filter(({ cell }) => ARROW_CELL.test(cell.text));
    const texts = filled.filter(({ cell }) => !ARROW_CELL.test(cell.text));
    if (texts.length !== 1 || arrows.length > 1)
      throw new ParseError(
        `Line ${line}: a row is one message: its text under the sender and an arrow like ->> under the receiver`,
      );

    const sender = texts[0]!;
    const receiver = arrows[0];
    const self = receiver ? undefined : SELF_ARROW.exec(sender.cell.text);
    const [arrow, activation] = receiver
      ? ARROW_CELL.exec(receiver.cell.text)!.slice(1)
      : (self?.slice(2) ?? ["->>"]);
    const text = self ? self[1]! : sender.cell.text;
    const message: Message = {
      from: names[sender.col]!,
      to: names[receiver?.col ?? sender.col]!,
      text,
      arrow: arrow as Arrow,
      span: { start: sender.cell.span.start, end: sender.cell.span.start + text.length },
    };
    if (activation) message.activation = activation as "+" | "-";
    if (receiver) graph.addNode(message.to, receiver.cell.span);
    activations.apply(message, line);
    graph.messages.push(message);
  }

  return graph;
}

const PARTICIPANT = /^(participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/d;
const SEQ_MESSAGE = new RegExp(`^(\\w+)\\s*(${ARROW_ALT})\\s*([+-])?\\s*(\\w+)\\s*:(.*)$`, "d");

function parseMermaidSequence(text: string): Graph {
  const graph = new Graph("mermaid", "sequence");
  const labels = new Map<string, string>();
  const spans = new Map<string, Span[]>();
  const actors = new Set<string>();
  const messages: Message[] = [];
  const activations = new Activations();
  const register = (id: string, span: Span, label?: string) => {
    if (label !== undefined || !labels.has(id)) labels.set(id, label ?? labels.get(id) ?? id);
    spans.set(id, [...(spans.get(id) ?? []), span]);
  };

  let header = false;
  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineStart = offset;
    offset += raw.length + 1;
    const line = raw.trim().replace(/;$/, "").trimEnd();
    if (!line || line.startsWith("%")) continue;
    if (!header) {
      header = true;
      continue;
    }
    if (line === "autonumber") {
      graph.autonumber = true;
      continue;
    }

    const at = lineStart + raw.length - raw.trimStart().length;
    const span = (m: RegExpExecArray, group: number) => {
      const [start, end] = m.indices![group]!;
      return trimmedSpan(line.slice(start, end), at + start);
    };
    const p = PARTICIPANT.exec(line);
    if (p) {
      register(p[2]!, span(p, 2), p[3]?.trim());
      if (p[1] === "actor") actors.add(p[2]!);
      continue;
    }
    const m = SEQ_MESSAGE.exec(line);
    if (m) {
      register(m[1]!, span(m, 1));
      register(m[4]!, span(m, 4));
      const message: Message = {
        from: m[1]!,
        to: m[4]!,
        text: m[5]!.trim(),
        arrow: m[2] as Arrow,
        span: span(m, 5),
      };
      if (m[3]) message.activation = m[3] as "+" | "-";
      activations.apply(message, i + 1);
      messages.push(message);
      continue;
    }
    graph.warnings.push({ line: i + 1, message: `not understood: ${line}` });
  }

  const nameOf = (id: string) => labels.get(id) ?? id;
  for (const [id, list] of spans) for (const s of list) graph.addNode(nameOf(id), s);
  for (const id of actors) graph.actors.add(nameOf(id));
  for (const m of messages) graph.messages.push({ ...m, from: nameOf(m.from), to: nameOf(m.to) });
  return graph;
}
