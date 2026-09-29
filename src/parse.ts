export class ParseError extends Error {}

interface Edge {
  src: string;
  dst: string;
  label?: string;
}

export class Graph {
  readonly nodes = new Set<string>();
  readonly edges: Edge[] = [];

  addNode(name: string): void {
    this.nodes.add(name);
  }

  addEdge(edge: Edge): void {
    if (this.edges.some((e) => e.src === edge.src && e.dst === edge.dst)) return;
    this.edges.push(edge);
  }
}

function isMermaid(text: string): boolean {
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%"));
  return /^(graph|flowchart)\b/.test(first ?? "");
}

export function parse(text: string): Graph {
  return isMermaid(text) ? parseMermaid(text) : parseMarkdown(text);
}

const BULLET = /^(\s*)[-*+]\s+(.*\S)\s*$/;
const LINK = /^\[(.+?)\]\((.+?)\)$/;

function expandTabs(s: string, width = 4): string {
  let out = "";
  for (const ch of s) out += ch === "\t" ? " ".repeat(width - (out.length % width)) : ch;
  return out;
}

function parseMarkdown(text: string): Graph {
  const graph = new Graph();
  const stack: Array<{ indent: number; name: string }> = [];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = BULLET.exec(expandTabs(lines[i]!));
    if (!m) continue;

    const indent = m[1]!.length;
    const link = LINK.exec(m[2]!);
    const name = (link ? link[2]! : m[2]!).trim();
    const label = link?.[1]!.trim();
    if (!name) throw new ParseError(`Empty node on line ${i + 1}`);

    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();

    graph.addNode(name);
    const parent = stack[stack.length - 1];
    if (parent) graph.addEdge({ src: parent.name, dst: name, label });
    stack.push({ indent, name });
  }

  return graph;
}

interface MNode {
  id: string;
  label?: string;
}

const ARROWS = ["-.->", "-->", "---", "-.-"];
const SHAPES = [/^(\w+)\[([^\]]+)\]/, /^(\w+)\(([^)]+)\)/, /^(\w+)\{([^}]+)\}/];

function parseNodeRef(text: string): MNode {
  const t = text.trim();
  for (const re of SHAPES) {
    const m = re.exec(t);
    if (m) return { id: m[1]!, label: m[2]!.trim() };
  }
  return { id: t };
}

function parseEdgeLine(line: string): { src: MNode; dst: MNode; label?: string } | null {
  for (const arrow of ARROWS) {
    const a = arrow.replace(/[.]/g, "\\.");
    let m = new RegExp(`^(.+?)\\s*${a}\\s*\\|([^|]+)\\|\\s*(.+)$`).exec(line);
    if (m) return { src: parseNodeRef(m[1]!), dst: parseNodeRef(m[3]!), label: m[2]!.trim() };
    m = new RegExp(`^(.+?)\\s*${a}\\s*(.+)$`).exec(line);
    if (m) return { src: parseNodeRef(m[1]!), dst: parseNodeRef(m[2]!) };
  }
  return null;
}

function parseMermaid(text: string): Graph {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%"));
  const header = lines.shift();
  if (header === undefined) throw new ParseError("Empty Mermaid file");
  if (!/^(graph|flowchart)\b/.test(header))
    throw new ParseError(`Expected 'graph' or 'flowchart' declaration, got: ${header}`);

  const nodes = new Map<string, MNode>();
  const edges: Array<{ src: string; dst: string; label?: string }> = [];
  const register = (n: MNode) => {
    const cur = nodes.get(n.id);
    if (!cur || (cur.label === undefined && n.label !== undefined)) nodes.set(n.id, n);
  };

  for (const line of lines) {
    const e = parseEdgeLine(line);
    if (e) {
      register(e.src);
      register(e.dst);
      edges.push({ src: e.src.id, dst: e.dst.id, label: e.label });
      continue;
    }
    const n = parseNodeRef(line);
    if (n.label !== undefined || /^\w+$/.test(line)) register(n);
  }

  const graph = new Graph();
  const nameOf = (id: string) => nodes.get(id)?.label ?? id;
  for (const id of nodes.keys()) graph.addNode(nameOf(id));
  for (const e of edges) graph.addEdge({ src: nameOf(e.src), dst: nameOf(e.dst), label: e.label });
  return graph;
}
