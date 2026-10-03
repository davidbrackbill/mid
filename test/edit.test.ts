import { describe, expect, test } from "bun:test";
import { editorFor, isBlank, modeOf, opening } from "../web/document.ts";
import {
  accept as gridAccept,
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  keyAction as gridKey,
  readTable,
  setCell,
  suggestion as gridSuggestion,
  writeGrid,
} from "../web/grid.ts";
import {
  accept,
  type Action,
  type Item,
  type Key,
  keyAction,
  pasteAction,
  readItems,
  suggestion,
  writeItems,
} from "../web/outline.ts";

describe("outline", () => {
  const items = (text: string) => readItems(text)!;
  const at = (i: number, start: number, end = start) => ({ i, start, end });
  const run = (text: string, key: Key, cursor: { i: number; start: number; end: number }) => {
    const action = keyAction(items(text), key, cursor);
    if (action?.kind !== "edit") return action;
    return { text: writeItems(action.items).text, focus: action.focus };
  };

  test("Enter splits a bullet at the cursor", () => {
    expect(run("- headtail\n", "Enter", at(0, 4))).toEqual({
      text: "- head\n- tail\n",
      focus: { i: 1, start: 0 },
    });
  });

  test("Enter replaces a selection with the split", () => {
    expect(run("- abcd\n", "Enter", at(0, 1, 3))).toMatchObject({ text: "- a\n- d\n" });
  });

  test("Enter at the end of a parent starts a first child", () => {
    expect(run("- a\n  - b\n", "Enter", at(0, 1))).toMatchObject({ text: "- a\n  -\n  - b\n" });
  });

  test("Enter at the start inserts a bullet above and keeps the cursor on the text", () => {
    expect(run("- alpha\n", "Enter", at(0, 0))).toEqual({
      text: "-\n- alpha\n",
      focus: { i: 1, start: 0 },
    });
  });

  test("Enter on an empty bullet outdents it, or does nothing at the top", () => {
    expect(run("- a\n  -\n", "Enter", at(1, 0))).toMatchObject({ text: "- a\n-\n" });
    expect(run("- a\n-\n", "Enter", at(1, 0))).toEqual({ kind: "ignore" });
  });

  test("Tab indents with children, but never more than one level past the bullet above", () => {
    expect(run("- a\n- b\n  - c\n", "Tab", at(1, 0))).toMatchObject({
      text: "- a\n  - b\n    - c\n",
    });
    expect(run("- a\n  - b\n", "Tab", at(1, 0))).toEqual({ kind: "ignore" });
    expect(run("- a\n", "Tab", at(0, 0))).toEqual({ kind: "ignore" });
  });

  test("Shift+Tab outdents with children, and later siblings become its children", () => {
    expect(run("- a\n  - b\n    - c\n  - d\n", "Shift+Tab", at(1, 0))).toMatchObject({
      text: "- a\n- b\n  - c\n  - d\n",
    });
    expect(run("- a\n", "Shift+Tab", at(0, 0))).toEqual({ kind: "ignore" });
  });

  test("Backspace at the start outdents, then merges into the bullet above", () => {
    expect(run("- a\n  - b\n", "Backspace", at(1, 0))).toMatchObject({ text: "- a\n- b\n" });
    expect(run("- a\n- b\n", "Backspace", at(1, 0))).toEqual({
      text: "- ab\n",
      focus: { i: 0, start: 1 },
    });
  });

  test("Backspace elsewhere is left to the browser", () => {
    expect(run("- ab\n", "Backspace", at(0, 1))).toBeUndefined();
    expect(run("- a\n- b\n", "Backspace", at(0, 0))).toBeUndefined();
  });

  test("Backspace at the start of the first bullet is left to the browser", () => {
    expect(run("-\n", "Backspace", at(0, 0))).toBeUndefined();
    expect(run("-\n- b\n", "Backspace", at(0, 0))).toBeUndefined();
  });

  test("Delete at the end pulls in the next bullet", () => {
    expect(run("- a\n- b\n", "Delete", at(0, 1))).toMatchObject({ text: "- ab\n" });
    expect(run("- a\n", "Delete", at(0, 1))).toBeUndefined();
  });

  test("arrow keys move between bullets at the edges", () => {
    const move = (key: Key, cursor: { i: number; start: number; end: number }) =>
      keyAction(items("- one\n- tw\n"), key, cursor);
    expect(move("ArrowDown", at(0, 3))).toEqual({ kind: "move", focus: { i: 1, start: 2 } });
    expect(move("ArrowUp", at(1, 1))).toEqual({ kind: "move", focus: { i: 0, start: 1 } });
    expect(move("ArrowLeft", at(1, 0))).toEqual({ kind: "move", focus: { i: 0, start: 3 } });
    expect(move("ArrowRight", at(0, 3))).toEqual({ kind: "move", focus: { i: 1, start: 0 } });
    expect(move("ArrowLeft", at(1, 1))).toBeUndefined();
    expect(move("ArrowUp", at(0, 0))).toBeUndefined();
  });

  test("pasting bullets keeps their nesting relative to the cursor's bullet", () => {
    const action = pasteAction(items("- a\n  - bc\n"), "- x\n  - y\n- z", at(1, 1)) as Extract<
      Action,
      { kind: "edit" }
    >;
    expect(writeItems(action.items).text).toBe("- a\n  - bx\n    - y\n  - zc\n");
    expect(action.focus).toEqual({ i: 3, start: 1 });
  });

  test("pasting plain lines makes sibling bullets, and one line is left to the browser", () => {
    const action = pasteAction(items("- a\n"), "x\ny", at(0, 1)) as Extract<
      Action,
      { kind: "edit" }
    >;
    expect(writeItems(action.items).text).toBe("- ax\n- y\n");
    expect(pasteAction(items("- a\n"), "x\n", at(0, 1))).toBeUndefined();
  });

  test("edits never leave a bullet more than one level below the one above", () => {
    const merged = keyAction(
      [
        { level: 0, text: "a" },
        { level: 0, text: "b" },
        { level: 1, text: "c" },
        { level: 2, text: "d" },
      ] satisfies Item[],
      "Backspace",
      at(1, 0),
    ) as Extract<Action, { kind: "edit" }>;
    expect(merged.items.map((x) => x.level)).toEqual([0, 1, 2]);
  });
});

