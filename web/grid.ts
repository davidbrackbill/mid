import { isSeparator, readTable as readBlock, writeTable } from "../src/mid.ts";
import type { Action as EditAction, Cursor, Key, Rules } from "./edit.ts";

export interface Table {
  before: string;
  head: string[];
  rows: string[][];
  after: string;
}

export type Action = EditAction<Table>;

export function readTable(text: string): Table | null {
  const block = readBlock(text);
  if (!block) return null;
  const [head = [""], ...rest] = block.rows.map((row) => row.cells.map((c) => c.text));
  const rows = isSeparator(block.rows[1]) ? rest.slice(1) : rest;
  const width = Math.max(1, head.length, ...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill("")];
  return { before: block.before, head: pad(head), rows: rows.map(pad), after: block.after };
}

export function writeGrid(t: Table) {
  const { text, starts } = writeTable([t.head, ...t.rows], t.before.length);
  return { text: t.before + text + t.after, starts };
}

export function isEmptyTable(t: Table): boolean {
  return (
    t.head.every((name) => !name || /^Participant \d+$/.test(name)) &&
    t.rows.every((row) => row.every((v) => !v))
  );
}

export const cellText = (t: Table, r: number, c: number) =>
  r === 0 ? t.head[c]! : t.rows[r - 1]![c]!;

const withRows = (t: Table, rows: string[][]): Table => ({ ...t, rows });
const blankRow = (t: Table) => t.head.map(() => "");
const texts = (t: Table) => [...t.head, ...t.rows.flat()];
const place = (t: Table, at: number) => ({
  r: Math.floor(at / t.head.length),
  c: at % t.head.length,
});
const edit = (table: Table, focus?: { at: number; start: number; end?: number }): Action => ({
  kind: "edit",
  model: table,
  focus,
});
const moveTo = (t: Table, at: number, side: "start" | "end"): Action => ({
  kind: "move",
  focus: { at, start: side === "start" ? 0 : texts(t)[at]!.length },
});

export function keyAction(t: Table, key: Key, { at, start, end }: Cursor): Action | undefined {
  const width = t.head.length;
  const count = (t.rows.length + 1) * width;
  const { r, c } = place(t, at);

  switch (key) {
    case "Enter":
    case "ArrowDown":
      if (at + width < count) return moveTo(t, at + width, "end");
      if (key === "ArrowDown") return { kind: "ignore" };
      return edit(withRows(t, [...t.rows, blankRow(t)]), { at: at + width, start: 0 });
    case "ArrowUp":
      return at >= width ? moveTo(t, at - width, "end") : { kind: "ignore" };
    case "ArrowLeft":
      if (start !== end || start !== 0 || at === 0) return undefined;
      return moveTo(t, at - 1, "end");
    case "ArrowRight":
      if (start !== end || end !== texts(t)[at]!.length || at === count - 1) return undefined;
      return moveTo(t, at + 1, "start");
    case "Shift+Tab":
      return at === 0 ? { kind: "ignore" } : moveTo(t, at - 1, "start");
    case "Tab":
      if (at + 1 < count) return moveTo(t, at + 1, "start");
      return edit(withRows(t, [...t.rows, blankRow(t)]), { at: count, start: 0 });
    case "Backspace":
      if (r > 0 && start === 0 && t.rows[r - 1]!.every((v) => !v))
        return edit(withRows(t, t.rows.toSpliced(r - 1, 1)), {
          at: at - width,
          start: r - 1 === 0 ? t.head[c]!.length : 0,
        });
      return undefined;
    default:
      return undefined;
  }
}

export function addColumn(t: Table): Action {
  const name = `Participant ${t.head.length + 1}`;
  return edit(
    { ...t, head: [...t.head, name], rows: t.rows.map((row) => [...row, ""]) },
    { at: t.head.length, start: 0, end: name.length },
  );
}

export function addRow(t: Table): Action {
  return edit(withRows(t, [...t.rows, blankRow(t)]), {
    at: (t.rows.length + 1) * t.head.length,
    start: 0,
  });
}

export function deleteRow(t: Table, r: number): Action {
  return edit(withRows(t, t.rows.toSpliced(r - 1, 1)));
}

export function deleteColumn(t: Table, c: number): Action {
  return edit({
    ...t,
    head: t.head.toSpliced(c, 1),
    rows: t.rows.map((row) => row.toSpliced(c, 1)),
  });
}

export function setCell(t: Table, r: number, c: number, value: string): Table {
  if (r === 0) return { ...t, head: t.head.with(c, value) };
  return withRows(t, t.rows.with(r - 1, t.rows[r - 1]!.with(c, value)));
}

const ARROW_COMPLETIONS: Record<string, string> = {
  "-": "->>",
  "--": "-->>",
  "<<-": "<<->>",
  "<<--": "<<-->>",
};

function completion(t: Table, { at, start, end }: Cursor): string | undefined {
  const text = texts(t)[at]!;
  if (at < t.head.length || start !== end || end !== text.length) return undefined;
  return ARROW_COMPLETIONS[text];
}

export function suggestion(t: Table, cursor: Cursor): string | undefined {
  return completion(t, cursor)?.slice(texts(t)[cursor.at]!.length);
}

export function accept(t: Table, cursor: Cursor): Action | undefined {
  const arrow = completion(t, cursor);
  if (!arrow) return undefined;
  const { r, c } = place(t, cursor.at);
  return edit(setCell(t, r, c, arrow), { at: cursor.at, start: arrow.length });
}

export const gridRules: Rules<Table> = {
  read: readTable,
  write: (t) => {
    const { text, starts } = writeGrid(t);
    return { text, starts: starts.flat() };
  },
  texts,
  setText: (t, at, text) => {
    const { r, c } = place(t, at);
    return setCell(t, r, c, text);
  },
  key: keyAction,
  suggestion,
  accept,
};
