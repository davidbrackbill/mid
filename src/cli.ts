#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { ParseError, parse, renderAscii, renderMermaid } from "./index.ts";

const USAGE = `Usage: mid [-m] [file]

Draws a mid bullet list or Mermaid flowchart as ASCII. The input syntax is
detected from the content.

Arguments:
  file           Input file; reads stdin if omitted or "-"

Options:
  -m, --mermaid  Print Mermaid (graph TD) source instead of ASCII
  -h, --help     Show this help
`;

async function readSource(source: string | undefined): Promise<string> {
  if (!source || source === "-") return await Bun.stdin.text();
  return await Bun.file(source).text();
}

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        mermaid: { type: "boolean", short: "m" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help || (!positionals.length && process.stdin.isTTY)) {
      process.stdout.write(USAGE);
      return;
    }
    if (positionals.length > 1) throw new Error(`expected one file, got: ${positionals.join(" ")}`);

    const graph = parse(await readSource(positionals[0]));
    const out = values.mermaid ? renderMermaid(graph) : renderAscii(graph);
    process.stdout.write(`${out}\n`);
  } catch (e) {
    const msg =
      e instanceof ParseError ? `Parse error: ${e.message}` : `Error: ${(e as Error).message}`;
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}

main();
