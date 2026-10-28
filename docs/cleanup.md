# Cleanup: nothing keeps running

Cleanup has two owners: the runner and the main session. Follow the steps below after every browser job, including a failed or stopped run. The cleanup command handles leased processes; tabs, other shell tasks and scratch files also need their owner's checks.

## Cleanup steps

Record ownership in the brief: existing user tabs, tabs opened for the job, process IDs, scratch paths and the evidence handoff path. Keep existing user tabs and the user's browser profile open.

The runner completes steps 1-5 at the end of every run, on success, failure or a reached bound. Save evidence at the handoff path first. Main completes steps 6-9 after the runner reports, before calling the task done.

1. **Runner: close run tabs.** Close every tab this run created, plus any tab the brief says main opened for this run. Closing the run's tabs ends the browser control. The extension's control banner goes with the last run tab; closing the last pane tab closes the pane. Closing a tab with the Chrome extension's `tabs_close_mcp` clears the pick, so close run tabs once at the end, never mid-task. Keep tabs the user already had open.
2. Close the in-app Browser pane if this run opened it and nothing else uses it. Closing its last tab closes the pane. Closing a tab in the in-app Browser pane keeps its pick.
3. Stop anything this run started from the shell outside `spawn`, including background commands, scripts and watchers. Delete run-owned scratch files, keeping evidence at the handoff path for main.
4. Use `tabs_context` or `tabs_context_mcp` to confirm no run-owned tab remains. Check processes started outside `spawn`, for example with `pgrep` scoped to what the run started, and confirm they have ended. The next step checks leased processes. If no process was started, report the initial and final resource snapshots. A cleanup claim needs these checks; report an unavailable check as `UNVERIFIED` with the remaining tab or process IDs and paths.
5. Run `npx --yes lean-browser-use cleanup --apply` as the last command. Copy its `cleanup:` line into the report, alongside the tab and process checks and any pending IDs.
6. **Main session: close remaining job tabs.** Close any tab main opened for this job that the runner did not close, including a tab used to pick or identify the browser profile. Closing the run's tabs ends the browser control. The extension's control banner goes with the last run tab; closing the last pane tab closes the pane. Keep existing user tabs open.
7. Stop every background task, monitor or watcher main started for this job, including any local preview or dev server.
8. Run `npx lean-browser-use doctor`. Exit 1 can indicate leftover leased processes: run `npx lean-browser-use cleanup --apply` and re-check with `doctor`. Resolve any other reported health failures before calling the task done; retain unavailable checks as `UNVERIFIED`.
9. Verify the runner's saved evidence and cleanup report, then delete the handoff scratch. Keep it available until verification is complete.

## The stop gate

The stop gate is on by default. PostToolUse `touch` records browser actions and successful closes for Chrome and the in-app Browser pane. Probes and desktop tools do nothing. State is separate for the main session and each subagent. It stores timestamps, counts and a session hash, not page text or tab IDs, in the selected config directory's `lean-browser-use/state/use` folder. `LBU_STATE_DIR` overrides the state root. State older than a day is pruned when a hook accesses it.

At Stop, an action since the last successful close makes a surface dirty. The gate blocks once and names the close tool: `tabs_close_mcp` for Chrome or `tabs_close` for the pane. Close only run-owned tabs. Closing them ends the browser control. Tabs the user already had open stay open. SubagentStop applies the same check only to `aun-browser-runner` and its own state. Stop waits when the payload lists background tasks.

The hook prints a block decision but never closes a tab or ends a process itself. On the repeated Stop, including `stop_hook_active: true`, it resolves the warning and stays silent. It cannot block twice for one dirty stretch. A new action re-arms it. Resolution is not proof of closure: keep the tab probes in the cleanup steps.

If the user must act on a tab, run:

```sh
npx lean-browser-use keep --reason "Review the prepared form"
```

Then name what stays open and why in the reply. `keep` holds every recorded surface of the session, including its subagents. The session defaults to the environment; use `--session ID` outside it. `--claude-dir DIR` selects the config directory. A later action clears holds on that action's main or subagent key.

Install with `--no-stop-gate` to omit the touch and stop-gate registrations, removing those registrations on a reinstall. The hook files remain installed for inspection. `--no-hooks --no-stop-gate` also omits them from the printed paste snippet. Uninstall removes owned registrations and unchanged hook files.

These hooks depend on Node and the matching tool payloads; malformed input or an unavailable state path fails open. `doctor` checks malformed-payload behavior and reports dirty surfaces older than ten minutes. Run it by hand after cleanup. There is no background watcher. The hook files and settings template are the source of truth.

## Process leases

