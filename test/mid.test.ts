import { describe, expect, test } from "bun:test";
import {
  type Graph,
  parse,
  renderAscii,
  renderMermaid,
  renderMid,
  renderSvg,
} from "../src/index.ts";

const CASES = ["flow.md", "nl.md", "branch.mmd", "sequence.md", "sequence.mmd"];

const read = (name: string) => Bun.file(`${import.meta.dir}/${name}`).text();
const expected = async (name: string) => (await read(name)).replace(/\n$/, "");

describe.each(CASES)("%s", (name) => {
  test("ascii", async () => {
    expect(renderAscii(parse(await read(name)))).toBe(await expected(`${name}.ascii`));
  });

  test("mermaid", async () => {
    expect(renderMermaid(parse(await read(name)))).toBe(await expected(`${name}.mermaid`));
  });

  test("svg", async () => {
    expect(renderSvg(parse(await read(name)))).toBe(await expected(`${name}.svg`));
  });
});

describe("spans", () => {
  const slices = (text: string) => {
    const g = parse(text);
    return {
      nodes: Object.fromEntries(
        [...g.spans].map(([name, spans]) => [name, spans.map((s) => text.slice(s.start, s.end))]),
      ),
      edges: g.edges.map((e) => e.span && text.slice(e.span.start, e.span.end)),
    };
  };

  test("bullets point at every occurrence of a node and at edge labels", async () => {
    expect(slices(await read("flow.md"))).toEqual({
      nodes: {
        request: ["request"],
        respond: ["respond", "respond"],
        fetch: ["fetch"],
        error: ["error"],
      },
      edges: ["cache hit", "cache miss", "ok", "fail"],
    });
  });

  test("tabs and padding inside links", () => {
    expect(slices("-\tA\n\t- [ go ]( B )")).toEqual({
      nodes: { A: ["A"], B: ["B"] },
      edges: ["go"],
    });
  });

  test("mermaid points at the node reference", () => {
    expect(slices("graph TD\n  A[Start] -->|go| B\n  B --> A")).toEqual({
      nodes: { Start: ["A[Start]", "A"], B: ["B", "B"] },
      edges: ["go", undefined],
    });
  });
});

describe("warnings", () => {
  test("mermaid lines that are not understood", () => {
    const g = parse("graph TD\n  A --> B --> C\n  classDef x fill:#f00\n  B --> D;");
    expect(g.warnings).toEqual([
      { line: 2, message: "not understood: A --> B --> C" },
      { line: 3, message: "not understood: classDef x fill:#f00" },
    ]);
    expect([...g.nodes]).toEqual(["B", "D"]);
  });
});

describe("renderSvg", () => {
  test("escapes names", () => {
    const svg = renderSvg(parse(`- <b>"x"</b> & y`));
    expect(svg).toContain(`data-node="&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y"`);
    expect(svg).not.toContain("<b>");
  });

  test("empty graph", () => {
    expect(renderSvg(parse(""))).toContain(`width="0" height="0"`);
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

describe("renderMid", () => {
  const edges = (g: Graph) => [
    ...g.edges.map((e) => [e.src, e.dst, e.label ?? ""]).sort(),
    ...g.messages.map((m) => [m.from, m.to, m.text]),
  ];

  test.each(CASES)("%s round-trips through mid bullets", async (name) => {
    const graph = parse(await read(name));
    const back = parse(renderMid(graph));
    expect(back.format).toBe("mid");
    expect([...back.nodes].sort()).toEqual([...graph.nodes].sort());
    expect(edges(back)).toEqual(edges(graph));
  });

  test("mermaid line breaks become \\n", () => {
    expect(renderMid(parse("graph TD\n  A[a<br/>b] --> B"))).toBe("- a\\nb\n  - B");
  });
});

describe("format", () => {
  test("reports the detected syntax", () => {
    expect(parse("- a").format).toBe("mid");
    expect(parse("graph TD\n  A --> B").format).toBe("mermaid");
  });
});

describe("sequence diagrams", () => {
  const messages = (text: string) => parse(text).messages.map((m) => [m.from, m.to, m.text]);

  test("a cell messages the next column unless it links elsewhere", async () => {
    const g = parse(await read("sequence.md"));
    expect([g.format, g.kind]).toEqual(["mid", "sequence"]);
    expect([...g.nodes]).toEqual(["Client", "Server", "Database"]);
    expect(messages(await read("sequence.md"))).toEqual([
      ["Client", "Server", "Goes to server by default"],
      ["Client", "Database", "Bypasses server access"],
    ]);
  });

  test("spans point at participants and message text", async () => {
    const text = await read("sequence.md");
    const g = parse(text);
    const slice = (s: { start: number; end: number }) => text.slice(s.start, s.end);
    expect(g.spans.get("Database")!.map(slice)).toEqual(["Database", "Database"]);
    expect(g.messages.map((m) => slice(m.span!))).toEqual([
      "Goes to server by default",
      "Bypasses server access",
    ]);
  });

  test("renderMid writes the table back out exactly, without the title line", async () => {
    const table = (await expected("sequence.md")).split("\n").slice(2).join("\n");
    expect(renderMid(parse(await read("sequence.md")))).toBe(table);
  });

  test("a row can hold several messages, read left to right", () => {
    const text = [
      "| client  | server  | database |",
      "| ------- | ------- | -------- |",
      "| a thing | another |          |",
      "|         |         |          |",
    ].join("\n");
    expect(messages(text)).toEqual([
      ["client", "server", "a thing"],
      ["server", "database", "another"],
    ]);
  });

  test("mermaid sequence input", async () => {
    const g = parse(await read("sequence.mmd"));
    expect([g.format, g.kind]).toEqual(["mermaid", "sequence"]);
    expect(messages(await read("sequence.mmd"))).toEqual([
      ["Client", "Server", "Log in"],
      ["Server", "Client", "Session token"],
      ["Client", "Client", "Store token"],
    ]);
  });

  test("mermaid lines that are not messages are warnings", () => {
    expect(parse("sequenceDiagram\n  A->>B: hi\n  Note over A: x").warnings).toEqual([
      { line: 3, message: "not understood: Note over A: x" },
    ]);
  });

  test.each([
    [
      "| A | B |\n| - | - |\n| | x |",
      'Line 3: "B" is the last column, so write [message](Receiver)',
    ],
    ["| A | B |\n| - | - |\n| [x](C) | |", 'Line 3: unknown participant "C"'],
    ["| A | B |\n| x | y |", "Line 2: expected a | --- | row under the participants"],
    ["| A | A |\n| - | - |", 'Line 1: "A" is listed twice'],
  ])("rejects %j", (text, message) => {
    expect(() => parse(text)).toThrow(message);
  });
});