describe("grid", () => {
  const table = readTable("| A | B |\n| - | - |\n| x | ->> |\n")!;
  const at = (r: number, c: number, start = 0) => ({ r, c, start, end: start });
  const text = (action: ReturnType<typeof gridKey>) =>
    action?.kind === "edit" ? writeGrid(action.table).text : action;

  test("Enter moves down a column and adds a row from the last one", () => {
    expect(gridKey(table, "Enter", at(0, 1))).toEqual({
      kind: "move",
      focus: { r: 1, c: 1, start: 3 },
    });
    expect(text(gridKey(table, "Enter", at(1, 0)))).toBe(
      "| A   | B   |\n| --- | --- |\n| x   | ->> |\n|     |     |\n",
    );
    expect(gridKey(table, "ArrowDown", at(1, 0))).toEqual({ kind: "ignore" });
  });

  test("Tab walks the cells in reading order and adds a row past the end", () => {
    expect(gridKey(table, "Tab", at(0, 1))).toEqual({
      kind: "move",
      focus: { r: 1, c: 0, start: 0 },
    });
    expect(gridKey(table, "Tab", at(1, 1))).toMatchObject({ focus: { r: 2, c: 0, start: 0 } });
  });

  test("Left and Right cross into neighbouring cells only at a cell's edge", () => {
    expect(gridKey(table, "ArrowLeft", at(1, 0))).toEqual({
      kind: "move",
      focus: { r: 0, c: 1, start: 1 },
    });
    expect(gridKey(table, "ArrowRight", at(0, 1, 1))).toEqual({
      kind: "move",
      focus: { r: 1, c: 0, start: 0 },
    });
    expect(gridKey(table, "ArrowRight", at(1, 1, 1))).toBeUndefined();
    expect(gridKey(table, "ArrowRight", at(1, 1, 3))).toBeUndefined();
    expect(gridKey(table, "ArrowLeft", at(0, 0))).toBeUndefined();
  });

  test("Shift+Tab moves to the previous cell", () => {
    expect(gridKey(table, "Shift+Tab", at(1, 0))).toEqual({
      kind: "move",
      focus: { r: 0, c: 1, start: 0 },
    });
    expect(gridKey(table, "Shift+Tab", at(0, 0))).toEqual({ kind: "ignore" });
  });

  test("Backspace at the start of an empty row deletes it", () => {
    const withBlank = readTable("| A | B |\n| - | - |\n| x | ->> |\n|  |  |\n")!;
    expect(gridKey(withBlank, "Backspace", at(2, 1))).toMatchObject({
      focus: { r: 1, c: 1, start: 0 },
    });
    expect(text(gridKey(withBlank, "Backspace", at(2, 1)))).toBe(
      "| A   | B   |\n| --- | --- |\n| x   | ->> |\n",
    );
    expect(gridKey(table, "Backspace", at(1, 0))).toBeUndefined();
  });

  test("Backspace in an empty participant is left to the browser", () => {
    const fresh = readTable("|  | Participant 2 |\n| - | - |\n|  |  |\n")!;
    expect(gridKey(fresh, "Backspace", at(0, 0))).toBeUndefined();
  });

  test("participants and messages can be added and deleted", () => {
    const added = addColumn(table) as Extract<ReturnType<typeof addColumn>, { kind: "edit" }>;
    expect(added.table.head).toEqual(["A", "B", "Participant 3"]);
    expect(added.focus).toEqual({ r: 0, c: 2, start: 0, end: 13 });
    expect(addRow(table)).toMatchObject({ focus: { r: 2, c: 0, start: 0 } });
    expect(deleteColumn(table, 0)).toMatchObject({ table: { head: ["B"], rows: [["->>"]] } });
    expect(deleteRow(table, 1)).toMatchObject({ table: { rows: [] } });
  });

  test("setCell leaves the original table alone", () => {
    const next = setCell(table, 1, 0, "y");
    expect(next.rows[0]).toEqual(["y", "->>"]);
    expect(table.rows[0]).toEqual(["x", "->>"]);
  });
});

