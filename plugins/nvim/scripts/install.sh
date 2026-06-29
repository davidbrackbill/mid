#!/usr/bin/env bash
# Download a prebuilt `mid` binary for this platform into ../bin/mid.
#
# Run automatically by lazy.nvim's `build` hook (cwd = the plugin dir), or by
# hand. No toolchain required — fetches the compiled standalone binary (Bun
# runtime bundled) from the latest GitHub release.
#
# Overrides:
#   MID_REPO     owner/repo to fetch from   (default: davidbrackbill/mid)
#   MID_VERSION  release tag, e.g. v0.1.0    (default: latest)
set -euo pipefail

REPO="${MID_REPO:-davidbrackbill/mid}"
VERSION="${MID_VERSION:-latest}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="$(cd "$script_dir/.." && pwd)/bin"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
	Darwin) os=darwin ;;
	Linux) os=linux ;;
	*) echo "mid: unsupported OS '$os' — build from source (bun run build) and set cmd." >&2; exit 1 ;;
esac
case "$arch" in
	x86_64 | amd64) arch=x64 ;;
	arm64 | aarch64) arch=arm64 ;;
	*) echo "mid: unsupported arch '$arch' — build from source (bun run build) and set cmd." >&2; exit 1 ;;
esac

asset="mid-${os}-${arch}"
if [ "$VERSION" = "latest" ]; then
	url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
	url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

mkdir -p "$bin_dir"
out="$bin_dir/mid"
echo "mid: downloading $asset from $REPO ($VERSION)…"
if command -v curl >/dev/null 2>&1; then
	curl -fsSL "$url" -o "$out"
elif command -v wget >/dev/null 2>&1; then
	wget -qO "$out" "$url"
else
	echo "mid: need curl or wget to download the binary." >&2
	exit 1
fi
chmod +x "$out"
echo "mid: installed $out"
