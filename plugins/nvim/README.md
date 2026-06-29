# mid.nvim

Render ` ```mid ` (and ` ```mermaid `) fenced code blocks as inline ASCII graphs,
right in your Markdown buffer.

````markdown
```mid
- A
  - [first step](B)
  - C
```
````

In **fences mode** (default) only the ` ``` ` fence lines are concealed — your bullet
source stays visible and editable, and the graph is drawn just *above* it. Move with
ordinary cursor motion: wherever the cursor lands, that node (or edge label) is
highlighted in the graph. Edits re-render live. **inline mode** conceals nothing and
draws the graph below the block.

It's independent of render-markdown.nvim (its own namespace, scoped to fenced blocks),
so the two don't fight. Same authoring syntax works in the Obsidian plugin.

## Requirements

- Neovim ≥ 0.11 (`conceal_lines` for fences mode).
- No toolchain. The `build` hook downloads a prebuilt `mid` binary (Bun runtime
  bundled) into the plugin on install — no PATH setup, no Bun. A `mid` already on
  your PATH is used as a fallback.

## Install (lazy.nvim)

```lua
{
  "davidbrackbill/mid.nvim",
  build = "./scripts/install.sh",   -- fetch the prebuilt `mid` binary
  ft = "markdown",
  opts = {},                        -- runs require("mid").setup(opts)
}
```

That's it. The plugin invokes the binary it downloaded into its own `bin/`. To use
a `mid` you built or installed yourself instead, set `cmd`:

```lua
opts = { cmd = { "mid" } },   -- or an absolute path, or { "bun", "run", ".../src/cli.ts" }
```

## Configuration (defaults)

```lua
require("mid").setup({
  cmd = { "mid" },                             -- how to invoke the CLI
  languages = { mid = "md", mermaid = "mmd" }, -- fenced info string -> --format
  filetypes = { "markdown" },
  mode = "fences",        -- "fences" (conceal fences, graph above) | "inline"
  click = true,           -- click a node/edge to jump to its source
  debounce = 120,         -- ms after an edit before re-rendering
  select_debounce = 20,   -- ms after cursor move before re-highlighting
  hl = "MidGraph",        -- graph highlight group (Comment colour, regular font)
  hl_selected = "MidSelected", -- focused node/edge (bold)
})
```

`fences` mode sets `conceallevel = 2` and `concealcursor = ""`. No custom keymaps —
you move with ordinary motions and the graph mirrors the cursor.
`require("mid").refresh()` forces a re-render. Both highlight groups are `default`
(your `:highlight` wins) and re-derive on `ColorScheme`.

## Test

From the repo root:

```bash
nvim --headless -u plugins/nvim/test/run.lua
```
