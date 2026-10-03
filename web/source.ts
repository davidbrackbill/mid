import type { Span } from "../src/index.ts";
import { el } from "./dom.ts";

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

export function textareaSource(value: string, caret: number, on: SourceEvents): Source {
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
