import {
  type Format,
  type Graph,
  ParseError,
  type Span,
  parse,
  renderAscii,
  renderMermaid,
  renderMid,
  renderSvg,
} from "../src/index.ts";
import { el } from "./dom.ts";
import { panZoom } from "./panzoom.ts";
import { svgToPng } from "./png.ts";
import { readTable, tableSource } from "./table.ts";

export type View = "svg" | "ascii";

export interface MidOptions {
  caption?: Node;
  value?: string;
  view?: View;
  vim?: boolean;
  onChange?: (value: string) => void;
  onVimChange?: (on: boolean) => void;
}

export interface MidEditor {
  getValue(): string;
  setValue(value: string): void;
  destroy(): void;
}

type Kind = "text" | "vim" | "table";

export interface SourceEvents {
  input(): void;
  caret(): void;
}

export interface Source {
  el: HTMLElement;
  value(): string;
  set(text: string): void;
  replace(text: string): void;
  select(span: Span): void;
  caret(): number;
  focus(): void;
  destroy(): void;
}

const ICON_COPY =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
const ICON_DONE =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>';

function modeButton<T extends string>(modes: Array<[T, string]>, onClick: () => void) {
  const button = el("button", "mid-mode");
  button.type = "button";
  const spans = modes.map(([id, label]) => {
    const span = el("span", "", label);
    button.append(span);
    return [id, label, span] as const;
  });
  button.addEventListener("click", onClick);
  return {
    button,
    set(current: T) {
      for (const [id, label, span] of spans) {
        span.className = id === current ? "mid-on" : "";
        if (id !== current) button.title = `Switch to ${label}`;
      }
    },
  };
}

function textareaSource(value: string, caret: number, on: SourceEvents): Source {
  const input = el("textarea", "mid-input");
  input.spellcheck = false;
  input.value = value;
  input.setAttribute("aria-label", "Diagram source");
  input.setSelectionRange(caret, caret);

  const onSelection = () => {
    if (document.activeElement === input) on.caret();
  };
  document.addEventListener("selectionchange", onSelection);
  input.addEventListener("input", on.input);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (document.execCommand("insertText", false, "  ")) return;
    input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end");
    on.input();
  });

  return {
    el: input,
    value: () => input.value,
    set(text) {
      input.value = text;
    },
    replace(text) {
      input.focus();
      input.select();
      if (!document.execCommand("insertText", false, text)) input.value = text;
      input.setSelectionRange(0, 0);
      input.scrollTop = 0;
    },
    select(span) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(span.start, span.end);
      const line = input.value.slice(0, span.start).split("\n").length - 1;
      const height = Number.parseFloat(getComputedStyle(input).lineHeight) || 20;
      input.scrollTop = Math.max(0, line * height - input.clientHeight / 2);
    },
    caret: () => input.selectionStart,
    focus: () => input.focus(),
    destroy() {
      document.removeEventListener("selectionchange", onSelection);
      input.remove();
    },
  };
}

