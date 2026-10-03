import { detect, type Span } from "../src/index.ts";
import { isEmptyTable, readTable } from "./grid.ts";
import { readItems } from "./outline.ts";

export type Kind = "text" | "table" | "bullets";
export type Mode = "graph" | "diagram";

const NEW_TABLE = "| Participant 1 | Participant 2 |\n| --- | --- |\n|  |  |\n";

export function editorFor(text: string): Kind | undefined {
  const { format, kind } = detect(text);
  if (format !== "mid") return undefined;
  if (kind === "sequence") return "table";
  return readItems(text) ? "bullets" : undefined;
}

export function modeOf(text: string): Mode {
  return detect(text).kind === "sequence" ? "diagram" : "graph";
}

export function isBlank(text: string): boolean {
  if (!text.trim()) return true;
  const items = readItems(text);
  if (items) return items.every((item) => !item.text);
  const table = modeOf(text) === "diagram" ? readTable(text) : null;
  return !!table && isEmptyTable(table);
}

export function opening(mode: Mode, saved: string | undefined) {
  if (saved !== undefined && !isBlank(saved) && modeOf(saved) === mode)
    return { text: saved, kind: editorFor(saved) ?? "text" };
  if (mode === "graph") return { text: "", kind: "bullets" as const };
  const name = NEW_TABLE.indexOf("Participant 1");
  const select: Span = { start: name, end: name + "Participant 1".length };
  return { text: NEW_TABLE, kind: "table" as const, select };
}
