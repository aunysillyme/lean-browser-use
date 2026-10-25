# Packet principle

Prepare the whole packet before dispatch: exact ask, URLs, requested fields, browser and tab identity when relevant, supplied code, permissions, evidence destination, stop condition, and cleanup ownership.

| Work | Packet |
| --- | --- |
| Predictable browser actions | One `browser_batch` with the known sequence. |
| Fields from a page | One extraction returning all named fields. |
| Related public reads | One session with independent reads running in parallel inside it. |
| A choice among observed controls | Enumerate the candidates and choose an index; reuse the observed ref. |
| A dependent action | Read first, then decide using that result. |

The caller writes the extraction or batch into the brief. The runner uses it unchanged within the named scope. A failed selector returns an explicit failed field rather than a guessed value. Bound large output and save the full relevant evidence for main to inspect.

A cheap helper and a subagent runner follow the same packet contract. Use bounded parallel work for large public collections when the executor supports it. Keep jobs sharing a browser tab sequential, and keep private content on the user-selected browser route.
