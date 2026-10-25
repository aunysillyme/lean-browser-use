# Releasing

The version source is `package.json`. Update it and add the matching dated entry and tag link to `CHANGELOG.md`. Keep README receipt values in sync with `proof/results.json`.

Our own tools and concepts are named with the aun- prefix; internal names never ship, and the terms check enforces it.

## Prepare the artifact

```sh
npm test
npm run check
npm run proof
npm test
npm run check
npm pack --dry-run --json
```

Review the packed file list and measurement provenance. Expired proof rows warn; they do not block CI or publishing. Inspect installation and removal in an isolated target. Have a reviewer from a different model family audit the final diff when using agents, and record that review separately from automated checks.

## Publish the reviewed version

A pushed tag `vX.Y.Z` triggers [release.yml](.github/workflows/release.yml). The publish job waits for the owner's approval in the GitHub `release` environment. After approval, it checks that the tag without `v` equals the `package.json` version, runs tests and checks, then checks the registry. If that version is already on the registry, it logs the skip and exits successfully. Otherwise, it runs `npm publish --provenance --access public` using npm trusted publishing through GitHub's identity token.

Follow [repository settings](REPO_SETTINGS.md) to create and protect the `release` environment before the first tag. GitHub creates an unprotected environment when a job names an environment that does not exist, so publishing would proceed without waiting for approval. A Trusted Publisher needs an existing npm package, so use this first-publish order:

1. The owner runs `npm login` and publishes 0.1.0 by hand with
   `npm publish --access public` (no provenance).
2. Push the `v0.1.0` tag with the owner's release authorization. The tag run waits
   for the owner's approval in the `release` environment, checks the tag against
   package.json, runs tests and check, and skips publishing because 0.1.0 is already
   on the registry.
3. The owner adds the Trusted Publisher on npmjs.com in package settings, Trusted
   publishing, GitHub Actions: owner `aunysillyme`, repository `lean-browser-use`,
   workflow `release.yml`, environment `release`.
4. Release 0.1.1 as the first workflow publish. It must publish successfully within
   2 days of creating the trust configuration to validate it and bind it to the
   repository identity. Update package.json, push `v0.1.1` and approve the `release`
   environment job in time to meet that window.

Tagging and publishing are maintainer actions. This guide and the workflow do not publish by themselves.

After publication, verify registry parity:

```sh
node -p "require('./package.json').version"
npm view lean-browser-use version
npm view lean-browser-use description repository.url license engines --json
npm view lean-browser-use dist.integrity dist.tarball
```

Compare the version and metadata with `package.json` and inspect the published tarball against the reviewed pack list. Check the npm page and GitHub release link. Document a release failure before retrying, and avoid overwriting evidence of the failed attempt.
