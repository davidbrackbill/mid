# AGENTS.md — working notes for Mid

The non-obvious stuff: gotchas and the cross-module contract. Not a changelog.

**Edit `AGENTS.md`, never `CLAUDE.md`** — `CLAUDE.md` is a symlink to it.

## What Mid is

Renders **Markdown bullet lists** (and Mermaid flowcharts) as graphs — ASCII for
terminals/editors, JSON for native rendering. One TS core (Bun + `@dagrejs/dagre`,
at repo root: `src/`, `test/`); two thin editor plugins (`plugins/nvim`,
`plugins/obsidian`) over its JSON contract. Pure parse → layout → render; nodes are
just names, edges just relationships.

A third format, **sequence diagrams**, parses to its own model (`SeqDiagram`, not
`Graph` — see below) and currently only converts to Mermaid `sequenceDiagram` syntax;
it has no ASCII layout/renderer or nvim JSON contract yet (Obsidian gets it for free
via the Mermaid conversion, same path as flowcharts).

## The DSL (both syntaxes are edge-oriented)

**Markdown bullets:** indentation = parent/child (`-`/`*`/`+`; tabs→next mult of 4).
**A name is the node's identity** — reused names are the same node, so trees become
DAGs and roots (`entryNodes()`, no incoming edge) aren't always top-level bullets.
`- [label](target)` → node `target`, edge label `label`; plain text → node by text.

**Mermaid** `.mmd` (`graph`/`flowchart`): arrows may omit spaces (`A-->B`); `|label|`
and `%%` comments handled.

**Sequence diagrams** (no file extension convention yet — content-sniffed, see
`sniffFormat`): no indentation, no bullets. Actor declarations (`Client`, or
`[Authentication Server](Auth)` — brackets = display label, parens = the id messages
reference) followed by messages, `From > To: Message text` or `From > To` (a *silent
call*, no text). Self-messages (`Client > Client: retry`) are fine. **v1 supports only
the `>` arrow** — no return/async/lost (`>>`/`~>`/`x>`) yet, and no comment syntax (a
line that's neither a declaration nor a message is silently skipped, same as the other
two formats). An actor mentioned in a message before being declared is auto-created,
appended after the declared ones — declaration order (not mention order) controls the
diagram's column order downstream. A bare (bracket-less) declaration must be a single
word (`/^\w+$/`, same restriction `mermaid.ts` places on a plain node decl) — otherwise
a stray prose line would silently become a phantom actor.

