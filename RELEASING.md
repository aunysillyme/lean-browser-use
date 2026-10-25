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

A pushed tag `vX.Y.Z` triggers [release.yml](.github/workflows/release.yml). The publish job waits for the owner's approval in the GitHub `release` environment. After approval, it checks that the tag without `v` equals the `package.json` version, runs tests and checks, then runs `npm publish --provenance --access public`. The workflow uses npm trusted publishing through GitHub's identity token.

Follow [repository settings](REPO_SETTINGS.md) in this order: create and protect the `release` environment, configure the npm Trusted Publisher, then push the matching version tag with the owner's release authorization. Create the environment before the first tag: GitHub creates an unprotected environment when a job names an environment that does not exist, so publishing would proceed without waiting for approval. The settings guide includes the first-publish paths and the Trusted Publisher's two-day first-publish window.

Tagging and publishing are maintainer actions. This guide and the workflow do not publish by themselves.

After publication, verify registry parity:

```sh
node -p "require('./package.json').version"
npm view lean-browser-use version
npm view lean-browser-use description repository.url license engines --json
npm view lean-browser-use dist.integrity dist.tarball
```

Compare the version and metadata with `package.json` and inspect the published tarball against the reviewed pack list. Check the npm page and GitHub release link. Document a release failure before retrying, and avoid overwriting evidence of the failed attempt.
