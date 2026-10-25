# Links-only search

SearXNG finds public URLs when the reading job starts without known links. The `searx` command prints titles, URLs and source engines. Pass those URLs to the reader or a batched reading job. Running your own instance avoids a paid search API.

## Run the instance

Install Docker yourself, then run:

```sh
bash searxng/deploy.sh
searxng/searx 'public documentation'
searxng/searx 'public documentation' --json
```

The container binds to `127.0.0.1:8888`. `SEARXNG_URL` selects another instance. The deployment script creates a private signing-secret file at `${XDG_CONFIG_HOME:-$HOME/.config}/lean-browser-use/searxng-secret.env`, pulls the pinned container, starts it and checks its health. It requires Docker Compose, OpenSSL and curl. The secret is never printed.

`--engines`, `--categories`, `--time`, `--lang`, `--page`, `--max-results` and `--timeout` narrow a query. The Python command uses the standard library. The container configuration keeps the limiter off for a private instance; add access controls before exposing it on a private network.

## Check the command

```sh
python3 -m unittest discover -s searxng -p 'test_*.py'
```

Mocked responses work offline. Loopback server checks skip when the sandbox blocks local sockets.

## Licence

[SearXNG](https://github.com/searxng/searxng) is AGPL-3.0. This repository ships configuration and a container reference only; it does not bundle SearXNG code. The command and configuration in this repository use the repository's MIT licence.
