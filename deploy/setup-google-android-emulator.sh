#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Google Android Emulator containers require Linux/KVM." >&2
  exit 1
fi

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v adb >/dev/null || { echo "adb is required." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd user services are required." >&2; exit 1; }
[[ -r /dev/kvm && -w /dev/kvm ]] || { echo "/dev/kvm must be readable and writable." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker must be usable without sudo by this user." >&2; exit 1; }

image="${DFARMING_ANDROID_EMULATOR_IMAGE:-us-docker.pkg.dev/android-emulator-268719/images/30-google-x64-no-metrics@sha256:e78ac1816acef59e40285e90003acd490ef54bb3242ed088afa31bc982577050}"
name="${DFARMING_ANDROID_EMULATOR_NAME:-dfarming-android-emulator-api30}"
adb_port="${DFARMING_ANDROID_EMULATOR_ADB_PORT:-5555}"
grpc_port="${DFARMING_ANDROID_EMULATOR_GRPC_PORT:-8554}"
adb_key="${DFARMING_ANDROID_EMULATOR_ADB_KEY:-$HOME/.android/adbkey}"

[[ -f "$adb_key" ]] || {
  mkdir -p "$(dirname "$adb_key")"
  adb keygen "$adb_key" >/dev/null
}
chmod 600 "$adb_key"

docker pull "$image"
docker rm -f "$name" >/dev/null 2>&1 || true
docker_args=(
  -d
  --name "$name"
  --restart unless-stopped
  --label com.dfarming.runtime=android-emulator
  -e "ADBKEY=$(cat "$adb_key")"
  --device /dev/kvm
  -p "127.0.0.1:${grpc_port}:8554/tcp"
  -p "127.0.0.1:${adb_port}:5555/tcp"
)
docker run "${docker_args[@]}" "$image" >/dev/null

mkdir -p "$HOME/.config/systemd/user"
adb_bin="$(command -v adb)"
cat > "$HOME/.config/systemd/user/dfarming-android-emulator-connect.service" <<EOF
[Unit]
Description=dFarming Android emulator ADB reconnect
After=network-online.target

[Service]
Type=oneshot
ExecStart=$adb_bin connect 127.0.0.1:${adb_port}
EOF

cat > "$HOME/.config/systemd/user/dfarming-android-emulator-connect.timer" <<EOF
[Unit]
Description=Keep the dFarming Android emulator visible to host ADB

[Timer]
OnBootSec=15s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=dfarming-android-emulator-connect.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now dfarming-android-emulator-connect.timer
systemctl --user start dfarming-android-emulator-connect.service

for _ in $(seq 1 60); do
  state="$(adb -s "127.0.0.1:${adb_port}" get-state 2>/dev/null || true)"
  boot="$(adb -s "127.0.0.1:${adb_port}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [[ "$state" == "device" && "$boot" == "1" ]]; then
    echo "Google Android Emulator is booted at 127.0.0.1:${adb_port}."
    exit 0
  fi
  sleep 2
done

echo "Android emulator container started but did not finish booting." >&2
docker logs --tail 80 "$name" >&2 || true
exit 1
