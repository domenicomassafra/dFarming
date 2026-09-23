#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup-device-worker.sh must run on the macOS host physically attached to the iPhones." >&2
  exit 1
fi

if ! xcode-select -p 2>/dev/null | grep -q '/Xcode.app/Contents/Developer$'; then
  echo "Full Xcode must be installed and selected before this host can become a device worker." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.device-worker.example .env
  chmod 600 .env
  echo "Created .env from .env.device-worker.example. Configure MiniPC DATABASE_URL/URL/tokens, then rerun." >&2
  exit 2
fi

set -a
source .env
set +a
source deploy/env-compat.sh
dfarming_import_legacy_env

require_configured() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" || "$value" == *replace-* || "$value" == *CHANGE_ME* ]]; then
    echo "$name must be configured with a real value in .env" >&2
    exit 1
  fi
}

require_launchd_running() {
  local label="$1"
  local detail
  if ! detail="$(launchctl print "gui/$(id -u)/$label" 2>/dev/null)"; then
    echo "$label is not loaded after installation" >&2
    exit 1
  fi
  if ! grep -q 'state = running' <<<"$detail" || grep -q 'execs = 0' <<<"$detail"; then
    echo "$label did not reach an executing launchd state" >&2
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

[[ "${DFARMING_ROLE:-}" == "device-worker" ]] || { echo "DFARMING_ROLE=device-worker is required in .env" >&2; exit 1; }
require_configured DFARMING_DEVICE_WORKER_TOKEN "${DFARMING_DEVICE_WORKER_TOKEN:-}"
require_configured DFARMING_INTERNAL_TOKEN "${DFARMING_INTERNAL_TOKEN:-}"
require_configured DFARMING_CONTROL_PLANE_URL "${DFARMING_CONTROL_PLANE_URL:-}"
require_configured DATABASE_URL "${DATABASE_URL:-}"

# Signing is required only when a physical iPhone is currently attached. A Mac
# can be a useful simulator execution worker without an Apple Development team,
# and the doctor reports physical-device readiness separately from worker
# runtime readiness.
physical_ios_enabled="${DFARMING_ENABLE_PHYSICAL_IOS:-true}"
physical_devices="$(xcrun xctrace list devices 2>/dev/null \
  | sed -n '/== Devices ==/,/== Simulators ==/p' \
  | sed '1d;$d' \
  | grep -Ev '^[[:space:]]*$|MacBook|Mac mini|Mac Studio|Mac Pro|Mac \(' || true)"
if [[ "$physical_ios_enabled" == "false" ]]; then
  echo "Physical iPhone lane disabled; installing a simulator-capable worker only."
elif [[ -n "$physical_devices" ]]; then
  require_configured XCODE_ORG_ID "${XCODE_ORG_ID:-}"
  if [[ "${WDA_BUNDLE_ID:-}" == "com.example.WebDriverAgentRunner" || -z "${WDA_BUNDLE_ID:-}" ]]; then
    echo "WDA_BUNDLE_ID must be changed from the example value before physical-iPhone installation" >&2
    exit 1
  fi
else
  echo "No physical iPhone detected; installing a simulator-capable worker. Configure XCODE_ORG_ID/WDA_BUNDLE_ID before adding a physical iPhone."
fi

npm ci --ignore-scripts
npm rebuild node-native-ocr esbuild sharp --foreground-scripts
[[ -d .appium-runtime/node_modules/appium-xcuitest-driver ]] || npm run appium:runtime:install-ios
[[ -d .appium-runtime/node_modules/appium-uiautomator2-driver ]] || npm run appium:runtime:install-android
npm run appium:runtime:sync
npm run wda:patch
npm run doctor:device-worker
npm run service -- install
require_launchd_running com.dfarming.appium-runtime
require_launchd_running com.dfarming.worker
require_launchd_running com.dfarming.device-worker
wait_for_http "Device worker" "http://127.0.0.1:${DEVICE_WORKER_PORT:-3010}/health" "Authorization: Bearer $DFARMING_DEVICE_WORKER_TOKEN"
wait_for_http "Appium runtime" "http://127.0.0.1:${APPIUM_RUNTIME_PORT:-4726}/status"
npm run service -- status

echo "Mac device worker installed and locally healthy. The MiniPC should reference ${DFARMING_WORKER_ID:-mac-worker}=http://<this-mac-private-address>:${DEVICE_WORKER_PORT:-3010}."
