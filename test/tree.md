# A mid tree

A mid tree is just a bulleted list — indentation defines parent/child. Edges can
be labelled with Markdown link syntax, `- [label](target)`. A node referenced
again by name is the *same* node, so a tree of bullets naturally becomes a DAG.

- A
  - [first step](B)
    - C
  - D
- C
  - E

Here A has children B (via a labelled edge) and D; C is a child of B; and because
`C` is reused as a top-level bullet, the final block adds `C → E` to that same
node C. Roots fall out as the bullets with no parent (just A here).
