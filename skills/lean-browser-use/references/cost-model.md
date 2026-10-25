# Cost model

Every agent step re-reads the whole conversation. A browser step in a long main session carries that context along with the page result. Keeping output small helps, but a fresh executor also reduces the context carried into each step.

Main writes the brief, chooses the route, verifies the evidence, and reports. A **subagent runner** starts with a small context and the tools for that job. A **cheap helper** is any lower-cost way to execute outside the paid main session. It is optional: the same brief and batch work with a subagent runner on a fast model.

The packet principle reduces how often that context is read. Send predictable actions together, read all requested fields together, and combine related public reads into a session. A separate call is useful when its result determines the next action.

Run `lean-browser-use measure` against local Claude Code transcripts. It compares main and runner browser steps using input, cache-creation, and cache-read tokens. It deduplicates assistant messages by id and counts a batch as one step. Cache reuse changes billing; this meter measures context volume, not money.

The main/runner median ratio describes those transcripts. It is an observation, not a promised saving or a controlled experiment. Compare similar jobs and inspect step counts, p90, and total alongside the median. The report contains counts and token values, never message text or tool inputs.
