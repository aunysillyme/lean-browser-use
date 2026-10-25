# Contributing

Useful contributions include new browser tool families, guard payload fixtures, reader specs, documentation fixes, and failures with reproducible steps. Describe the observable success check before changing behavior. Use the issue forms for a bug or proposal and the pull request template for a finished change.

## Run the checks

Use Node 20 or newer. The package has zero runtime dependencies, so a checkout needs no npm dependency installation.

```sh
npm test
npm run check
npm run proof
```

The Node tests run the Python offline suites when Python is available. Optional integration tests skip with an explanation when their tools are absent. Use saved fixtures and local test servers; keep normal verification independent of external services. Regenerate proof after the final change, then rerun the checks.

## Keep changes reviewable

Add a payload fixture for each new guard rule and prove a blocking test rejects an always-allow implementation. Test allow, block, reset, and fail-open behavior. A new reader spec should include a sanitized public fixture, the fields it extracts, and an independent success check.

Keep tools dependency-free: Node built-ins for the installer and guards, Python standard library for the optional scripts except the user-provided Crawl4AI reader integration. Preserve install-time hashes and the uninstall ownership rules. Never add network calls to the installer, doctor, or meter.

Write short, positive sentences. Keep internal names, personal paths, secrets, and em dashes out of shipped files. Publish numerical performance claims only with package proof or clearly scoped local measurements. Consult [AGENTS.md](AGENTS.md) for test locations and [provenance](docs/PROVENANCE.md) for public names.

Include what changed, why, how it was verified, and any remaining uncertainty in the pull request. Follow the [code of conduct](CODE_OF_CONDUCT.md). Use [private reporting](SECURITY.md) for vulnerabilities.
