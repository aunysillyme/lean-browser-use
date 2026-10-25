# Measure browser context

Run the meter on your own Claude Code transcripts:

```sh
lean-browser-use measure
lean-browser-use measure --dir ./transcripts --since 2026-10-25 --json
```

The default directory is the selected Claude config directory's `projects` folder. The meter walks JSONL files recursively, including subagent transcripts. `--dir` selects another tree, `--since YYYY-MM-DD` filters line timestamps, and `--json` returns the same measurements in structured form.

## What counts

A browser step is a unique assistant `message.id` with a browser `tool_use` block. Recognized prefixes are `mcp__claude-in-chrome__`, `mcp__Claude_Browser__`, `mcp__Control_Chrome__`, `mcp__playwright__`, and `mcp__chrome-devtools__`. A batch counts once, even when it contains many browser actions.

For each step the meter adds `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`. An assistant message can appear on several transcript lines. The meter keeps the largest total for that id as final usage, preserving the browser-step classification across its lines.

A line belongs to the runner group when `isSidechain` is true or its file path contains `/subagents/`. Other lines belong to main. Unreadable lines are skipped and counted in `skipped_lines`.

## Read the result

| Field | Meaning |
| --- | --- |
| Group | Main session or runner. |
| Steps | Distinct assistant messages using browser tools. |
| Median | Typical input-context tokens per step. |
| p90 | Input-context tokens near the upper end of the observed steps. |
| Total | Sum of input-context tokens across browser steps. |
| `reread_share` | Cache-read plus cache-creation tokens divided by total input-context tokens. |
| `ratio` | Main median divided by runner median, reported when each has at least 3 steps. |
| `skipped_lines` | Transcript lines the meter could not read. |

The default output is a short table for main and runner, followed by summary information. With an empty transcript tree it prints `no browser steps found` and exits 0. Generate a real example from the synthetic fixtures with:

```sh
node bin/lean-browser-use.mjs measure --dir test/fixtures/transcripts
```

Output from the synthetic fixtures, not a token-saving claim:

```text
group   steps   median   p90   total   reread_share
main    3       400      600   1200    0.5000
runner  3       200      300   600     0.5000
ratio   2
skipped_lines   1
```

This is a context-volume comparison, not a currency bill. Cached tokens can have different pricing. Different jobs, model behavior, and transcript coverage also affect the result. Compare similar work and keep the counts beside the ratio. The meter prints counts and token values, never message text or tool inputs, and makes no network calls.

## Package measurements

[proof/results.json](../proof/results.json) measures the package: tarball size, file count, dependencies, passing tests, guard timings, install time, and covered guard rules. Reproduce it with `npm run proof`. Each row gives its command, measurement date, and expiry. An expired row warns during `npm run check`; expiry does not block checks or a release. These rows make no claim about your token savings.
