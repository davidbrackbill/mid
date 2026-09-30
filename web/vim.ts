import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";
import type { Source, SourceEvents } from "./editor.ts";

const theme = EditorView.theme({
  "&": {
    flex: "1",
    minWidth: "0",
    height: "100%",
    color: "inherit",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mid-mono)", fontSize: "14px", lineHeight: "1.6" },
  ".cm-content": { padding: "14px 0 48px", caretColor: "var(--mid-fg)" },
  ".cm-line": { padding: "0 14px" },
  ".cm-cursor": { borderLeftColor: "var(--mid-fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--mid-hl)",
  },
  ".cm-panels": {
    backgroundColor: "transparent",
    color: "var(--mid-muted)",
    zIndex: "0",
  },
  ".cm-panels-bottom": { borderTop: "none" },
  ".cm-vim-panel": {
    padding: "2px 72px 2px 14px",
    fontFamily: "var(--mid-mono)",
    fontSize: "13px",
  },
  ".cm-vim-panel input": { color: "inherit", fontFamily: "inherit" },
});

const synced = new WeakSet<object>();

function yankToClipboard() {
  const registers = Vim.getRegisterController();
  if (synced.has(registers)) return;
  synced.add(registers);
  const pushText = registers.pushText.bind(registers);
  registers.pushText = (name, operator, text, linewise, blockwise) => {
    pushText(name, operator, text, linewise, blockwise);
    if (operator !== "yank" || (name && name !== '"')) return;
    const copied = linewise && !text.endsWith("\n") ? `${text}\n` : text;
    navigator.clipboard?.writeText(copied).catch(() => undefined);
  };
}

export function vimSource(value: string, caret: number, on: SourceEvents): Source {
  const view = new EditorView({
    state: EditorState.create({
      doc: value,
      selection: { anchor: Math.min(caret, value.length) },
      extensions: [
        vim({ status: true }),
        history(),
        drawSelection(),
        indentUnit.of("  "),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) on.input();
          else if (u.selectionSet) on.caret();
        }),
        EditorView.contentAttributes.of({ "aria-label": "Diagram source" }),
        theme,
      ],
    }),
  });

  yankToClipboard();
  const all = () => ({ from: 0, to: view.state.doc.length });

  return {
    el: view.dom,
    value: () => view.state.doc.toString(),
    set(text) {
      view.dispatch({
        changes: { ...all(), insert: text },
        annotations: Transaction.addToHistory.of(false),
      });
    },
    replace(text) {
      view.dispatch({ changes: { ...all(), insert: text }, selection: { anchor: 0 } });
      view.focus();
    },
    select(span) {
      view.dispatch({ selection: { anchor: span.start, head: span.end }, scrollIntoView: true });
      view.focus();
    },
    caret: () => view.state.selection.main.head,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
