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

interface Point {
  x: number;
  y: number;
}

interface Label extends Point {
  text: string;
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
    const d = g.edge(e) as { label?: string; x?: number; y?: number; points: Point[] };
    const label: Label | undefined =
      d.label && d.x !== undefined && d.y !== undefined
        ? { text: d.label, x: d.x, y: d.y }
        : undefined;
    return { src: e.v, dst: e.w, label, points: d.points };
  });
  const { width = 0, height = 0 } = g.graph();
  return { nodes, edges, width, height };
}

export function renderAscii(graph: Graph): string {
  if (graph.kind === "sequence") return sequenceAscii(graph);
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
  if (graph.kind === "sequence") return sequenceMermaid(graph);
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

const UX = 9;
const UY = 18;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (v: number) => String(Math.round(v * 10) / 10);

function text(rows: string[], x: number, y: number): string {
  const spans = rows.map(
    (row, i) =>
      `<tspan x="${num(x)}" y="${num(y + (i - (rows.length - 1) / 2) * UY)}">${xml(row)}</tspan>`,
  );
  return `<text fill="currentColor" text-anchor="middle" dominant-baseline="central">${spans.join("")}</text>`;
}

const ARROW_DEF = `<defs><marker id="mid-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;

function svgOpen(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="mid-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" font-size="14">`;
}

