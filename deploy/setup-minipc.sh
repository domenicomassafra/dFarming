#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "setup-minipc.sh is for the Linux control-plane host." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null

if [[ ! -f .env.minipc ]]; then
  cp .env.minipc.example .env.minipc
  password="$(openssl rand -hex 24)"
  worker_token="$(openssl rand -hex 32)"
  internal_token="$(openssl rand -hex 32)"
  stream_secret="$(openssl rand -hex 32)"
  sed -i \
    -e "s/replace-with-a-long-random-password/${password}/" \
    -e "s/replace-with-a-long-random-token/${worker_token}/" \
    -e "s/replace-with-a-different-long-random-token/${internal_token}/" \
    -e "s/replace-with-at-least-32-random-bytes/${stream_secret}/" \
    -e "s/^DFARMING_UID=.*/DFARMING_UID=$(id -u)/" \
    -e "s/^DFARMING_GID=.*/DFARMING_GID=$(id -g)/" \
    .env.minipc
  chmod 600 .env.minipc
  if command -v tailscale >/dev/null 2>&1; then
    tailscale_ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    if [[ -n "$tailscale_ip" ]]; then
      sed -i -e "s/^POSTGRES_LISTEN_ADDRESSES=.*/POSTGRES_LISTEN_ADDRESSES=127.0.0.1,${tailscale_ip}/" .env.minipc
    fi
  fi
  echo "Created .env.minipc with private runtime secrets. Review DFARMING_DEVICE_WORKERS before adding more Mac workers."
fi

set -a
source .env.minipc
set +a
source deploy/env-compat.sh
dfarming_import_legacy_env

# Compose treats the database volume as an explicit external resource so a
# repository/project rename cannot silently allocate a fresh empty database.
postgres_volume="${DFARMING_POSTGRES_VOLUME:-dfarming-postgres}"
if ! docker volume inspect "$postgres_volume" >/dev/null 2>&1; then
  docker volume create "$postgres_volume" >/dev/null
  echo "Created PostgreSQL volume: $postgres_volume"
fi

mkdir -p .runtime/minipc
chmod 700 .runtime/minipc

# Record the exact source revision that is about to be deployed. The health
# endpoint reads this file from the persistent /data volume so operators can
# prove which main SHA is actually live instead of inferring it from checkout
# state or image age.
release_sha="$(git rev-parse HEAD)"
release_subject="$(git log -1 --format=%s | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g')"
release_time="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf '{"sha":"%s","subject":"%s","deployedAt":"%s"}\n' \
  "$release_sha" "$release_subject" "$release_time" > .runtime/minipc/RELEASED
chmod 600 .runtime/minipc/RELEASED

docker compose --env-file .env.minipc -f docker-compose.production.yml up -d --build
docker compose --env-file .env.minipc -f docker-compose.production.yml ps

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT:-4050}/health"; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "Control plane did not become healthy." >&2
  docker compose --env-file .env.minipc -f docker-compose.production.yml logs --tail=120 control-plane >&2 || true
  exit 1
fi
echo

# Run the role-aware doctor in the same production image/environment that is
# actually serving traffic. The host checkout intentionally does not need a
# development node_modules tree.
docker compose --env-file .env.minipc -f docker-compose.production.yml \
  exec -T control-plane npm run doctor:control-plane

if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg --yes --https="${DFARMING_TAILSCALE_HTTPS_PORT:-18443}" "${WEB_PORT:-4050}"
  echo "Tailscale Serve status:"
  tailscale serve status || true
else
  echo "Tailscale is unavailable; use an SSH tunnel to reach the loopback-only dashboard."
fi
echo "MiniPC control plane is up. The dashboard process itself remains loopback-only."
