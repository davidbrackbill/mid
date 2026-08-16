import { describe, expect, test } from "bun:test";
import { toMermaidSequence } from "../src/convert.ts";
import { sniffFormat } from "../src/index.ts";
import { parseSequence } from "../src/sequence.ts";

function msgs(text: string) {
	return parseSequence(text).messages.map((m) => ({
		from: m.from,
		to: m.to,
		text: m.text,
	}));
}

describe("sequence parser", () => {
	test("declared actors, in declaration order", () => {
		const d = parseSequence("Client\nServer\n[Authentication Server](Auth)\n");
		expect([...d.actors.keys()]).toEqual(["Client", "Server", "Auth"]);
		expect(d.actors.get("Auth")!.label).toBe("Authentication Server");
		expect(d.actors.get("Client")!.label).toBeUndefined();
	});

	test("undeclared actor auto-created in first-mention order", () => {
		const d = parseSequence("Client > Server: hi\n");
		expect([...d.actors.keys()]).toEqual(["Client", "Server"]);
	});

	test("declared actors keep their column position ahead of later mentions", () => {
		const d = parseSequence(
			"Server\nClient\nClient > Server: hi\nClient > New: bye\n",
		);
		expect([...d.actors.keys()]).toEqual(["Server", "Client", "New"]);
	});

	test("message with text", () => {
		expect(msgs("Client > Auth: Login request\n")).toEqual([
			{ from: "Client", to: "Auth", text: "Login request" },
		]);
	});

	test("silent call, no message text", () => {
		expect(msgs("Client > Server\n")).toEqual([
			{ from: "Client", to: "Server", text: undefined },
		]);
	});

	test("self-message", () => {
		expect(msgs("Client > Client: retry\n")).toEqual([
			{ from: "Client", to: "Client", text: "retry" },
		]);
	});

	test("message text may contain colons", () => {
		expect(msgs("Client > Server: ratio 3:2 wins\n")).toEqual([
			{ from: "Client", to: "Server", text: "ratio 3:2 wins" },
		]);
	});

	test("messages are ordered events, not deduped like flowchart edges", () => {
		const d = parseSequence(
			"Client > Auth: first\nClient > Auth: second\nClient > Auth: first\n",
		);
		expect(d.messages.map((m) => m.text)).toEqual(["first", "second", "first"]);
	});

	test("unmatched lines are silently skipped, same as markdown/mermaid", () => {
		const d = parseSequence("# Auth flow\n\nClient\nnotes go here\nServer\n");
		expect([...d.actors.keys()]).toEqual(["Client", "Server"]);
	});

	test("actor id span points at the id token, not the label", () => {
		const d = parseSequence("[Authentication Server](Auth)\n");
		const span = d.actors.get("Auth")!.spans[0]!;
		expect(span).toEqual({ line: 1, col: 24, len: 4 }); // "Auth" inside the parens
	});

	test("message text span points at the text after the colon", () => {
		const d = parseSequence("Client > Auth: Login request\n");
		expect(d.messages[0]!.spans[0]).toEqual({ line: 1, col: 15, len: 13 });
	});

	test("silent call has no spans (no text token to point at)", () => {
		const d = parseSequence("Client > Server\n");
		expect(d.messages[0]!.spans).toEqual([]);
	});
});

describe("sniffFormat for sequence blocks", () => {
	test("no bullets, has an arrow message → seq", () => {
		expect(sniffFormat("Client\nServer\n\nClient > Server: hi\n")).toBe("seq");
	});

	test("bullets still sniff as md", () => {
		expect(sniffFormat("- A\n  - B\n")).toBe("md");
	});
});

describe("toMermaidSequence", () => {
	test("emits participants and messages in order", () => {
		const d = parseSequence(
			"Client\nServer\n[Authentication Server](Auth)\n\n" +
				"Client > Auth: Login request\n" +
				"Auth > Server: Validate token\n",
		);
		const { text } = toMermaidSequence(d);
		expect(text.split("\n")[0]).toBe("sequenceDiagram");
		expect(text).toContain("participant n0");
		expect(text).toContain("participant n2 as Authentication Server");
		expect(text).toContain("n0->>n2: Login request");
		expect(text).toContain("n2->>n1: Validate token");
	});

	test("silent call becomes an empty-text message", () => {
		const { text } = toMermaidSequence(parseSequence("Client > Server\n"));
		expect(text).toContain("n0->>n1: ");
	});

	test("a literal \\n in message text becomes <br/>, matching toMermaid", () => {
		const { text } = toMermaidSequence(
			parseSequence("Client\nServer\nClient > Server: line one\\nline two\n"),
		);
		expect(text).toContain("line one<br/>line two");
	});
});
