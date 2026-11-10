# Security

Report vulnerabilities privately through the repository's [Security tab](https://github.com/aunysillyme/lean-browser-use/security). Use **Report a vulnerability** to share the affected version, reproduction steps, expected behavior, observed behavior, and a minimal sanitized example.

Do not put secrets, private transcripts, account details, or an active exploit against another user's system in a public issue. If private reporting is unavailable, request that a maintainer enable it without posting the vulnerability details.

Useful reports include installer path handling, unsafe uninstall behavior, secret exposure, reader target checks, or a guard failure that changes permitted actions. The installer, doctor, and meter operate locally without telemetry or network calls. Optional reader, search, browser, and compiler integrations use the services you configure.

Maintainers assess reports, coordinate a fix, and agree on disclosure with the reporter. Keep a reproducer confined to files and services you own.

## Supported versions

The latest published minor line, 0.1.x, receives security fixes.

## Coordinated disclosure

Maintainers aim to acknowledge a report within 7 days and provide a fix or a status update within 30 days. Maintainers and the reporter agree on a disclosure date, allow time for a fix and release, and coordinate the public advisory after users can update. Please keep details private until the agreed disclosure.
