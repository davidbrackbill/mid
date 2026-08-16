#!/usr/bin/env bun
/**
 * mid CLI — render a Markdown bullet list (or Mermaid) graph as ASCII/JSON, or
 * convert between the two syntaxes. Also converts sequence-diagram syntax to
 * Mermaid (`render` isn't supported for it yet — no ASCII layout exists).
 *
 *   mid render file.md              ASCII → stdout
 *   mid render --json file.md       {nodes, edges, ascii} → stdout
 *   mid render --select NAME ...    highlight a node (heavy box)
 *   mid convert file.md             → Mermaid (opposite of the input format)
 *   mid convert file.mmd            → mid bullets
 *   mid convert file.seq            → Mermaid sequenceDiagram
 *   mid convert - < file.mmd        read from stdin, format sniffed from content
 *
 * `--format md|mmd|seq` is only needed to override auto-detection (e.g.
 * content that doesn't sniff cleanly); by default the format is inferred from
 * the source, not from you.
 */
import { toMarkdown, toMermaid, toMermaidSequence } from "./convert.ts";
import { type Format, parse, sniffFormat } from "./index.ts";
import { layout } from "./layout.ts";
import { ParseError } from "./markdown.ts";
import { renderAscii, toJSON } from "./render.ts";
import { parseSequence } from "./sequence.ts";

interface Args {
	cmd: string;
	source?: string;
	json: boolean;
	format?: Format;
	select?: string;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { cmd: argv[0] ?? "", json: false };
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--json") args.json = true;
		else if (a === "--format") {
			const f = argv[++i];
			if (f !== "md" && f !== "mmd" && f !== "seq") {
				process.stderr.write(
					`mid: unknown --format '${f}' (expected md, mmd, or seq)\n`,
				);
				process.exit(1);
			}
			args.format = f;
		} else if (a === "--select") args.select = argv[++i];
		else args.source = a;
	}
	return args;
}

async function readSource(source: string | undefined): Promise<string> {
	if (!source || source === "-") return await Bun.stdin.text();
	return await Bun.file(source).text();
}

const USAGE =
	"Usage: mid render [--json] [--format md|mmd] [--select NAME] <file|->\n" +
	"       mid convert [--format md|mmd|seq] <file|->\n";

async function main() {
	const args = parseArgs(Bun.argv.slice(2));

	if (args.cmd !== "render" && args.cmd !== "convert") {
		process.stderr.write(USAGE);
		process.exit(args.cmd ? 1 : 0);
	}

	try {
		const text = await readSource(args.source);
		const fmt = args.format ?? sniffFormat(text);

		if (fmt === "seq") {
			if (args.cmd !== "convert") {
				process.stderr.write(
					"mid: sequence diagrams aren't supported by `render` yet — use `mid convert` for Mermaid output\n",
				);
				process.exit(1);
			}
			const out = toMermaidSequence(parseSequence(text)).text;
			process.stdout.write(`${out}\n`);
			return;
		}

		const graph = parse(text, fmt);

		if (args.cmd === "convert") {
			const out = fmt === "md" ? toMermaid(graph).text : toMarkdown(graph);
			process.stdout.write(`${out}\n`);
			return;
		}

		const lay = layout(graph);
		const opts = { selected: args.select };
		if (args.json) {
			process.stdout.write(`${JSON.stringify(toJSON(graph, lay, opts))}\n`);
		} else {
			process.stdout.write(`${renderAscii(lay, opts)}\n`);
		}
	} catch (e) {
		const msg =
			e instanceof ParseError
				? `Parse error: ${e.message}`
				: `Error: ${(e as Error).message}`;
		process.stderr.write(`${msg}\n`);
		process.exit(1);
	}
}

main();
