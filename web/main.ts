import { mountMid } from "./editor.ts";

const SAMPLE = `- request
  - [cache hit](respond)
  - [cache miss](fetch)
    - [ok](respond)
    - [fail](error)
`;

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

mountMid(document.getElementById("app")!, {
  value: load("mid:source") ?? SAMPLE,
  vim: load("mid:vim") === "on",
  caption: document.getElementById("title")!,
  onChange: (value) => save("mid:source", value),
  onVimChange: (on) => save("mid:vim", on ? "on" : "off"),
});
