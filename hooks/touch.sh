#!/bin/sh
d=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ -f "$d/touch.mjs" ] || exit 0
node "$d/touch.mjs" "$@" >/dev/null 2>&1
exit 0
