import dagre from "@dagrejs/dagre";
import type { Graph } from "./parse.ts";

function nodeLines(name: string): string[] {
  return name.split(/\\n/);
}

function nodeWidth(name: string): number {
  return Math.max(...nodeLines(name).map((l) => l.length));
}

interface Box {
  top: number;
  left: number;
  centerCol: number;
  w: number;
  h: number;
}

interface Label {
  text: string;
  x: number;
  y: number;
}

function layout(graph: Graph) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 4, ranksep: 4, edgesep: 2, marginx: 1, marginy: 1 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const name of graph.nodes) {
    g.setNode(name, { width: nodeWidth(name) + 4, height: nodeLines(name).length + 2 });
  }
  for (const e of graph.edges) {
    const lbl = e.label ?? "";
    g.setEdge(e.src, e.dst, lbl ? { label: lbl, width: lbl.length, height: 1, labelpos: "c" } : {});
  }

  dagre.layout(g);

  const nodes = g.nodes().map((name) => {
    const d = g.node(name) as { x: number; y: number; width: number; height: number };
    return { name, x: d.x, y: d.y, w: d.width, h: d.height };
  });
  const edges = g.edges().map((e) => {
    const d = g.edge(e) as { label?: string; x?: number; y?: number };
    const label: Label | undefined =
      d.label && d.x !== undefined && d.y !== undefined
        ? { text: d.label, x: d.x, y: d.y }
        : undefined;
    return { src: e.v, dst: e.w, label };
  });
  return { nodes, edges };
}

export function renderAscii(graph: Graph): string {
  const lay = layout(graph);
  if (lay.nodes.length === 0) return "(empty graph)";

  let minX = Infinity;
  let minY = Infinity;
  for (const n of lay.nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
  }
  for (const { label } of lay.edges) {
    if (!label) continue;
    minX = Math.min(minX, label.x - label.text.length / 2);
    minY = Math.min(minY, label.y);
  }
  const pad = 1;
  const toCol = (x: number) => Math.round(x - minX) + pad;
  const toRow = (y: number) => Math.round(y - minY) + pad;

  const boxes = new Map<string, Box>();
  for (const { name, x, y, w, h } of lay.nodes) {
    const centerCol = toCol(x);
    boxes.set(name, {
      top: toRow(y) - Math.floor(h / 2),
      left: centerCol - Math.floor(w / 2),
      centerCol,
      w,
      h,
    });
  }

  let width = 0;
  let height = 0;
  for (const b of boxes.values()) {
    width = Math.max(width, b.left + b.w + pad);
    height = Math.max(height, b.top + b.h + pad);
  }
  for (const { label } of lay.edges) {
    if (!label) continue;
    width = Math.max(width, toCol(label.x) + Math.ceil(label.text.length / 2) + pad);
    height = Math.max(height, toRow(label.y) + pad);
  }

  const grid: string[][] = Array.from({ length: height }, () => Array<string>(width).fill(" "));
  const set = (r: number, c: number, ch: string) => {
    if (r >= 0 && r < height && c >= 0 && c < width) grid[r]![c] = ch;
  };
  const setBlank = (r: number, c: number, ch: string) => {
    if (r >= 0 && r < height && c >= 0 && c < width && grid[r]![c] === " ") grid[r]![c] = ch;
  };
  const draw = (r: number, c: number, text: string) => {
    for (let i = 0; i < text.length; i++) set(r, c + i, text[i]!);
  };

  for (const e of lay.edges) {
    const s = boxes.get(e.src)!;
    const d = boxes.get(e.dst)!;
    const sc = s.centerCol;
    const dc = d.centerCol;
    const startRow = s.top + s.h;
    const endRow = d.top - 1;

    if (Math.abs(sc - dc) <= 1) {
      for (let r = startRow; r <= endRow; r++) setBlank(r, sc, "│");
    } else {
      const mid = startRow + 1;
      for (let r = startRow; r <= mid; r++) setBlank(r, sc, "│");
      set(mid, sc, dc > sc ? "╰" : "╯");
      set(mid, dc, dc > sc ? "╮" : "╭");
      for (let c = Math.min(sc, dc) + 1; c < Math.max(sc, dc); c++) setBlank(mid, c, "─");
      for (let r = mid + 1; r <= endRow; r++) setBlank(r, dc, "│");
    }

    if (e.label) {
      draw(toRow(e.label.y), toCol(e.label.x) - Math.floor(e.label.text.length / 2), e.label.text);
    }
  }

  for (const [name, b] of boxes) {
    const inner = b.w - 4;
    const rows = nodeLines(name);
    draw(b.top, b.left, `╭${"─".repeat(b.w - 2)}╮`);
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]!;
      const padL = Math.floor((inner - t.length) / 2);
      const padR = inner - t.length - padL;
      draw(b.top + 1 + i, b.left, `│ ${" ".repeat(padL)}${t}${" ".repeat(padR)} │`);
    }
    draw(b.top + b.h - 1, b.left, `╰${"─".repeat(b.w - 2)}╯`);
  }

  const lines = compress(grid).map((row) => row.join("").replace(/\s+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function compress(grid: string[][]): string[][] {
  const keep = new Set("╭╮╰╯─");
  const out: string[][] = [];
  let blank = false;
  for (const row of grid) {
    const hasContent = row.some((ch) => keep.has(ch) || /[A-Za-z0-9]/.test(ch));
    if (hasContent || !blank) out.push(row);
    blank = !hasContent;
  }
  return out;
}

function mermaidText(s: string): string {
  return s.replace(/\\n/g, "<br/>");
}

export function renderMermaid(graph: Graph): string {
  const ids = new Map([...graph.nodes].map((name, i) => [name, `n${i}`]));
  const lines = ["graph TD"];
  for (const [name, id] of ids) lines.push(`  ${id}[${mermaidText(name)}]`);
  for (const e of graph.edges) {
    const s = ids.get(e.src)!;
    const d = ids.get(e.dst)!;
    lines.push(e.label ? `  ${s} -->|${mermaidText(e.label)}| ${d}` : `  ${s} --> ${d}`);
  }
  return lines.join("\n");
}
