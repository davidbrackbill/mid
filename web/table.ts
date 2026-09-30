import { el } from "./dom.ts";
import type { Source, SourceEvents } from "./editor.ts";

export interface Table {
  before: string;
  head: string[];
  rows: string[][];
  after: string;
}

const IS_ROW = /^\s*\|/;
const SEPARATOR = /^:?-+:?$/;

function cells(line: string): string[] {
  const raw = line.trim();
  const out: string[] = [];
  let start = 1;
  for (let i = 1; i <= raw.length; i++) {
    if (i < raw.length && (raw[i] !== "|" || raw[i - 1] === "\\")) continue;
    out.push(raw.slice(start, i).trim());
    start = i + 1;
  }
  if (raw.length > 1 && raw.endsWith("|") && raw[raw.length - 2] !== "\\") out.pop();
  return out;
}

export function readTable(text: string): Table | null {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => IS_ROW.test(l));
  if (first === -1) return null;
  let last = first;
  while (last + 1 < lines.length && IS_ROW.test(lines[last + 1]!)) last++;

  const [head = [""], ...rest] = lines.slice(first, last + 1).map(cells);
  const rows = rest[0]?.length && rest[0].every((c) => SEPARATOR.test(c)) ? rest.slice(1) : rest;
  const width = Math.max(1, head.length, ...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill("")];
  return {
    before: first ? `${lines.slice(0, first).join("\n")}\n` : "",
    head: pad(head),
    rows: rows.map(pad),
    after: last < lines.length - 1 ? `\n${lines.slice(last + 1).join("\n")}` : "",
  };
}

const escape = (cell: string) => cell.replace(/\\?\|/g, (m) => (m.length === 2 ? m : "\\|"));

