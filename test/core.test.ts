import { describe, expect, test } from "bun:test";
import { toMermaid } from "../src/convert.ts";
import { parse, sniffFormat } from "../src/index.ts";
import { layout } from "../src/layout.ts";
import { parseMarkdown } from "../src/markdown.ts";
import { parseMermaid } from "../src/mermaid.ts";
import { render, renderGrid, toJSON } from "../src/render.ts";

function edges(g: ReturnType<typeof parseMarkdown>) {
	return new Map(g.edges.map((e) => [`${e.src}->${e.dst}`, e.label ?? null]));
}

describe("markdown parser", () => {
	test("basic tree", () => {
		const g = parseMarkdown("- A\n  - B\n    - C\n  - D\n");
		expect([...g.nodes.keys()].sort()).toEqual(["A", "B", "C", "D"]);
		expect([...edges(g).keys()].sort()).toEqual(["A->B", "A->D", "B->C"]);
		expect(g.entryNodes().map((n) => n.name)).toEqual(["A"]);
	});

	test("reused node is shared (tree → DAG)", () => {
		const g = parseMarkdown("- A\n  - B\n    - C\n  - D\n- C\n  - E\n");
		expect([...edges(g).keys()].sort()).toEqual([
			"A->B",
			"A->D",
			"B->C",
			"C->E",
		]);
		expect(g.entryNodes().map((n) => n.name)).toEqual(["A"]); // C is not a root
	});

	test("multiple roots", () => {
		const g = parseMarkdown("- A\n  - B\n- X\n  - Y\n");
		expect(
			g
				.entryNodes()
				.map((n) => n.name)
				.sort(),
		).toEqual(["A", "X"]);
	});

	test("link edge label", () => {
		const g = parseMarkdown("- A\n  - [A goes to B](B)\n");
		expect(edges(g).get("A->B")).toBe("A goes to B");
	});

	test("first edge label wins on dedup", () => {
		const g = parseMarkdown("- A\n  - [first](B)\n- A\n  - B\n");
		expect(edges(g).get("A->B")).toBe("first");
	});

	test("tabs and mixed indent", () => {
		const g = parseMarkdown("- A\n\t- B\n    - C\n");
		expect([...edges(g).keys()].sort()).toEqual(["A->B", "A->C"]);
	});

	test("* and + markers", () => {
		const g = parseMarkdown("* A\n  + B\n");
		expect(edges(g).get("A->B")).toBe(null);
	});

	test("non-bullet lines ignored", () => {
		const g = parseMarkdown("# Heading\n\nprose\n- A\n  - B\n\nmore\n");
		expect([...g.nodes.keys()].sort()).toEqual(["A", "B"]);
	});

	test("names with spaces", () => {
		const g = parseMarkdown("- start here\n  - then here\n");
		expect(edges(g).get("start here->then here")).toBe(null);
	});

	test("node-name spans recorded (line + col of the token)", () => {
		const g = parseMarkdown("- A\n  - B\n");
		expect(g.nodes.get("A")!.spans).toEqual([{ line: 1, col: 2, len: 1 }]); // after "- "
		expect(g.nodes.get("B")!.spans).toEqual([{ line: 2, col: 4, len: 1 }]); // after "  - "
	});

	test("link bullet: span points at the target, node accumulates a span per edge", () => {
		//   line 1: - A
		//   line 2:   - [hit](respond)
		//   line 3:   - [ok](respond)
		const g = parseMarkdown("- A\n  - [hit](respond)\n  - [ok](respond)\n");
		const respond = g.nodes.get("respond")!;
		expect(respond.spans.length).toBe(2); // reached by two edges → two spans
		// first span is on line 2, pointing inside "(respond)" not at the label
		expect(respond.spans[0]!.line).toBe(2);
		const line2 = "  - [hit](respond)";
		expect(
			line2.slice(
				respond.spans[0]!.col,
				respond.spans[0]!.col + respond.spans[0]!.len,
			),
		).toBe("respond");
	});

	test("empty input", () => {
		const g = parseMarkdown("");
		expect(g.nodes.size).toBe(0);
	});

	test("bare bullet with no content is ignored", () => {
		const g = parseMarkdown("- A\n-  \n  - B\n");
		expect([...g.nodes.keys()].sort()).toEqual(["A", "B"]);
	});
});

