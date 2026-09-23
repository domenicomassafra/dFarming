# Getting started

dFarming uses one Linux MiniPC control plane plus one or more execution
workers. The MiniPC owns the dashboard/API, PostgreSQL, schedules and canonical
fleet state. macOS workers own Apple-specific transport for physical iPhones
and iOS Simulators; Linux or macOS workers with Android platform-tools can own
physical Android and Android Emulator runtimes. Every lane passes through the
same scheduler and evidence path.

## Requirements

| Requirement | Notes |
| --- | --- |
| Linux MiniPC + Docker | Production control-plane authority. `deploy/setup-minipc.sh` installs the Compose stack and PostgreSQL. |
| macOS + full Xcode | Required on workers that expose iOS runtimes. `xcode-select -p` must point at an Xcode install, not Command Line Tools. |
| Android platform-tools | Required on workers that expose physical Android or Android Emulator runtimes. |
| Node.js 22+ | Required for source validation and device-worker processes. |
| iOS Simulator | Optional execution lane through the isolated Appium/XCUITest runtime. |
| Physical iPhone + Apple Developer team | Optional physical lane. Required only when `PHONE_FARM_ENABLE_PHYSICAL_IOS=true`. |
| Android Emulator / AVD | Optional virtual Android lane. Linux hosts should have hardware virtualization enabled. |

## 1. Prepare a macOS execution worker

Install and select full Xcode on every Mac that will expose iOS runtimes. A
simulator-only worker can stop after Xcode/Appium setup. For a physical iPhone,
Xcode must also be able to **see and sign for** the device:

1. **Install the full Xcode** from the App Store (not just the Command Line
   Tools), open it once, and accept the licence:
   ```sh
   sudo xcodebuild -license accept
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -runFirstLaunch
   ```
   `xcode-select -p` must now print `…/Xcode.app/Contents/Developer`.

2. **Physical lane only:** add the signing account in Xcode → Settings →
   Accounts, select the intended team, and record its Team ID as
   `XCODE_ORG_ID`.

3. **Pair the iPhone.** Connect it by USB, unlock it, tap **Trust This
   Computer**, enter the passcode. In Xcode → Window → **Devices and
   Simulators**, the device should appear and, after a minute, read
   **"Connected"** (not "Preparing" or "Unavailable") — Xcode is downloading
   the matching Developer Disk Image in the background.

4. **Enable Developer Mode** (iOS 16+): on the phone, Settings → Privacy &
   Security → **Developer Mode** → on → restart → confirm. If the toggle
   isn't there yet, it appears after the first pair with Xcode.

5. **Login keychain** — `wda:prepare` signs with a certificate in
   your login keychain, which is only unlocked in a graphical session. Run it
   from Terminal.app / a remote desktop, not a bare SSH shell.

For the physical lane, verify the phone is visible to the toolchain:

```sh
xcrun xctrace list devices      # your iPhone must be under "Devices", not "Devices Offline"
```

## 2. Install the canonical checkout

```sh
git clone <this-repo> dFarming
cd dFarming
npm ci
npm run check
```

Use the same released `main` revision on the MiniPC and every execution worker.
The MiniPC is the only control plane; a Mac worker must never start a competing
dashboard/database authority.

## 3. Configure and deploy the MiniPC

```sh
cp .env.minipc.example .env.minipc
# edit passwords, worker URLs and shared tokens
./deploy/setup-minipc.sh
```

The production deployment owns PostgreSQL and the web/API service. Useful
verification after setup:

```sh
docker compose --env-file .env.minipc -f docker-compose.production.yml ps
docker compose --env-file .env.minipc -f docker-compose.production.yml exec -T control-plane npm run doctor:control-plane
```

See [distributed MiniPC deployment](deployment/distributed-minipc.md) for the
private-network/Tailscale layout and current production ports.

## 4. Configure each macOS worker

```sh
cp .env.device-worker.example .env
# point DATABASE_URL and PHONE_FARM_CONTROL_PLANE_URL at the MiniPC
# copy PHONE_FARM_DEVICE_WORKER_TOKEN and PHONE_FARM_INTERNAL_TOKEN from MiniPC config
./deploy/setup-device-worker.sh
```

Set `PHONE_FARM_ENABLE_PHYSICAL_IOS=false` for a simulator-only worker. That
setting suppresses physical-iPhone discovery, WDA/legacy-Appium launch agents,
and direct physical-device control while keeping the Appium Simulator lane.

The worker setup installs the required Appium runtimes, runs
`doctor:device-worker`, installs the selected launchd services, and fails
closed unless the gateway and Appium runtime pass local health checks. Database
migrations remain a MiniPC/control-plane responsibility. Inspect the final
launchd state with `npm run service -- status`.

Keep execution-host disk use bounded with `npm run runtime:storage`. The report
covers Appium, Simulator/AVD data and WebDriverAgent DerivedData and compares the
combined footprint with `PHONE_FARM_RUNTIME_DISK_BUDGET_GB` (20 GiB by default).
Use `npm run runtime:storage:cleanup` for conservative reclamation: it removes
only unavailable iOS Simulators and rebuildable stale caches, skips running
Android AVDs, and preserves device registration, userdata and USB trust state.

## 4b. Configure a Linux Android worker

