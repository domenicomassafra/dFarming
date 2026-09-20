# dFarming

dFarming is the canonical cross-platform mobile-device farm for owner-managed
real and virtual iOS and Android devices. The Linux MiniPC is the always-on
control-plane authority; execution hosts expose device transports through a
narrow authenticated worker API.

## Runtime authority

- Canonical repository: `domenicomassafra/dFarming`, branch `main`.
- Canonical development checkout: `~/Code/dFarming`.
- Production control plane: MiniPC / Linux / Docker Compose.
- PostgreSQL + pg-boss on the MiniPC own schedules, execution history, pools,
  flow revisions and the canonical fleet view.
- Device workers never become a second scheduler or database authority.
- `Kevs-IOS-Agents` is retained only as iOS lineage/history.

## Runtime matrix

| Runtime | Transport | Execution host |
| --- | --- | --- |
| Physical iPhone/iPad | WDA + Apple device tooling | macOS |
| iOS Simulator | Appium 3 + XCUITest | macOS |
| Physical Android | ADB + Appium 3 + UiAutomator2 | Linux/macOS/Windows-capable worker |
| Android Emulator | Android Emulator/AVD + ADB + UiAutomator2 | Linux/macOS worker with the Android SDK |

Android can additionally expose an opt-in scrcpy raw-H.264 video transport.
Control remains Appium/UiAutomator2; video is not allowed to become a second
input/control authority.

## Product capabilities

- Fleet registry with host, platform, runtime kind, health, tags and reusable
  device pools.
- Capability-aware allocation that resolves every run to a concrete device.
- One serialized scheduler authority with normal queue, stop and evidence
  semantics for every runtime.
- Physical/virtual runtime discovery and virtual-runtime boot/shutdown.
- Live device wall with bounded streaming and one focused live stream.
- Portable versioned flows with semantic accessibility actions such as
  `tapText`, `waitVisible`, `assertVisible`, `waitGone` and
  `inputText`.
- Maestro JSON/YAML interoperability for the safe, lossless subset.
- Stable accessibility refs normalized from XCUITest and UiAutomator2 trees.
- Deterministic TikTok/Instagram recipes remain plugins rather than a second
  automation core.
- Thin Hermes/MCP clients consume the dFarming API; they do not own WDA,
  Appium, scheduling or device state.

## Donor-first architecture

dFarming does not copy whole upstream projects into its core. Mature projects
are kept as pinned forks and integrated through narrow adapters. See
`donors.lock.json` and `docs/donors.md`.

The current donor set covers Appium Device Farm, DeviceFarmer/STF, Facebook
IDB, pymobiledevice3, Google's Android emulator container scripts, scrcpy and
Maestro. GPL components such as pymobiledevice3 stay behind process/service
boundaries rather than being linked into the Apache-2.0 core.

## Account and network isolation

Accounts are explicitly bound to configured devices and policy. Different
identities should use separate device/app profiles and, where required for
privacy, testing or operational separation, separately configured network
routes. dFarming does not share browser cookies or provider sessions with
dCreator.

Network/proxy routing is an execution policy boundary, not a mechanism for
evading provider enforcement, bans, rate limits or other safeguards. Provider
and platform rules remain authoritative.

## dCreator integration boundary

dCreator may submit approved assets/jobs plus non-secret identity references
to dFarming and receive execution receipts/results. dFarming owns device
automation; dCreator owns creator/content workflows. The integration must not
merge cookie jars, login sessions, credentials, scheduler authority or device
registries.

## MiniPC production

The control plane is Dockerized. Existing deployments can pin the PostgreSQL
volume name with `DFARMING_POSTGRES_VOLUME` so a repository/path rename does
not create an empty database.

```bash
cp .env.minipc.example .env.minipc   # first install only
./deploy/setup-minipc.sh
docker compose --env-file .env.minipc -f docker-compose.production.yml ps
curl -fsS http://127.0.0.1:4050/health
docker compose --env-file .env.minipc -f docker-compose.production.yml \
  exec -T control-plane npm run doctor:control-plane
```

For an existing Kevs/Phone-Farm deployment, set
`DFARMING_POSTGRES_VOLUME=kevs-ios-agents_phone-farm-postgres` before the
cutover. Never delete or recreate that volume as generic cleanup.

## macOS iOS worker

```bash
cp .env.device-worker.example .env
./deploy/setup-device-worker.sh
npm run doctor:device-worker
```

Set `PHONE_FARM_ENABLE_PHYSICAL_IOS=false` for a simulator-only Mac. The
`PHONE_FARM_*` environment prefix remains a compatibility wire/config
namespace during the dFarming migration; it is not the product name.

## Linux Android worker

```bash
cp .env.linux-android-worker.example .env
./deploy/setup-linux-android-worker.sh
npm run doctor:device-worker
```

The Linux worker requires Android platform-tools/ADB and the Appium
UiAutomator2 runtime. Android Emulator support additionally requires an SDK
emulator/AVD and, on Linux, working hardware virtualization for useful
performance.

For the pinned Google container donor on a KVM-capable Linux worker:

```bash
./deploy/setup-google-android-emulator.sh
```

The default image is the official no-metrics API-30 image pinned in
`donors.lock.json`. The installer keeps the container restartable and uses a
small systemd timer to restore the host ADB connection after reboots/container
restarts.

## Development gates

```bash
npm ci
npm run check
npm run build:web
npm audit --omit=dev
git diff --check
```

Live acceptance is separate from unit tests: production claims require the
exact `main` SHA deployed on the MiniPC plus a healthy control plane and a
read-only/innocuous proof for each reachable device/runtime lane.

## Safety boundary

dFarming automates only owner-configured devices and accounts. It must not
discover credentials, bypass CAPTCHA/login/platform enforcement, create hidden
authorities, or silently route high-impact public actions around existing
policy/confirmation gates.
