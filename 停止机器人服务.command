#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./scripts/macos-env.sh
node "$PWD/dist/main.cjs" stop
