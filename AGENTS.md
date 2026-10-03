# AGENTS.md

Notes for working on mid. The code says what it does; this file covers what it
doesn't.

## Layout

- `src/parse.ts`: Mid bullets, Mid tables, and Mermaid flowchart/sequence input
  into one `Graph`, with source spans and warnings.
- `src/render.ts`: `renderAscii`, `renderSvg`, `renderMermaid`, `renderMid`.
- `src/mid.ts`: reads and writes Mid tables and outlines, and splits
  `node: label`. The parser, `renderMid`, and the editors all use it.
- `src/cli.ts`: the only file in `src/` allowed to use `Bun.*`. The web
  editor imports `src/` directly, so the core must stay runtime-agnostic.
- `web/editor.ts`: all of the editor's DOM code. Every change goes through
  `commit()`; the outline and table share one field editor driven by a
  `Rules` object (`edit.ts`). `outline.ts`, `grid.ts`, and `document.ts` hold
  those rules with no DOM, tested in `test/edit.test.ts`. Table cells are
  numbered in reading order, header first.
- `scripts/dev.ts`: `bun run web`. Starting it again replaces the running one.
- `test/`: each fixture input has expected `.ascii`, `.svg`, `.mermaid`
  outputs next to it.
- `test/web.test.ts`: drives the editor in the installed Google Chrome
  through playwright-core, so `bun test` needs Chrome (CI runners have it).

## Mid syntax

Graph (bullets): each bullet is a node and nests under its parent.
`node: label` labels the edge from the parent; the first `: ` outside double
quotes splits them, so `"Step 1: check": ok` keeps the colon. `\n` breaks a
name or label onto two lines.

Sequence (a Markdown table): the header row lists participants (`actor: Name`
for an actor). Each row is one message: its text under the sender and a
Mermaid arrow under the receiver, with `+`/`-` to activate or deactivate.
Text alone is a self-message, optionally ending in an arrow (`retry -->>`).
An `autonumber` line above the table numbers messages.

| Mermaid feature                                    | Read    | Mid      | Drawn           |
| -------------------------------------------------- | ------- | -------- | --------------- |
| flowchart nodes `A`, `A[..]`, `A(..)`, `A{..}`     | yes     | as names | as boxes        |
| links `-->` `---` `-.->` `-.-`, with `\|label\|`   | yes     | yes      | as solid arrows |
| `LR`/`RL`/`BT` direction                           | ignored | no       | top to bottom   |
| subgraphs, classDef, chained links                 | warning | no       | no              |
| participant, actor, `as` alias                     | yes     | yes      | yes             |
| all ten message arrows, `+`/`-` activation         | yes     | yes      | yes             |
| autonumber                                         | yes     | yes      | yes             |
| notes, loop/alt/opt/par/critical/break/rect        | warning | no       | no              |
| `activate`/`deactivate` lines, create/destroy, box | warning | no       | no              |

Lines that aren't understood become warnings and are dropped on conversion.

## Rules

- No code comments. The `mid/no-comments` oxlint rule rejects them and
  `bun run lint:fix` strips them.
- `bun run check` is the CI gate: oxfmt, oxlint, `tsc` for `src/` and `web/`,
  and `bun test`.
- Bun is the only runtime and package manager; Node isn't needed.
  `bunfig.toml` runs Node-shebang tools (oxlint, oxfmt, tsc) on Bun and
  rejects a Bun older than `engines.bun` in `package.json`.
- Library code needs no runtime dependency besides dagre. Web-only packages
  are dev dependencies bundled by `web:build`.

## Gotchas

- Fixtures are excluded from oxfmt (`.oxfmtrc.json`) so formatting can't
  silently change what a test covers.
- `web/` has its own `tsconfig.json` with DOM types and no Bun types, checked
  by `tsc -p web`.
