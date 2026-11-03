#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./scripts/macos-env.sh
if ! command -v codex >/dev/null 2>&1; then
  echo '请先安装 Codex CLI，登录后将 codex 加入 PATH。' >&2
  exit 1
fi
node "$PWD/scripts/install-macos.cjs"
