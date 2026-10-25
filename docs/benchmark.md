# Paired browser-token benchmark

One paired run measured browser-step context in Claude Code on 2026-10-25. The plain session used about 3x the median tokens per browser step; the skill-and-runner arm used about half the browser-step tokens across the task. These are ballpark figures for this run.

## What was measured

Both arms performed the same task on public pages:

- Plain: browser work stayed in the main session.
- Skill and runner: the package was installed project-scoped in a scratch project, and the task used the skill and a fresh runner.

The task: open Hacker News, read the titles and comment counts of the top 5 stories, then open example.com and read its h1 (both arms found no h1 there and reported the page title). Both arms used the in-app Browser pane tools. The main session was Claude Sonnet 5.5 in both arms and the runner was Claude Haiku 5.5. The plain arm took 8 browser steps in the main session; the runner arm took 1 main-session browser step and 9 runner steps.

The meter counts input-context tokens on browser steps: input tokens plus cache-creation and cache-read input tokens. A step is a unique assistant message using a recognized browser tool, so a batch counts once. The per-step comparison uses the plain main-session median and the runner median. The whole-task comparison sums browser-step tokens across each arm, including any main-session browser work in the runner arm. It covers browser-step context rather than every token used by the session.

## Exact counts

| Measurement | Plain session | Skill and runner | Plain / runner |
| --- | --- | --- | --- |
| Median input-context tokens per browser step | 188,487 | 59,725 | 3.16 |
| Total input-context tokens across task browser steps | 1,506,374 | 725,151 | 2.08 |

Ratios divide plain by runner and round to two decimal places. [proof/benchmark.json](../proof/benchmark.json) is the hand-recorded source. `npm run proof` appends six rows copied or derived from it to [proof/results.json](../proof/results.json). Those rows retain this measurement date, carry no expiry, and are never re-measured by the proof script.

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
