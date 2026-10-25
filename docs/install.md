# Install and manage

Use Node 20 or newer. From a terminal:

```sh
npx lean-browser-use
```

The installer prints its plan, then asks `Proceed? [Y/n]` on a terminal. Non-interactive runs proceed automatically; `--yes` also skips the prompt. Undo the install with `npx lean-browser-use --uninstall`.

## Choose the target

The config directory is selected by `--claude-dir DIR`, then `$CLAUDE_CONFIG_DIR`, then `~/.claude`. `--project` targets `./.claude` in the current project. Use one explicit target choice per invocation.

```sh
npx lean-browser-use install --project
npx lean-browser-use install --claude-dir ./sandbox-config --dry
npx lean-browser-use install --with-reader --yes
```

| Install flag | Effect |
| --- | --- |
| `--claude-dir DIR` | Use the named Claude config directory. |
| `--project` | Install into the current project's `.claude`. |
| `--no-hooks` | Copy the hooks and print registration to paste by hand; skip the settings merge. |
| `--with-reader` | Also copy the optional reader and SearXNG files. |
| `--dry` | Print the real plan while leaving files unchanged. |
| `--yes` | Proceed after the plan without an interactive confirmation. |
| `--help` | Print command usage. |
| `--version` | Print the package version. |

## Files and settings

Here `<cfg>` means the selected config directory.

| Destination | Contents |
| --- | --- |
| `<cfg>/skills/lean-browser-use/` | Method entrypoint and focused references. |
| `<cfg>/agents/aun-browser-runner.md` | Browser subagent definition. |
| `<cfg>/lean-browser-use/hooks/` | Guard scripts and registration source. |
| `<cfg>/lean-browser-use/briefs/` | Browser and cheap-helper packet templates. |
| `<cfg>/lean-browser-use/reader/` | Optional compile-once reader and specs. |
| `<cfg>/lean-browser-use/searxng/` | Optional search script and container configuration. |
| `<cfg>/lean-browser-use/manifest.json` | Install-time hashes, created directories, and settings changes. |
| `<cfg>/settings.json` | Merged hook registrations, preserving other settings and hooks. |
| `<cfg>/settings.json.lean-browser-use.bak` | Backup of existing settings, written only if the backup is absent. |

Repeated installs avoid duplicate registrations. The installer substitutes real hook paths into the registration template. It never installs third-party tools, runs a vendor login, contacts the network, or prints secrets. Optional tool installation belongs to the user; see [reader](reader.md) and [search](search.md).

## Activate and inspect

Start a fresh Claude Code session so it can discover the installed skill and agent. Ask it to use `lean-browser-use` for a browser task. Pick your Chrome profile by name when logged-in work needs it. A Chrome connection and tool permissions come from your own Claude Code setup.

```sh
npx lean-browser-use doctor
npx lean-browser-use doctor --claude-dir ./sandbox-config --json
```

Doctor checks installed file hashes, registered hook paths, executable shims, and synthetic hook responses. Edited files are reported. Its capability table explains what Python, `crwl`, Docker, Claude Code, and local transcripts enable; missing optional tools are capabilities to add, not installation errors. JSON output has `ok` and `checks`, each with `id`, `status`, and `detail`. Hook behavior on your Claude Code version is confirmed by `lean-browser-use doctor`.

## Measure and remove

```sh
npx lean-browser-use measure --dir ./transcripts --since 2026-10-25 --json
npx lean-browser-use uninstall --claude-dir ./sandbox-config --dry
npx lean-browser-use uninstall --claude-dir ./sandbox-config
```

`measure` defaults to the selected config directory's `projects` folder; `--dir` overrides it, `--since YYYY-MM-DD` filters timestamps, and `--json` returns structured results. See [the meter](measure.md).

Uninstall compares each file with its install-time hash. It removes matching files, preserves and lists edited files, removes only its hook entries from settings, and removes only empty directories this install created. It refuses traversal, absolute manifest paths, and symlink entries. The manifest is removed last. Follow printed manual steps for registration pasted by hand. For a project install, point uninstall and doctor at `--claude-dir ./.claude`.

| Exit | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | A check failed. |
| 2 | Usage error or refused target; a missing uninstall manifest names its path. |
| 3 | Uninstall preserved edited files. |