export function mountMid(root: HTMLElement, options: MidOptions = {}): MidEditor {
  let view: View = options.view ?? "svg";
  let graph: Graph | undefined;
  let format: Format = "mid";
  let error: string | undefined;
  let vim = options.vim ?? false;
  let kind: Kind = "text";
  let forceText = false;
  let cycle = { key: "", index: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const events: SourceEvents = {
    input() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        update();
        options.onChange?.(source.value());
        sync();
      }, 100);
    },
    caret: () => mark(source.caret()),
  };
  let source = textareaSource(options.value ?? "", 0, events);

  const slot = el("div", "mid-slot");
  slot.append(source.el);
  const status = el("div", "mid-status");
  status.setAttribute("role", "status");
  const swapButton = el("button", "mid-swap");
  swapButton.type = "button";
  swapButton.addEventListener("click", () => {
    forceText = kind === "table";
    void mount(forceText ? textKind() : "table", true);
  });
  const vimButton = el("button", "mid-vim", "Vim");
  vimButton.type = "button";
  vimButton.title = "Vim keys";
  vimButton.setAttribute("aria-pressed", String(vim));
  vimButton.addEventListener("click", () => {
    vim = !vim;
    vimButton.setAttribute("aria-pressed", String(vim));
    options.onVimChange?.(vim);
    void mount(textKind(), true);
  });

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
  editPane.append(bar, slot, status, corner("bottom-right", swapButton, vimButton));

  const out = el("div", "mid-out");
  const pan = panZoom(out);
  const copy = el("button", "mid-copy");
  copy.type = "button";
  copy.innerHTML = ICON_COPY;
  const viewMode = modeButton<View>(
    [
      ["svg", "SVG"],
      ["ascii", "ASCII"],
    ],
    () => {
      view = view === "svg" ? "ascii" : "svg";
      show();
    },
  );
  const output = el("div", "mid-pane mid-view");
  output.append(out, corner("left", viewMode.button), corner("right", copy));

  const container = el("div", "mid");
  container.append(editPane, output);
  root.append(container);

  function corner(side: "left" | "right" | "bottom-right", ...buttons: HTMLElement[]) {
    const div = el("div", `mid-corner mid-${side}`);
    div.append(...buttons);
    return div;
  }

  function labelCopy() {
    copy.title = view === "ascii" ? "Copy ASCII" : "Copy as PNG";
    copy.setAttribute("aria-label", copy.title);
  }

  function show() {
    labelCopy();
    viewMode.set(view);
    sourceMode.set(format);
    vimButton.hidden = kind === "table";
    swapButton.hidden = kind !== "table" && !(forceText && isTable());
    swapButton.textContent = kind === "table" ? "Text" : "Table";
    swapButton.title = kind === "table" ? "Edit the table as Markdown text" : "Edit as a table";
    if (!graph) {
      pan.clear();
      return out.replaceChildren();
    }
    if (view === "svg") {
      const canvas = el("div", "");
      canvas.innerHTML = renderSvg(graph);
      pan.show(canvas);
    } else {
      pan.clear();
      out.replaceChildren(el("pre", "mid-text", renderAscii(graph)));
    }
    mark(source.caret());
  }

  function setStatus(kind: "" | "warn" | "error", text: string) {
    status.className = kind ? `mid-status mid-${kind}` : "mid-status";
    status.textContent = text;
  }

  function update() {
    try {
      graph = parse(source.value());
      format = graph.format;
      error = undefined;
      const warnings = graph.warnings.map((w) => `Line ${w.line}: ${w.message}`);
      setStatus(warnings.length ? "warn" : "", warnings.join("\n"));
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      error = e.message;
      setStatus("error", error);
    }
    show();
  }

  function textKind(): Kind {
    return vim ? "vim" : "text";
  }

  function isTable(text = source.value()) {
    return text.trimStart().startsWith("|");
  }

  async function mount(next: Kind, focus: boolean, text = source.value()) {
    if (next === kind && text === source.value()) return;
    let created: Source;
    try {
      if (next === "vim")
        created = (await import("./vim.ts")).vimSource(text, source.caret(), events);
      else if (next === "table") created = tableSource(readTable(text)!, events);
      else created = textareaSource(text, Math.min(source.caret(), text.length), events);
    } catch {
      return setStatus("error", "Couldn't load Vim keys. Check your connection and try again.");
    }
    const caret = source.caret();
    source.destroy();
    slot.append(created.el);
    source = created;
    kind = next;
    if (focus) {
      source.focus();
      source.select({ start: caret, end: caret });
    }
    clearTimeout(timer);
    update();
    if (source.value() !== text) options.onChange?.(source.value());
  }

  function sync() {
    if (!isTable()) forceText = false;
    const want = isTable() && !forceText ? "table" : textKind();
    if (want !== kind) void mount(want, editPane.contains(document.activeElement));
  }

  async function convert() {
    if (error) return setStatus("error", `${error}\nFix this before switching syntax.`);
    if (!graph) return;
    const dropped = graph.warnings.length;
    if (dropped && !confirm(`${dropped} line(s) not understood will be dropped. Switch anyway?`))
      return;
    const text = `${format === "mermaid" ? renderMid(graph) : renderMermaid(graph)}\n`;
    if (isTable(text)) {
      forceText = false;
      return mount("table", true, text);
    }
    if (kind === "table") await mount(textKind(), true);
    source.replace(text);
    clearTimeout(timer);
    update();
    options.onChange?.(source.value());
  }

  function at(spans: Span[] | undefined, pos: number) {
    return spans?.some((s) => s.start <= pos && pos <= s.end) ?? false;
  }

  function mark(pos: number) {
    let node: string | undefined;
    for (const [name, spans] of graph?.spans ?? []) if (at(spans, pos)) node = name;
    const message = graph?.messages.findIndex((m) => at(m.span && [m.span], pos)) ?? -1;
    for (const g of out.querySelectorAll("[data-node]"))
      g.classList.toggle("mid-hl", g.getAttribute("data-node") === node);
    for (const g of out.querySelectorAll("[data-message]"))
      g.classList.toggle("mid-hl", g.getAttribute("data-message") === String(message));
  }

  out.addEventListener("click", (e) => {
    if (pan.dragged()) return;
    const target = (e.target as Element).closest("[data-node],[data-message]");
    const name = target?.getAttribute("data-node");
    const index = target?.getAttribute("data-message");
    const spans =
      name != null
        ? graph?.spans.get(name)
        : index != null
          ? [graph?.messages[Number(index)]?.span].filter((s) => s !== undefined)
          : undefined;
    if (!spans?.length) return;
    const key = name ?? `#${index}`;
    cycle = { key, index: cycle.key === key ? (cycle.index + 1) % spans.length : 0 };
    source.select(spans[cycle.index]!);
    mark(spans[cycle.index]!.start);
  });

  copy.addEventListener("click", async () => {
    if (!graph) return;
    try {
      if (view === "ascii") await navigator.clipboard.writeText(renderAscii(graph));
      else {
        const style = getComputedStyle(container);
        const colors = {
          fg: style.getPropertyValue("--mid-fg").trim(),
          bg: style.getPropertyValue("--mid-bg").trim(),
        };
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": svgToPng(renderSvg(graph), colors) }),
        ]);
      }
      copy.innerHTML = ICON_DONE;
      copy.title = "Copied";
    } catch {
      copy.title = "Copy failed";
    }
    setTimeout(() => {
      copy.innerHTML = ICON_COPY;
      labelCopy();
    }, 1200);
  });

  update();
  void mount(isTable() ? "table" : textKind(), false);

  return {
    getValue: () => source.value(),
    setValue(value: string) {
      source.set(value);
      update();
      if (source.value() !== value) void mount(textKind(), false, value);
      sync();
    },
    destroy() {
      clearTimeout(timer);
      source.destroy();
      pan.destroy();
      container.remove();
    },
  };
}
