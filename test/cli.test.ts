import { describe, expect, test } from "bun:test";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

async function run(
	args: string[],
	stdin: string,
): Promise<{ out: string; err: string; code: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdin: new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = await new Response(proc.stdout).text();
	const err = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { out, err, code };
}

describe("cli render", () => {
	test("ascii from markdown stdin", async () => {
		const { out, code } = await run(
			["render", "--format", "md", "-"],
			"- A\n  - B\n",
		);
		expect(code).toBe(0);
		expect(out).toContain("A");
		expect(out).toContain("B");
		expect(out).toContain("╭");
	});

	test("json from markdown stdin", async () => {
		const { out, code } = await run(
			["render", "--json", "--format", "md", "-"],
			"- A\n  - [go](B)\n",
		);
		expect(code).toBe(0);
		const data = JSON.parse(out);
		expect(data.nodes.map((n: { name: string }) => n.name).sort()).toEqual([
			"A",
			"B",
		]);
		expect(typeof data.ascii).toBe("string");
		// each node carries its source spans + its rectangle in the rendered ascii grid
		for (const n of data.nodes) {
			expect(Array.isArray(n.spans)).toBe(true);
			expect(n.cell).toMatchObject({
				row: expect.any(Number),
				col: expect.any(Number),
				width: expect.any(Number),
				height: expect.any(Number),
			});
		}
	});

	test("mermaid via --format mmd", async () => {
		const { out, code } = await run(
			["render", "--format", "mmd", "-"],
			"graph TD\n  A --> B\n",
		);
		expect(code).toBe(0);
		expect(out).toContain("A");
		expect(out).toContain("B");
	});

	test("content sniff when no format given", async () => {
		const { out, code } = await run(["render", "-"], "graph TD\n  A --> B\n");
		expect(code).toBe(0);
		expect(out).toContain("A");
	});

	test("parse error exits non-zero", async () => {
		const { code } = await run(
			["render", "--format", "mmd", "-"],
			"not a graph\n",
		);
		expect(code).toBe(1);
	});

	test("unknown --format exits non-zero with a message", async () => {
		const { err, code } = await run(
			["render", "--format", "xyz", "-"],
			"- A\n",
		);
		expect(code).toBe(1);
		expect(err).toContain("unknown --format");
	});
});
