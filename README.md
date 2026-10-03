# mid

Write Mermaid graphs as Markdown bullets:

```markdown
- request
  - respond: cache hit
  - fetch: cache miss
    - respond: ok
    - error: fail
```

Each bullet is a node and nests under its parent. Text after `: ` labels the
edge from the parent, and quotes keep a colon in a name: `"Step 1: check": ok`.

Get ASCII output:

```
         ╭─────────╮
         │ request │
         ╰─────────╯
              │
       ╭──────╰─────╮
       │       cache miss
       │            │
       │        ╭───────╮
  cache hit     │ fetch │
       │        ╰───────╯
       │            │
       ╭────────────╰──╮
       │    ok       fail
       │               │
  ╭─────────╮      ╭───────╮
  │ respond │      │ error │
  ╰─────────╯      ╰───────╯
```

## CLI

```bash
bun install
bun src/cli.ts diagram.md          # print an ASCII graph
bun src/cli.ts -m diagram.md       # convert Mid -> Mermaid
cat diagram.md | bun src/cli.ts    # reads stdin
```

## Library

```ts
import { parse, renderAscii, renderMermaid } from "./src/index.ts";

const graph = parse(text);
renderAscii(graph);
renderMermaid(graph);
```

## Editor keys

The web editor (`bun run web`) edits graphs as an outline and sequence
diagrams as a table. **Graph**/**Diagram** at the bottom left switches between
them and keeps each one; **Text** edits the Markdown directly.

| Key                    | Outline                                             | Table                                                                   |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Enter                  | new bullet; at the end of a parent, its first child | next row; adds one from the last row                                    |
| Shift+Enter            | types `\n` (a line break in the diagram)            | types `\n`                                                              |
| Tab                    | accepts a grey suggestion, otherwise indents        | accepts a grey suggestion, otherwise next cell; adds a row past the end |
| Shift+Tab              | outdents                                            | previous cell                                                           |
| Backspace at the start | outdents, then merges into the bullet above         | deletes an empty row                                                    |
| Delete at the end      | pulls in the next bullet                            |                                                                         |
| ↑ ↓                    | previous / next bullet                              | previous / next row                                                     |
| ← → at an edge         | previous / next bullet                              | previous / next cell                                                    |
| Esc                    | hides a suggestion                                  | hides a suggestion                                                      |

Suggestions appear in grey: in the outline, an existing node name after two
typed characters; in a table, `->>` after `-` and `-->>` after `--`.
