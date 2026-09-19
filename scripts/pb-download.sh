#!/usr/bin/env bash
set -euo pipefail
PB_VERSION=0.40.4
[[ "$(uname -s)" == Linux ]] || { echo 'PocketBase development download supports Linux only.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) PB_ARCH=amd64 ;;
  aarch64|arm64) PB_ARCH=arm64 ;;
  *) echo 'Unsupported architecture.' >&2; exit 1 ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/pocketbase"
if [[ -x "$ROOT/pocketbase/pocketbase" ]] && [[ "$("$ROOT/pocketbase/pocketbase" --version)" == "pocketbase version $PB_VERSION" ]]; then
  echo "PocketBase $PB_VERSION already installed"
  exit 0
fi
PB_TMP="$(mktemp -d)"
trap 'rm -rf "$PB_TMP"' EXIT
ASSET="pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip"
BASE="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}"
curl -fsSL "$BASE/$ASSET" -o "$PB_TMP/$ASSET"
curl -fsSL "$BASE/checksums.txt" -o "$PB_TMP/checksums.txt"
(cd "$PB_TMP"; awk -v asset="$ASSET" '$2 == asset { print }' checksums.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
unzip -oq "$PB_TMP/$ASSET" pocketbase -d "$PB_TMP"
install -m 755 "$PB_TMP/pocketbase" "$ROOT/pocketbase/pocketbase"
"$ROOT/pocketbase/pocketbase" --version
