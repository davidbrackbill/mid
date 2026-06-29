#!/usr/bin/env bash
# Install the `mid` CLI. Downloads the prebuilt standalone binary (Bun runtime
# bundled — no toolchain needed) for your platform from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/davidbrackbill/mid/main/install.sh | bash
#
# Overrides:
#   MID_REPO     owner/repo to fetch from   (default: davidbrackbill/mid)
#   MID_VERSION  release tag, e.g. v0.1.0    (default: latest)
#   MID_BIN_DIR  install dir                 (default: ~/.local/bin)
set -euo pipefail

REPO="${MID_REPO:-davidbrackbill/mid}"
VERSION="${MID_VERSION:-latest}"
BIN_DIR="${MID_BIN_DIR:-$HOME/.local/bin}"

os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
	Darwin) os=darwin ;;
	Linux) os=linux ;;
	*) echo "mid: unsupported OS '$os'." >&2; exit 1 ;;
esac
case "$arch" in
	x86_64 | amd64) arch=x64 ;;
	arm64 | aarch64) arch=arm64 ;;
	*) echo "mid: unsupported arch '$arch'." >&2; exit 1 ;;
esac

asset="mid-${os}-${arch}"
if [ "$VERSION" = "latest" ]; then
	url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
	url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

mkdir -p "$BIN_DIR"
out="$BIN_DIR/mid"
echo "mid: downloading $asset from $REPO ($VERSION)…"
if command -v curl >/dev/null 2>&1; then
	curl -fsSL "$url" -o "$out"
elif command -v wget >/dev/null 2>&1; then
	wget -qO "$out" "$url"
else
	echo "mid: need curl or wget." >&2; exit 1
fi
chmod +x "$out"
echo "mid: installed to $out"

case ":$PATH:" in
	*":$BIN_DIR:"*) ;;
	*) echo "mid: add $BIN_DIR to your PATH:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
