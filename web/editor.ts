import {
  type Format,
  type Graph,
  ParseError,
  parse,
  renderAscii,
  renderMermaid,
  renderMid,
  renderSvg,
  type Span,
} from "../src/index.ts";
import { editorFor, type Kind, type Mode, modeOf, opening } from "./document.ts";
import type { Action, Cursor, Focus, Key, Rules } from "./edit.ts";
import {
  addColumn,
  addRow,
  cellText,
  deleteColumn,
  deleteRow,
  gridRules,
  readTable,
  type Table,
} from "./grid.ts";
import { type Item, outlineRules, readItems } from "./outline.ts";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function caretIn(cell: HTMLElement): [number, number] | null {
  const sel = getSelection();
  if (!sel?.rangeCount || !cell.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(cell);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return [start, start + range.toString().length];
}

function selectIn(cell: HTMLElement, start: number, end = start) {
  cell.focus();
  const text = cell.firstChild;
  const range = document.createRange();
  if (text) {
    const len = text.textContent?.length ?? 0;
    range.setStart(text, Math.min(start, len));
    range.setEnd(text, Math.min(end, len));
  } else range.setStart(cell, 0);
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

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

function corner(
  side: "left" | "right" | "bottom-left" | "bottom-right",
  ...children: HTMLElement[]
) {
  const div = el("div", `mid-corner mid-${side}`);
  div.append(...children);
  return div;
}

function typeLineBreak(e: KeyboardEvent, field: HTMLElement | null): boolean {
  if (!field || e.key !== "Enter" || !e.shiftKey || e.isComposing) return false;
  e.preventDefault();
  if (field.textContent) document.execCommand("insertText", false, "\\n");
  return true;
}

const MIN = 0.2;
const MAX = 5;
const TOP = 48;
const PAD = 16;
const DRAG = 4;

interface Point {
  x: number;
  y: number;
}

interface PanZoom {
  show(content: HTMLElement): void;
  clear(): void;
  dragged(): boolean;
  destroy(): void;
}

const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

function panZoom(view: HTMLElement): PanZoom {
  let content: HTMLElement | undefined;
  let x = 0;
  let y = 0;
  let s = 1;
  let free = false;
  let moved = false;
  let start: Point | undefined;
  let pinch: { dist: number; mid: Point } | undefined;
  const pointers = new Map<number, Point>();

  const apply = () => {
    if (content) content.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  };

  function fit() {
    const svg = content?.firstElementChild;
    const w = Number(svg?.getAttribute("width")) || 1;
    const h = Number(svg?.getAttribute("height")) || 1;
    s = clamp(Math.min(1, (view.clientWidth - PAD * 2) / w, (view.clientHeight - TOP - PAD) / h));
    x = (view.clientWidth - w * s) / 2;
    y = TOP;
    apply();
  }

  function zoomAt(p: Point, factor: number) {
    const next = clamp(s * factor);
    x = p.x - (p.x - x) * (next / s);
    y = p.y - (p.y - y) * (next / s);
    s = next;
    free = true;
    apply();
  }

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const twoFinger = () => {
    const [a, b] = [...pointers.values()] as [Point, Point];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  function onMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2 && pinch) {
      const next = twoFinger();
      zoomAt(next.mid, next.dist / pinch.dist);
      x += next.mid.x - pinch.mid.x;
      y += next.mid.y - pinch.mid.y;
      pinch = next;
      moved = true;
      apply();
      return;
    }
    if (!moved && start && Math.hypot(p.x - start.x, p.y - start.y) < DRAG) return;
    moved = true;
    free = true;
    view.classList.add("mid-dragging");
    x += p.x - prev.x;
    y += p.y - prev.y;
    apply();
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    pinch = pointers.size >= 2 ? twoFinger() : undefined;
    if (pointers.size) return;
    view.classList.remove("mid-dragging");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
  }

  view.addEventListener("pointerdown", (e) => {
    if (!content || e.button !== 0) return;
    const p = local(e);
    if (!pointers.size) {
      moved = false;
      start = p;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    }
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2) pinch = twoFinger();
  });

  view.addEventListener(
    "wheel",
    (e) => {
      if (!content) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey)
        return zoomAt(local(e), Math.exp(-Math.max(-30, Math.min(30, e.deltaY)) * 0.01));
      x -= e.deltaX;
      y -= e.deltaY;
      free = true;
      apply();
    },
    { passive: false },
  );

  view.addEventListener("dblclick", (e) => {
    if (!content || (e.target as Element).closest("[data-node],[data-message]")) return;
    free = false;
    fit();
  });

  const resize = new ResizeObserver(() => {
    if (content && !free) fit();
  });
  resize.observe(view);

  return {
    show(next) {
      content = next;
      content.classList.add("mid-canvas");
      view.classList.add("mid-pan");
      view.replaceChildren(content);
      if (free) apply();
      else fit();
    },
    clear() {
      content = undefined;
      view.classList.remove("mid-pan", "mid-dragging");
    },
    dragged: () => moved,
    destroy() {
      resize.disconnect();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    },
  };
}

