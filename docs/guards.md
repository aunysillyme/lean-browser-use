# Guards for browser work

The guards turn common mistakes into a prompt to choose a better next step. They receive Claude Code hook JSON on stdin. Exit 0 allows a call; exit 2 blocks it with a message for the agent. The non-blocking nudge suggests batching.

## What each guard does

| Guard | Behavior |
| --- | --- |
| aun-pick-guard | Requires a browser pick for the current session before page actions. Probe tools remain available. |
| aun-retry-guard | Stops repeated waits, reloads, and fruitless reads per run and tab. |
| aun-batch-nudge | Suggests a `browser_batch` after a streak of 3 single actions. |

The pick guard records successful `select_browser` or `switch_browser` results. Page reads count as actions. Closing a tab with the Chrome extension's `tabs_close_mcp` clears the pick on PostToolUse, so close run tabs once at the end. Closing a tab in the in-app Browser pane keeps its pick. A missing session id blocks because a pick needs a session key. A runner uses its own session and may reselect only the deviceId in its brief. For the in-app Browser pane, record its explicitly selected target with:

```sh
node hooks/pick-guard.mjs --pick '<profile label>' --session '<session id>'
node hooks/pick-guard.mjs --reset --session '<session id>'
```

The retry guard caps cumulative waits on a tab at 60 s by default (`LBU_WAIT_CAP_SECONDS` changes it). It blocks the third consecutive navigation to the same URL. After two fruitless reads, the next wait or navigate and a third identical read are blocked. A different query is a new approach. Another origin, a targeted click or type, or changed read text resets the counters. For supported native tools, the third identical attempt after two identical errors is blocked. Probe calls remain available.

The nudge shares its streak across supported browser and native actions. A probe or `browser_batch` resets the streak. The nudge informs and always allows.

## Registration

The installer merges [hooks.settings.json](../hooks/hooks.settings.json), replacing `${HOOKS_DIR}` with the installed path. Browser matchers cover `claude-in-chrome`, `Claude_Browser`, and `Control_Chrome`. Native matchers cover `computer-use` and `cua-driver`.

| Event | Tools | Script |
| --- | --- | --- |
| PreToolUse | Browser tools | `pick-guard.sh` |
| PreToolUse | Browser and native tools | `retry-guard.sh` |
| PostToolUse | Chrome extension `select_browser`, `switch_browser`, and `tabs_close_mcp` (clears the pick; close run tabs once at the end); the in-app pane keeps its pick | `pick-guard.sh` |
| PostToolUse | Browser and native tools | `retry-guard.sh` |
| PostToolUse | Browser and native tools | `batch-nudge.sh`, timeout 10 s |

State is keyed by session for picking, and by agent run plus tab for retries. `$LBU_STATE_DIR` overrides the state directory; the default is under the Claude config directory's `lean-browser-use/state`. State files use mode 0600 and the directory uses 0700. Retry state is pruned after 24 h.

## Try a payload

From the repository root, this page action should block with exit 2 because its isolated session has no pick:

```sh
state_dir=$(mktemp -d)
printf '%s\n' '{"session_id":"demo","hook_event_name":"PreToolUse","tool_name":"mcp__claude-in-chrome__read_page","tool_input":{"tabId":"demo-tab"}}' |
  LBU_STATE_DIR="$state_dir" sh hooks/pick-guard.sh
echo "$?"
rm -rf -- "$state_dir"
```

Run `node --test test/` for allow, block, reset, fail-open, and RED-proof fixtures. The RED-proof cases confirm that an always-allow stub cannot satisfy the blocking expectations.

## Fail-open behavior

Each shim locates its sibling script and passes through only the intentional blocking exit. Missing Node, missing script files, malformed input, or state failures allow the call. This keeps a broken guard deployment from blocking the browser itself. Fail-open protects availability; it does not prove the guard is healthy. Use `lean-browser-use doctor` after installation and inspect failures before relying on enforcement.
