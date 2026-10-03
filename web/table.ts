import { caretIn, el, selectIn, typeLineBreak } from "./dom.ts";
import type { Source, SourceEvents } from "./source.ts";
import {
  accept,
  type Action,
  addColumn,
  addRow,
  cellText,
  deleteColumn,
  deleteRow,
  type Focus,
  type Key,
  keyAction,
  readTable,
  setCell,
  suggestion,
  type Table,
  writeGrid,
} from "./grid.ts";

const KEYS: Record<string, Key> = {
  Enter: "Enter",
  ArrowDown: "ArrowDown",
  ArrowUp: "ArrowUp",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Tab: "Tab",
  Backspace: "Backspace",
};

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
  const growCol = button("mid-grow mid-grow-col", "+", "Add participant");
  const growRow = button("mid-grow mid-grow-row", "+", "Add message");
  frame.append(grid, growCol, growRow);
  root.append(frame);

  const cellAt = (r: number, c: number) =>
    grid.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
  const pos = (cell: HTMLElement): [number, number] => [
    Number(cell.dataset.r),
    Number(cell.dataset.c),
  ];

  function render(focus?: Focus) {
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
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        if (r === 0) cell.dataset.placeholder = "Participant";
        td.append(cell);
        if (r === 0 && width > 1) td.append(handle("column", c));
        if (r > 0 && c === 0) td.append(handle("row", r));
        tr.append(td);
      }
      grid.append(tr);
    }
    if (focus) focusAt(focus);
  }

  function focusAt({ r, c, start, end }: Focus) {
    const cell = cellAt(r, c);
    if (cell) selectIn(cell, start, end);
  }

  function apply(action: Action) {
    if (action.kind === "move") return focusAt(action.focus);
    if (action.kind === "edit") {
      t = action.table;
      render(action.focus);
      on.input();
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
    del.addEventListener("click", () =>
      apply(kind === "row" ? deleteRow(t, index) : deleteColumn(t, index)),
    );
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

  growCol.addEventListener("click", () => apply(addColumn(t)));
  growRow.addEventListener("click", () => apply(addRow(t)));

  grid.addEventListener("input", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".mid-tcell");
    if (!cell) return;
    const [r, c] = pos(cell);
    t = setCell(t, r, c, cell.textContent ?? "");
    dismissed = false;
    showGhost();
    on.input();
  });

  grid.addEventListener("paste", (e) => {
    e.preventDefault();
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, pasted.replace(/\s*\n\s*/g, " "));
  });

  const cursor = (cell: HTMLElement) => {
    const [r, c] = pos(cell);
    const [start, end] = caretIn(cell) ?? [0, 0];
    return { r, c, start, end };
  };

  grid.addEventListener("keydown", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".mid-tcell");
    if (typeLineBreak(e, cell)) return;
    if (cell?.dataset.ghost && !e.isComposing) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissed = true;
        return showGhost();
      }
      if (e.key === "Tab" && !e.shiftKey) {
        const action = accept(t, cursor(cell));
        if (action) {
          e.preventDefault();
          return apply(action);
        }
      }
    }
    const key = !e.shiftKey
      ? KEYS[e.key]
      : e.key === "Tab"
        ? "Shift+Tab"
        : ["Enter", "ArrowLeft", "ArrowRight"].includes(e.key)
          ? undefined
          : KEYS[e.key];
    if (!cell || !key) return;
    const action = keyAction(t, key, cursor(cell));
    if (!action) return;
    e.preventDefault();
    apply(action);
  });

  const onDown = (e: PointerEvent) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  };
  document.addEventListener("pointerdown", onDown);
  let dismissed = false;
  function showGhost() {
    for (const n of grid.querySelectorAll<HTMLElement>("[data-ghost]")) delete n.dataset.ghost;
    const cell = (document.activeElement as Element | null)?.closest?.<HTMLElement>(".mid-tcell");
    if (!cell || !grid.contains(cell) || dismissed) return;
    const ghost = suggestion(t, cursor(cell));
    if (ghost) cell.dataset.ghost = ghost;
  }

  const onSelection = () => {
    showGhost();
    if (grid.contains(document.activeElement)) on.caret();
  };
  document.addEventListener("selectionchange", onSelection);

  render();

  return {
    el: root,
    value: () => writeGrid(t).text,
    set(value) {
      const next = readTable(value);
      if (next) t = next;
      render();
    },
    replace(value) {
      this.set(value);
    },
    select(span) {
      const { starts } = writeGrid(t);
      for (let r = 0; r < starts.length; r++)
        for (let c = 0; c < t.head.length; c++) {
          const start = starts[r]![c]!;
          if (start <= span.start && span.start <= start + cellText(t, r, c).length) {
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
        const [r, c] = pos(cell);
        lastCaret = writeGrid(t).starts[r]![c]! + range[0];
      }
      return lastCaret;
    },
    focus() {
      focusAt({ r: t.rows.length ? 1 : 0, c: 0, start: 0 });
    },
    destroy() {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("selectionchange", onSelection);
      root.remove();
    },
  };
}
