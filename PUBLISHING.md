# Publishing mid

You develop in **one monorepo** (`davidbrackbill/mid`). Releasing mirrors the two
plugins out to standalone repos, because lazy.nvim and Obsidian both require a
plugin's files at a **repo root** — which a monorepo subdirectory can't provide.

```
davidbrackbill/mid          ← this monorepo. The only repo you edit.
  └─ release: mid-<os>-<arch> binaries   (CLI installer + nvim build hook download these)
davidbrackbill/mid.nvim      ← mirror of plugins/nvim       (lazy.nvim install target)
davidbrackbill/obsidian-mid  ← mirror of plugins/obsidian   (Obsidian community plugin)
```

All three repos already exist. Mirroring is a **hand-run script** —
`scripts/mirror.sh` — not CI, so there's no cross-repo token to manage. It uses
your local `gh`/git auth.

## One-time setup

```bash
gh auth setup-git                                    # let git push over https via gh
git remote set-url origin git@github.com:davidbrackbill/mid.git
git push -u origin main                              # publish the monorepo
```

(`scripts/mirror.sh` pushes tags to `origin`, so `origin` must point at
`davidbrackbill/mid`.)

## Cutting a release

1. Bump the version in **`package.json`** and **`plugins/obsidian/manifest.json`**
   (and add the entry to `plugins/obsidian/versions.json`). Commit.
2. Run the mirror script with the tag:

   ```bash
   ./scripts/mirror.sh v0.1.0
   ```

   It runs `bun run check`, cross-compiles the `mid` binaries and attaches them to
   the `mid` release, subtree-splits `plugins/nvim` → `mid.nvim`, and builds +
   pushes `plugins/obsidian` → `obsidian-mid` (cutting that release tagged `0.1.0`,
   no `v` — Obsidian requires the tag to equal `manifest.json`'s version exactly).

That's the whole release flow. CI (`.github/workflows/ci.yml`) only runs
`bun run check` on PRs/pushes.

## Listing in the "marketplaces"

**Neovim** has no registry. Add the GitHub topic `neovim-plugin` to `mid.nvim`
(auto-indexed by [dotfyle](https://dotfyle.com)) and optionally PR it into
[`rockerBOO/awesome-neovim`](https://github.com/rockerBOO/awesome-neovim). Install
is just the lazy.nvim spec in the README — no submission.

**Obsidian** community plugins: after the first `obsidian-mid` release exists, PR
[`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases),
adding to `community-plugins.json`:
```json
{ "id": "mid", "name": "Mid", "author": "David Brackbill",
  "description": "Render mid and mermaid fenced code blocks as native Mermaid graphs above their editable source.",
  "repo": "davidbrackbill/obsidian-mid" }
```
Their bot checks for `manifest.json` at the mirror's repo root, a matching release,
a `LICENSE`, and the [submission guidelines](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins).
Until it's merged, users can install via [BRAT](https://github.com/TfTHacker/obsidian42-brat)
pointed at `davidbrackbill/obsidian-mid`.