describe("documents", () => {
  test("each text picks the editor that can show it", () => {
    expect(editorFor("- a\n")).toBe("bullets");
    expect(editorFor("")).toBe("bullets");
    expect(editorFor("| A |\n| - |\n")).toBe("table");
    expect(editorFor("# title\n- a\n")).toBeUndefined();
    expect(editorFor("graph TD\n  A --> B\n")).toBeUndefined();
  });

  test("modes follow the kind of diagram", () => {
    expect(modeOf("- a")).toBe("graph");
    expect(modeOf("sequenceDiagram\n  A->>B: x")).toBe("diagram");
  });

  test("blank means nothing a person wrote would be lost", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("-\n  -\n")).toBe(true);
    expect(isBlank("| Participant 1 |  |\n| - | - |\n|  |  |\n")).toBe(true);
    expect(isBlank("- a\n")).toBe(false);
    expect(isBlank("| Server |  |\n| - | - |\n")).toBe(false);
  });

  test("switching opens the saved document, or a starter when there isn't one", () => {
    expect(opening("graph", "- a\n")).toEqual({ text: "- a\n", kind: "bullets" });
    expect(opening("graph", "| A |\n| - |\n")).toEqual({ text: "", kind: "bullets" });
    expect(opening("graph", undefined)).toEqual({ text: "", kind: "bullets" });
    const diagram = opening("diagram", "-\n");
    expect(diagram.kind).toBe("table");
    expect(diagram.text.slice(diagram.select!.start, diagram.select!.end)).toBe("Participant 1");
  });
});

describe("autocomplete", () => {
  const items = (text: string) => readItems(text)!;
  const end = (list: Item[], i: number) => {
    const at = list[i]!.text.length;
    return { i, start: at, end: at };
  };
  const ghost = (text: string, i: number) => suggestion(items(text), end(items(text), i));

  test("a node name completes from two typed characters, ignoring case", () => {
    expect(ghost("- fetch user\n- fe\n", 1)).toBe("tch user");
    expect(ghost("- Fetch\n- fe\n", 1)).toBe("tch");
    expect(ghost("- fetch\n- f\n", 1)).toBeUndefined();
  });

  test("the nearest bullet above wins, then the nearest below", () => {
    expect(ghost("- report\n- request\n- re\n- retry\n", 2)).toBe("quest");
    expect(ghost("- re\n- retry\n- report\n", 0)).toBe("try");
  });

  test("names come without their labels", () => {
    expect(ghost("- a\n  - respond: cache hit\n  - res\n", 2)).toBe("pond");
  });

  test("nothing is suggested for an existing name, a label, or mid-text", () => {
    expect(ghost("- fetch\n- fetch user\n- fetch\n", 2)).toBeUndefined();
    expect(ghost("- respond\n- x: re\n", 1)).toBeUndefined();
    const list = items("- fetch\n- fet\n");
    expect(suggestion(list, { i: 1, start: 1, end: 1 })).toBeUndefined();
  });

  test("accepting takes the existing node's casing and puts the cursor at the end", () => {
    const list = items("- Fetch\n- fe\n");
    expect(accept(list, end(list, 1))).toEqual({
      kind: "edit",
      items: [
        { level: 0, text: "Fetch" },
        { level: 0, text: "Fetch" },
      ],
      focus: { i: 1, start: 5 },
    });
  });

  test("a dash in a table cell completes to an arrow", () => {
    const t = readTable("| A | B |\n| - | - |\n| hi | - |\n| -- | ok |\n")!;
    expect(gridSuggestion(t, { r: 1, c: 1, start: 1, end: 1 })).toBe(">>");
    expect(gridSuggestion(t, { r: 2, c: 0, start: 2, end: 2 })).toBe(">>");
    expect(gridSuggestion(t, { r: 1, c: 0, start: 2, end: 2 })).toBeUndefined();
    expect(gridAccept(t, { r: 2, c: 0, start: 2, end: 2 })).toMatchObject({
      table: {
        rows: [
          ["hi", "-"],
          ["-->>", "ok"],
        ],
      },
      focus: { r: 2, c: 0, start: 4 },
    });
  });
});