export function renderSvg(graph: Graph): string {
  if (graph.kind === "sequence") return sequenceSvg(graph);
  if (graph.nodes.size === 0) return `${svgOpen(0, 0)}</svg>`;

  const lay = layout(graph);
  const parts = [svgOpen(Math.ceil(lay.width * UX), Math.ceil(lay.height * UY)), ARROW_DEF];

  for (const e of lay.edges) {
    const d = e.points.map((p) => `${num(p.x * UX)} ${num(p.y * UY)}`).join("L");
    parts.push(
      `<path class="mid-edge" d="M${d}" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mid-arrow)"/>`,
    );
  }

  for (const { label } of lay.edges) {
    if (!label) continue;
    const x = label.x * UX;
    const y = label.y * UY;
    const w = label.text.length * UX + 8;
    parts.push(
      `<g class="mid-label"><rect class="mid-label-bg" x="${num(x - w / 2)}" y="${num(y - UY / 2)}" width="${num(w)}" height="${UY}" fill="#fff"/>${text([label.text], x, y)}</g>`,
    );
  }

  for (const n of lay.nodes) {
    const x = n.x * UX;
    const y = n.y * UY;
    const w = n.w * UX;
    const h = n.h * UY;
    parts.push(
      `<g class="mid-node" data-node="${xml(n.name)}"><rect class="mid-box" x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${num(w)}" height="${num(h)}" rx="6" fill="#fff" stroke="currentColor" stroke-width="1.5"/>${text(nodeLines(n.name), x, y)}</g>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function midText(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\\n");
}

export function renderMid(graph: Graph): string {
  if (graph.kind === "sequence") return sequenceMid(graph);
  const outgoing = new Map<string, Graph["edges"]>();
  for (const e of graph.edges) outgoing.set(e.src, [...(outgoing.get(e.src) ?? []), e]);
  const hasIncoming = new Set(graph.edges.map((e) => e.dst));
  const expanded = new Set<string>();
  const lines: string[] = [];

  const visit = (name: string, depth: number, label?: string) => {
    const text = label ? `[${midText(label)}](${midText(name)})` : midText(name);
    lines.push(`${"  ".repeat(depth)}- ${text}`);
    if (expanded.has(name)) return;
    expanded.add(name);
    for (const e of outgoing.get(name) ?? []) visit(e.dst, depth + 1, e.label);
  };

  for (const name of graph.nodes) if (!hasIncoming.has(name) && !expanded.has(name)) visit(name, 0);
  for (const name of graph.nodes) if (!expanded.has(name)) visit(name, 0);
  return lines.join("\n");
}

const GAP = 4;

function sequenceLayout(graph: Graph) {
  const names = [...graph.nodes];
  const col = new Map(names.map((name, i) => [name, i]));
  const widths = names.map((name) => nodeWidth(name) + 4);
  const headH = Math.max(...names.map((name) => nodeLines(name).length)) + 2;
  const x: number[] = [];
  for (let i = 0; i < names.length; i++)
    x.push(
      i === 0
        ? Math.floor(widths[0]! / 2) + 1
        : x[i - 1]! + Math.ceil(widths[i - 1]! / 2) + GAP + Math.floor(widths[i]! / 2),
    );

  let extra = 0;
  const widen = (lo: number, hi: number, need: number) => {
    const d = need - (x[hi]! - x[lo]!);
    if (d > 0) for (let i = hi; i < x.length; i++) x[i]! += d;
  };
  for (const m of graph.messages) {
    const a = col.get(m.from)!;
    const b = col.get(m.to)!;
    const need = m.text.length + 4;
    if (a !== b) widen(Math.min(a, b), Math.max(a, b), need);
    else if (a < x.length - 1) widen(a, a + 1, need);
    else extra = Math.max(extra, need);
  }

  let row = headH + 1;
  const rows = graph.messages.map((m) => {
    const r = row;
    row += m.from === m.to ? 4 : 3;
    return r;
  });
  const last = names.length - 1;
  const width = x[last]! + Math.ceil(widths[last]! / 2) + extra + 1;
  return { names, col, widths, headH, x, rows, width, height: row };
}

function sequenceAscii(graph: Graph): string {
  if (graph.nodes.size === 0) return "(empty graph)";
  const lay = sequenceLayout(graph);
  const grid = Array.from({ length: lay.height }, () => Array<string>(lay.width).fill(" "));
  const put = (r: number, c: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      if (r >= 0 && r < lay.height && c + i >= 0 && c + i < lay.width) grid[r]![c + i] = text[i]!;
  };

  lay.names.forEach((name, i) => {
    const w = lay.widths[i]!;
    const cx = lay.x[i]!;
    const left = cx - Math.floor(w / 2);
    const lines = nodeLines(name);
    const top = Math.floor((lay.headH - 2 - lines.length) / 2);
    put(0, left, `╭${"─".repeat(w - 2)}╮`);
    for (let r = 0; r < lay.headH - 2; r++) {
      const t = lines[r - top] ?? "";
      const padL = Math.floor((w - 4 - t.length) / 2);
      put(1 + r, left, `│ ${" ".repeat(padL)}${t}${" ".repeat(w - 4 - t.length - padL)} │`);
    }
    put(lay.headH - 1, left, `╰${"─".repeat(w - 2)}╯`);
    for (let r = lay.headH; r < lay.height; r++) put(r, cx, "│");
  });

  graph.messages.forEach((m, k) => {
    const a = lay.x[lay.col.get(m.from)!]!;
    const b = lay.x[lay.col.get(m.to)!]!;
    const r = lay.rows[k]!;
    if (a === b) {
      put(r, a + 2, m.text);
      put(r + 1, a, "├──╮");
      put(r + 2, a, "│<─╯");
      return;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    put(r, lo + 2, m.text);
    put(r + 1, lo + 1, "─".repeat(hi - lo - 1));
    if (b > a) {
      put(r + 1, a, "├");
      put(r + 1, b - 1, ">");
    } else {
      put(r + 1, a, "┤");
      put(r + 1, b + 1, "<");
    }
  });

  return grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n");
}

function sequenceSvg(graph: Graph): string {
  if (graph.nodes.size === 0) return `${svgOpen(0, 0)}</svg>`;
  const lay = sequenceLayout(graph);
  const parts = [svgOpen(Math.ceil(lay.width * UX), Math.ceil(lay.height * UY)), ARROW_DEF];

  lay.names.forEach((name, i) => {
    const cx = lay.x[i]! * UX;
    parts.push(
      `<line class="mid-lifeline" x1="${num(cx)}" y1="${num(lay.headH * UY)}" x2="${num(cx)}" y2="${num(lay.height * UY)}" stroke="currentColor" stroke-dasharray="4 4" opacity="0.5"/>`,
    );
  });

  lay.names.forEach((name, i) => {
    const cx = lay.x[i]! * UX;
    const w = lay.widths[i]! * UX;
    const h = lay.headH * UY - 4;
    parts.push(
      `<g class="mid-node" data-node="${xml(name)}"><rect class="mid-box" x="${num(cx - w / 2)}" y="2" width="${num(w)}" height="${num(h)}" rx="6" fill="#fff" stroke="currentColor" stroke-width="1.5"/>${text(nodeLines(name), cx, 2 + h / 2)}</g>`,
    );
  });

  graph.messages.forEach((m, k) => {
    const a = lay.x[lay.col.get(m.from)!]! * UX;
    const b = lay.x[lay.col.get(m.to)!]! * UX;
    const r = lay.rows[k]!;
    const ty = (r + 0.5) * UY;
    const ly = (r + 1.5) * UY;
    const d =
      a === b
        ? `M${num(a)} ${num(ly)}H${num(a + 28)}V${num(ly + UY)}H${num(a + 2)}`
        : `M${num(a)} ${num(ly)}H${num(b > a ? b - 1 : b + 1)}`;
    const label =
      a === b
        ? `<text x="${num(a + 8)}" y="${num(ty)}" fill="currentColor" text-anchor="start" dominant-baseline="central">${xml(m.text)}</text>`
        : text([m.text], (a + b) / 2, ty);
    parts.push(
      `<g class="mid-message" data-message="${k}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mid-arrow)"/>${label}</g>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

function sequenceMermaid(graph: Graph): string {
  const ids = new Map([...graph.nodes].map((name, i) => [name, `p${i}`]));
  const lines = ["sequenceDiagram"];
  for (const [name, id] of ids) lines.push(`  participant ${id} as ${mermaidText(name)}`);
  for (const m of graph.messages)
    lines.push(`  ${ids.get(m.from)}->>${ids.get(m.to)}: ${mermaidText(m.text)}`);
  return lines.join("\n");
}

function sequenceMid(graph: Graph): string {
  const names = [...graph.nodes].map(midText);
  const col = new Map([...graph.nodes].map((name, i) => [name, i]));
  const rows = graph.messages.map((m) => {
    const cells = names.map(() => "");
    const a = col.get(m.from)!;
    const b = col.get(m.to)!;
    const message = midText(m.text).replace(/\|/g, "\\|");
    cells[a] = b === a + 1 ? message : `[${message}](${names[b]})`;
    return cells;
  });
  const widths = names.map((name, i) => Math.max(3, name.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
  return [line(names), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}
