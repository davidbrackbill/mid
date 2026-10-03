import { readOutline, splitNode, writeOutline } from "../src/mid.ts";

export interface Item {
  level: number;
  text: string;
}

export interface Cursor {
  i: number;
  start: number;
  end: number;
}

export interface Focus {
  i: number;
  start: number;
  end?: number;
}

export type Key =
  | "Enter"
  | "Tab"
  | "Shift+Tab"
  | "Backspace"
  | "Delete"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

export type Action =
  | { kind: "edit"; items: Item[]; focus: Focus }
  | { kind: "move"; focus: Focus }
  | { kind: "ignore" };

export function readItems(text: string): Item[] | null {
  return readOutline(text)?.map(({ level, text }) => ({ level, text })) ?? null;
}

export function writeItems(items: Item[]) {
  const { text, starts } = writeOutline(items);
  return { text: items.length ? `${text}\n` : "", starts };
}

function normalize(items: Item[]): Item[] {
  items.forEach((item, i) => {
    item.level = i === 0 ? 0 : Math.max(0, Math.min(item.level, items[i - 1]!.level + 1));
  });
  return items;
}

function subtreeEnd(items: Item[], i: number): number {
  let j = i + 1;
  while (j < items.length && items[j]!.level > items[i]!.level) j++;
  return j;
}

function shifted(items: Item[], i: number, by: number): Item[] {
  const end = subtreeEnd(items, i);
  return items.map((item, k) => (k >= i && k < end ? { ...item, level: item.level + by } : item));
}

const edit = (items: Item[], focus: Focus): Action => ({
  kind: "edit",
  items: normalize(items),
  focus,
});

export function keyAction(items: Item[], key: Key, { i, start, end }: Cursor): Action | undefined {
  const item = items[i]!;
  const collapsed = start === end;
  const last = items.length - 1;
  const copy = () => items.map((x) => ({ ...x }));

  switch (key) {
    case "Enter": {
      if (!item.text && item.level > 0) return edit(shifted(items, i, -1), { i, start: 0 });
      if (!item.text) return { kind: "ignore" };
      const next = copy();
      if (collapsed && start === 0) {
        next.splice(i, 0, { level: item.level, text: "" });
        return edit(next, { i: i + 1, start: 0 });
      }
      const hasChildren = subtreeEnd(items, i) > i + 1;
      next[i] = { ...item, text: item.text.slice(0, start) };
      next.splice(i + 1, 0, {
        level: item.level + (hasChildren ? 1 : 0),
        text: item.text.slice(end),
      });
      return edit(next, { i: i + 1, start: 0 });
    }
    case "Tab":
      if (i === 0 || item.level > items[i - 1]!.level) return { kind: "ignore" };
      return edit(shifted(items, i, 1), { i, start, end });
    case "Shift+Tab":
      if (item.level === 0) return { kind: "ignore" };
      return edit(shifted(items, i, -1), { i, start, end });
    case "Backspace": {
      if (!collapsed || start !== 0) return undefined;
      if (item.level > 0) return edit(shifted(items, i, -1), { i, start: 0 });
      if (i === 0) return undefined;
      const next = copy();
      const join = next[i - 1]!.text.length;
      next[i - 1]!.text += item.text;
      next.splice(i, 1);
      return edit(next, { i: i - 1, start: join });
    }
    case "Delete": {
      if (!collapsed || start !== item.text.length || i === last) return undefined;
      const next = copy();
      next[i]!.text += items[i + 1]!.text;
      next.splice(i + 1, 1);
      return edit(next, { i, start });
    }
    case "ArrowUp":
      if (i === 0) return undefined;
      return {
        kind: "move",
        focus: { i: i - 1, start: Math.min(start, items[i - 1]!.text.length) },
      };
    case "ArrowDown":
      if (i === last) return undefined;
      return {
        kind: "move",
        focus: { i: i + 1, start: Math.min(start, items[i + 1]!.text.length) },
      };
    case "ArrowLeft":
      if (!collapsed || start !== 0 || i === 0) return undefined;
      return { kind: "move", focus: { i: i - 1, start: items[i - 1]!.text.length } };
    case "ArrowRight":
      if (!collapsed || start !== item.text.length || i === last) return undefined;
      return { kind: "move", focus: { i: i + 1, start: 0 } };
  }
}

export function pasteAction(
  items: Item[],
  pasted: string,
  { i, start, end }: Cursor,
): Action | undefined {
  const lines = pasted
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length < 2) return undefined;
  const parsed =
    readItems(lines.join("\n")) ?? lines.map((text) => ({ level: 0, text: text.trim() }));
  const item = items[i]!;
  const added = parsed.slice(1).map((p) => ({ level: item.level + p.level, text: p.text }));
  const tail = added[added.length - 1]!;
  const caret = tail.text.length;
  tail.text += item.text.slice(end);
  const next = items.map((x) => ({ ...x }));
  next[i]!.text = item.text.slice(0, start) + parsed[0]!.text;
  next.splice(i + 1, 0, ...added);
  return edit(next, { i: i + added.length, start: caret });
}

function completion(items: Item[], { i, start, end }: Cursor): string | undefined {
  const text = items[i]!.text;
  if (start !== end || end !== text.length || text.length < 2) return undefined;
  if (text.includes(": ") || text.startsWith('"')) return undefined;
  const typed = text.toLowerCase();
  const names: string[] = [];
  for (let k = i - 1; k >= 0; k--) names.push(splitNode(items[k]!.text).name);
  for (let k = i + 1; k < items.length; k++) names.push(splitNode(items[k]!.text).name);
  if (names.some((name) => name.toLowerCase() === typed)) return undefined;
  return names.find((name) => name.length > text.length && name.toLowerCase().startsWith(typed));
}

export function suggestion(items: Item[], cursor: Cursor): string | undefined {
  return completion(items, cursor)?.slice(items[cursor.i]!.text.length);
}

export function accept(items: Item[], cursor: Cursor): Action | undefined {
  const name = completion(items, cursor);
  if (!name) return undefined;
  return edit(items.with(cursor.i, { ...items[cursor.i]!, text: name }), {
    i: cursor.i,
    start: name.length,
  });
}