**Key insight — a line is an *edge*, not a node.** A node recurs on every line that
references it (`respond` on each `(respond)` bullet; `B` on `A-->B` and `B-->C`).
Markdown has ≤1 node-name/line, mermaid up to 2. This is why the source map is
**spans**, not whole lines. Sequence messages are the exception to "edge" here: unlike
`Graph.addEdge`, `SeqDiagram.addMessage` never dedups — a message is an ordered event,
so the same `(from,to)` pair sending three different messages must keep all three (see
`sequence.ts`'s own model instead of reusing `Graph`).

**Gotchas:**
- `addEdge` dedups by `(src,dst)` and **keeps the first label** — an unlabelled edge
  before a labelled one drops the label. Make each edge appear once in fixtures.
  (Test: `first edge label wins on dedup`.)
- A bare `- ` (no content) and non-bullet lines (headings, prose) are ignored.
- A literal `\n` in a node's text → a line break inside the node, identically in ASCII
  and Mermaid. Pure display, lives only in `text.ts`; node identity is unchanged.

## Module layout (`src/`)

- `model.ts` — `Graph` (nodes by name, deduped edges), `Node`, `Edge`, `Span`. Edges
  store src/dst **by name**. **Both Node and Edge carry `spans: Span[]`** —
  `{line, col, len}` (1-indexed line in block, 0-indexed byte col) for every place the
  token appears. A node's token is its name; an edge's is its **label** (empty/​not
  addressable when unlabeled). Spans stay sorted, so `spans[0]` is the home occurrence.
  Spans are the single syntax-agnostic source↔graph map (highlight, jump-to-source,
  edit). `entryNodes()` derived from edges; no adjacency index.
- `markdown.ts` — `parseMarkdown` (indent stack), exports `ParseError`. Columns from
  the **raw** line (matches the editor), not the tab-expanded one used for indent.
- `mermaid.ts` — `parseMermaid`, regex flowchart parser; node span at the id token,
  edge span at the `|label|`.
- `sequence.ts` — `SeqDiagram` (`actors: Map<id,Actor>`, `messages: Message[]`,
  undeduped) + `parseSequence`. Its own `addSpan` (mirrors `model.ts`'s, doesn't import
  it — `Graph`'s dedup-on-add doesn't apply here). No layout/render module — see "What
  Mid is" above.
- `text.ts` — node display text; splits the `\n` (the one place that decision lives).
- `index.ts` — `parse(text, format?)` (md/mmd → `Graph`; throws on `seq`, use
  `parseSequence` directly) + `sniffFormat` (`mmd` if starts `graph`/`flowchart`, `seq`
  if no line has a bullet marker, else `md`) + re-exports.
- `layout.ts` — `layout(graph)` via dagre. **Sizes in character units** (w = width+4,
  h = rows+2), so dagre coords map ~1:1 to grid cells. `(x,y)` are node centers;
  returns centers + per-edge `labelPos`.
- `convert.ts` — `toMermaid(graph)` → `{text, ids}`: flowchart syntax with stable
  synthetic ids (`n0`…), names as labels, `\n`→`<br/>`. `ids` (name→id) lets Obsidian
  find a node's `<g id="flowchart-n0-…">`. `toMarkdown(graph)` is the inverse
  direction: mid bullets, `<br/>`→`\n`; a node is expanded (children emitted) only
  on its first visit, so a reused node or a cycle becomes a leaf reference instead
  of recursing forever. `toMermaidSequence(diagram)` → `{text, ids}`, same
  synthetic-id treatment (an actor's bare id may contain spaces, which Mermaid
  participant ids can't); this is the *only* sequence-diagram renderer — no
  ASCII/JSON path yet, so Obsidian's existing Mermaid-SVG pipeline is how sequence
  diagrams render at all today.
- `render.ts` — `renderAscii(graph, lay, {selected?})`, `toJSON`, `render`. Down-horiz-
  down edge routing; labels at `labelPos`; selected node → heavy box. `renderGrid`
  reports each node's `cell` rect and each **labeled** edge's label `cell` (keyed
  `src\x00dst`), both mapped through the blank-row `compress`. The connector line is
  not a cell (compressed away) — the label is the addressable edge token.
- `cli.ts` — `mid render [--json] [--format md|mmd] [--select NAME] <file|->` and
  `mid convert [--format md|mmd|seq] <file|->`. Format is always content-sniffed
  (`sniffFormat`) unless `--format` overrides it — no extension-based default.
  `convert` emits the *other* format from whatever was detected (md→mmd via
  `toMermaid`, mmd→md via `toMarkdown`, seq→mmd via `toMermaidSequence`). `render`
  on `seq` input exits 1 with a message pointing at `convert` — no ASCII layout
  exists for sequence diagrams yet.

**The `toJSON` contract (the one thing nvim consumes; Obsidian imports the core
directly).** Per node `{name, spans, cell}`, per edge `{src, dst, label, spans, cell}`
(unlabeled edge: empty `spans`, no `cell`), plus joined `ascii`. Keep it stable.

## CLI / build

```bash
bun run src/cli.ts render examples/tree.md   # ASCII (auto-detect format)
bun run src/cli.ts convert examples/tree.md  # → Mermaid (or mmd → mid bullets)
bun test                                      # 64 tests
bun run build                                 # → dist/mid standalone binary
bun run check                                 # biome (lint+format) + tsc + tests — the CI gate
```

**Tooling.** Lint + format is **Biome** (`biome.json`); typecheck is **`tsc --noEmit`**
(Bun strips types, never checks them). Scripts: `typecheck`, `format` / `format:check`,
`lint`, `lint:fix` (`biome check --write`), `check` (all three). Biome is set to its
default style (tabs, double quotes) over `src/`, `test/`, `plugins/obsidian/src`; `dist`
and the generated `main.js` are excluded. The dynamic SVG highlight legitimately needs
`!important` (overrides Mermaid's inline styles at runtime), so `noImportantStyles` is
off. Lua (`plugins/nvim`) is formatted by **stylua** (`.stylua.toml`, `bun run
format:lua`) — a separate binary (`brew install stylua`), not part of Bun/Biome.

`tsconfig` sets `allowImportingTsExtensions` (imports use explicit `.ts`). The core
uses **standard JS/web APIs only** (no `Bun.*`/`node:*` outside `cli.ts`) so it loads
in Obsidian's Electron too.

## Publishing (`PUBLISHING.md`, `scripts/mirror.sh`)

You only ever edit this monorepo (`davidbrackbill/mid`). lazy.nvim and Obsidian
both require a plugin's files at a **repo root**, which a monorepo subdir can't
give — so releasing mirrors the plugins to standalone repos. This is a **hand-run
script**, not CI: `scripts/mirror.sh vX.Y.Z` (uses local `gh`/git auth, no token)
(1) cross-compiles `mid` binaries onto the monorepo release (the CLI installer +
nvim `build` hook download these), (2) `git subtree split`s `plugins/nvim` →
force-pushes the **`mid.nvim`** mirror, (3) builds + pushes `plugins/obsidian` →
the **`obsidian-mid`** mirror and cuts its release. ⚠️ The Obsidian release tag is
the version **without** `v` (`0.1.0`, not `v0.1.0`) — it must equal `manifest.json`;
keep `package.json`/`manifest.json`/`versions.json` in lockstep with the tag. CI
(`.github/workflows/ci.yml`) only runs `bun run check`.

## Examples (`examples/`)

`tree.md` (canonical: nesting + label + node reuse), `flow.md` (DAG with a join),
`notes.md` (plugin scratch buffer), `test.mmd` / `pipeline.mmd` (Mermaid),
`sequence.md` (sequence diagram: labeled actor, two `>` messages).

## Neovim plugin (`plugins/nvim/`)

`lua/mid/init.lua`; headless test `nvim --headless -u plugins/nvim/test/run.lua` from
repo root. Shells out to the `mid` CLI (`vim.system`, async). `M.on_cursor(buf)`
exposed for tests.

- **CLI resolution (`config.cmd`):** an explicit `cmd` in `setup()` always wins.
  Otherwise `bundled_cmd()` prefers `<plugin>/bin/mid` — the prebuilt binary the
  lazy `build` hook (`scripts/install.sh`) downloads — and falls back to `mid` on
  PATH. So a normal install needs no PATH setup (`scripts/` rides the subtree split
  to the mirror; see `PUBLISHING.md`).

- **Modes (`config.mode`):** `fences` (default) conceals **only the two fence lines**
  (`conceal_lines`, nvim 0.11) and draws the graph as `virt_lines` **above** the first
  content line (which stays a valid anchor); `inline` conceals nothing, graph below the
  block. `anchor(block)` returns `(row, above)` for both — keep `draw_block` in sync.
- **Interaction = cursor mirror, no keymaps.** `line_tokens[row]` holds every node's
  and labeled edge's `{col, len, cell, is_node}`. `on_cursor`→`cell_at`: a token
  *containing* the cursor wins (on `[label]` → edge), else nearest node, else nearest.
  Selected `cell` restyled client-side (`MidSelected`, bold) by rebuilding `virt_lines`
  in Lua — no subprocess. Box glyphs are multibyte: split with `vim.fn.split(.,"\\zs")`.
- **Click → source (`config.click`):** bound to `<LeftRelease>` (keeps default mouse
  positioning). Graph is `virt_lines`, so `target_at_mouse` works in **screen coords**
  via `screenpos()` of a known buffer line → grid (row,col) → cell → jump to `spans[0]`.
- **Flicker fix — incremental reconcile, no blanket clear.** Debounced `on_lines`
  → `reconcile`: snapshot old blocks, re-`find_blocks`, match by index, carry extmark
  ids + last render + selection, then **publish a fresh `st.blocks`**. ⚠️ *Don't* alias
  `old = st.blocks` then write `st.blocks[i]` — that bug made every edit look unchanged.
  Marks update in place by id; `mid` re-spawns only for changed blocks; stale callbacks
  dropped via `vim.tbl_contains(st.blocks, block)`. Only initial `full_render` clears
  the namespace. Block-count change falls back to per-index match (may briefly flash).

**Why (don't undo):** independent plugin, **not** a render-markdown `custom_handler`
(that API is sync + treesitter-keyed; mid is async with no `mid` parser); scoping to
fenced blocks makes the two compose. `fences` via conceal+virt_lines **not a float**
(source must stay editable in place). Highlight client-side **not** re-spawning
`--select` (latency/stale). Shell out to the Bun binary **not** a Lua port (one core;
a port would reimplement dagre).

## Obsidian plugin (`plugins/obsidian/`)

Renders `mid` blocks as **native Mermaid SVG**: `parseMarkdown` → `toMermaid` →
`MarkdownRenderer.render` (the same SVG a `mermaid` block makes). Imports the core
directly — no subprocess. UX mirrors nvim's fences model: SVG above, editable source
below.

**Only `mid` is owned; `mermaid` is left native — forced, not preference.** `renderSvg`
itself renders a generated `mermaid` fence, so owning `mermaid` blocks would re-enter
our renderer → **infinite recursion (crashes Obsidian)**; and the native LP mermaid
widget can't be suppressed without a block-`replace` that hides the editable source.
(Don't reintroduce `loadMermaid()` — it didn't suppress the LP widget and lost the
theme.)

**Command "Make mid diagram"** (`addCommand`/`editorCallback`) wraps the selection in a
` ```mid ` fence (or a `- node` scaffold) via `editor.replaceSelection` — the only
place the plugin writes source.

**Two render surfaces:**
- **Live Preview — the CM6 extension is the renderer:** a `StateField`
  (`midDecorations`, the block widget — CM requires block decos from a field, not a
  ViewPlugin) + a `ViewPlugin` (`midInteraction`, cursor mirror + enter-snap).
  `buildDecos` puts one widget above each open fence; fence lines stay editable. We
  do **not** use Obsidian's native code-block widget (it collapses to SVG on cursor
  leave). `GraphWidget.eq` is by **source** (cursor moves don't re-render); field
  rebuilds only on `tr.docChanged`; `findBlocks` skips unterminated fences. No flicker:
  `updateDOM` reuses the wrap and `scheduleRender` is debounced, rendering into a hidden
  off-flow slot and swapping in only when ready (stale-token guard).
- **Reading view — `registerMarkdownCodeBlockProcessor("mid", …)`** renders SVG +
  static `.mid-source` `<pre>`. **Bails in Live Preview** via
  `getActiveViewOfType(MarkdownView)?.getMode() === "source"` (the `el` is still
  detached when it runs, so DOM-ancestry checks are unreliable) — else it double-renders.

**Interactions:** cursor mirror (`targetAtCursor`, same column rule as nvim) toggles
`mid-hl` on `g[id^="flowchart-n0-"]` / `mid-hl-edge` on `path[id^="L_n0_n1_"]`
(hyphen variant handled). Enter-snap (`snapIntoBlock`) drops the cursor onto the first
content line when arrowing onto the open fence from outside; deferred via
`queueMicrotask` (a ViewPlugin may not dispatch mid-update). Click jumps + centers on
`spans[0]`, resolving node → edge path → edge **label** (by text; dup labels → first).

**Build:** `cd plugins/obsidian && npm install && npm run build` (esbuild → `main.js`;
core + dagre bundled; `obsidian`/`@codemirror/*` external). `npm run typecheck` clean.
Install: copy/symlink `manifest.json` + `main.js` + `styles.css` into
`<vault>/.obsidian/plugins/mid/`; reload Obsidian.

## Core vs plugin boundary

The TS core is the single source of truth, DOM-free / runtime-agnostic. Litmus test:
**pure function of the source text → core; touches an editor surface (DOM, extmarks,
conceal, applying an edit) → plugin.** So parse/layout/geometry/`toMermaid`/`spans` are
core; conceal/virt_lines (nvim), SVG + CodeMirror (Obsidian), and applying edits are
plugins.

## Future work

- **Interactive `mermaid` blocks in Obsidian** — needs a CM `Decoration.replace({block})`
  taking the block over (and re-showing source); at odds with plain editability.
- **nvim structural-edit flash** — diff blocks by fingerprint, or use `on_lines` ranges;
  `find_blocks` is a regex scan (treesitter would handle `~~~`/indented fences).
- **Converter surfaces** — SVG serializer; export commands (`mid convert` — md↔mmd — is done).
- **Editing reach in Obsidian** — inline-rename a node (rewrite `spans`), create-child.
- **Sequence diagram ASCII renderer + nvim JSON contract** — actors-as-fixed-columns,
  time-flowing-down-in-declared-order; nothing to reuse from `dagre`/`render.ts`
  (deliberately deferred so v1 could ship as parser + `toMermaidSequence` only).
- **More sequence arrows** — `>>` (return), `~>` (async), `x>` (lost); decide then
  whether `>>` pairs with a prior `>` as a lifeline activation bar or stays an
  independent message type (v1 punted on this along with the extra arrows).

## Maintaining this file

Current-state, present tense — no history/dates/"used to". Delete removed features
rather than narrating them (a one-line "don't reintroduce X" only for real footguns).
Update the affected section in the same change as the code; update the test count.
Scope = the non-obvious (the *why*, gotchas, the cross-module contract), not restating
code. Edit `AGENTS.md`, never `CLAUDE.md`.
