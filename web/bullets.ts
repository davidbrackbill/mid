import { caretIn, el, selectIn, typeLineBreak } from "./dom.ts";
import type { Source, SourceEvents } from "./source.ts";
import {
  accept,
  type Action,
  type Focus,
  type Item,
  type Key,
  keyAction,
  pasteAction,
  readItems,
  suggestion,
  writeItems,
} from "./outline.ts";

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

export function bulletSource(initial: Item[], on: SourceEvents): Source {
  let items: Item[] = initial.length ? initial : [{ level: 0, text: "" }];
  let lastCaret = 0;
  const root = el("div", "mid-bullets");
  const list = el("div", "mid-bullet-list");
  list.setAttribute("role", "list");
  root.append(list);

  const textAt = (i: number) => list.querySelector<HTMLElement>(`[data-i="${i}"]`);
  const indexOf = (node: HTMLElement) => Number(node.dataset.i);
  const nodeOf = (e: Event) => (e.target as Element).closest<HTMLElement>(".mid-btext");

  function render(focus?: Focus) {
    list.replaceChildren(
      ...items.map((item, i) => {
        const row = el("div", "mid-bullet");
        row.setAttribute("role", "listitem");
        row.setAttribute("aria-level", String(item.level + 1));
        row.style.paddingLeft = `${item.level * 24}px`;
        const dot = el("span", "mid-bullet-dot", "•");
        dot.setAttribute("aria-hidden", "true");
        const text = el("div", "mid-btext", item.text);
        text.contentEditable = "plaintext-only";
        text.spellcheck = false;
        text.dataset.i = String(i);
        text.dataset.placeholder = "Node";
        row.append(dot, text);
        return row;
      }),
    );
    if (focus) focusAt(focus);
  }

  function focusAt({ i, start, end }: Focus) {
    const text = textAt(i);
    if (text) selectIn(text, start, end);
  }

  function apply(action: Action) {
    if (action.kind === "move") return focusAt(action.focus);
    if (action.kind === "edit") {
      items = action.items;
      render(action.focus);
      on.input();
    }
  }

  function cursor(node: HTMLElement) {
    const [start, end] = caretIn(node) ?? [0, 0];
    return { i: indexOf(node), start, end };
  }

  list.addEventListener("input", (e) => {
    const node = nodeOf(e);
    if (!node) return;
    items = items.with(indexOf(node), { ...items[indexOf(node)]!, text: node.textContent ?? "" });
    dismissed = false;
    showGhost();
    on.input();
  });

  list.addEventListener("keydown", (e) => {
    const node = nodeOf(e);
    if (typeLineBreak(e, node)) return;
    if (node?.dataset.ghost && !e.isComposing) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissed = true;
        return showGhost();
      }
      if (e.key === "Tab" && !e.shiftKey) {
        const action = accept(items, cursor(node));
        if (action) {
          e.preventDefault();
          return apply(action);
        }
      }
    }
    const key = keyOf(e);
    if (!node || !key || e.isComposing) return;
    const action = keyAction(items, key, cursor(node));
    if (!action) return;
    e.preventDefault();
    apply(action);
  });

  list.addEventListener("paste", (e) => {
    const node = nodeOf(e);
    if (!node) return;
    e.preventDefault();
    const pasted = e.clipboardData?.getData("text/plain") ?? "";
    const action = pasteAction(items, pasted, cursor(node));
    if (action) apply(action);
    else document.execCommand("insertText", false, pasted.trim());
  });

  root.addEventListener("mousedown", (e) => {
    if (e.target !== root && e.target !== list) return;
    e.preventDefault();
    const last = items.length - 1;
    focusAt({ i: last, start: items[last]!.text.length });
  });

  let dismissed = false;
  function showGhost() {
    for (const n of list.querySelectorAll<HTMLElement>("[data-ghost]")) delete n.dataset.ghost;
    const node = (document.activeElement as Element | null)?.closest?.<HTMLElement>(".mid-btext");
    if (!node || !list.contains(node) || dismissed) return;
    const ghost = suggestion(items, cursor(node));
    if (ghost) node.dataset.ghost = ghost;
  }

  const onSelection = () => {
    showGhost();
    if (list.contains(document.activeElement)) on.caret();
  };
  document.addEventListener("selectionchange", onSelection);

  render();

  return {
    el: root,
    value: () => writeItems(items).text,
    set(value) {
      const next = readItems(value);
      if (next) items = next.length ? next : [{ level: 0, text: "" }];
      render();
    },
    replace(value) {
      this.set(value);
    },
    select(span) {
      const { starts } = writeItems(items);
      for (let i = 0; i < items.length; i++) {
        const start = starts[i]!;
        if (start <= span.start && span.start <= start + items[i]!.text.length) {
          const text = textAt(i);
          if (text) selectIn(text, span.start - start, span.end - start);
          return;
        }
      }
    },
    caret() {
      const node = (document.activeElement as Element | null)?.closest?.<HTMLElement>(".mid-btext");
      const range = node && list.contains(node) ? caretIn(node) : null;
      if (node && range) lastCaret = writeItems(items).starts[indexOf(node)]! + range[0];
      return lastCaret;
    },
    focus() {
      focusAt({ i: 0, start: items[0]!.text.length });
    },
    destroy() {
      document.removeEventListener("selectionchange", onSelection);
      root.remove();
    },
  };
}
