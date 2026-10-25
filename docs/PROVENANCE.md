# Provenance

## Own tools and concepts

| Public name | Contribution |
| --- | --- |
| aun-web-use | The browser process, packet briefs, route table, verification, and cleanup practices. |
| aun-runner | Fresh-context execution, shipped as `aun-browser-runner`. |
| aun-chrome | Logged-in work through Claude in Chrome on the profile the user selects. |
| aun-pick-guard | Session-bound browser selection, implemented fresh as public code. |
| aun-retry-guard | Bounded retries and waits, implemented fresh as public code. |
| aun-batch-nudge | Advice to group predictable actions, implemented fresh as public code. |
| aun-screen | Optional screening of fetched text for prompt-injection attempts. |
| aun-keep | Optional storage of long output by id with a bounded view. |
| aun-squeeze | Shell-output compression practice inspired by rtk. |
| aun-privacy-gate | Public tree, filename, and history checks in `scripts/gate.mjs`. |
| aun-acceptance | Observable success checks in each brief and verification against the artifact. |
| aun-cross-review | Review by a different model family from the writer. |

The method and templates are generalized rewrites. The guards, installer, and meter are fresh public implementations. The reader and search companion adapt the author's code to public configuration and command contracts. The reader accepts an explicit stdin compiler command; its extraction design reimplements the compile-once idea from scratch.

The sibling [lean-computer-use](https://github.com/aunysillyme/lean-computer-use) carries aun-desk-use for native apps.

## Public upstreams

The Jev research client, typesafe-sdk, and browser-use/jev-ultrafast informed packet and index-choice techniques. Crawl4AI provides fetching and text extraction. SearXNG supplies the optional search service. Anthropic's Claude in Chrome supplies the connected browser tools. The compile-once idea comes from fetchapi.co. trycua/cua supplies the sibling's native-app driver; rtk informed shell-output compression. Keep a Changelog and Contributor Covenant inform repository conventions.

See [CREDITS.md](../CREDITS.md) for links, licenses, and the contribution of each upstream. A credit describes influence or use and never implies endorsement.

## Evidence boundaries

[proof/results.json](../proof/results.json) holds reproducible package measurements, with a command, measurement date, and expiry per row. It contains no author-specific token-saving ratio. The local meter compares a user's own transcripts. Saved reader fixtures establish offline extraction behavior; live page values need a current fetch and independent verification.