const PNG_PAD = 16;
const SCALE = 2;

async function svgToPng(svg: string, colors: { fg: string; bg: string }): Promise<Blob> {
  const themed = svg
    .replace("<svg ", `<svg style="color:${colors.fg}" `)
    .replace("<defs>", `<defs><style>.mid-svg-box,.mid-svg-label-bg{fill:${colors.bg}}</style>`);
  const url = URL.createObjectURL(new Blob([themed], { type: "image/svg+xml" }));
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement("canvas");
  canvas.width = (img.width + PNG_PAD * 2) * SCALE;
  canvas.height = (img.height + PNG_PAD * 2) * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(SCALE, SCALE);
  ctx.drawImage(img, PNG_PAD, PNG_PAD);
  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png",
    ),
  );
}

interface SourceEvents {
  input(): void;
  caret(): void;
}

interface Source {
  el: HTMLElement;
  value(): string;
  set(text: string): void;
  replace(text: string): void;
  select(span: Span): void;
  caret(): number;
  focus(): void;
  destroy(): void;
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

const KEYS: Record<string, Key> = {
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

function keyOf(e: KeyboardEvent): Key | undefined {
  if (e.shiftKey && e.key === "Tab") return "Shift+Tab";
  if (e.shiftKey && ["Enter", "ArrowLeft", "ArrowRight"].includes(e.key)) return undefined;
  return KEYS[e.key];
}

interface Fields<M> {
  root: HTMLElement;
  host: HTMLElement;
  field: string;
  rules: Rules<M>;
  model: M;
  render(model: M): void;
  first(model: M): Focus;
  on: SourceEvents;
}

function fieldSource<M>(o: Fields<M>) {
  const { root, host, field, rules, on } = o;
  let model = o.model;
  let lastCaret = 0;
  let dismissed = false;

  const nodeAt = (at: number) => host.querySelector<HTMLElement>(`.${field}[data-at="${at}"]`);
  const fieldOf = (target: EventTarget | null) => {
    const node = (target as Element | null)?.closest?.<HTMLElement>(`.${field}`);
    return node && host.contains(node) ? node : null;
  };
  const cursor = (node: HTMLElement): Cursor => {
    const [start, end] = caretIn(node) ?? [0, 0];
    return { at: Number(node.dataset.at), start, end };
  };

  function focusAt({ at, start, end }: Focus) {
    const node = nodeAt(at);
    if (node) selectIn(node, start, end);
  }

  function draw(focus?: Focus) {
    o.render(model);
    if (focus) focusAt(focus);
  }

  function apply(action: Action<M>) {
    if (action.kind === "move") return focusAt(action.focus);
    if (action.kind === "edit") {
      model = action.model;
      draw(action.focus);
      on.input();
    }
  }

  function showGhost() {
    for (const n of host.querySelectorAll<HTMLElement>("[data-ghost]")) delete n.dataset.ghost;
    const node = fieldOf(document.activeElement);
    if (!node || dismissed) return;
    const ghost = rules.suggestion(model, cursor(node));
    if (ghost) node.dataset.ghost = ghost;
  }

  host.addEventListener("input", (e) => {
    const node = fieldOf(e.target);
    if (!node) return;
    model = rules.setText(model, Number(node.dataset.at), node.textContent ?? "");
    dismissed = false;
    showGhost();
    on.input();
  });

  host.addEventListener("keydown", (e) => {
    const node = fieldOf(e.target);
    if (!node || e.isComposing || typeLineBreak(e, node)) return;
    if (node.dataset.ghost && e.key === "Escape") {
      e.preventDefault();
      dismissed = true;
      return showGhost();
    }
    const accepted =
      node.dataset.ghost && e.key === "Tab" && !e.shiftKey
        ? rules.accept(model, cursor(node))
        : undefined;
    const key = keyOf(e);
    const action = accepted ?? (key && rules.key(model, key, cursor(node)));
    if (!action) return;
    e.preventDefault();
    apply(action);
  });

  host.addEventListener("paste", (e) => {
    const node = fieldOf(e.target);
    if (!node) return;
    e.preventDefault();
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    const action = rules.paste?.(model, pasted, cursor(node));
    if (action) apply(action);
    else document.execCommand("insertText", false, pasted.replace(/\s*\n\s*/g, " ").trim());
  });

  const onSelection = () => {
    showGhost();
    if (host.contains(document.activeElement)) on.caret();
  };
  document.addEventListener("selectionchange", onSelection);

  draw();

  const source: Source = {
    el: root,
    value: () => rules.write(model).text,
    set(value) {
      const next = rules.read(value);
      if (next) model = next;
      draw();
    },
    replace(value) {
      this.set(value);
    },
    select(span) {
      const { starts } = rules.write(model);
      const texts = rules.texts(model);
      const at = starts.findIndex((s, k) => s <= span.start && span.start <= s + texts[k]!.length);
      const node = nodeAt(at);
      if (node) selectIn(node, span.start - starts[at]!, span.end - starts[at]!);
    },
    caret() {
      const node = fieldOf(document.activeElement);
      const range = node && caretIn(node);
      if (node && range) lastCaret = rules.write(model).starts[Number(node.dataset.at)]! + range[0];
      return lastCaret;
    },
    focus: () => focusAt(o.first(model)),
    destroy() {
      document.removeEventListener("selectionchange", onSelection);
      root.remove();
    },
  };

  return { source, apply, focusAt, model: () => model };
}

function bulletSource(initial: Item[], on: SourceEvents): Source {
  const root = el("div", "mid-bullets");
  const list = el("div", "mid-bullet-list");
  list.setAttribute("role", "list");
  root.append(list);

  const fields = fieldSource({
    root,
    host: list,
    field: "mid-btext",
    rules: outlineRules,
    model: initial.length ? initial : outlineRules.read("")!,
    on,
    first: (items) => ({ at: 0, start: items[0]!.text.length }),
    render: (items) =>
      list.replaceChildren(
        ...items.map((item, at) => {
          const row = el("div", "mid-bullet");
          row.setAttribute("role", "listitem");
          row.setAttribute("aria-level", String(item.level + 1));
          row.style.paddingLeft = `${item.level * 24}px`;
          const dot = el("span", "mid-bullet-dot", "•");
          dot.setAttribute("aria-hidden", "true");
          const text = el("div", "mid-btext", item.text);
          text.contentEditable = "plaintext-only";
          text.spellcheck = false;
          text.dataset.at = String(at);
          text.dataset.placeholder = "Node";
          row.append(dot, text);
          return row;
        }),
      ),
  });

  root.addEventListener("mousedown", (e) => {
    if (e.target !== root && e.target !== list) return;
    e.preventDefault();
    const items = fields.model();
    fields.focusAt({ at: items.length - 1, start: items[items.length - 1]!.text.length });
  });

  return fields.source;
}

function button(className: string, label: string, title: string) {
  const b = el("button", className, label);
  b.type = "button";
  b.tabIndex = -1;
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}

function tableSource(table: Table, on: SourceEvents): Source {
  let menu: HTMLElement | undefined;
  const root = el("div", "mid-table-wrap");
  const frame = el("div", "mid-table-frame");
  const grid = el("table", "mid-table");
  const growCol = button("mid-grow mid-grow-col", "+", "Add participant");
  const growRow = button("mid-grow mid-grow-row", "+", "Add message");
  frame.append(grid, growCol, growRow);
  root.append(frame);

  function render(t: Table) {
    closeMenu();
    grid.replaceChildren();
    const width = t.head.length;
    for (let r = 0; r <= t.rows.length; r++) {
      const tr = el("tr", "");
      for (let c = 0; c < width; c++) {
        const td = el(r === 0 ? "th" : "td", "");
        const cell = el("div", "mid-tcell", cellText(t, r, c));
        cell.contentEditable = "plaintext-only";
        cell.spellcheck = false;
        cell.dataset.at = String(r * width + c);
        if (r === 0) cell.dataset.placeholder = "Participant";
        td.append(cell);
        if (r === 0 && width > 1) td.append(handle("column", c));
        if (r > 0 && c === 0) td.append(handle("row", r));
        tr.append(td);
      }
      grid.append(tr);
    }
  }

  function handle(kind: "row" | "column", index: number) {
    const h = button(
      `mid-handle mid-handle-${kind}`,
      "⋮",
      `${kind === "row" ? "Message" : "Participant"} options`,
    );
    h.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu(h, kind, index);
    });
    return h;
  }

