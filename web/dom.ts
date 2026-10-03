export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function caretIn(cell: HTMLElement): [number, number] | null {
  const sel = getSelection();
  if (!sel?.rangeCount || !cell.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(cell);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return [start, start + range.toString().length];
}

export function selectIn(cell: HTMLElement, start: number, end = start) {
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

export function modeButton<T extends string>(modes: Array<[T, string]>, onClick: () => void) {
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

export function corner(
  side: "left" | "right" | "bottom-left" | "bottom-right",
  ...children: HTMLElement[]
) {
  const div = el("div", `mid-corner mid-${side}`);
  div.append(...children);
  return div;
}

export function typeLineBreak(e: KeyboardEvent, field: HTMLElement | null): boolean {
  if (!field || e.key !== "Enter" || !e.shiftKey || e.isComposing) return false;
  e.preventDefault();
  if (field.textContent) document.execCommand("insertText", false, "\\n");
  return true;
}
