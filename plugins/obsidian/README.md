# mid for Obsidian

Render ` ```mid ` fenced bullet lists as graphs — drawn with Obsidian's **native
Mermaid SVG**, sitting **above** the block while the source stays editable beneath,
mirroring [mid.nvim](../nvim/README.md)'s "fences" model.

````markdown
```mid
- request
  - [cache hit](respond)
  - [cache miss](fetch)
    - [ok](respond)
    - [fail](error)
```
````

The TypeScript core parses the bullets and, via `toMermaid`, converts the graph to
Mermaid; the plugin hands that to Obsidian's built-in renderer — the same SVG a
`mermaid` block produces. The core is imported directly (bundled) — no subprocess.

## UX

- **Graph above, source below** — the SVG stays visible while you edit the fenced
  source beneath; edits re-render live.
- **Cursor mirror** — ordinary cursor motion highlights the node (or edge, on a
  `[label]`) under the cursor.
- **Enter a block** — arrowing onto the opening fence drops you onto the first source
  line, so you land "in the graph".
- **Click to jump** — clicking a node, edge, or edge label moves + centers the cursor
  on its source line.

These need a live editor (live preview / source mode); in pure reading view the SVG +
source render but interactions are inert.

## Commands

- **Make mid diagram** — wraps the current selection (a bullet list) in a ` ```mid `
  block. With no selection it inserts an empty scaffold. Run from the command palette
  or bind a hotkey.

## Note on `mermaid` blocks

Only ` ```mid ` blocks get the full UX; ` ```mermaid ` blocks are left to Obsidian's
native renderer (taking them over would recurse through our own SVG generation or hide
their editable source — see AGENTS.md). Want a mermaid-style diagram with the mid UX?
Write it as a ` ```mid ` block.

## Build & install

```bash
cd plugins/obsidian
npm install
npm run build        # production bundle → main.js  (npm run dev = watch)
npm run typecheck
```

Then copy (or symlink) `manifest.json`, `main.js`, and `styles.css` into
`<vault>/.obsidian/plugins/mid/` and enable **Mid** in Settings → Community plugins.
Desktop only.
