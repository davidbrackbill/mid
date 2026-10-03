import { mountMid } from "./editor.ts";

const SAMPLE = `- request
  - respond: cache hit
  - fetch: cache miss
    - respond: ok
    - error: fail
`;

const STORAGE_KEYS = {
  open: "mid:source",
  graph: "mid:graph",
  diagram: "mid:diagram",
} as const;

function load(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const title = document.getElementById("title")!;
const editor = mountMid(document.getElementById("app")!, {
  value: load(STORAGE_KEYS.open) ?? SAMPLE,
  caption: title,
  onChange: (value) => save(STORAGE_KEYS.open, value),
  load: (mode) => load(STORAGE_KEYS[mode]),
  save: (mode, value) => save(STORAGE_KEYS[mode], value),
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    editor.destroy();
    document.body.prepend(title);
  });
  import.meta.hot.accept();
}
