import dagre from "@dagrejs/dagre";
import { joinNode, writeOutline, writeTable } from "./mid.ts";
import type { Arrow, Graph, Message } from "./parse.ts";

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
  lines: string[];
}

const labelWidth = (label: Label) => Math.max(...label.lines.map((l) => l.length));
const labelAbove = (label: Label) => Math.floor((label.lines.length - 1) / 2);

function layout(graph: Graph) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 4, ranksep: 4, edgesep: 2, marginx: 1, marginy: 1 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const name of graph.nodes) {
    g.setNode(name, { width: nodeWidth(name) + 4, height: nodeLines(name).length + 2 });
  }
  for (const e of graph.edges) {
    const lbl = e.label ?? "";
    g.setEdge(
      e.src,
      e.dst,
      lbl
        ? { label: lbl, width: nodeWidth(lbl), height: nodeLines(lbl).length, labelpos: "c" }
        : {},
    );
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
        ? { lines: nodeLines(d.label), x: d.x, y: d.y }
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
    minX = Math.min(minX, label.x - labelWidth(label) / 2);
    minY = Math.min(minY, label.y - labelAbove(label));
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
    width = Math.max(width, toCol(label.x) + Math.ceil(labelWidth(label) / 2) + pad);
    height = Math.max(height, toRow(label.y) - labelAbove(label) + label.lines.length - 1 + pad);
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
      const top = toRow(e.label.y) - labelAbove(e.label);
      const col = toCol(e.label.x);
      e.label.lines.forEach((line, k) => draw(top + k, col - Math.floor(line.length / 2), line));
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

function text(rows: string[], x: number, y: number, anchor = "middle"): string {
  const spans = rows.map(
    (row, i) =>
      `<tspan x="${num(x)}" y="${num(y + (i - (rows.length - 1) / 2) * UY)}">${xml(row)}</tspan>`,
  );
  return `<text fill="currentColor" text-anchor="${anchor}" dominant-baseline="central">${spans.join("")}</text>`;
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
      `<path class="mid-svg-edge" d="M${d}" fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#mid-arrow)"/>`,
    );
  }

  for (const { label } of lay.edges) {
    if (!label) continue;
    const x = label.x * UX;
    const y = label.y * UY;
    const w = labelWidth(label) * UX + 8;
    const h = label.lines.length * UY;
    parts.push(
      `<g class="mid-svg-label"><rect class="mid-svg-label-bg" x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${num(w)}" height="${num(h)}" fill="#fff"/>${text(label.lines, x, y)}</g>`,
    );
  }

  for (const n of lay.nodes) {
    const x = n.x * UX;
    const y = n.y * UY;
    const w = n.w * UX;
    const h = n.h * UY;
    parts.push(
      `<g class="mid-svg-node" data-node="${xml(n.name)}"><rect class="mid-svg-box" x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${num(w)}" height="${num(h)}" rx="6" fill="#fff" stroke="currentColor" stroke-width="1.5"/>${text(nodeLines(n.name), x, y)}</g>`,
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
  const items: Array<{ level: number; text: string }> = [];

  const visit = (name: string, level: number, label?: string) => {
    items.push({ level, text: joinNode(midText(name), label && midText(label)) });
    if (expanded.has(name)) return;
    expanded.add(name);
    for (const e of outgoing.get(name) ?? []) visit(e.dst, level + 1, e.label);
  };

  for (const name of graph.nodes) if (!hasIncoming.has(name) && !expanded.has(name)) visit(name, 0);
  for (const name of graph.nodes) if (!expanded.has(name)) visit(name, 0);
  return writeOutline(items).text;
}

const GAP = 4;
const ASCII_FIGURE = ["o", "-|-"];
const SVG_FIGURE = 3;

function messageLines(graph: Graph, m: Message, k: number): string[] {
  return nodeLines(graph.autonumber ? `${k + 1}. ${m.text}` : m.text);
}

function dashed(arrow: Arrow): boolean {
  return arrow.startsWith("--") || arrow.startsWith("<<--");
}

function tip(arrow: Arrow): "head" | "open" | "cross" | undefined {
  if (arrow.endsWith(">>")) return "head";
  if (arrow.endsWith(")")) return "open";
  if (arrow.endsWith("x")) return "cross";
  return undefined;
}

interface Bar {
  name: string;
  start: number;
  end: number;
  depth: number;
}

function sequenceLayout(graph: Graph, figure: number) {
  const names = [...graph.nodes];
  const col = new Map(names.map((name, i) => [name, i]));
  const widths = names.map((name) => nodeWidth(name) + 4);
  const headH = Math.max(
    ...names.map((name) => nodeLines(name).length + (graph.actors.has(name) ? figure : 2)),
  );
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
  graph.messages.forEach((m, k) => {
    const a = col.get(m.from)!;
    const b = col.get(m.to)!;
    const need = Math.max(...messageLines(graph, m, k).map((l) => l.length)) + 4;
    if (a !== b) widen(Math.min(a, b), Math.max(a, b), need);
    else if (a < x.length - 1) widen(a, a + 1, need);
    else extra = Math.max(extra, need);
  });

  let row = headH + 1;
  const tall = graph.messages.map((m, k) => messageLines(graph, m, k).length);
  const rows = graph.messages.map((m, k) => {
    const r = row;
    row += tall[k]! + (m.from === m.to ? 3 : 2);
    return r;
  });
  const arrowAt = (k: number) => rows[k]! + tall[k]!;
  const height = row;

  const bars: Bar[] = [];
  const open = new Map<string, Bar[]>();
  graph.messages.forEach((m, k) => {
    const arrowRow = arrowAt(k) + (m.from === m.to ? 1 : 0);
    if (m.activation === "+") {
      const stack = open.get(m.to) ?? [];
      const bar = { name: m.to, start: arrowRow, end: height - 1, depth: stack.length };
      stack.push(bar);
      open.set(m.to, stack);
      bars.push(bar);
    } else if (m.activation === "-") {
      const bar = open.get(m.from)?.pop();
      if (bar) bar.end = arrowAt(k);
    }
  });

  const activeAt = (name: string, r: number) =>
    bars.filter((b) => b.name === name && b.start <= r && r <= b.end).length;

  const last = names.length - 1;
  const width = x[last]! + Math.ceil(widths[last]! / 2) + extra + 1;
  return { names, col, widths, headH, x, rows, arrowAt, bars, activeAt, width, height };
}

function sequenceAscii(graph: Graph): string {
  if (graph.nodes.size === 0) return "(empty graph)";
  const lay = sequenceLayout(graph, ASCII_FIGURE.length);
  const grid = Array.from({ length: lay.height }, () => Array<string>(lay.width).fill(" "));
  const put = (r: number, c: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      if (r >= 0 && r < lay.height && c + i >= 0 && c + i < lay.width) grid[r]![c + i] = text[i]!;
  };
  const center = (r: number, cx: number, t: string) => put(r, cx - Math.floor(t.length / 2), t);

  lay.names.forEach((name, i) => {
    const w = lay.widths[i]!;
    const cx = lay.x[i]!;
    const lines = nodeLines(name);
    if (graph.actors.has(name)) {
      ASCII_FIGURE.forEach((t, r) => center(r, cx, t));
      lines.forEach((t, r) => center(ASCII_FIGURE.length + r, cx, t));
    } else {
      const left = cx - Math.floor(w / 2);
      const top = Math.floor((lay.headH - 2 - lines.length) / 2);
      put(0, left, `╭${"─".repeat(w - 2)}╮`);
      for (let r = 0; r < lay.headH - 2; r++) {
        const t = lines[r - top] ?? "";
        const padL = Math.floor((w - 4 - t.length) / 2);
        put(1 + r, left, `│ ${" ".repeat(padL)}${t}${" ".repeat(w - 4 - t.length - padL)} │`);
      }
      put(lay.headH - 1, left, `╰${"─".repeat(w - 2)}╯`);
    }
    for (let r = lay.headH; r < lay.height; r++) put(r, cx, lay.activeAt(name, r) ? "┃" : "│");
  });

  const tipChar = (arrow: Arrow, dir: number) => {
    const t = tip(arrow);
    if (t === "head") return dir > 0 ? ">" : "<";
    if (t === "open") return dir > 0 ? ")" : "(";
    if (t === "cross") return "x";
    return undefined;
  };

  graph.messages.forEach((m, k) => {
    const a = lay.x[lay.col.get(m.from)!]!;
    const b = lay.x[lay.col.get(m.to)!]!;
    const r = lay.rows[k]!;
    const at = lay.arrowAt(k);
    const line = dashed(m.arrow) ? "┄" : "─";
    const labels = messageLines(graph, m, k);
    const active = lay.activeAt(m.from, at) > 0;
    if (a === b) {
      labels.forEach((l, i) => put(r + i, a + 2, l));
      put(at, a, `${active ? "┣" : "├"}${line}${line}╮`);
      put(at + 1, a + 1, `${tipChar(m.arrow, -1) ?? line}${line}╯`);
      return;
    }
    const dir = b > a ? 1 : -1;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    labels.forEach((l, i) => put(r + i, lo + 2, l));
    put(at, lo + 1, line.repeat(hi - lo - 1));
    put(at, a, dir > 0 ? (active ? "┣" : "├") : active ? "┫" : "┤");
    const end = tipChar(m.arrow, dir);
    if (end) put(at, b - dir, end);
    if (m.arrow.startsWith("<<")) put(at, a + dir, tipChar(m.arrow, -dir)!);
  });

  return grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n");
}

const SEQ_DEFS = `<defs><marker id="mid-head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker><marker id="mid-open" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1 1L10 5L1 9" fill="none" stroke="currentColor" stroke-width="1.5"/></marker><marker id="mid-cross" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5"/></marker></defs>`;

const BAR = 5;

function sequenceSvg(graph: Graph): string {
  if (graph.nodes.size === 0) return `${svgOpen(0, 0)}</svg>`;
  const lay = sequenceLayout(graph, SVG_FIGURE);
  const parts = [svgOpen(Math.ceil(lay.width * UX), Math.ceil(lay.height * UY)), SEQ_DEFS];

  lay.names.forEach((name, i) => {
    const cx = lay.x[i]! * UX;
    parts.push(
      `<line class="mid-svg-lifeline" x1="${num(cx)}" y1="${num(lay.headH * UY)}" x2="${num(cx)}" y2="${num(lay.height * UY)}" stroke="currentColor" stroke-dasharray="4 4" opacity="0.5"/>`,
    );
  });

  for (const bar of lay.bars) {
    const cx = lay.x[lay.col.get(bar.name)!]! * UX + bar.depth * BAR;
    const y = (bar.start + 0.5) * UY;
    const h = Math.min(bar.end + 0.5, lay.height) * UY - y;
    parts.push(
      `<rect class="mid-svg-bar" x="${num(cx - BAR)}" y="${num(y)}" width="${BAR * 2}" height="${num(h)}" fill="#fff" stroke="currentColor" stroke-width="1.5"/>`,
    );
  }

  lay.names.forEach((name, i) => {
    const cx = lay.x[i]! * UX;
    const w = lay.widths[i]! * UX;
    const h = lay.headH * UY - 4;
    const lines = nodeLines(name);
    if (graph.actors.has(name)) {
      const figure = `<circle class="mid-svg-box" cx="${num(cx)}" cy="11" r="7" fill="#fff" stroke="currentColor" stroke-width="1.5"/><path d="M${num(cx)} 18V34M${num(cx - 10)} 24H${num(cx + 10)}M${num(cx - 9)} 46L${num(cx)} 34L${num(cx + 9)} 46" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
      const ty = SVG_FIGURE * UY + (lines.length * UY) / 2;
      parts.push(
        `<g class="mid-svg-node" data-node="${xml(name)}"><rect x="${num(cx - w / 2)}" y="2" width="${num(w)}" height="${num(h)}" fill="none" pointer-events="all"/>${figure}${text(lines, cx, ty)}</g>`,
      );
      return;
    }
    parts.push(
      `<g class="mid-svg-node" data-node="${xml(name)}"><rect class="mid-svg-box" x="${num(cx - w / 2)}" y="2" width="${num(w)}" height="${num(h)}" rx="6" fill="#fff" stroke="currentColor" stroke-width="1.5"/>${text(lines, cx, 2 + h / 2)}</g>`,
    );
  });

  graph.messages.forEach((m, k) => {
    const r = lay.rows[k]!;
    const edge = (name: string, row: number, toward: number) => {
      const cx = lay.x[lay.col.get(name)!]! * UX;
      const depth = lay.activeAt(name, row);
      return depth ? cx + (toward > 0 ? BAR : -BAR) + (depth - 1) * BAR : cx;
    };
    const lines = nodeLines(m.text);
    const at = lay.arrowAt(k);
    const ty = (r + lines.length / 2) * UY;
    const ly = (at + 0.5) * UY;
    const self = m.from === m.to;
    const ax = lay.x[lay.col.get(m.from)!]! * UX;
    const bx = lay.x[lay.col.get(m.to)!]! * UX;
    const dir = self || bx > ax ? 1 : -1;
    const a = edge(m.from, at, dir);
    const t = tip(m.arrow);
    const gap = t === "head" || t === "open" ? 1 : 0;
    const d = self
      ? `M${num(a)} ${num(ly)}H${num(ax + 28)}V${num(ly + UY)}H${num(edge(m.to, at + 1, 1) + gap)}`
      : `M${num(a)} ${num(ly)}H${num(edge(m.to, at, -dir) - dir * gap)}`;
    const markers = [
      t ? ` marker-end="url(#mid-${t})"` : "",
      m.arrow.startsWith("<<") ? ` marker-start="url(#mid-head)"` : "",
    ].join("");
    const stroke = dashed(m.arrow) ? ` stroke-dasharray="6 4"` : "";
    const label = self
      ? text(lines, a + (graph.autonumber ? 14 : 8), ty, "start")
      : text(lines, (ax + bx) / 2, ty);
    const number = graph.autonumber
      ? `<circle class="mid-svg-box" cx="${num(a)}" cy="${num(ly)}" r="8" fill="#fff" stroke="currentColor" stroke-width="1.5"/><text x="${num(a)}" y="${num(ly)}" fill="currentColor" font-size="10" text-anchor="middle" dominant-baseline="central">${k + 1}</text>`
      : "";
    parts.push(
      `<g class="mid-svg-message" data-message="${k}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"${stroke}${markers}/>${label}${number}</g>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

function sequenceMermaid(graph: Graph): string {
  const ids = new Map([...graph.nodes].map((name, i) => [name, `p${i}`]));
  const lines = ["sequenceDiagram"];
  if (graph.autonumber) lines.push("  autonumber");
  for (const [name, id] of ids)
    lines.push(
      `  ${graph.actors.has(name) ? "actor" : "participant"} ${id} as ${mermaidText(name)}`,
    );
  for (const m of graph.messages)
    lines.push(
      `  ${ids.get(m.from)}${m.arrow}${m.activation ?? ""}${ids.get(m.to)}: ${mermaidText(m.text)}`,
    );
  return lines.join("\n");
}

function sequenceMid(graph: Graph): string {
  const names = [...graph.nodes].map(
    (name) => `${graph.actors.has(name) ? "actor: " : ""}${midText(name)}`,
  );
  const col = new Map([...graph.nodes].map((name, i) => [name, i]));
  const rows = graph.messages.map((m) => {
    const cells = names.map(() => "");
    const a = col.get(m.from)!;
    const b = col.get(m.to)!;
    const arrow = `${m.arrow}${m.activation ?? ""}`;
    const text = midText(m.text);
    cells[a] = b === a && arrow !== "->>" ? `${text} ${arrow}` : text;
    if (b !== a) cells[b] = arrow;
    return cells;
  });
  const table = writeTable([names, ...rows]).text;
  return graph.autonumber ? `autonumber\n\n${table}` : table;
}
