# Cleanup with proof

Record resource ownership in the brief before acting: existing tabs, run-created tabs, process IDs, scratch paths, and the evidence handoff path. Existing user resources stay open. Never run a command that closes the user's whole browser profile.

At the end, close only tabs this run created or that the brief explicitly assigns to it. Closing a tab with the Chrome extension's `tabs_close_mcp` clears the pick, so close run tabs once at the end. Closing a tab in the in-app Browser pane keeps its pick. Close a Browser pane only when this run opened it and it is unused by other work.

Stop only processes started by the run, using recorded process IDs. Check each owned process with a PID-specific `ps` or `pgrep` probe; avoid broad process-name kills. Delete only run-owned scratch files. Keep evidence at the main-owned handoff path until main finishes verification, then let main remove it.

After closing, use `tabs_context` or `tabs_context_mcp` to confirm the owned tabs are absent. Pair it with the process check. If the run started no process, report the initial and final resource snapshots explicitly. If a check is unavailable, report `UNVERIFIED` and give main the remaining IDs and paths.

End the report with:

```text
Cleanup: <closed tab IDs; tabs_context result; process check; scratch removed; retained evidence; pending IDs>
```

Main checks any outer helper process after it exits. A cleanup claim without a probe is still pending.
