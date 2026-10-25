# Browser recovery

| Observation | Next step |
| --- | --- |
| A helper is slow | Check its declared deadline and process state; use the brief's stop condition. |
| A helper exhausts its capacity | Report the failure and dispatch the remaining packet to a subagent runner. |
| A tool is denied or unavailable | Return the exact missing capability; main assigns an eligible executor. |
| An extraction is empty | Mark the field failed and inspect saved evidence; an empty result is not success. |
| The same error appears twice | Stop and report partial results; avoid another identical attempt. |
| A page shows the wrong account | Recheck the user-selected profile and account evidence before acting. |
| The browser list is empty while Chrome is open | Ask the user to reload the extension at `chrome://extensions` and open the Claude side panel, then re-read the marker. |
| A retry guard blocks | Return its reason; main chooses a new approach within the brief's scope. |
| Reader fetch, compile, or extraction fails | Preserve its exit and diagnostic, then use the next eligible public-read route. |
| Cleanup lacks a probe | Mark it `UNVERIFIED` and hand the exact resource IDs to main. |

Never run a command that closes the user's whole browser profile. Preserve existing tabs, sessions, and shared processes. If verification needs a headless browser, share a run-owned instance and isolate checks with separate browser contexts instead of launching a browser per check.
