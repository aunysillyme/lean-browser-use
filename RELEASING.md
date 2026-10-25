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

A pushed tag `vX.Y.Z` triggers [release.yml](.github/workflows/release.yml). It runs tests and checks, then `npm publish --provenance --access public`. The workflow uses npm trusted publishing through GitHub's identity token. Configure that trust on npm for this repository and workflow before releasing; the workflow uses no GitHub environment and stores no npm token in the repository.

Tagging and publishing are maintainer actions. This guide and the workflow do not publish by themselves.

After publication, verify registry parity:

```sh
node -p "require('./package.json').version"
npm view lean-browser-use version
npm view lean-browser-use description repository.url license engines --json
npm view lean-browser-use dist.integrity dist.tarball
```

Compare the version and metadata with `package.json` and inspect the published tarball against the reviewed pack list. Check the npm page and GitHub release link. Document a release failure before retrying, and avoid overwriting evidence of the failed attempt.