describe("mermaid parser", () => {
	test("flowchart with labels", () => {
		const g = parseMermaid(
			"graph TD\n  A[Start] --> B[Parse]\n  B -->|ok| C[Done]\n",
		);
		expect([...g.nodes.keys()].sort()).toEqual(["Done", "Parse", "Start"]);
		expect(edges(g).get("Start->Parse")).toBe(null);
		expect(edges(g).get("Parse->Done")).toBe("ok");
	});

	test("rejects non-flowchart", () => {
		expect(() => parseMermaid("not a graph\n")).toThrow();
	});

	test("spans: each id token's line+col; a node recurs across edge lines", () => {
		//  line 1: graph TD
		//  line 2:   A --> B
		//  line 3:   B --> C
		const g = parseMermaid("graph TD\n  A --> B\n  B --> C\n");
		expect(g.nodes.get("A")!.spans).toEqual([{ line: 2, col: 2, len: 1 }]);
		// B is on both line 2 (as dst) and line 3 (as src) → two spans, sorted
		expect(g.nodes.get("B")!.spans).toEqual([
			{ line: 2, col: 8, len: 1 },
			{ line: 3, col: 2, len: 1 },
		]);
		expect(g.nodes.get("C")!.spans).toEqual([{ line: 3, col: 8, len: 1 }]);
	});

	test("spans point at the id token even when a label is present", () => {
		const g = parseMermaid("graph TD\n  A[Start] --> B[Parse]\n");
		const raw = "  A[Start] --> B[Parse]";
		const a = g.nodes.get("Start")!.spans[0]!;
		const b = g.nodes.get("Parse")!.spans[0]!;
		expect(raw.slice(a.col, a.col + a.len)).toBe("A");
		expect(raw.slice(b.col, b.col + b.len)).toBe("B");
	});
});

describe("format dispatch", () => {
	test("sniff", () => {
		expect(sniffFormat("- A\n")).toBe("md");
		expect(sniffFormat("graph TD\nA-->B\n")).toBe("mmd");
		expect(sniffFormat("flowchart LR\nA-->B\n")).toBe("mmd");
	});

	test("parse routes by sniff", () => {
		expect(parse("graph TD\nA-->B\n").edges.length).toBe(1);
		expect(parse("- A\n  - B\n").edges.length).toBe(1);
	});
});

describe("layout + render", () => {
	test("layout gives centers and is layered top-down", () => {
		const g = parseMarkdown("- A\n  - B\n    - C\n");
		const lay = layout(g);
		expect(lay.nodes.size).toBe(3);
		const a = lay.nodes.get("A")!;
		const b = lay.nodes.get("B")!;
		const c = lay.nodes.get("C")!;
		expect(a.y).toBeLessThan(b.y);
		expect(b.y).toBeLessThan(c.y);
	});

	test("render produces boxes and connectors", () => {
		const out = render(parseMarkdown("- A\n  - B\n"));
		expect(out).toContain("A");
		expect(out).toContain("B");
		expect(out).toContain("│");
		expect(out).toContain("╭");
	});

	test("selected node uses a heavy box", () => {
		const out = render(parseMarkdown("- A\n  - B\n"), { selected: "A" });
		expect(out).toContain("┏");
		expect(out).toContain("┃");
	});

	test("empty graph", () => {
		expect(render(parseMarkdown(""))).toBe("(empty graph)");
	});

	test("a literal \\n makes a multi-row box (ascii); cell height grows", () => {
		const g = parseMarkdown("- foo\\nbar\n  - [go](baz)\n");
		const { lines, cells } = renderGrid(layout(g));
		// both rows of the name are drawn, on consecutive lines
		const fooRow = lines.findIndex((l) => l.includes("foo"));
		expect(fooRow).toBeGreaterThanOrEqual(0);
		expect(lines[fooRow + 1]).toContain("bar");
		// the box is 4 rows tall (2 borders + 2 text rows); single-line baz is 3
		expect(cells.get("foo\\nbar")!.height).toBe(4);
		expect(cells.get("baz")!.height).toBe(3);
	});

	test("renderGrid reports each node's cell in the ascii grid", () => {
		const g = parseMarkdown("- A\n  - B\n");
		const { lines, cells } = renderGrid(layout(g));
		for (const name of ["A", "B"]) {
			const c = cells.get(name)!;
			expect(c).toBeDefined();
			// the node's name sits inside its reported rectangle
			const mid = lines[c.row + 1]!; // middle row of the box
			expect(mid.slice(c.col, c.col + c.width)).toContain(name);
		}
		expect(cells.get("A")!.row).toBeLessThan(cells.get("B")!.row);
	});
});

