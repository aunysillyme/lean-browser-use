#!/bin/sh
d=$(cd "$(dirname "$0")" && pwd) || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ -f "$d/batch-nudge.mjs" ] || exit 0
node "$d/batch-nudge.mjs" "$@"
status=$?
[ "$status" -eq 2 ] && exit 2
exit 0
