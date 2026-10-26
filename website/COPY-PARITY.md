# Copy parity

Reviewed live on 2026-10-26. The GitHub README matches this checkout byte for byte.
GitHub About, npm description and package.json description are identical. npm keywords
match package.json. The repository llms.txt repeats the same description and installation
command, and keeps the precise cost and whole-run token scopes.

Sources: [README](https://github.com/aunysillyme/lean-browser-use/blob/main/README.md),
[GitHub About API](https://api.github.com/repos/aunysillyme/lean-browser-use),
[npm metadata](https://registry.npmjs.org/lean-browser-use/latest),
[agent map](https://github.com/aunysillyme/lean-browser-use/blob/main/llms.txt),
[package metadata](../package.json), [benchmark](../docs/benchmark.md).

After the design rebuild, before the copy pin change:

| Message point | README line | Site line | Verdict |
| --- | --- | --- | --- |
| What it is | 10-11: Claude Code browser work; skill, runner agent, three hooks and token meter | Installer features and guide cards describe the parts separately | Mismatch: the complete package summary is missing from the landing |
| Lead | 8: Cut browser use cost by about 25% in Claude Code | Hero: Cut browser use cost by about 25%. A fresh runner, bulk reads, three guards. | Match in meaning; owner's required two-line treatment |
| Install | 21: npx lean-browser-use | Install box: npx lean-browser-use | Match |
| Dollar scope | 17, 52-53: 3% and 25% less; about 14% pooled at list API prices | Hero uses those words; evidence shows -3.15%, -25.26%, -14.02% | Match; headline is best of two on one setup |
| Token scope | 18, 54-56: about 3x per step; whole run reads more | Hero and evidence distinguish per-step context from whole-run tokens; proof retains totals | Match |
| Needs | 63-69: fresh Claude Code session; user chooses logged-in profile; docs/install.md requires Node 20 or newer | Requirements, installation steps and flow footnote | Match |
| Optional tools | 40-41 and FAQ: reader and search use separately installed tools | Requirements: Python 3, Crawl4AI and a SearXNG instance; optional Docker setup | Match |
| License | 158-160: MIT | Sidebar: Open source · MIT license | Match |

After the copy pin change:

| Message point | README line | Site line | Verdict |
| --- | --- | --- | --- |
| What it is | 10-11: For Claude Code users who run browser work in their sessions. You get a skill, a runner agent, three hooks and a token meter | Installer section renders the complete two-line README paragraph verbatim | Match |
| Lead | 8: Cut browser use cost by about 25% in Claude Code: run page work in a fresh runner, send it in bulk, and see your own saving. | H1 keeps the owner wording and records that exact README source; pins enforce its opening clause | Match |
| Install | 21: npx lean-browser-use | Install box and pin: npx lean-browser-use | Match |
| Dollar scope | 17, 52-53: 3%, 25%, about 14% pooled | Hero preserves the sentence and lists the best-of-two limit; evidence uses exact benchmark rows | Match |
| Token scope | 18, 54-56: per-step about 3x; whole-run totals 2,657,290 and 2,846,792 | Hero says tokens rose in both runs; proof keeps whole-run totals and the break-even estimate separate | Match |
| Needs | 63-69 and docs/install.md: Claude Code, selected profile, Node 20 or newer | Installation, requirements and illustrative flow | Match |
| Optional tools | 40-41 and FAQ: separately installed reader and search tools | Requirements and linked setup guides | Match |
| License | 158-160: MIT | Sidebar and SoftwareApplication license | Match |

The meta description equals the pinned About and package description. `pins.json` records
all four source strings. Builder and checker reject a changed README source, H1 opening
clause, install command or meta description. Tests prove each failure and restoration.
README and GitHub copy were left unchanged. This review found no incorrect README claim.
