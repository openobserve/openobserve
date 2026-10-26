#!/usr/bin/env bash
# Installs the pinned opencode binary into $1 after verifying its SHA-256; never pipes a script to a shell.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=opencode-pin.env
source "$here/opencode-pin.env"
dest="${1:?usage: install-opencode.sh <install-dir>}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
url="https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz"
curl -fsSL --retry 3 --retry-all-errors -o "$tmp/opencode.tar.gz" "$url"
echo "${OPENCODE_SHA256}  $tmp/opencode.tar.gz" | sha256sum --check --strict -

mkdir -p "$dest"
tar -xzf "$tmp/opencode.tar.gz" -C "$dest" opencode
installed="$("$dest/opencode" --version)"
if [ "$installed" != "$OPENCODE_VERSION" ]; then
  echo "::error::installed opencode $installed, expected $OPENCODE_VERSION" >&2
  exit 1
fi
echo "opencode $installed installed to $dest"
