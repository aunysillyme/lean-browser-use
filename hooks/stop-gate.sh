#!/bin/sh
d=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ -f "$d/stop-gate.mjs" ] || exit 0
node "$d/stop-gate.mjs" "$@" 2>/dev/null
exit 0