  function openMenu(anchor: HTMLElement, kind: "row" | "column", index: number) {
    closeMenu();
    menu = el("div", "mid-menu");
    const del = button(
      "mid-menu-item",
      `Delete ${kind === "row" ? "message" : "participant"}`,
      "Delete",
    );
    del.tabIndex = 0;
    del.addEventListener("click", () => {
      const t = fields.model();
      fields.apply(kind === "row" ? deleteRow(t, index) : deleteColumn(t, index));
    });
    menu.append(del);
    frame.append(menu);
    const a = anchor.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    menu.style.left = `${a.left - f.left}px`;
    menu.style.top = `${a.bottom - f.top + 4}px`;
    del.focus();
  }

  function closeMenu() {
    menu?.remove();
    menu = undefined;
  }

  const fields = fieldSource({
    root,
    host: grid,
    field: "mid-tcell",
    rules: gridRules,
    model: table,
    on,
    first: (t) => ({ at: t.rows.length ? t.head.length : 0, start: 0 }),
    render,
  });

  growCol.addEventListener("click", () => fields.apply(addColumn(fields.model())));
  growRow.addEventListener("click", () => fields.apply(addRow(fields.model())));

  const onDown = (e: PointerEvent) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", onDown);

  return {
    ...fields.source,
    destroy() {
      document.removeEventListener("pointerdown", onDown);
      fields.source.destroy();
    },
  };
}

