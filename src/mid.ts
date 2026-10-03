import type { Span } from "./parse.ts";

export interface Cell {
  text: string;
  span: Span;
}

export interface Row {
  line: number;
  cells: Cell[];
}

export interface TableBlock {
  before: string;
  rows: Row[];
  after: string;
}

const IS_ROW = /^\s*\|/;
const SEPARATOR = /^:?-+:?$/;

export function trimmedSpan(raw: string, at: number): Span {
  const start = at + raw.length - raw.trimStart().length;
  return { start, end: start + raw.trim().length };
}

export function splitCells(line: string, at: number): Cell[] {
  const raw = line.trimEnd();
  const cells: Cell[] = [];
  let start = raw.indexOf("|") + 1;
  for (let i = start; i <= raw.length; i++) {
    if (i < raw.length && (raw[i] !== "|" || raw[i - 1] === "\\")) continue;
    const cell = raw.slice(start, i);
    cells.push({ text: cell.trim(), span: trimmedSpan(cell, at + start) });
    start = i + 1;
  }
  if (raw.length > 1 && raw.endsWith("|") && raw[raw.length - 2] !== "\\") cells.pop();
  return cells;
}

export function isSeparator(row: Row | undefined): boolean {
  return !!row?.cells.length && row.cells.every((c) => SEPARATOR.test(c.text));
}

export function readTable(text: string): TableBlock | null {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => IS_ROW.test(l));
  if (first === -1) return null;
  let at = lines.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
  const rows: Row[] = [];
  let last = first;
  for (; last < lines.length && IS_ROW.test(lines[last]!); last++) {
    rows.push({ line: last + 1, cells: splitCells(lines[last]!, at) });
    at += lines[last]!.length + 1;
  }
  return {
    before: first ? `${lines.slice(0, first).join("\n")}\n` : "",
    rows,
    after: last < lines.length ? `\n${lines.slice(last).join("\n")}` : "",
  };
}

export function escapeCell(text: string): string {
  return text.replace(/\\?\|/g, (m) => (m.length === 2 ? m : "\\|"));
}

export function writeTable(rows: string[][], offset = 0) {
  const escaped = rows.map((r) => r.map(escapeCell));
  const widths = escaped[0]!.map((_, i) => Math.max(3, ...escaped.map((r) => r[i]!.length)));
  const lines: string[] = [];
  const starts: number[][] = [];
  let pos = offset;
  const line = (cells: string[], record: boolean) => {
    if (record) {
      const cellStarts: number[] = [];
      let at = pos + 2;
      for (const w of widths) {
        cellStarts.push(at);
        at += w + 3;
      }
      starts.push(cellStarts);
    }
    const text = `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
    lines.push(text);
    pos += text.length + 1;
  };
  escaped.forEach((cells, i) => {
    line(cells, true);
    if (i === 0)
      line(
        widths.map((w) => "-".repeat(w)),
        false,
      );
  });
  return { text: lines.join("\n"), starts };
}

export interface Bullet {
  line: number;
  level: number;
  text: string;
  start: number;
}

const BULLET = /^(\s*)[-*+](?:\s+(.*?))?\s*$/d;

function indentWidth(s: string, tab = 4): number {
  let width = 0;
  for (const ch of s) width = ch === "\t" ? width + tab - (width % tab) : width + 1;
  return width;
}

export function readOutline(text: string, strict = true): Bullet[] | null {
  const bullets: Bullet[] = [];
  const stack: number[] = [];
  let at = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineStart = at;
    at += raw.length + 1;
    if (!raw.trim()) continue;
    const m = BULLET.exec(raw);
    if (!m) {
      if (strict) return null;
      continue;
    }
    const indent = indentWidth(m[1]!);
    while (stack.length && stack[stack.length - 1]! >= indent) stack.pop();
    const start = lineStart + (m.indices![2]?.[0] ?? raw.trimEnd().length);
    bullets.push({ line: i + 1, level: stack.length, text: m[2] ?? "", start });
    stack.push(indent);
  }
  return bullets;
}

export function writeOutline(items: Array<{ level: number; text: string }>) {
  let pos = 0;
  const starts: number[] = [];
  const lines = items.map(({ level, text }) => {
    const prefix = `${"  ".repeat(level)}- `;
    const line = text ? prefix + text : prefix.trimEnd();
    starts.push(pos + Math.min(prefix.length, line.length));
    pos += line.length + 1;
    return line;
  });
  return { text: lines.join("\n"), starts };
}

export interface NodeText {
  name: string;
  nameSpan: [number, number];
  label?: string;
  labelSpan?: [number, number];
}

export function splitNode(text: string): NodeText {
  let quoted = false;
  let cut = -1;
  for (let i = 0; i < text.length && cut === -1; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text[i] === ":" && text[i + 1] === " ") cut = i;
  }
  const piece = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (end - start >= 2 && text[start] === '"' && text[end - 1] === '"') {
      start++;
      end--;
    }
    return { text: text.slice(start, end), span: [start, end] as [number, number] };
  };
  const name = piece(0, cut === -1 ? text.length : cut);
  const label = cut === -1 ? undefined : piece(cut + 1, text.length);
  if (!label?.text) return { name: name.text, nameSpan: name.span };
  return { name: name.text, nameSpan: name.span, label: label.text, labelSpan: label.span };
}

const quote = (s: string) => (s.includes(": ") || /^".*"$/.test(s) ? `"${s}"` : s);

export function joinNode(name: string, label?: string): string {
  return label ? `${quote(name)}: ${quote(label)}` : quote(name);
}
