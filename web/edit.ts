export interface Cursor {
  at: number;
  start: number;
  end: number;
}

export interface Focus {
  at: number;
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

export type Action<M> =
  | { kind: "edit"; model: M; focus?: Focus }
  | { kind: "move"; focus: Focus }
  | { kind: "ignore" };

export interface Rules<M> {
  read(text: string): M | null;
  write(model: M): { text: string; starts: number[] };
  texts(model: M): string[];
  setText(model: M, at: number, text: string): M;
  key(model: M, key: Key, cursor: Cursor): Action<M> | undefined;
  suggestion(model: M, cursor: Cursor): string | undefined;
  accept(model: M, cursor: Cursor): Action<M> | undefined;
  paste?(model: M, pasted: string, cursor: Cursor): Action<M> | undefined;
}
