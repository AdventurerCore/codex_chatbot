#!/bin/sh
# Shared by the Finder/Terminal launchers. Preserve the user's preferred tools.
PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
export PATH
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo '请先安装 Node.js 22 或更新版本，并将 node 加入 PATH。' >&2
  exit 1
fi
