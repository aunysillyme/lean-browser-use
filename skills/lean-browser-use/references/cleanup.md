# Cleanup with proof

Record resource ownership in the brief before acting: existing tabs, run-created tabs, process IDs, scratch paths, and the evidence handoff path. Existing user resources stay open. Never run a command that closes the user's whole browser profile.

Start every process the run needs with `npx --yes lean-browser-use spawn -- <command>`: the wrapper records a lease (process id, start time, exact command).

## Runner steps

At the end of every run, on success, failure or a reached bound, save evidence at the handoff path first. Then:

1. Close every tab this run created, plus any tab the brief says main opened for this run. Closing a tab with the Chrome extension's `tabs_close_mcp` clears the pick, so close run tabs once at the end, never mid-task. Keep tabs the user already had open.
   Closing the run's tabs ends the control. Hold a tab the user must act on with `npx --yes lean-browser-use keep --reason "<why>"` and name it in the report. Otherwise the stop gate blocks once to request closure.
2. Close the in-app Browser pane if this run opened it and nothing else uses it. Closing its last tab closes the pane. Closing a tab in the in-app Browser pane keeps its pick.
3. Stop anything this run started from the shell outside `spawn`, including background commands, scripts and watchers. Delete run-owned scratch files, keeping evidence at the handoff path for main.
4. Use `tabs_context` or `tabs_context_mcp` to confirm no run-owned tab remains. Check processes started outside `spawn`, for example with `pgrep` scoped to what the run started, and confirm they have ended. The next step checks leased processes. If no process was started, report the initial and final resource snapshots. A cleanup claim needs these checks; report an unavailable check as `UNVERIFIED` with the remaining tab or process IDs and paths.
5. Run `npx --yes lean-browser-use cleanup --apply` as the last command. Copy its `cleanup:` line into the report, alongside the tab and process checks and any pending IDs.

The command ends only leased processes of the current session, children first: SIGTERM, a 3 second wait, then SIGKILL for the same process only. It never touches a Chrome without automation flags or one using the real profile directory.

End the report with:

```text
Cleanup: <the cleanup line; closed tab IDs; tab and process checks; scratch removed; retained evidence; pending IDs>
```

Main follows [Cleanup steps 6-9](https://github.com/aunysillyme/lean-browser-use/blob/main/docs/cleanup.md#cleanup-steps) after the runner reports and before calling the task done: close remaining job tabs, stop its tasks and servers, run `doctor`, verify the evidence, then remove the handoff scratch. A cleanup claim without a probe is still pending.
