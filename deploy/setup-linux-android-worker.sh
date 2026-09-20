#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "setup-linux-android-worker.sh requires Linux." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js >=22 is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }
command -v adb >/dev/null || { echo "Android platform-tools / adb is required." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd user services are required." >&2; exit 1; }

if [[ ! -f .env ]]; then
  cp .env.linux-android-worker.example .env
  chmod 600 .env
  echo "Created .env. Configure MiniPC URLs/tokens/database, then rerun." >&2
  exit 2
fi

set -a
source .env
set +a

require_configured() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" || "$value" == *replace-* || "$value" == *CHANGE_ME* ]]; then
    echo "$name must be configured with a real value in .env" >&2
    exit 1
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local header="${3:-}"
  local attempt
  for attempt in $(seq 1 30); do
    if [[ -n "$header" ]]; then
      curl -fsS -H "$header" "$url" >/dev/null 2>&1 && return 0
    else
      curl -fsS "$url" >/dev/null 2>&1 && return 0
    fi
    sleep 0.5
  done
  echo "$name did not become ready at $url" >&2
  exit 1
}

[[ "${PHONE_FARM_ROLE:-}" == "device-worker" ]] || { echo "PHONE_FARM_ROLE=device-worker is required." >&2; exit 1; }
require_configured PHONE_FARM_DEVICE_WORKER_TOKEN "${PHONE_FARM_DEVICE_WORKER_TOKEN:-}"
require_configured PHONE_FARM_INTERNAL_TOKEN "${PHONE_FARM_INTERNAL_TOKEN:-}"
require_configured PHONE_FARM_CONTROL_PLANE_URL "${PHONE_FARM_CONTROL_PLANE_URL:-}"
require_configured DATABASE_URL "${DATABASE_URL:-}"

npm ci --ignore-scripts
npm rebuild node-native-ocr esbuild sharp --foreground-scripts
[[ -d .appium-runtime/node_modules/appium-uiautomator2-driver ]] || npm run appium:runtime:install-android
npm run doctor:device-worker

node_bin="$(command -v node)"
repo="$(pwd)"
port="${APPIUM_RUNTIME_PORT:-4726}"
mkdir -p "$HOME/.config/systemd/user"

cat > "$HOME/.config/systemd/user/dfarming-appium-runtime.service" <<EOF
[Unit]
Description=dFarming Appium runtime
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo
Environment=APPIUM_HOME=$repo/.appium-runtime
ExecStart=$node_bin --env-file-if-exists=.env node_modules/appium-runtime/index.js --address 127.0.0.1 --base-path / --port $port --log-level info
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

cat > "$HOME/.config/systemd/user/dfarming-worker.service" <<EOF
[Unit]
Description=dFarming scheduler execution worker
After=network-online.target dfarming-appium-runtime.service
Requires=dfarming-appium-runtime.service

[Service]
Type=simple
WorkingDirectory=$repo
ExecStart=$node_bin --env-file-if-exists=.env --env-file-if-exists=.env.devices --import tsx src/scheduler/worker.ts
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

cat > "$HOME/.config/systemd/user/dfarming-device-worker.service" <<EOF
[Unit]
Description=dFarming authenticated device gateway
After=network-online.target dfarming-appium-runtime.service
Requires=dfarming-appium-runtime.service

[Service]
Type=simple
WorkingDirectory=$repo
ExecStart=$node_bin --env-file-if-exists=.env --env-file-if-exists=.env.devices --import tsx src/device-worker-server.ts
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now dfarming-appium-runtime.service dfarming-worker.service dfarming-device-worker.service

for unit in dfarming-appium-runtime.service dfarming-worker.service dfarming-device-worker.service; do
  systemctl --user --no-pager --full status "$unit" >/dev/null
done

wait_for_http "Appium runtime" "http://127.0.0.1:${APPIUM_RUNTIME_PORT:-4726}/status"
wait_for_http "Device worker" "http://127.0.0.1:${DEVICE_WORKER_PORT:-3010}/health" \
  "Authorization: Bearer $PHONE_FARM_DEVICE_WORKER_TOKEN"
curl -fsS -H "Authorization: Bearer $PHONE_FARM_DEVICE_WORKER_TOKEN" \
  "http://127.0.0.1:${DEVICE_WORKER_PORT:-3010}/health"
echo
echo "Linux Android worker is installed and locally healthy."
