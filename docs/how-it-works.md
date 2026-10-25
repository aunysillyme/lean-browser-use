# How the method works

Every agent step re-reads the whole conversation, so the cost of a browser step is dominated by the size of the session that takes it. Two moves cut it: (1) the main session never drives the browser, a fresh small context does (a "subagent runner", or optionally a "cheap helper": any lower-cost way to run a job outside the paid session); (2) everything goes in bulk so there are fewer steps (the packet principle). A user with no cheap helper keeps most of the saving by sending those jobs to a subagent runner on a fast model.

## Prepare the packet

Main records the user's ask, requested fields, eligible URLs, permissions, observable success checks, and evidence destination. Draft form values offline. Read documentation before the first click. Supply the exact extraction code or action batch so the runner spends its context on execution.

Follow the [route table](../skills/lean-browser-use/references/route-by-job.md). Fetch public text directly when possible. Discover unknown URLs with search. Reuse a compiled reader for stable repeated reads. A cheap helper can read public pages in one session with parallel reads inside it. A subagent runner handles the same packet when the helper is absent.

## Hand off browser work

For logged-in work, main coordinates browser discovery and asks the user to choose by profile name. Record the chosen deviceId and tab in the brief. The runner executes on that tab with a fresh context. It can reselect that same browser for its own session; it cannot choose another profile.

Batch predictable actions and read all named fields together. Where the next action depends on a result, split there. Enumerated observed controls let the executor choose an index and reuse a known ref. Wait for an element in a bounded call. Use screenshots when visual evidence is needed.

## Verify and clean up

The guards require a session pick, bound fruitless retries, and nudge single actions toward a batch. They support the brief's scope and stop conditions. The runner reports partial evidence when blocked.

A runner's DONE is a claim. Main re-reads saved values or independently fetches public data before reporting. Close only run-created tabs and stop only owned processes. Prove it with tab and process checks, then end the report with `Cleanup:`. Preserve existing user resources.

## Where the method came from

The method grew from browser workflow experiments with separate executors, batched reads, and compile-once extraction. The package turns those practices into reusable briefs, a runner, freshly written public guards, and a local transcript meter. The experiments belong to the author's environment; this repository publishes package measurements in [the proof file](../proof/results.json).

Run `lean-browser-use measure` to get your own context comparison. The package receipts describe this build; your transcripts provide evidence for your own workflow. [Credits](../CREDITS.md) identifies the upstream techniques and tools.
