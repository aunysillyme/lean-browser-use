# Website builder

## What and why

The static site ports the sibling package's builder, checker and layout. It renders the
landing page and documentation from this repository. Editable copy lives in `content.mjs`,
the source and route map in `pages.mjs`, exact tool evidence in `tools.json`, and page shells
in the templates. The design system, avatar and navigation come from model-orchestrator. Google Fonts
loads Cormorant Garamond and JetBrains Mono from the two pinned font hosts. All other
resources are local. Navigation copies the install command, marks sections and closes
the mobile accordion after a selection. The four flow buttons illustrate the method. The site has no analytics.

## Trigger and deployment mode

Run the builder after changing package sources or website files. The prepared Vercel
configuration installs with `npm --prefix website ci` and writes `website/dist`.
Its build command checks `SITE_LIVE`: a value of `1` runs both builder and checker with
`--live`; every other value runs both in default mode. A linked Vercel project can rebuild
on pushes to `main`. Project creation, Git linking and deployment are separate steps.

Default mode adds noindex, a Disallow robots policy and no discovery files. Live mode
adds the sitemap, Markdown page twins, `llms.txt`, `llms-full.txt`, social metadata and
package `sameAs` links. The error page always keeps noindex. Set `SITE_LIVE=1` after the
repository and package links are public and the deployment is ready for discovery.
Changing the environment variable and redeploying changes modes without a code edit.

## Invocation chain

`node website/build.mjs [--live]` calls the shared fact loader, validates the route and
tool map, renders all pages in memory, then replaces the output directory.
`node website/check.mjs [--live]` checks the generated inventory, metadata, structured data,
proof values, tool text, commands, local links, resources, privacy and mode rules.
Vercel runs the two sequentially. A failure stops that build.

## Dependencies

The website has no dependencies. Its empty package stub matches the sibling and uses
Node.js as declared in `website/package.json`. The package itself requires Node.js >=20
and Claude Code. Git supplies the source commit when `VERCEL_GIT_COMMIT_SHA` is absent.
No supported operating system is stated in the package README or documentation, so the
SoftwareApplication schema omits `operatingSystem`.

Asset preparation is separate from the site build. Supply `assets/trailer.mp4`,
`assets/trailer.webm` and `assets/trailer-poster.jpg` before building. Both modes copy
these files and fail clearly if an asset is missing. The silent trailer autoplays muted,
loops and has a keyboard pause/play control. Reduced motion disables automatic playback
and resets the video to its poster until the viewer presses play. Render the editable
`assets/social-preview.svg` with `rsvg-convert` to refresh its PNG.

## Reads

The builder reads package metadata, the README set row and Common questions, the versioned
proof rows, `tools.json`, sources listed in `pages.mjs`, templates and assets.
The description must match the README set row; the displayed name and version must match
the package. Evidence strings and command flags must occur in their source files.
The checker reuses `scripts/gate.mjs` for private-term hashing and reads the repository's
term-hash file. Neither builder nor checker contacts the network.

Proof rows retain their original labels, values, units and dates. The landing shows selected
receipts, and the proof page shows every eligible row. Guard and installation timing rows
are excluded. A present expiry in the past fails the build. Historical benchmark rows have
no expiry and keep that source format. Benchmark and whole-run totals remain distinct;
the break-even label retains its estimate warning. The benchmark page includes the saved
proof rows and source reproduction guidance, with a link to the complete benchmark source.
README performance summaries are represented by the proof tables rather than rounded prose.
Synthetic meter output stays in its linked source; displayed measurement values come from the receipts.
Commands, requirements, procedure steps, versions and exit codes retain their source values.

An optional `website/release.json` can mark the current package version verified using
`{"version":"0.1.0","verified":true}`. Otherwise the displayed version says "not released yet".
The source commit is validated before use. No other environment values are written.

## Writes and closed loop

Normal commands write only `website/dist/`. Both modes write HTML, local assets,
`robots.txt` and `build-info.json`. Build information records source commit, time,
package version, mode and page count. Live mode also writes discovery files.
`node website/facts.mjs --write` optionally writes ignored `website/facts.json`.

Watcher: nothing. The invoking process checks command status and diagnostics. Vercel's
prepared command runs the checker after the builder. Actual project wiring and deployment
are unverified here. Input validation finishes before output replacement. A later filesystem
error can leave partial output; correct it and rerun.

## Failure modes

| Failure | Next action |
|---|---|
| Description or displayed metadata drift | Reconcile the source metadata and site copy. |
| Expired or invalid receipt | Refresh the package proof through its owning workflow. |
| Missing source evidence or unsupported flag | Correct the tool entry against code and documentation. |
| Missing or duplicate tool assignment | Assign each tool once in `pages.mjs`. |
| Missing source or asset | Restore the named input. |
| Invalid commit | Run in a Git checkout or supply the full source commit through the build environment. |
| Default landing differs from mock | Review the change, then rebuild the mock at the fixed test commit. |
| Wrong discovery mode | Pass the same mode to builder and checker. |
| Output write failure | Restore filesystem access and rerun. |

Source HTML is data. The renderer constructs a limited tag set, removes active raw blocks
and refuses unsafe schemes. Images use named local assets. Source links use included routes
or repository file links. Documented code URLs are checked against source evidence; external resources other than the pinned Google font stylesheet and font files,
and unsafe anchors remain rejected. Source contradictions remain in the source
and must be resolved by its owner.

## Hand-run verification

From the repository root:

```sh
npm --prefix website ci
node --test test/website-facts.test.mjs test/website-build.test.mjs test/website-check.test.mjs
node website/build.mjs
node website/check.mjs
node website/build.mjs --live
node website/check.mjs --live
```

The tests use a fixed placeholder commit and temporary outputs. The saved mock is the
built default landing at that commit. The checker ignores only the footer commit URL and
short label when comparing a default landing to the mock. Its tests cover other commits
without reading repository revision state. Remove generated output after verification.

The source of truth is the package code and documentation, `proof/results.json`,
`pages.mjs`, `tools.json` and `content.mjs`. The three `test/website-*.test.mjs` suites
verify the fact, build and checker contracts. Publishing and deployment are outside this build.

Design source: [model-orchestrator website](https://github.com/aunysillyme/model-orchestrator/tree/main/website).
The shared CSS and navigation are reused under its MIT license. Product copy and proof
come from this repository; the reference analytics and remote media are excluded.

## Copy pins

`pins.json` records the reviewed GitHub About, README lead, install command and package
metadata. The builder and checker compare the headline's README source, its opening
clause, the install box and the meta description with that snapshot. The H1 retains the
owner's two-line treatment. The audience and package summary are rendered from README.
Changing copy requires reviewing the sources and updating the snapshot together.
The checks are offline. [Copy parity](COPY-PARITY.md) records the live source comparison.
