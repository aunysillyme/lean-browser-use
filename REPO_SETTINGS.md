# Repository settings

This is the setup plan for the owner-approved public flip and first release.
Apply these commands after the owner's yes, then record the read-back values.
The commands below are prepared for review; their results remain UNVERIFIED.

## Metadata

Description: Cut browser use cost by about 25% in Claude Code: fresh runner subagent, bulk reads, three guards and a token meter. One npx command

Homepage: https://github.com/aunysillyme/lean-browser-use#readme

Repository: https://github.com/aunysillyme/lean-browser-use

Topics: ai-agents, browser-automation, browser-use, claude-code, claude-in-chrome, context-window, hooks, llm-cost, mcp, subagent, token-efficiency, web-scraping

Source of truth: [package.json](package.json). Topics are the twelve selected GitHub topics from its keywords.
Use GitHub's default repository link preview.

## Settings at the public flip

| Setting | Target | Read-back |
| --- | --- | --- |
| Visibility | Public after the owner's yes | to be read back after the flip |
| Private vulnerability reporting | Enabled | to be read back after the flip |
| Secret scanning and push protection | Enabled | to be read back after the flip |
| Dependabot alerts and security updates | Enabled | to be read back after the flip |
| CodeQL default setup | Configured for supported languages | to be read back after the flip |
| Main branch protection | Force pushes and deletion blocked, required check `check`, admins exempt | to be read back after the flip |
| Sponsorships | Enabled with the package funding link | to be read back after the flip |
| Topics | Equal to the selected GitHub topics in package.json keywords | to be read back after the flip |
| Description and homepage | Equal to package.json | to be read back after the flip |

Set the repository once for this shell session:

```sh
REPO=aunysillyme/lean-browser-use
```

After the owner approves the visibility change, apply it and read it back:

```sh
gh api --method PATCH "repos/$REPO" -f visibility=public
gh api "repos/$REPO" --jq .visibility
```

Apply the metadata from package.json and the selected topics:

```sh
gh api --method PATCH "repos/$REPO" \
  -f description="$(node -p "require('./package.json').description")" \
  -f homepage="$(node -p "require('./package.json').homepage")"
gh api --method PUT "repos/$REPO/topics" --input - <<'JSON'
{"names":["ai-agents","browser-automation","browser-use","claude-code","claude-in-chrome","context-window","hooks","llm-cost","mcp","subagent","token-efficiency","web-scraping"]}
JSON
gh api "repos/$REPO" --jq '{description,homepage}'
gh api "repos/$REPO/topics"
```

Enable private vulnerability reporting:

```sh
gh api --method PUT "repos/$REPO/private-vulnerability-reporting"
gh api "repos/$REPO/private-vulnerability-reporting"
```

Enable secret scanning and push protection:

```sh
gh api --method PATCH "repos/$REPO" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh api "repos/$REPO" --jq .security_and_analysis
```

Enable Dependabot alerts and security updates:

```sh
gh api --method PUT "repos/$REPO/vulnerability-alerts"
gh api --method PUT "repos/$REPO/automated-security-fixes"
gh api --method GET "repos/$REPO/vulnerability-alerts" --include
gh api "repos/$REPO/automated-security-fixes"
```

Configure CodeQL default setup:

```sh
gh api --method PATCH "repos/$REPO/code-scanning/default-setup" -f state=configured
gh api "repos/$REPO/code-scanning/default-setup"
```

Protect main. The stable job name in [check.yml](.github/workflows/check.yml) is `check`:

```sh
gh api --method PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["check"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}
JSON
gh api "repos/$REPO/branches/main/protection"
```

Enable Sponsorships and verify the community profile and funding link together:

```sh
REPO_ID=$(gh api "repos/$REPO" --jq .node_id)
gh api graphql -f query='mutation($id:ID!){updateRepository(input:{repositoryId:$id,hasSponsorshipsEnabled:true}){repository{hasSponsorshipsEnabled}}}' -f id="$REPO_ID"
gh api graphql -f query='query{repository(owner:"aunysillyme",name:"lean-browser-use"){hasSponsorshipsEnabled}}'
gh api "repos/$REPO/community/profile"
node -p "require('./package.json').funding"
```

## Release environment

Create and protect the `release` environment BEFORE the first tag. Required reviewer:
`aunysillyme`. Look up the numeric user ID when running the commands, then restrict
deployments to tags matching `v*`:

```sh
REVIEWER_ID=$(gh api users/aunysillyme --jq .id)
gh api --method PUT "repos/$REPO/environments/release" --input - <<JSON
{"reviewers":[{"type":"User","id":$REVIEWER_ID}],"prevent_self_review":false,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api --method POST "repos/$REPO/environments/release/deployment-branch-policies" -f name='v*' -f type=tag
gh api "repos/$REPO/environments/release"
gh api "repos/$REPO/environments/release/deployment-branch-policies"
```

Self-review is allowed so the owner can approve a release she triggers. Verify the
required reviewer and tag policy from both read-backs before pushing a tag.

If the environment does not exist when the tag job starts, GitHub creates an
unprotected one and the publish does not wait for approval. The order is environment
first, then the first-publish sequence below.

UNVERIFIED: GitHub may offer environment protection on a private repository only on
paid plans. Read [GitHub's environment protection documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
on the day, and run this setup right after the public flip.

## npm Trusted Publisher

On npmjs.com, open the package settings, then Trusted publishing, then GitHub Actions.
Use these fields for [release.yml](.github/workflows/release.yml):

| Field | Value |
| --- | --- |
| Owner | aunysillyme |
| Repository | lean-browser-use |
| Workflow filename | release.yml |
| Environment | release |

The [npm trust command documentation](https://docs.npmjs.com/cli/v11/commands/npm-trust),
read 2026-10-25, confirms that the package must already exist on the npm registry
before configuring a Trusted Publisher. The
[npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers),
read 2026-10-25, requires the first successful publish within 2 days of creating the
trust configuration to validate it and bind it to the repository identity. It
requires npm 11.5.1 or later and Node 22.14.0 or later. The workflow installs
npm 12.1.0 with Node 24.

After creating and protecting the `release` environment, follow this order:

1. The owner runs `npm login` and publishes 0.1.0 by hand with
   `npm publish --access public` (no provenance).
2. Push the `v0.1.0` tag with the owner's release authorization. The tag run waits
   for the owner's approval in the `release` environment, checks the tag against
   package.json, runs tests and check, and skips publishing because 0.1.0 is already
   on the registry.
3. The owner adds the Trusted Publisher on npmjs.com using the package settings,
   Trusted publishing, GitHub Actions and the fields above.
4. Release 0.1.1 as the first workflow publish. It must publish successfully within
   2 days of creating the trust configuration. Update package.json, push `v0.1.1`
   and approve the `release` environment job in time to meet that window.

For later trusted releases, push a tag whose version without `v` equals package.json
and approve the job in `release`. See [Releasing](RELEASING.md) for artifact review.

## Registry parity

After publication, compare the registry values with [package.json](package.json):

```sh
node -e "const {version,description,bin,funding,license} = require('./package.json'); console.log({version,description,bin,funding,license})"
npm view lean-browser-use version
npm view lean-browser-use description
npm view lean-browser-use bin --json
npm view lean-browser-use funding --json
npm view lean-browser-use license
npm view lean-browser-use dist.integrity
```

Version, description, bin, funding and license should match package.json at the tag.
`dist.integrity` describes the tarball, so compare it with the reviewed artifact's
integrity from `npm pack --dry-run --json` at that tag, alongside the metadata check.