function write(t: Table) {
  const head = t.head.map(escape);
  const rows = t.rows.map((r) => r.map(escape));
  const widths = head.map((h, i) => Math.max(3, h.length, ...rows.map((r) => r[i]!.length)));
  let pos = t.before.length;
  const lines: string[] = [];
  const line = (row: string[]) => {
    const starts: number[] = [];
    let at = pos + 2;
    for (const w of widths) {
      starts.push(at);
      at += w + 3;
    }
    const text = `| ${row.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
    lines.push(text);
    pos += text.length + 1;
    return starts;
  };
  const headStarts = line(head);
  line(widths.map((w) => "-".repeat(w)));
  const rowStarts = rows.map(line);
  return { text: t.before + lines.join("\n") + t.after, starts: [headStarts, ...rowStarts] };
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

function button(className: string, label: string, title: string) {
  const b = el("button", className, label);
  b.type = "button";
  b.tabIndex = -1;
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}

export function tableSource(table: Table, on: SourceEvents): Source {
  let t = table;
  let lastCaret = 0;
  let menu: HTMLElement | undefined;
  const root = el("div", "mid-table-wrap");
  const frame = el("div", "mid-table-frame");
  const grid = el("table", "mid-table");
  const addCol = button("mid-grow mid-grow-col", "+", "Add participant");
  const addRow = button("mid-grow mid-grow-row", "+", "Add message");
  frame.append(grid, addCol, addRow);
  root.append(frame);

  const width = () => t.head.length;
  const text = (r: number, c: number) => (r === 0 ? t.head[c]! : t.rows[r - 1]![c]!);
  const cellAt = (r: number, c: number) =>
    grid.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
  const pos = (cell: Element) => [
    Number((cell as HTMLElement).dataset.r),
    Number((cell as HTMLElement).dataset.c),
  ];

  function render(focus?: { r: number; c: number; start?: number; end?: number }) {
    closeMenu();
    grid.replaceChildren();
    for (let r = 0; r <= t.rows.length; r++) {
      const tr = el("tr", "");
      for (let c = 0; c < width(); c++) {
        const td = el(r === 0 ? "th" : "td", "");
        const cell = el("div", "mid-tcell", text(r, c));
        cell.contentEditable = "plaintext-only";
        cell.spellcheck = false;
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        if (r === 0) cell.dataset.placeholder = "Participant";
        td.append(cell);
        if (r === 0 && width() > 1) td.append(handle("column", c));
        if (r > 0 && c === 0) td.append(handle("row", r));
        tr.append(td);
      }
      grid.append(tr);
    }
    if (focus) {
      const cell = cellAt(focus.r, focus.c);
      if (cell) selectIn(cell, focus.start ?? 0, focus.end);
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
      if (kind === "row") t.rows.splice(index - 1, 1);
      else {
        t.head.splice(index, 1);
        for (const row of t.rows) row.splice(index, 1);
      }
      changed();
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

  function changed(focus?: { r: number; c: number; start?: number; end?: number }) {
    render(focus);
    on.input();
  }

  function moveTo(r: number, c: number, at: "start" | "end" = "end") {
    const cell = cellAt(r, c);
    if (!cell) return;
    selectIn(cell, at === "start" ? 0 : text(r, c).length);
  }

  addCol.addEventListener("click", () => {
    t.head.push(`Participant ${width() + 1}`);
    for (const row of t.rows) row.push("");
    changed({ r: 0, c: width() - 1, start: 0, end: t.head[width() - 1]!.length });
  });

  addRow.addEventListener("click", () => {
    t.rows.push(t.head.map(() => ""));
    changed({ r: t.rows.length, c: 0 });
  });

  grid.addEventListener("input", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".mid-tcell");
    if (!cell) return;
    const [r, c] = pos(cell);
    const value = cell.textContent ?? "";
    if (r === 0) t.head[c!] = value;
    else t.rows[r! - 1]![c!] = value;
    on.input();
  });

  grid.addEventListener("paste", (e) => {
    e.preventDefault();
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, pasted.replace(/\s*\n\s*/g, " "));
  });

  grid.addEventListener("keydown", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".mid-tcell");
    if (!cell) return;
    const [r, c] = pos(cell) as [number, number];
    const last = t.rows.length;

    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (r < last) return moveTo(r + 1, c);
      if (e.key !== "Enter") return;
      t.rows.push(t.head.map(() => ""));
      return changed({ r: last + 1, c });
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      return moveTo(r - 1, c);
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const i = r * width() + c + (e.shiftKey ? -1 : 1);
      if (i < 0) return;
      if (i >= (last + 1) * width()) {
        t.rows.push(t.head.map(() => ""));
        return changed({ r: last + 1, c: 0 });
      }
      return moveTo(Math.floor(i / width()), i % width(), "start");
    }
    if (
      e.key === "Backspace" &&
      r > 0 &&
      t.rows[r - 1]!.every((v) => !v) &&
      caretIn(cell)?.[0] === 0
    ) {
      e.preventDefault();
      t.rows.splice(r - 1, 1);
      return changed({ r: r - 1, c, start: r - 1 === 0 ? t.head[c]!.length : 0 });
    }
  });

  const onDown = (e: PointerEvent) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", onDown);
  const onSelection = () => {
    if (grid.contains(document.activeElement)) on.caret();
  };
  document.addEventListener("selectionchange", onSelection);

  render();

  return {
    el: root,
    value: () => write(t).text,
    set(value) {
      const next = readTable(value);
      if (next) t = next;
      render();
    },
    replace(value) {
      this.set(value);
    },
    select(span) {
      const { starts } = write(t);
      for (let r = 0; r < starts.length; r++)
        for (let c = 0; c < width(); c++) {
          const start = starts[r]![c]!;
          if (start <= span.start && span.start <= start + text(r, c).length) {
            const cell = cellAt(r, c);
            if (cell) selectIn(cell, span.start - start, span.end - start);
            return;
          }
        }
    },
    caret() {
      const cell = (document.activeElement as Element | null)?.closest?.<HTMLElement>(".mid-tcell");
      const range = cell && grid.contains(cell) ? caretIn(cell) : null;
      if (cell && range) {
        const [r, c] = pos(cell) as [number, number];
        lastCaret = write(t).starts[r]![c]! + range[0];
      }
      return lastCaret;
    },
    focus() {
      moveTo(t.rows.length ? 1 : 0, 0, "start");
    },
    destroy() {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("selectionchange", onSelection);
      root.remove();
    },
  };
}
