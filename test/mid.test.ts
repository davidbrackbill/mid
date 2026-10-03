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

  test("tabs and padding around a node and its label", () => {
    expect(slices("-\tA\n\t-  B :  go ")).toEqual({
      nodes: { A: ["A"], B: ["B"] },
      edges: ["go"],
    });
  });

  test("quoted names keep their colons and spans skip the quotes", () => {
    expect(slices('- a\n  - "Step 1: check": "on: go"\n  - http://x\n  - 10:30')).toEqual({
      nodes: {
        a: ["a"],
        "Step 1: check": ["Step 1: check"],
        "http://x": ["http://x"],
        "10:30": ["10:30"],
      },
      edges: ["on: go", undefined, undefined],
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

describe("subgraphs", () => {
  test("subgraph and end lines are warnings, not nodes", () => {
    const g = parse("graph TD\n  subgraph one\n    A --> B\n  end");
    expect([...g.nodes]).toEqual(["A", "B"]);
    expect(g.warnings.map((w) => w.message)).toEqual([
      "not understood: subgraph one",
      "not understood: end",
    ]);
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

  test("owns the mid-svg class prefix, which the editor never uses", async () => {
    const svgClasses = new Set<string>();
    for (const name of CASES)
      for (const [, list] of renderSvg(parse(await read(name))).matchAll(/class="([^"]*)"/g))
        for (const c of list!.split(/\s+/)) svgClasses.add(c);
    expect([...svgClasses].filter((c) => !/^mid-svg(-|$)/.test(c))).toEqual([]);

    const dir = `${import.meta.dir}/../web`;
    const named: string[] = [];
    for await (const file of new Bun.Glob("*.ts").scan(dir)) {
      const src = await Bun.file(`${dir}/${file}`).text();
      for (const [call] of src.matchAll(/\bel\([^)]*\)|className\s*=[^;]*/g))
        if (call.includes("mid-svg")) named.push(`${file}: ${call}`);
    }
    expect(named).toEqual([]);
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
  const messages = (text: string) =>
    parse(text).messages.map((m) => [m.from, m.to, m.text, `${m.arrow}${m.activation ?? ""}`]);
  const table = (...rows: string[]) =>
    ["| A | B | C |", "| - | - | - |", ...rows.map((r) => `| ${r} |`)].join("\n");

  test("the sender's cell holds the text and the receiver's holds the arrow", async () => {
    const g = parse(await read("sequence.md"));
    expect([g.format, g.kind, g.autonumber]).toEqual(["mid", "sequence", true]);
    expect([...g.nodes]).toEqual(["User", "Client", "Server", "Database"]);
    expect([...g.actors]).toEqual(["User"]);
    expect(messages(await read("sequence.md"))).toEqual([
      ["User", "Client", "Click log in", "->>"],
      ["Client", "Server", "POST /login", "->>+"],
      ["Server", "Database", "Find user", "-->>"],
      ["Database", "Server", "Row", "-->>"],
      ["Server", "Server", "Check password", "->>"],
      ["Server", "Client", "Session token", "-->>-"],
      ["Client", "Server", "Track login", "-)"],
      ["Client", "User", "Show dashboard", "-x"],
    ]);
  });

  test("every Mermaid arrow works in a cell", () => {
    for (const arrow of ["->>", "-->>", "->", "-->", "-x", "--x", "-)", "--)", "<<->>", "<<-->>"])
      expect(messages(table(`hi | ${arrow} |`))).toEqual([["A", "B", "hi", arrow]]);
  });

  test("a row with only text is a self-message", () => {
    expect(messages(table(" | think | "))).toEqual([["B", "B", "think", "->>"]]);
  });

  test("a self-message can end with an arrow", () => {
    expect(messages(table(" | Retry later -->> | ", " | Start ->>+ | "))).toEqual([
      ["B", "B", "Retry later", "-->>"],
      ["B", "B", "Start", "->>+"],
    ]);
  });

  test("blank rows are skipped", () => {
    expect(messages(table(" |  | ", "hi | ->> | "))).toEqual([["A", "B", "hi", "->>"]]);
  });

  test("spans point at participants, arrow cells, and message text", async () => {
    const text = await read("sequence.md");
    const g = parse(text);
    const slice = (s: { start: number; end: number }) => text.slice(s.start, s.end);
    expect(g.spans.get("User")!.map(slice)).toEqual(["User", "-x"]);
    expect(g.spans.get("Database")!.map(slice)).toEqual(["Database", "-->>"]);
    expect(g.messages.map((m) => slice(m.span!)).slice(0, 2)).toEqual([
      "Click log in",
      "POST /login",
    ]);
  });

  test("renderMid writes the table back out exactly", async () => {
    expect(renderMid(parse(await read("sequence.md")))).toBe(await expected("sequence.md"));
  });

  test("mermaid sequence input", async () => {
    const g = parse(await read("sequence.mmd"));
    expect([g.format, g.kind, [...g.actors]]).toEqual(["mermaid", "sequence", ["User"]]);
    expect(messages(await read("sequence.mmd"))).toEqual([
      ["User", "Client", "Log in", "->>"],
      ["Client", "Server", "Credentials", "->>+"],
      ["Server", "Client", "Session token", "-->>-"],
      ["Client", "Server", "Analytics", "-)"],
      ["Client", "User", "Expired", "--x"],
      ["Client", "Server", "Keepalive", "<<->>"],
      ["Client", "Client", "Store token", "->"],
    ]);
  });

  test.each(["sequence.md", "sequence.mmd"])(
    "%s keeps arrows and activations through Mermaid -> Mid -> Mermaid",
    async (name) => {
      const mmd = renderMermaid(parse(await read(name)));
      expect(renderMermaid(parse(renderMid(parse(mmd))))).toBe(mmd);
    },
  );

  test("self-message spans cover the text, not the arrow", () => {
    const text = table(" | Retry -->> | ");
    const { span } = parse(text).messages[0]!;
    expect(text.slice(span!.start, span!.end)).toBe("Retry");
  });

  test("\\n breaks message text onto several lines", () => {
    const ascii = renderAscii(parse("| A | B |\n| - | - |\n| one\\ntwo | ->> |\n"));
    const lines = ascii.split("\n");
    const at = lines.findIndex((l) => l.includes("one"));
    expect([lines[at + 1]!.includes("two"), lines[at + 2]!.includes("├")]).toEqual([true, true]);
  });

  test("mermaid autonumber", () => {
    expect(parse("sequenceDiagram\n  autonumber\n  A->>B: hi").autonumber).toBe(true);
  });

  test("mermaid lines that are not messages are warnings", () => {
    expect(parse("sequenceDiagram\n  A->>B: hi\n  Note over A: x").warnings).toEqual([
      { line: 3, message: "not understood: Note over A: x" },
    ]);
  });

  const ROW =
    "Line 3: a row is one message: its text under the sender and an arrow like ->> under the receiver";
  test.each([
    [table("hi | there | "), ROW],
    [table("->> | ->> | "), ROW],
    [table("hi | ->> | ->>"), ROW],
    [table("hi | ->> | ", "-->>- | back | "), `Line 4: "B" isn't active, so it can't deactivate`],
    ["sequenceDiagram\n  A-->>-B: x", `Line 2: "A" isn't active, so it can't deactivate`],
    ["| A | B |\n| - | - |\n| | | x |", "Line 3: no participant for column 3"],
    ["| A | B |\n| x | y |", "Line 2: expected a | --- | row under the participants"],
    ["| A | A |\n| - | - |", 'Line 1: "A" is listed twice'],
    ["| actor: | B |\n| - | - |", "Line 1: column 1 has no participant"],
  ])("rejects %j", (text, message) => {
    expect(() => parse(text)).toThrow(message);
  });
});
