import { describe, expect, test } from "bun:test";
import { parse, renderMid } from "../src/index.ts";
import {
  joinNode,
  readOutline,
  readTable,
  splitCells,
  splitNode,
  writeOutline,
  writeTable,
} from "../src/mid.ts";

describe("tables", () => {
  test("readTable finds the rows and keeps the text around them", () => {
    const text = "intro\n| A | B |\n| - | - |\n| x | y |\nafter";
    const table = readTable(text)!;
    expect(table.before).toBe("intro\n");
    expect(table.after).toBe("\nafter");
    expect(table.rows.map((r) => [r.line, r.cells.map((c) => c.text)])).toEqual([
      [2, ["A", "B"]],
      [3, ["-", "-"]],
      [4, ["x", "y"]],
    ]);
    for (const cell of table.rows[2]!.cells)
      expect(text.slice(cell.span.start, cell.span.end)).toBe(cell.text);
  });

  test("readTable is null without a table", () => {
    expect(readTable("- a\n- b")).toBeNull();
  });

  test("escaped pipes stay inside a cell, even at the end of a row", () => {
    expect(splitCells("| a \\| b | c |", 0).map((c) => c.text)).toEqual(["a \\| b", "c"]);
    expect(splitCells("| a | b \\|", 0).map((c) => c.text)).toEqual(["a", "b \\|"]);
  });

  test("writeTable pads columns and reports where each cell's text starts", () => {
    const { text, starts } = writeTable([
      ["Client", "B"],
      ["hi", "->>"],
    ]);
    expect(text).toBe("| Client | B   |\n| ------ | --- |\n| hi     | ->> |");
    expect(starts.map((row) => row.map((at) => text.slice(at, at + 2)))).toEqual([
      ["Cl", "B "],
      ["hi", "->"],
    ]);
  });

  test("writeTable escapes a bare pipe once and leaves an escaped one alone", () => {
    expect(writeTable([["a|b", "c\\|d"]]).text.split("\n")[0]).toBe("| a\\|b | c\\|d |");
  });

  test("a message with an escaped pipe survives renderMid", () => {
    const text = "| A    | B   |\n| ---- | --- |\n| x\\|y | ->> |";
    expect(renderMid(parse(text))).toBe(text);
  });
});

describe("outlines", () => {
  test("levels follow indentation, whatever its width, with a tab as four columns", () => {
    const items = readOutline("- a\n    - b\n  - c\n\t- d\n- e")!;
    expect(items.map((b) => [b.level, b.text])).toEqual([
      [0, "a"],
      [1, "b"],
      [1, "c"],
      [2, "d"],
      [0, "e"],
    ]);
  });

  test("empty bullets are kept and every bullet records where its text starts", () => {
    const text = "- a\n  -\n  - y: x  ";
    const items = readOutline(text)!;
    expect(items.map((b) => [b.level, b.text])).toEqual([
      [0, "a"],
      [1, ""],
      [1, "y: x"],
    ]);
    expect(text.slice(items[2]!.start, items[2]!.start + 4)).toBe("y: x");
  });

  test("strict reading rejects other lines and loose reading skips them", () => {
    expect(readOutline("# title\n- a")).toBeNull();
    expect(readOutline("# title\n- a", false)!.map((b) => b.text)).toEqual(["a"]);
  });

  test("writeOutline indents by two spaces and writes an empty bullet as -", () => {
    const { text, starts } = writeOutline([
      { level: 0, text: "a" },
      { level: 1, text: "" },
      { level: 2, text: "b" },
    ]);
    expect(text).toBe("- a\n  -\n    - b");
    expect(starts.map((at) => text[at])).toEqual(["a", "\n", "b"]);
  });
});

describe("node text", () => {
  const split = (text: string) => {
    const { name, label } = splitNode(text);
    return label === undefined ? [name] : [name, label];
  };

  test("the first colon and space splits the node from its label", () => {
    expect(split("respond: cache hit")).toEqual(["respond", "cache hit"]);
    expect(split("a: b: c")).toEqual(["a", "b: c"]);
  });

  test("a colon without a space, or an empty label, keeps the whole name", () => {
    expect(split("http://x")).toEqual(["http://x"]);
    expect(split("10:30")).toEqual(["10:30"]);
    expect(split("respond:")).toEqual(["respond:"]);
    expect(split("respond: ")).toEqual(["respond"]);
  });

  test("quotes keep a colon inside a name or label", () => {
    expect(split('"Step 1: validate"')).toEqual(["Step 1: validate"]);
    expect(split('"Step 1: validate": "on: error"')).toEqual(["Step 1: validate", "on: error"]);
  });

  test("spans point inside the quotes", () => {
    const text = '"a: b": c';
    const { nameSpan, labelSpan } = splitNode(text);
    expect([text.slice(...nameSpan), text.slice(...labelSpan!)]).toEqual(["a: b", "c"]);
  });

  test("joinNode quotes only what would otherwise split", () => {
    for (const [name, label] of [
      ["respond", "cache hit"],
      ["Step 1: validate", "on: error"],
      ["http://x", undefined],
      ['"quoted"', undefined],
    ] as const) {
      expect(split(joinNode(name, label))).toEqual(label ? [name, label] : [name]);
    }
    expect(joinNode("Step 1: validate")).toBe('"Step 1: validate"');
    expect(joinNode("respond", "hit")).toBe("respond: hit");
  });
});