export type View = "svg" | "ascii";

const ICON_COPY =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
const ICON_DONE =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>';

const covers = (spans: Span[] | undefined, pos: number) =>
  spans?.some((s) => s.start <= pos && pos <= s.end) ?? false;

function outputPane(initial: View, onPick: (span: Span) => void) {
  let view = initial;
  let graph: Graph | undefined;
  let cycle = { key: "", index: 0 };
  let marked = 0;

  const out = el("div", "mid-out");
  const pan = panZoom(out);
  const copy = el("button", "mid-copy");
  copy.type = "button";
  copy.innerHTML = ICON_COPY;
  const toggle = modeButton<View>(
    [
      ["svg", "SVG"],
      ["ascii", "ASCII"],
    ],
    () => {
      view = view === "svg" ? "ascii" : "svg";
      draw();
    },
  );
  const pane = el("div", "mid-pane mid-view");
  pane.append(out, corner("left", toggle.button), corner("right", copy));

  function labelCopy() {
    copy.title = view === "ascii" ? "Copy ASCII" : "Copy as PNG";
    copy.setAttribute("aria-label", copy.title);
  }

  function draw() {
    labelCopy();
    toggle.set(view);
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
    mark(marked);
  }

  function mark(pos: number) {
    marked = pos;
    let node: string | undefined;
    for (const [name, spans] of graph?.spans ?? []) if (covers(spans, pos)) node = name;
    const message = graph?.messages.findIndex((m) => covers(m.span && [m.span], pos)) ?? -1;
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
    onPick(spans[cycle.index]!);
    mark(spans[cycle.index]!.start);
  });

  copy.addEventListener("click", async () => {
    if (!graph) return;
    try {
      if (view === "ascii") await navigator.clipboard.writeText(renderAscii(graph));
      else {
        const style = getComputedStyle(pane);
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

  return {
    el: pane,
    show(next: Graph | undefined, caret: number) {
      graph = next;
      marked = caret;
      draw();
    },
    mark,
    destroy: () => pan.destroy(),
  };
}

export type { Mode };

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