describe("toJSON (nvim contract)", () => {
	test("each node carries name, spans, and ascii cell", () => {
		const json = toJSON(
			parseMarkdown("- A\n  - B\n"),
			layout(parseMarkdown("- A\n  - B\n")),
		);
		const a = json.nodes.find((n) => n.name === "A")!;
		expect(a.spans).toEqual([{ line: 1, col: 2, len: 1 }]);
		expect(a.cell).toBeDefined();
		expect(Object.keys(a).sort()).toEqual(["cell", "name", "spans"]);
		expect(typeof json.ascii).toBe("string");
	});

	test("a labeled edge carries its label span + ascii cell; unlabeled has neither", () => {
		const src = "- request\n  - [cache hit](respond)\n  - fetch\n";
		const json = toJSON(parseMarkdown(src), layout(parseMarkdown(src)));
		const labeled = json.edges.find((e) => e.dst === "respond")!;
		// the label span points at `cache hit` inside the brackets (line 2)
		expect(labeled.spans[0]).toEqual({ line: 2, col: 5, len: 9 });
		expect(labeled.cell).toBeDefined(); // its label is drawn, so it's highlightable
		const unlabeled = json.edges.find((e) => e.dst === "fetch")!;
		expect(unlabeled.spans).toEqual([]);
		expect(unlabeled.cell).toBeUndefined();
	});
});

describe("toMermaid (converter)", () => {
	test("mid bullets → mermaid with synthetic ids and labels", () => {
		const { text, ids } = toMermaid(
			parseMarkdown("- request\n  - [cache hit](respond)\n"),
		);
		// synthetic ids, names as labels, edge carries the label
		expect(text).toContain("n0[request]");
		expect(text).toContain("n1[respond]");
		expect(text).toContain(
			`${ids.get("request")} -->|cache hit| ${ids.get("respond")}`,
		);
		// round-trips: the emitted mermaid parses back to the same shape
		const g2 = parseMermaid(text);
		expect(edges(g2).get("request->respond")).toBe("cache hit");
	});

	test("a reused node is emitted once (shared identity)", () => {
		const { ids } = toMermaid(
			parseMarkdown("- A\n  - [x](C)\n- B\n  - [y](C)\n"),
		);
		expect(ids.size).toBe(3); // A, B, C — C shared
	});

	test("a literal \\n in node text becomes a <br/> — same for both syntaxes", () => {
		// mid bullet: `- foo\nbar`
		const md = toMermaid(parseMarkdown("- foo\\nbar\n"));
		expect(md.text).toContain("[foo<br/>bar]");
		// mermaid node label: `A[foo\nbar]` — names by label, so the same graph
		const mm = toMermaid(parseMermaid("graph TD\n  A[foo\\nbar]\n"));
		expect(mm.text).toContain("[foo<br/>bar]");
		// identity (the ids key) keeps the raw `\n`, only the label is rewritten
		expect([...md.ids.keys()][0]).toBe("foo\\nbar");
	});

	test("\\n in an edge label becomes a <br/>", () => {
		const { text } = toMermaid(parseMarkdown("- A\n  - [one\\ntwo](B)\n"));
		expect(text).toContain("|one<br/>two|");
	});
});
