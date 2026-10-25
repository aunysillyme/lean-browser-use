# Find links, then read pages

Use search when the URLs are unknown. The optional `searx` script returns links from a SearXNG instance so a helper or runner can read the selected pages in a packet. SearXNG is a self-hosted search service; hosting and upstream availability depend on your environment.

Install the companion files with `npx lean-browser-use --with-reader`. Docker is a separate user-provided capability. From a repository checkout:

```sh
bash searxng/deploy.sh
searxng/searx 'browser automation documentation'
```

The default endpoint is `http://127.0.0.1:8888`. `SEARXNG_URL` selects another instance. The compose configuration binds to loopback; expose it to a private network only as a deliberate deployment choice. The deployment script keeps its generated secret in `${XDG_CONFIG_HOME:-$HOME/.config}/lean-browser-use/searxng-secret.env` with restricted permissions. Keep that file out of briefs and reports.

Search finds candidate URLs. A search snippet is a discovery aid; read the selected page and save the requested fields as evidence. Batch independent public reads within a helper session or a subagent-runner session. See the [helper packet](../briefs/helper-read.md).

This repository ships configuration and a container reference. SearXNG itself is AGPL-3.0 and is not bundled here. See [the companion guide](../searxng/README.md) and [credits](../CREDITS.md).
