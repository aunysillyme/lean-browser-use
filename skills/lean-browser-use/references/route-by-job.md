# Route by job

Use the first eligible row. A cheap helper means an optional lower-cost executor, independent of vendor. The subagent runner is the complete default path.

| Job | Route | With no cheap helper |
| --- | --- | --- |
| Repeated extraction from a stable public URL or template | Run a compiled reader spec. On fetch, compile, or extraction failure, report the exit and use the next eligible route. | Same reader. |
| A known public URL with useful text | Fetch to a file: try `llms.txt`, a served `.md` page, then `crwl`, then the page reader. | Same fetch tools; let a runner perform any browser work. |
| Public pages whose URLs are unknown | Find links with SearXNG, then apply a read route. | Same search, then a batched runner. |
| Several known public pages | One cheap-helper session, parallel reads inside it. | One subagent-runner session, batched the same way. |
| A large independent public collection | Bounded parallel helper work, with a merged evidence file. | Bounded runner work; share a verification browser with isolated contexts if needed. |
| Public pages requiring scripts or clicks | Cheap helper if its probed browser tools can complete the brief. | Subagent runner on a fast model. |
| Public forms where every field must land | Subagent runner using Claude in Chrome; verify each named field. | Same runner. |
| A page behind the user's login | Subagent runner on the browser profile the user picked. | Same runner. |
| Browser actions in Claude in Chrome or the in-app Browser pane | Main coordinates the browser pick and tab handoff; the runner executes the packet. | Same runner. |
| Main session | Frame, dispatch, independently verify, and report. | Same responsibilities. |

Use [logged-in run](logged-in-run.md) for profile selection. Public pages can use a fast model; logins and forms can use a standard model at dispatch. This is a capability choice, not a fixed vendor-to-job recipe. If a helper fails, carry its evidence and blocker into a runner brief instead of repeating the whole discovery process.
