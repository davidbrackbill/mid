import { isSeparator, readTable as readBlock, writeTable } from "../src/mid.ts";

export interface Table {
  before: string;
  head: string[];
  rows: string[][];
  after: string;
}

export interface Cursor {
  r: number;
  c: number;
  start: number;
  end: number;
}

export interface Focus {
  r: number;
  c: number;
  start: number;
  end?: number;
}

export type Key =
  | "Enter"
  | "ArrowDown"
  | "ArrowUp"
  | "ArrowLeft"
  | "ArrowRight"
  | "Tab"
  | "Shift+Tab"
  | "Backspace";

export type Action =
  | { kind: "edit"; table: Table; focus?: Focus }
  | { kind: "move"; focus: Focus }
  | { kind: "ignore" };

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
const moveTo = (t: Table, r: number, c: number, at: "start" | "end"): Action => ({
  kind: "move",
  focus: { r, c, start: at === "start" ? 0 : cellText(t, r, c).length },
});

export function keyAction(t: Table, key: Key, { r, c, start, end }: Cursor): Action | undefined {
  const last = t.rows.length;
  const width = t.head.length;

  switch (key) {
    case "Enter":
    case "ArrowDown":
      if (r < last) return moveTo(t, r + 1, c, "end");
      if (key === "ArrowDown") return { kind: "ignore" };
      return {
        kind: "edit",
        table: withRows(t, [...t.rows, blankRow(t)]),
        focus: { r: last + 1, c, start: 0 },
      };
    case "ArrowUp":
      return r > 0 ? moveTo(t, r - 1, c, "end") : { kind: "ignore" };
    case "ArrowLeft": {
      if (start !== end || start !== 0) return undefined;
      const i = r * width + c - 1;
      return i < 0 ? undefined : moveTo(t, Math.floor(i / width), i % width, "end");
    }
    case "ArrowRight": {
      if (start !== end || end !== cellText(t, r, c).length) return undefined;
      const i = r * width + c + 1;
      return i > last * width + width - 1
        ? undefined
        : moveTo(t, Math.floor(i / width), i % width, "start");
    }
    case "Shift+Tab": {
      const i = r * width + c - 1;
      return i < 0 ? { kind: "ignore" } : moveTo(t, Math.floor(i / width), i % width, "start");
    }
    case "Tab": {
      const i = r * width + c + 1;
      if (i >= (last + 1) * width)
        return {
          kind: "edit",
          table: withRows(t, [...t.rows, blankRow(t)]),
          focus: { r: last + 1, c: 0, start: 0 },
        };
      return moveTo(t, Math.floor(i / width), i % width, "start");
    }
    case "Backspace":
      if (r > 0 && start === 0 && t.rows[r - 1]!.every((v) => !v))
        return {
          kind: "edit",
          table: withRows(t, t.rows.toSpliced(r - 1, 1)),
          focus: { r: r - 1, c, start: r - 1 === 0 ? t.head[c]!.length : 0 },
        };
      return undefined;
  }
}

export function addColumn(t: Table): Action {
  const name = `Participant ${t.head.length + 1}`;
  return {
    kind: "edit",
    table: { ...t, head: [...t.head, name], rows: t.rows.map((row) => [...row, ""]) },
    focus: { r: 0, c: t.head.length, start: 0, end: name.length },
  };
}

export function addRow(t: Table): Action {
  return {
    kind: "edit",
    table: withRows(t, [...t.rows, blankRow(t)]),
    focus: { r: t.rows.length + 1, c: 0, start: 0 },
  };
}

export function deleteRow(t: Table, r: number): Action {
  return { kind: "edit", table: withRows(t, t.rows.toSpliced(r - 1, 1)) };
}

export function deleteColumn(t: Table, c: number): Action {
  return {
    kind: "edit",
    table: { ...t, head: t.head.toSpliced(c, 1), rows: t.rows.map((row) => row.toSpliced(c, 1)) },
  };
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

function completion(t: Table, { r, c, start, end }: Cursor): string | undefined {
  if (r === 0 || start !== end) return undefined;
  const text = cellText(t, r, c);
  return end === text.length ? ARROW_COMPLETIONS[text] : undefined;
}

export function suggestion(t: Table, cursor: Cursor): string | undefined {
  return completion(t, cursor)?.slice(cellText(t, cursor.r, cursor.c).length);
}

export function accept(t: Table, cursor: Cursor): Action | undefined {
  const arrow = completion(t, cursor);
  if (!arrow) return undefined;
  return {
    kind: "edit",
    table: setCell(t, cursor.r, cursor.c, arrow),
    focus: { r: cursor.r, c: cursor.c, start: arrow.length },
  };
}
