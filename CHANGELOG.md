# Changelog

All notable changes to this project are documented here, following [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

## [0.1.1] - 2026-10-27

### Added

- Full after-use cleanup steps for the runner and main session, including tabs, Browser panes, shell tasks, scratch files and verification.
- Cleanup guide on the website, with links from the README, runner agent, skill reference and `llms.txt`.
- `cleanup` command: dry run by default, `--apply` ends only leased automation processes, children first, with SIGTERM, a 3 second wait, then SIGKILL for the same process. It prints one summary line.
- `spawn` command: starts a process detached and records a lease (process id, start time, command line, session).
- Cleanup hooks for SubagentStop, Stop and SessionEnd, registered by the installer and removed by `uninstall`; each exits 0 on every path.
- `doctor` check that reports leftover leased processes and exits 1 when any exist.
- Runner agent and cleanup reference end with the exact cleanup command.

### Changed

- `uninstall` removes hook events it leaves empty instead of keeping empty lists.

## [0.1.0] - 2026-10-25

### Added

- Dollar cost rows and an about 25% cheaper headline, the best of two measured runs on one setup.

- Whole-run context totals of 2,657,290 plain and 2,846,792 runner, with the 15.54-step break-even flagged as an estimate.
- One paired browser-token benchmark with static proof, exact counts, and reproduction guidance.

- Browser method skill, focused references, and a fresh-context runner.
- Browser and cheap-helper packet templates with evidence and cleanup contracts.
- Pick and retry guards plus a batching nudge.
- Local installer, doctor, hash-aware uninstall, and transcript meter.
- Optional compile-once page reader and SearXNG companion.
- Offline checks, package measurements, provenance, and contribution guides.

[0.1.1]: https://github.com/aunysillyme/lean-browser-use/releases/tag/v0.1.1
[0.1.0]: https://github.com/aunysillyme/lean-browser-use/releases/tag/v0.1.0