```sh
cp .env.linux-android-worker.example .env
# point DATABASE_URL and PHONE_FARM_CONTROL_PLANE_URL at the MiniPC
# copy the shared worker/internal tokens
./deploy/setup-linux-android-worker.sh
```

The Linux installer prepares UiAutomator2 and installs three systemd-user
services: Appium runtime, scheduler execution worker and authenticated device
gateway. It does not install a web server or a second PostgreSQL/control plane.

## 5. Prepare WebDriverAgent (physical lane only)

```sh
npm run wda:prepare                 # the connected / sole registered device
npm run wda:prepare -- --udid <udid> # a specific device
npm run wda:prepare -- --all        # every device in devices.json
```

This verifies/applies the reviewed modern Appium-bundled
`appium-webdriveragent` patch, then runs
`xcodebuild build-for-testing` signed with your team, once per target device.
It ends with `** TEST BUILD SUCCEEDED **`.

> **Run this from a graphical login session** (Terminal.app, or a remote
> desktop), not a bare SSH shell. Code signing needs the login keychain
> unlocked; over SSH it fails with `errSecInternalComponent`. If you must run
> it over SSH: `security unlock-keychain ~/Library/Keychains/login.keychain-db`
> and `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <pw>
> ~/Library/Keychains/login.keychain-db` first.

## 6. Open the control plane

Open the MiniPC dashboard through its configured private/Tailscale endpoint.
The browser never needs direct access to Appium or WDA ports on the Mac. Go to
**Add device** to attach a booted Simulator or start the guided physical-iPhone
registration flow. Unlock the phone when WDA first launches.

## 7. Schedule something

From a device page you can run the built‑in TikTok and Instagram tasks
(`doomscroll`, `post`) now or on a `daily`/`weekly`/`once` schedule. Watch
progress in **Activity**; full logs are under `GET /api/executions/:id`.

## Authentication

On a loopback bind (`WEB_HOST=127.0.0.1`) auth is optional. Before binding to
anything else, set `PHONE_FARM_AUTH_PLUGIN` to an ESM module exporting an
`AuthProvider`; startup **deliberately fails** otherwise (`assertSafeBind`).
Write the provider against the `AuthProvider` interface in `src/plugin.ts` —
it hands you the Fastify instance to register login routes on, an
`authenticate(request)` hook, and `isPublicPath()` for the unauthenticated
allow‑list.

## Devices and secrets

Registered devices live in `devices.json` (git‑ignored):

```json
[
  {
    "name": "Phone A",
    "udid": "00008030-000000000000000E",
    "wdaLocalPort": 8100,
    "mjpegLocalPort": 9100,
    "coordinateProfile": "iphone8",
    "passcode": "123456",
    "pluginData": {
      "com.git-agni.tiktok": { "accounts": ["@handle"] },
      "com.git-agni.instagram": { "accounts": ["@handle"] }
    }
  }
]
```

- `coordinateProfile` selects a compiled tap layout — see
  [coordinates.md](coordinates.md).
- `pluginData[<pluginId>]` is per‑device plugin config (never secrets).
- `disabled: true` keeps the entry but stops the farm supervising it — no
  WebDriverAgent, no scheduler worker, no discovery polling. Toggle it from the
  dashboard ("Disconnect" on a device card, "Reconnect" under **Disconnected
  devices**) or with `PATCH /api/devices/:udid` (`{"disabled":true}` /
  `{"disabled":false}`). Scheduling is rejected while a device is disabled.
- `passcode` is the device unlock code, used to wake a locked phone before
  automation. It lives here because `devices.json` is git‑ignored and written
  `0600`. It is **never** returned by the API — `GET /api/devices` reports
  `hasPasscode: true/false` instead. Set it in the registration wizard, with
  `PATCH /api/devices/:udid` (`{"passcode":"…"}`, `""` clears it), or by editing
  the file. `IOS_PASSCODE` / `IOS_PASSCODE_<UDID>` in the environment still work
  as a deprecated fallback.

## Health & troubleshooting

| Symptom | Check |
| --- | --- |
| `wda: error … stale or corrupted` | Re‑run `npm run wda:prepare`; delete `~/Library/Developer/Xcode/DerivedData/WebDriverAgent-*` if it keeps producing an empty `.app`. |
| `wda: unlock-required` | Physically unlock the iPhone once. |
| physical device is missing from a worker | Check `PHONE_FARM_ENABLE_PHYSICAL_IOS`, `npm run doctor:device-worker`, USB trust and Xcode signing. |
| Simulator is missing | Check `npm run doctor:device-worker`, `xcrun simctl list devices available`, and the `appium-runtime` launchd service. |
| worker is shown offline on MiniPC | Verify the private worker URL/token and `npm run service -- status` on the Mac. |
| web returns 401 everywhere | An auth provider is configured — sign in, or unset `PHONE_FARM_AUTH_PLUGIN` on loopback. |
| physical Appium listener is unavailable | Run `npm ci`, `npm run appium:runtime:install-ios`, `npm run wda:patch`, then `npm run service -- install`; both iOS listeners use Appium 3 and `.appium-runtime`. |

`GET /health` on the MiniPC lists the loaded plugins and versions. Physical
workers also expose per-device WDA state through their local supervisor; do not
publish WDA/Appium ports outside the execution host.
