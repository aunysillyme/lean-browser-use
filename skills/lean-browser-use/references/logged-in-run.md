# Logged-in run

## Pick by profile name

The user sets a small JSON marker once in each Chrome profile on `https://example.com`, using that profile's developer console:

```js
localStorage['claude_chrome_profile'] = JSON.stringify({name: 'Work'});
```

Use a descriptive profile label, without account secrets. Main coordinates `list_connected_browsers` and inspection of these markers, then asks the user to pick by profile name. Never auto-pick. An absent marker or ambiguous name goes back to the user. Profile setup and selection are the handoff preparation; delegate the task's page actions to the runner.

Select the confirmed browser and record its exact `deviceId`. Obtain the named tab with `tabs_context_mcp` (create-if-empty when supported). Record whether the tab existed before the run and who owns closing it. In the in-app Browser pane, record the selected pane and use `node pick-guard.mjs --pick <label> --session <id>` for that session. Give the pane runner its explicit target and tab; it does not call `select_browser`.

## Hand off the packet

The brief names the deviceId, profile label, tab id, URLs, fields, supplied batch, and cleanup owner. A runner has its own session. If its pick guard blocks, it may list browsers and select only the deviceId named in the brief. It stops if that identifier is absent or unavailable.

The runner uses the named tab directly and confirms the expected account from a narrow visible read before an approved action. It reports a mismatch instead of treating an account error as permission to try another profile.

## Verify, then close

Main re-reads saved evidence before the cleanup owner closes run-created tabs. The runner preserves evidence at the handoff path. Closing a tab with the Chrome extension's `tabs_close_mcp` clears the pick, so close run tabs once at the end. Closing a tab in the in-app Browser pane keeps its pick. Preserve the user's existing tabs and whole browser profile. Finish with the checks in [cleanup](cleanup.md).
