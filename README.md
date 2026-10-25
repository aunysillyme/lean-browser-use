# lean-browser-use

[![npm version](https://img.shields.io/npm/v/lean-browser-use)](https://www.npmjs.com/package/lean-browser-use)
[![CI](https://github.com/aunysillyme/lean-browser-use/actions/workflows/check.yml/badge.svg)](https://github.com/aunysillyme/lean-browser-use/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-supported-green)](package.json)

**The process and working tools for token-lean browser use by an AI agent in Claude Code: delegate screen work, send it in bulk, and measure your own saving.**

Every agent step re-reads the conversation, so browser work in a long session carries a large context.
A fresh subagent runner and batched reads keep that work compact, with evidence for the main session to verify.

```sh
npx lean-browser-use
```

Undo it with `npx lean-browser-use --uninstall`. Preview the install with `npx lean-browser-use --dry`.

## What it does

| Part | What you get |
| --- | --- |
| Method skill | A route table for public pages, repeated reads, forms, and logged-in work. |
| Subagent runner | Browser execution in a fresh context, with named fields and an evidence handoff. |
| Packet briefs | Paste-ready scope, code, permissions, stop conditions, and cleanup checks. |
| Pick guard | A session-bound browser choice before page actions. |
| Retry guard | A stop on repeated waits, reloads, and fruitless reads. |
| Batch nudge | A reminder to combine predictable actions. |
| Optional page reader | Compile extraction once, then run it as code. |
| Optional search companion | Find links through your SearXNG instance, then read selected pages. |
| Token meter | Compare main and runner browser context in your local transcripts. |
| Installer and doctor | Managed files, preserved settings, health checks, and hash-aware removal. |

The installer has 0 runtime dependencies. [Package measurements](proof/results.json) include the reproduction commands and measurement dates.
It never installs third-party tools, runs a vendor login, or contacts the network.

## After you install

1. Start a fresh Claude Code session and ask it to use the `lean-browser-use` skill.
2. Run `npx lean-browser-use doctor` to check files, hooks, and available companion tools.
3. Try: "Use lean-browser-use to read the title from https://example.com, save the evidence, verify it, and report cleanup."

For logged-in work, choose your Chrome profile by name when asked. The runner receives that browser's deviceId and a named tab.
A cheap helper is optional: the subagent runner can execute the same packets on its own.
See [installation and activation](docs/install.md) for target directories and optional companions.

## Part of a set

| Package | What it gives |
| --- | --- |
| **lean-browser-use** | Token-lean browser use for AI agents: runner subagent, bulk-read briefs, three guards, a compile-once page reader and a token meter, installed with one command |
| [lean-computer-use](https://github.com/aunysillyme/lean-computer-use) | Token-lean computer use for AI agents: runner subagent, desktop scripts, guards and a token meter, installed with one command |

## Measure your own saving

```sh
lean-browser-use measure
```

The table compares main and runner groups: steps, median, p90, total input-context tokens, and reread share.
The summary includes a main-to-runner median ratio when enough steps are present and a count of skipped lines.
It measures context volume, not a currency bill, and prints no message text or tool inputs.
See [how the meter counts](docs/measure.md) to choose a transcript directory, filter dates, or request JSON.

## Common questions

### How do I install browser-use tools for Claude Code?

Run `npx lean-browser-use`, then start a fresh Claude Code session and invoke the skill.
The installer copies the method, runner, briefs, and guards into your selected Claude config directory.

### Can I use a subagent without a cheap helper?

Yes: the subagent runner handles the full browser route with the same packets.
Run `npx lean-browser-use doctor` to inspect the tools your machine provides, then follow the [route table](skills/lean-browser-use/references/route-by-job.md).

### How do I install into just this project?

Run `npx lean-browser-use --project` to target the current project's `.claude` directory.
Check it with `npx lean-browser-use doctor --claude-dir ./.claude`.

### How do I add the page reader and search?

Run `npx lean-browser-use --with-reader` to copy both companions.
You provide their optional tools; [reader setup](docs/reader.md) and [search setup](docs/search.md) explain the commands.

### How do I check browser hooks after installing?

Run `npx lean-browser-use doctor`; hook behavior on your Claude Code version is confirmed there.
For payload examples and stop rules, read [the guards guide](docs/guards.md).

## Uninstall

```sh
npx lean-browser-use uninstall
```

Preview with `npx lean-browser-use uninstall --dry`.
Removal uses install-time hashes: edited files stay and are listed, while owned hook registrations are removed from settings.
Use `--claude-dir` to target the same directory as the install; follow printed manual steps for hooks pasted by hand.

## Read next

- [Install and manage](docs/install.md): every flag, target path, health check, and removal behavior.
- [How the method works](docs/how-it-works.md): prepare, route, batch, verify, and clean up.
- [Guards](docs/guards.md): selection, retry bounds, batching, and fail-open checks.
- [Page reader](docs/reader.md): compile a public extraction and reuse it as code.
- [Search](docs/search.md): find URLs with the optional SearXNG companion.
- [Measure](docs/measure.md): count local browser context and read the comparison.
- [Provenance](docs/PROVENANCE.md): public names, upstream ideas, and evidence boundaries.

**For agents:** [llms.txt](llms.txt) maps the docs; [AGENTS.md](AGENTS.md) defines repository work. Use `npx lean-browser-use doctor` for a headless check.

## Contributing

Bring a reproducible browser failure, a tool-family fixture, a reader spec, or a docs fix.
[CONTRIBUTING.md](CONTRIBUTING.md) gives the checks and review expectations.

## Credits

- [trycua/cua](https://github.com/trycua/cua), MIT: the sibling's background native-app driver.
- [Jev research client / typesafe-sdk](https://pypi.org/project/typesafe-sdk/) and [its source](https://github.com/typesafe-ai/typesafe-sdk-python), MIT: index-choice and packet techniques.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast), MIT: packet ideas.
- [Crawl4AI](https://github.com/unclecode/crawl4ai), Apache-2.0: reader fetching and text extraction.
- [SearXNG](https://github.com/searxng/searxng), AGPL-3.0: the search container referenced by the companion.
- [rtk](https://github.com/rtk-ai/rtk), Apache-2.0: shell-output compression techniques.
- [fetchapi.co](https://fetchapi.co): the compile-once idea, reimplemented here from scratch; idea credit only.
- [Anthropic's Claude in Chrome](https://claude.com/chrome): the logged-in browser integration, under Anthropic's service terms.
- [Keep a Changelog](https://keepachangelog.com), MIT, and [Contributor Covenant](https://www.contributor-covenant.org), CC-BY-4.0: repository conventions.

[CREDITS.md](CREDITS.md) explains each contribution. Credits do not imply endorsement.

## License

[MIT](LICENSE). Copyright Auny LLC and contributors.
