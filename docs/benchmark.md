# Paired browser-token benchmark

One paired run measured context in Claude Code on 2026-10-25. Browser-step tokens roughly halved with the skill and runner, and its median browser step used about 3x fewer tokens. The whole run read about 7% more context on this short task with 9 runner browser steps. These are ballpark figures for this run.

## What was measured

Both arms performed the same task on public pages:

- Plain: browser work stayed in the main session.
- Skill and runner: the package was installed project-scoped in a scratch project, and the task used the skill and a fresh runner.

The task: open Hacker News, read the titles and comment counts of the top 5 stories, then open example.com and read its h1 (both arms found no h1 there and reported the page title). Both arms used the in-app Browser pane tools. The main session was Claude Sonnet 5.5 in both arms and the runner was Claude Haiku 5.5. The plain arm took 8 browser steps in the main session; the runner arm took 1 main-session browser step and 9 runner steps.

The meter counts input-context tokens on browser steps: fresh input tokens plus cache-creation and cache-read input tokens. A step is a unique assistant message using a recognized browser tool, so a batch counts once. The per-step comparison uses the plain main-session median and the runner median. The browser-step total sums those steps across each arm, including any main-session browser work in the runner arm. Whole-run totals cover every call, including setup, delegation and reporting. Output tokens are separate from context read.

## Exact counts

| Measurement | Plain session | Skill and runner | Plain / runner |
| --- | --- | --- | --- |
| Median input-context tokens per browser step | 188,487 | 59,725 | 3.16 |
| Total input-context tokens across task browser steps | 1,506,374 | 725,151 | 2.08 |

## Everything each run read

Two runs, both measured the same way on 2026-10-25. Every model call counts: setup, reading the skill and brief files, dispatching, verifying and reporting. Context tokens are fresh input plus cache creation plus cache read; output tokens are separate.

| | Run 1: 9-step read (Hacker News and example.com, in-app Browser pane) | Run 2: small task (one page, Claude in Chrome) |
| --- | --- | --- |
| Browser steps, plain session | 8 | 4 |
| Whole-run context tokens, plain session | 2,657,290 (14 calls) | 1,133,195 (6 calls) |
| Browser steps with the package | 1 main + 9 runner | 1 main + 4 runner |
| Whole-run context tokens with the package | 2,846,792 (11 main + 12 runner calls) | 1,241,361 (5 main + 5 runner calls) |
| Median per browser step, plain / runner | 188,487 / 59,725 (3.16x) | 189,084 / 58,057 (3.26x) |
| Whole run, plain / with the package | 0.93 (7.13% more with the package) | 0.91 (9.55% more with the package) |

Run 1 detail: plain 28 fresh, 129,118 cache-creation, 2,528,144 cache-read, 2,188 output; with the package 46 fresh, 195,388 cache-creation, 2,651,358 cache-read, 5,905 output (the runner's 712,461 context tokens ran on Claude Haiku 5.5, the main session's 2,134,331 on Claude Sonnet 5.5). Run 2: native 734 output; with the package 2,846 output.

Ratios divide plain by the package arm and round to two decimal places. [proof/benchmark.json](../proof/benchmark.json) is the hand-recorded source. `npm run proof` appends fourteen rows copied or derived from it to [proof/results.json](../proof/results.json). Those rows retain this measurement date, carry no expiry, and are never re-measured by the proof script.

## Where the saving appears

Per browser step, measured twice: the runner re-reads about 3x fewer tokens (128,762 fewer in run 1). Over a whole run, the package used more tokens in both measured runs. The main session still makes its own calls (loading the skill, reading the brief template, dispatching, verifying), each re-reading its whole context, about 190K tokens per call in this setup, and the runner adds a fresh start. On short tasks those calls outweigh the per-step saving.

Not measured: a longer job. No run here had more than 9 browser steps, so where the whole-run total drops below the plain session is unmeasured. A rough break-even of about 16 browser steps (15.54, flagged `estimate: true` in the saved record) comes from extending the two data points and assumes similar session sizes and call overhead. Treat it as a planning guess, with no guaranteed saving and no currency cost.

## Reproduce a paired comparison

1. Choose a public-page task and save its exact prompt. Record the model, browser tools and starting session size for both arms.
2. Prepare separate scratch folders for the plain arm and the skill-and-runner arm. In the runner scratch folder, install the package into that project:

```sh
npx lean-browser-use --project
```

3. Run the task prompt once in a plain Claude Code session. Run the same prompt once in a session using the `lean-browser-use` skill and its runner. Keep each arm's transcripts in its own folder, including subagent transcripts.
4. Measure each transcript folder with the same package version:

```sh
npx lean-browser-use measure --dir ./plain-transcripts
npx lean-browser-use measure --dir ./runner-transcripts
```

Quote folder paths when they contain spaces. Compare the plain main median with the runner median. For the task totals, sum the main and runner group totals within each arm. Save the meter output and conditions beside the transcripts. [How the meter counts](measure.md) explains grouping and token fields.

## How far to trust it

This is one paired run of one task on public pages. Results move with the model, session size and task. The arms exercise different execution routes, so the comparison describes that pair rather than isolating a single cause.

Tokens re-read are not a price list: cached tokens and fresh input tokens can have different prices. Cost varies by model, and this ballpark guarantees no particular saving. Measure your own similar work to see what changes for you.

