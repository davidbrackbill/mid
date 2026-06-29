#!/usr/bin/env bash
# Hand-run release. Builds the CLI binaries, cuts the GitHub release on the
# monorepo, and mirrors the two plugins to their standalone install repos.
# No CI, no secrets — uses your local `gh`/git auth (run `gh auth setup-git` once).
#
#   ./scripts/mirror.sh v0.1.0
#
# Before running: bump the version in package.json AND
# plugins/obsidian/manifest.json + versions.json to match the tag (minus the `v`),
# commit, and make sure `origin` points at davidbrackbill/mid.
set -euo pipefail

tag="${1:?usage: scripts/mirror.sh vX.Y.Z}"
ver="${tag#v}"
REPO="davidbrackbill/mid"
NVIM_MIRROR="davidbrackbill/mid.nvim"
OBSIDIAN_MIRROR="davidbrackbill/obsidian-mid"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "==> check"
bun run check

echo "==> cross-compile binaries"
rm -rf dist && mkdir -p dist
for t in \
  bun-darwin-arm64:mid-darwin-arm64 \
  bun-darwin-x64:mid-darwin-x64 \
  bun-linux-x64:mid-linux-x64 \
  bun-linux-arm64:mid-linux-arm64 \
  bun-windows-x64:mid-windows-x64.exe; do
  bun build src/cli.ts --compile --target="${t%%:*}" --outfile "dist/${t##*:}"
done

echo "==> tag + push monorepo + release"
git tag -f "$tag"
git push origin "$tag"
gh release create "$tag" --repo "$REPO" --title "$tag" --generate-notes dist/mid-* \
  || gh release upload "$tag" --repo "$REPO" --clobber dist/mid-*

echo "==> mirror nvim (subtree split -> $NVIM_MIRROR)"
split="$(git subtree split --prefix=plugins/nvim)"
git push --force "https://github.com/${NVIM_MIRROR}.git" "$split:refs/heads/main"
git push --force "https://github.com/${NVIM_MIRROR}.git" "$tag"

echo "==> mirror obsidian (build + push -> $OBSIDIAN_MIRROR)"
( cd plugins/obsidian && npm install && npm run build && npm run typecheck )
manifest_ver="$(node -p "require('./plugins/obsidian/manifest.json').version")"
if [ "$ver" != "$manifest_ver" ]; then
  echo "tag ($ver) != manifest.json version ($manifest_ver) — bump them to match." >&2
  exit 1
fi
work="$(mktemp -d)"
cp plugins/obsidian/manifest.json plugins/obsidian/main.js plugins/obsidian/styles.css \
   plugins/obsidian/versions.json plugins/obsidian/README.md LICENSE "$work/"
(
  cd "$work"
  git init -q
  git config user.name "David Brackbill"
  git config user.email "dbrackbill@launchdarkly.com"
  git add -A
  git commit -qm "release $ver"
  git branch -M main
  git push --force "https://github.com/${OBSIDIAN_MIRROR}.git" main
)
# Obsidian requires the release tag to equal manifest.json's version (no leading `v`).
gh release create "$ver" --repo "$OBSIDIAN_MIRROR" --title "$ver" --generate-notes \
  "$work/manifest.json" "$work/main.js" "$work/styles.css" \
  || gh release upload "$ver" --repo "$OBSIDIAN_MIRROR" --clobber \
  "$work/manifest.json" "$work/main.js" "$work/styles.css"

echo "==> done: $tag"
