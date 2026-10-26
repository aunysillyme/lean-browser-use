# Cleanup: nothing keeps running

After a browser run, the processes the package started are ended and nothing stays running in the background. The package does this with leases: a lease is a small file that `lean-browser-use spawn` writes for each process it starts. Cleanup acts on leases and on nothing else.

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

The installer registers three additive entries, all removed by `uninstall`:

| Event | Scope |
| --- | --- |
| SubagentStop, matcher `aun-browser-runner` | The session's leases when the runner stops. |
| Stop | The session's leases at the end of a turn, unless a subagent is still running. |
| SessionEnd | The session's leases when the session ends. |

Runners that work in parallel inside one session share its scope: when one stops, the hook ends the session's leases. Give each its own `--run NAME` and clean with `cleanup --run NAME` when their helpers must outlive one another.

Each hook reads `session_id` (and `agent_type` for SubagentStop) from the hook payload, ends that session's leases, and exits 0 on every path, so a session is never blocked. A malformed payload does nothing. `doctor` runs the hook against a malformed payload to prove this.

## Check for leftovers

`npx lean-browser-use doctor` lists leased processes still running, with their age and process count, and exits 1 when any exist. Run `cleanup --apply` to end them. `LBU_LEASE_DIR` moves the lease directory; the default is `~/.local/state/lean-browser-use/leases`.
