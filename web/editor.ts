import {
  type Format,
  type Graph,
  ParseError,
  parse,
  renderMermaid,
  renderMid,
} from "../src/index.ts";
import { bulletSource } from "./bullets.ts";
import { editorFor, type Kind, type Mode, modeOf, opening } from "./document.ts";
import { corner, el, modeButton } from "./dom.ts";
import { readTable } from "./grid.ts";
import { readItems } from "./outline.ts";
import { type Source, type SourceEvents, textareaSource } from "./source.ts";
import { tableSource } from "./table.ts";
import { outputPane, type View } from "./view.ts";

export type { Mode, View };

export interface MidOptions {
  caption?: Node;
  value?: string;
  view?: View;
  onChange?: (value: string) => void;
  load?: (mode: Mode) => string | undefined;
  save?: (mode: Mode, value: string) => void;
}

export interface MidEditor {
  getValue(): string;
  setValue(value: string): void;
  destroy(): void;
}

export function mountMid(root: HTMLElement, options: MidOptions = {}): MidEditor {
  let graph: Graph | undefined;
  let format: Format = "mid";
  let error: string | undefined;
  let kind: Kind = "text";
  let forceText = false;
  let reported = options.value ?? "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const saved = new Map<Mode, string | undefined>(
    (["graph", "diagram"] as const).map((mode) => [mode, options.load?.(mode)]),
  );

  const events: SourceEvents = {
    input() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sync();
        commit();
      }, 250);
    },
    caret: () => view.mark(source.caret()),
  };
  let source: Source = textareaSource(reported, 0, events);

  const slot = el("div", "mid-slot");
  slot.append(source.el);
  const status = el("div", "mid-status");
  status.setAttribute("role", "status");

  const swapButton = el("button", "mid-swap");
  swapButton.type = "button";
  swapButton.addEventListener("click", () => {
    forceText = kind !== "text";
    swap(forceText ? "text" : editorFor(source.value())!, true);
    commit();
  });

  const kindButton = el("button", "mid-kind");
  kindButton.type = "button";
  kindButton.addEventListener("click", () => switchMode());

  const sourceMode = modeButton<Format>(
    [
      ["mid", "Mid"],
      ["mermaid", "Mermaid"],
    ],
    convert,
  );
  const bar = el("div", "mid-bar");
  const caption = el("div", "mid-caption");
  if (options.caption) caption.append(options.caption);
  bar.append(caption, sourceMode.button);
  const editPane = el("div", "mid-pane mid-source");
  editPane.append(
    bar,
    slot,
    status,
    corner("bottom-left", kindButton),
    corner("bottom-right", swapButton),
  );

  const view = outputPane(options.view ?? "svg", (span) => source.select(span));

  const container = el("div", "mid");
  container.append(editPane, view.el);
  root.append(container);

  function setStatus(level: "" | "warn" | "error", text: string) {
    status.className = level ? `mid-status mid-${level}` : "mid-status";
    status.textContent = text;
  }

  function commit() {
    clearTimeout(timer);
    const value = source.value();
    try {
      graph = parse(value);
      format = graph.format;
      error = undefined;
      const warnings = graph.warnings.map((w) => `Line ${w.line}: ${w.message}`);
      setStatus(warnings.length ? "warn" : "", warnings.join("\n"));
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      error = e.message;
      setStatus("error", error);
    }
    sourceMode.set(format);
    const diagram = modeOf(value) === "diagram";
    kindButton.textContent = diagram ? "Diagram" : "Graph";
    kindButton.title = diagram ? "Switch to the graph" : "Switch to the diagram";
    const alt = editorFor(value);
    swapButton.hidden = kind === "text" && !(forceText && alt);
    swapButton.textContent = kind !== "text" ? "Text" : alt === "table" ? "Table" : "Bullets";
    swapButton.title =
      kind !== "text"
        ? "Edit as Markdown text"
        : alt === "table"
          ? "Edit as a table"
          : "Edit as bullets";
    view.show(graph, source.caret());
    if (value !== reported) {
      reported = value;
      options.onChange?.(value);
    }
  }

  function swap(next: Kind, focus: boolean, text = source.value()) {
    if (next === kind && text === source.value()) return;
    const caret = source.caret();
    const created =
      next === "table"
        ? tableSource(readTable(text)!, events)
        : next === "bullets"
          ? bulletSource(readItems(text)!, events)
          : textareaSource(text, Math.min(caret, text.length), events);
    source.destroy();
    slot.append(created.el);
    source = created;
    kind = next;
    if (focus) {
      source.focus();
      source.select({ start: caret, end: caret });
    }
  }

  function sync() {
    const alt = editorFor(source.value());
    if (!alt) forceText = false;
    const want = alt && !forceText ? alt : "text";
    if (want !== kind) swap(want, editPane.contains(document.activeElement));
  }

  function switchMode() {
    const value = source.value();
    const from = modeOf(value);
    const to: Mode = from === "graph" ? "diagram" : "graph";
    saved.set(from, value);
    options.save?.(from, value);
    const next = opening(to, saved.get(to));
    forceText = false;
    swap(next.kind, true, next.text);
    if (next.select) source.select(next.select);
    commit();
  }

  function convert() {
    if (error) return setStatus("error", `${error}\nFix this before switching syntax.`);
    if (!graph) return;
    const dropped = graph.warnings.length;
    if (dropped && !confirm(`${dropped} line(s) not understood will be dropped. Switch anyway?`))
      return;
    const text = `${format === "mermaid" ? renderMid(graph) : renderMermaid(graph)}\n`;
    const alt = editorFor(text);
    forceText = false;
    if (alt) swap(alt, true, text);
    else {
      swap("text", true);
      source.replace(text);
    }
    commit();
  }

  swap(editorFor(reported) ?? "text", false);
  commit();

  return {
    getValue: () => source.value(),
    setValue(value: string) {
      reported = value;
      source.set(value);
      if (source.value() !== value) swap("text", false, value);
      sync();
      commit();
    },
    destroy() {
      clearTimeout(timer);
      source.destroy();
      view.destroy();
      container.remove();
    },
  };
}
