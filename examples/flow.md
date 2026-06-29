# Request handling flow

A small DAG, not just a tree: branches that **rejoin**. Edge labels use the
`[label](target)` link form, and `respond` is reached from two parents
(`request` and `fetch`) — a join / fan-in — because the name is reused.

- request
  - [cache hit](respond)
  - [cache miss](fetch)
    - [ok](respond)
    - [fail](error)

So: a cache hit responds directly; a miss fetches, which either responds (`ok`)
or fails to an `error`. The only root is `request`.
