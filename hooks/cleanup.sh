#!/bin/sh
d=$(cd "$(dirname "$0")" && pwd) || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ -f "$d/cleanup.mjs" ] || exit 0
node "$d/cleanup.mjs" "$@" >/dev/null
exit 0
