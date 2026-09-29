import { describe, expect, test } from "bun:test";
import { parse, renderAscii, renderMermaid } from "../src/index.ts";

const CASES = ["flow.md", "tree.md", "nl.md", "branch.mmd", "pipeline.mmd"];

const read = (name: string) => Bun.file(`${import.meta.dir}/${name}`).text();
const expected = async (name: string) => (await read(name)).replace(/\n$/, "");

describe.each(CASES)("%s", (name) => {
  test("ascii", async () => {
    expect(renderAscii(parse(await read(name)))).toBe(await expected(`${name}.ascii`));
  });

  test("mermaid", async () => {
    expect(renderMermaid(parse(await read(name)))).toBe(await expected(`${name}.mermaid`));
  });
});

describe("format detection", () => {
  const nodes = (text: string) => [...parse(text).nodes];

  test("bullets parse as mid", () => {
    expect(nodes("- a\n  - b")).toEqual(["a", "b"]);
  });

  test("graph header parses as mermaid", () => {
    expect(nodes("\n  graph TD\n  A --> B")).toEqual(["A", "B"]);
  });

  test("leading %% lines still parse as mermaid", () => {
    expect(nodes("%% comment\n%%{init: {}}%%\nflowchart LR\n  A --> B")).toEqual(["A", "B"]);
  });

  test("bare graph header without a direction", () => {
    expect(nodes("graph\n  A --> B")).toEqual(["A", "B"]);
  });
});

describe("mermaid edges", () => {
  test("dotted link without arrowhead", () => {
    expect(parse("graph TD\n  A -.- B").edges).toEqual([{ src: "A", dst: "B" }]);
  });
});
