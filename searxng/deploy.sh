#!/usr/bin/env bash
# Usage: bash searxng/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

SECRET_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/lean-browser-use/searxng-secret.env"
mkdir -p "$(dirname "$SECRET_FILE")"
chmod 700 "$(dirname "$SECRET_FILE")"
if [ ! -f "$SECRET_FILE" ]; then
  # A cookie-signing key only this container reads; generated here, never printed.
  (umask 077; set -C; printf 'SEARXNG_SECRET=%s\n' "$(openssl rand -hex 32)" > "$SECRET_FILE") || [ -f "$SECRET_FILE" ]
fi
chmod 600 "$SECRET_FILE"

for _ in $(seq 1 30); do
  [ -s "$SECRET_FILE" ] && break
  sleep 0.1
done
if [ ! -s "$SECRET_FILE" ]; then
  echo "searxng: secret file is empty" >&2
  exit 1
fi

set -a; . "$SECRET_FILE"; set +a
docker compose pull --quiet
docker compose up -d

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:8888/healthz"; then
    echo "searxng: healthy"
    exit 0
  fi
  sleep 2
done
echo "searxng: not healthy after 60s; see: docker compose -f $PWD/compose.yml logs core" >&2
exit 1