A lease is a small file that `lean-browser-use spawn` writes for each process it starts. The cleanup command acts on leases and on nothing else. Use `spawn` for every browser or helper process the run needs.

## Start a process with a lease

```sh
npx lean-browser-use spawn -- chromium --headless --user-data-dir=/tmp/run-profile --remote-debugging-port=0
```

`spawn` starts the command detached, then records the process id, its start time, its exact command line and the Claude Code session id. It prints one line and returns. A command that fails the checks below is refused before it starts, and a process whose lease cannot be written is stopped again.

| Option | Effect |
| --- | --- |
| `--session ID` | Session that owns the lease. Defaults to the session id Claude Code puts in the environment. |
| `--run NAME` | Optional name, so `cleanup --run NAME` can end one run's processes. |

## Clean up

```sh
npx lean-browser-use cleanup            # dry run: lists what would end
npx lean-browser-use cleanup --apply    # ends it and prints one summary line
```

The summary line reads `cleanup: tabs_closed=1 ended=chrome:9 left=0`. It counts the page tabs closed through the leased Chrome's own loopback debugging port, the processes ended by name, and the leased processes still alive. Tabs are closed only when `lsof` confirms that the leased Chrome tree is the listener on that port; otherwise the processes simply end.

| Option | Effect |
| --- | --- |
| `--apply` | End the processes. Without it nothing is touched. |
| `--all` | Every lease. Without `--session`, a run inside Claude Code covers its own session; a plain terminal covers all. |
| `--session ID` / `--run NAME` | Narrow the scope. |
| `--json` | Print the result as JSON. |

| Exit | Meaning |
| --- | --- |
| 0 | Dry run, or every leased process ended. |
| 1 | A leased process is still alive, a lease was refused, or the process list could not be read. |
| 2 | Usage error. |

## What it ends

A process is ended when all of these hold:

- A lease names it, in a lease directory only your user can write.
- The live process has the same id, start time, command line and owner as its lease. A recycled process id fails this check, and its stale lease is cleared. The check repeats right before each signal.
- It passes the signature check, judged on the running command line, since wrappers and interpreters can re-exec. Chrome needs `--headless` or `--remote-debugging-port=N` and an explicit absolute `--user-data-dir` that is not a real browser profile and does not contain one. Other commands are leased as helpers.
- It is not an ancestor of the cleanup run itself.

Its children go first. Each process gets SIGTERM, then a 3 second wait, then SIGKILL only if the same process (same id, start time and command line) is still alive.

## What is left alone

- Your normal Chrome windows and profile, and any Chrome without automation flags.
- Any directory under the real Chrome, Chromium, Edge, Brave, Vivaldi or Opera profile roots.
- A Chrome or desktop app found below a leased helper that lacks automation flags, uses a real profile, or lives outside the helper's own bundle: it stays running and the line reports `kept_other_chrome=N`.
- Desktop app executables, other browsers, and processes with no lease.
- Processes of other users.

## Trust

Lease files are mode 0600 in a directory only your user can write, and a lease with looser permissions is ignored. A lease names a process; it never replaces the live checks above. Anyone able to write inside that directory can already signal your processes directly, so the lease directory is the boundary to protect.

## Hooks

The installer registers these additive cleanup entries, all removed by `uninstall`:

| Event | Scope |
| --- | --- |
| SubagentStop, matcher `aun-browser-runner` | The session's leases when the runner stops. |
| Stop | The session's leases at the end of a turn, unless a subagent is still running. |
| SessionEnd | The session's leases when the session ends. |
| PostToolUse `touch` | Browser actions and successful closes, per session and subagent. |
| Stop `stop-gate` | One reminder to close dirty main-session browser surfaces. |
| SubagentStop `stop-gate`, matcher `aun-browser-runner` | One reminder for that runner's dirty surfaces. |

Runners that work in parallel inside one session share its scope: when one stops, the hook ends the session's leases. Give each its own `--run NAME` and clean with `cleanup --run NAME` when their helpers must outlive one another.

The lease cleanup hooks read `session_id` (and `agent_type` for SubagentStop) from the hook payload and end that session's leases. All hooks exit 0 on every path. Only the stop gate can request a block through JSON on stdout. A malformed payload does nothing. `doctor` runs the hooks against a malformed payload to prove this.

## Check for leftovers

`npx lean-browser-use doctor` lists leased processes still running, with their age and process count, and exits 1 when any exist. Run `cleanup --apply` to end them. `LBU_LEASE_DIR` moves the lease directory; the default is `~/.local/state/lean-browser-use/leases`.

The `open-surfaces` check also exits 1 for recorded dirty surfaces whose last action is older than ten minutes. Close the run's tabs, or use `keep --reason` with their owning session ID. Kept surfaces do not count.
