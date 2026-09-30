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

export interface Message {
  from: string;
  to: string;
  text: string;
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

export function parse(text: string): Graph {
  const lines = text.split("\n").map((l) => l.trim());
  const first = lines.find((l) => l && !l.startsWith("%")) ?? "";
  if (/^sequenceDiagram\b/.test(first)) return parseMermaidSequence(text);
  if (/^(graph|flowchart)\b/.test(first)) return parseMermaid(text);
  if (lines.some((l) => l.startsWith("|"))) return parseTable(text);
  return parseMarkdown(text);
}

const BULLET = /^(\s*)[-*+]\s+(.*\S)\s*$/;
const PREFIX = /^\s*[-*+]\s+/;
const LINK = /^\[(.+?)\]\((.+?)\)$/;

function expandTabs(s: string, width = 4): string {
  let out = "";
  for (const ch of s) out += ch === "\t" ? " ".repeat(width - (out.length % width)) : ch;
  return out;
}

function trimmedSpan(raw: string, at: number): Span {
  const start = at + raw.length - raw.trimStart().length;
  return { start, end: start + raw.trim().length };
}

function parseMarkdown(text: string): Graph {
  const graph = new Graph();
  const stack: Array<{ indent: number; name: string }> = [];

  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineStart = offset;
    offset += raw.length + 1;
    const m = BULLET.exec(expandTabs(raw));
    if (!m) continue;

    const indent = m[1]!.length;
    const prefix = PREFIX.exec(raw)![0].length;
    const content = raw.slice(prefix).trimEnd();
    const at = lineStart + prefix;
    const link = LINK.exec(content);
    const name = (link ? link[2]! : content).trim();
    if (!name) throw new ParseError(`Empty node on line ${i + 1}`);
    const nameSpan = link
      ? trimmedSpan(link[2]!, at + content.length - 1 - link[2]!.length)
      : trimmedSpan(content, at);
    const label = link?.[1]!.trim();
    const labelSpan = link ? trimmedSpan(link[1]!, at + 1) : undefined;

    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();

    graph.addNode(name, nameSpan);
    const parent = stack[stack.length - 1];
    if (parent) graph.addEdge({ src: parent.name, dst: name, label, span: labelSpan });
    stack.push({ indent, name });
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

const ARROWS = ["-.->", "-->", "---", "-.-"];
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
  for (const arrow of ARROWS) {
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
    const n = ref(line, at, [0, line.length]);
    if (n) register(n);
    else graph.warnings.push({ line: i + 1, message: `not understood: ${line}` });
  }
  if (!header) throw new ParseError("Empty Mermaid file");

  const nameOf = (id: string) => nodes.get(id)?.label ?? id;
  for (const [id, list] of spans) for (const span of list) graph.addNode(nameOf(id), span);
  for (const e of edges) graph.addEdge({ ...e, src: nameOf(e.src), dst: nameOf(e.dst) });
  return graph;
}

interface Cell {
  text: string;
  span: Span;
}

function tableCells(raw: string, at: number): Cell[] {
  const cells: Cell[] = [];
  let start = raw.indexOf("|") + 1;
  for (let i = start; i <= raw.length; i++) {
    if (i < raw.length && (raw[i] !== "|" || raw[i - 1] === "\\")) continue;
    const cell = raw.slice(start, i);
    cells.push({ text: cell.trim(), span: trimmedSpan(cell, at + start) });
    start = i + 1;
  }
  if (raw.trimEnd().endsWith("|")) cells.pop();
  return cells;
}

function parseTable(text: string): Graph {
  const graph = new Graph("mid", "sequence");
  const rows: Array<{ line: number; cells: Cell[] }> = [];

  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const at = offset;
    offset += raw.length + 1;
    if (raw.trimStart().startsWith("|")) rows.push({ line: i + 1, cells: tableCells(raw, at) });
    else if (rows.length) break;
  }

  const [head, separator, ...body] = rows;
  if (!separator || !separator.cells.every((c) => /^:?-+:?$/.test(c.text)))
    throw new ParseError(`Line ${head!.line + 1}: expected a | --- | row under the participants`);

  const names = head!.cells.map((c) => c.text);
  names.forEach((name, i) => {
    if (!name) throw new ParseError(`Line ${head!.line}: column ${i + 1} has no participant`);
    if (graph.nodes.has(name))
      throw new ParseError(`Line ${head!.line}: "${name}" is listed twice`);
    graph.addNode(name, head!.cells[i]!.span);
  });

  for (const { line, cells } of body) {
    cells.forEach((cell, col) => {
      if (!cell.text) return;
      const from = names[col];
      if (from === undefined)
        throw new ParseError(`Line ${line}: no participant for column ${col + 1}`);

      const link = LINK.exec(cell.text);
      if (link) {
        const to = link[2]!.trim();
        if (!graph.nodes.has(to)) throw new ParseError(`Line ${line}: unknown participant "${to}"`);
        const at = cell.span.start + cell.text.length - 1 - link[2]!.length;
        graph.addNode(to, trimmedSpan(link[2]!, at));
        graph.messages.push({
          from,
          to,
          text: link[1]!.trim(),
          span: trimmedSpan(link[1]!, cell.span.start + 1),
        });
        return;
      }
      const to = names[col + 1];
      if (to === undefined)
        throw new ParseError(
          `Line ${line}: "${from}" is the last column, so write [message](Receiver)`,
        );
      graph.messages.push({ from, to, text: cell.text, span: cell.span });
    });
  }

  return graph;
}

const PARTICIPANT = /^(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/d;
const SEQ_MESSAGE = /^(\w+)\s*(?:-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*(\w+)\s*:(.*)$/d;

function parseMermaidSequence(text: string): Graph {
  const graph = new Graph("mermaid", "sequence");
  const labels = new Map<string, string>();
  const spans = new Map<string, Span[]>();
  const messages: Array<{ from: string; to: string; text: string; span: Span }> = [];
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

    const at = lineStart + raw.length - raw.trimStart().length;
    const span = (m: RegExpExecArray, group: number) => {
      const [start, end] = m.indices![group]!;
      return trimmedSpan(line.slice(start, end), at + start);
    };
    const p = PARTICIPANT.exec(line);
    if (p) {
      register(p[1]!, span(p, 1), p[2]?.trim());
      continue;
    }
    const m = SEQ_MESSAGE.exec(line);
    if (m) {
      register(m[1]!, span(m, 1));
      register(m[2]!, span(m, 2));
      messages.push({ from: m[1]!, to: m[2]!, text: m[3]!.trim(), span: span(m, 3) });
      continue;
    }
    graph.warnings.push({ line: i + 1, message: `not understood: ${line}` });
  }

  const nameOf = (id: string) => labels.get(id) ?? id;
  for (const [id, list] of spans) for (const s of list) graph.addNode(nameOf(id), s);
  for (const m of messages) graph.messages.push({ ...m, from: nameOf(m.from), to: nameOf(m.to) });
  return graph;
}
