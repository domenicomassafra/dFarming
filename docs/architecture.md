# Architecture — what does what

Mobile Farm is one Linux MiniPC control plane plus a heterogeneous set of
execution-host runtimes over one PostgreSQL database and a few worker-local state files. There is no
client framework: the dashboard is server-rendered HTML with HTMX. Physical
iPhones keep their specialized WDA video/control path, while iOS Simulators use
generic Appium/XCUITest control. Both lanes now use the same pinned Appium 3 /
XCUITest runtime; the physical lane retains a compatibility Appium listener on
`:4725` only because existing social recipes use that port. Both are exposed to
the MiniPC through the authenticated device-worker gateway.

The canonical topology is deliberately **hybrid, not fixed**. A deployment may mix:

- iOS Simulators on macOS workers;
- Android Emulators on Linux or macOS workers that actually have both ADB and
  the Android Emulator installed;
- physical iPhones on macOS workers with Xcode/WDA signing available;
- physical Android devices on any worker with ADB.

The MiniPC may therefore be both control-plane host and Android execution host,
but Linux is never treated as an iOS Simulator/WDA host. Device pools may span
workers and physical/virtual kinds, with soft kind preferences used after load
so an operator can prefer real hardware or virtual capacity without pinning an
automation to one machine forever.

Footprint policy: reuse an already installed runtime before adding another copy
of the same heavy SDK/system image to a second host. Capability discovery reports
only what a host can execute now; an installed ADB binary alone must not advertise
Android Emulator capacity. Heavy Android SDK/emulator images are installed on the
MiniPC only when that capacity is actually wanted; the existing KVM-capable host
is suitable, but the control plane itself does not require those gigabytes.

```
 browser / Hermes / MCP
          │
          ▼
┌───────────────────────────────┐
│ MiniPC control plane          │
│ Fastify + HTMX + scheduler    │
│ PostgreSQL / pg-boss          │
└──────────┬────────────────────┘
           │ authenticated worker HTTP + shared PostgreSQL
           ▼
┌───────────────────────────────┐
│ execution worker(s)           │
│ macOS and/or Linux            │
│ device gateway + job worker   │
├───────────────────────────────┤
│ Appium 3 + WDA/XCUITest      │──▶ iPhone / iOS Simulator (macOS)
│ Appium 3 + UiAutomator2      │──▶ Android physical / emulator
└───────────────────────────────┘
```

## Runtime ownership

### MiniPC `web` — `src/api/server.ts` → `startServer()` → `src/api/app.ts`
Fastify control plane, normally containerized on the MiniPC.

- Server‑rendered dashboard (`/`, `/devices/:udid`, `/tasks`, `/devices/register`).
- JSON API under `/api/*` (devices, registrations, schedules, executions,
  assets, remote control).
- Live device screen and input are proxied through the owning device worker;
  browser clients never need direct access to WDA/Appium ports.
- Loads plugins (`PHONE_FARM_PLUGINS`) and the auth provider
  (`PHONE_FARM_AUTH_PLUGIN`); mounts each plugin's **panels** on the device
  page and its **routes** under `/plugins/<pluginId>`.
- `assertSafeBind(host, authProvider)` refuses a non‑loopback bind with no
  auth provider.
- Owns the canonical registry view and scheduler runtime. In distributed mode,
  registration/runtime lifecycle requests are delegated to the selected worker.

### macOS `worker` — `src/scheduler/worker.ts` → `startWorker()`
Headless executor. It claims work from the MiniPC PostgreSQL instance and runs
it only for devices owned by that execution host.

- One pg-boss worker per **active** registered device. A device with `disabled: true` in `devices.json`
  is skipped here and by `wda-service` — the entry stays but nothing supervises
  it.
- Every 5 s, `materializeDue()` turns due schedules into `executions` rows and
  enqueues jobs; every 30 s it picks up newly registered devices.
- For each job: `executeAutomation()` (`src/scheduler/executor.ts`) resolves the
  device backend (WDA or generic Appium), waits for the required runtime, builds a `TaskExecutionContext`, and
  calls the task's `execute()`. Handles attempts, retry policy, stop requests,
  and the run‑window deadline.
- Must load the **same plugin versions** as `web`.

### macOS `device-worker` gateway — `src/device-worker-server.ts`

Authenticated transport boundary used by the MiniPC for host inventory,
runtime discovery/lifecycle, screenshots, accessibility, streaming, input and
device configuration. A disabled device or disabled physical-iOS lane is
rejected here as well as hidden from discovery.

### macOS `wda-service` — `src/devices/wda-service.ts`
Persistent WebDriverAgent supervisor, controlled over a Unix socket
(`.wda/wda-service.sock`).

- Keeps one WDA session alive per registered device, (re)launching
  `xcodebuild test-without-building` as needed and USB‑forwarding WDA
  (`8100`, `8101`, …) and MJPEG (`9100`, `9101`, …).
- `GET /health` on the socket reports per‑device `{ physical, wda, appium,
  message }`. States: `ready`, `unlock-required`, `error`, …
- Single‑supervisor by design; a lock prevents duplicates.

### macOS `appium` physical compatibility lane — `:4725`
This is an Appium 3 process using `APPIUM_HOME=.appium-runtime`. It exists to
preserve the existing physical-iPhone social-recipe port contract. The pinned
XCUITest 12.13.1 / WDA 16.12.9 source is extended by the reviewed
`appium-webdriveragent-16.12.9-dfarming.patch` for sessionless absolute touch,
Photos import and device buttons. `wda:patch` checks exact upstream versions
and the patch checksum before modifying the installed WDA source. The listener
is omitted when `PHONE_FARM_ENABLE_PHYSICAL_IOS=false`.

### macOS `appium-runtime` cross-platform lane — `:4726`
The second Appium 3 listener uses the same pinned `.appium-runtime` driver home
for iOS Simulator and Android. `AppiumRemoteControl`
provides screen info, screenshots, input, app lifecycle and a bounded
screenshot stream. Its XML page source is normalized into the same semantic
snapshot/ref model used by WDA, so Hermes/MCP do not need a second selector API.

Workers discover iOS Simulators through `xcrun simctl`; the dashboard can
attach those runtimes without hand-editing `devices.json`.

## Xcode, signing, and device pairing

The farm never talks to a device directly at the USB level for *control* — it
delegates the whole pair/trust/sign/launch chain to Xcode's toolchain:

- **Pairing & trust** are the OS's job. An iPhone must be paired (USB + "Trust
  This Computer") and, on iOS 16+, have **Developer Mode** enabled before any
  of this works. `xcrun xctrace list devices` / `discoverConnectedDevices()`
  (`appium-ios-device`, over `usbmuxd`) is how the app learns a device is
  attached; it does not initiate pairing.
- **The Developer Disk Image** for the device's iOS version is mounted by
  Xcode on first pair. `xcodebuild` needs it present to launch a test bundle.
- **Signing.** `src/devices/wda/prepare.ts` runs `xcodebuild build-for-testing`
  with `CODE_SIGN_STYLE=Automatic` and `DEVELOPMENT_TEAM=$XCODE_ORG_ID`. Xcode
  automatic signing creates/refreshes a development provisioning profile that
  lists the connected UDIDs and embeds it in `WebDriverAgentRunner-Runner.app`.
  This is why a new device must be plugged in (and the Apple ID have a free
  slot — the 100-UDID limit) when `wda:prepare` runs. Signing reads a
  certificate from the **login keychain**, which is only unlocked in a
  graphical session — hence the "run from Terminal.app, not SSH" rule.
- **Launch.** `wda-service` runs `xcodebuild test-without-building
  -destination id=<udid>` per active device: it installs the pre-signed
  `WebDriverAgentRunner` and starts it as a UI test. WDA then serves HTTP on
  the device's `:8100` and MJPEG on `:9100`, which `wda-service` USB-forwards
  to the host's `:81xx` / `:91xx`.

The **registration wizard** (`src/devices/registration.ts`) is a UI over this
chain: its `host` / `connection` / `signing` / `developer` / `wda` checks each
probe one link (Xcode selected, device visible over usbmux, a signing identity
present, the DDI mounted, WDA reachable) and surface a specific fix before the
device is written to `devices.json`. `wda:prepare` is the same signing step
without the UI, for scripted or bulk (`--all`) setup.

## Data & state

| Store | Contents |
| --- | --- |
| PostgreSQL `scheduler.*` | `schedules`, `executions`, `execution_attempts`, `execution_logs`, `assets`. Drizzle ORM; migrations in `drizzle/`. |
| PostgreSQL `pgboss.*` | Job queue (one partitioned queue per device). |
| PostgreSQL `drizzle.*` | Applied‑migration ledger. |
| `devices.json` | Registered devices: `udid`, `name`, `platform`, `kind`, `automationBackend`, owner `workerId`, optional WDA ports/coordinates/passcode and `pluginData`. Git-ignored, `0600`. |
| `.env` | Configuration and secrets (DB URL, signing IDs, auth keys). Git‑ignored. Device passcodes live in `devices.json`, not here. |
| `.scheduler-data/assets/` | Uploaded media for `post`‑style tasks, content‑addressed. |
| `.wda/` | wda-service socket and locks. |
| `.appium-runtime/` | Shared pinned Appium 3 driver home: XCUITest + UiAutomator2, with reviewed physical-WDA patch. |

## The task model

Every schedule and execution row carries a **task envelope**:

```
pluginId : string        e.g. "com.git-agni.tiktok" or "com.git-agni.instagram"
taskType : string        e.g. "doomscroll"
taskVersion : integer     e.g. 1
payload : jsonb          validated, version-specific shape
```

`PluginRegistry.task({pluginId, taskType, taskVersion})` resolves the envelope
to a `TaskDefinition`. Because the version is stored, **an old schedule can
never silently run a new contract** — if `taskVersion` 1 is no longer
installed, that schedule fails loudly instead of executing v2 logic.

### Portable semantic flows

`com.phone-farm.flow/flow@1` is the iOS automation contract. Coordinate tap/swipe remains available as a fallback, but the preferred steps use the common accessibility tree: `tapText`, `waitVisible`, `assertVisible`, `waitGone`, and `inputText`. WDA JSON and XCUITest XML are normalized into the same stable-ref snapshot model before those actions run. This keeps scheduler contracts independent of Appium/WDA and lets the same flow survive device-size changes when labels and accessibility roles remain stable.

Portable flows are also canonical library objects. `scheduler.flow_definitions` identifies a flow while `scheduler.flow_versions` stores immutable revisions; editing creates a new revision instead of mutating history. Mobile Farm JSON is the native lossless interchange format. A bounded Maestro YAML adapter supports the accessibility-oriented command subset that maps cleanly into this contract; unsupported/lossy steps fail export rather than silently changing behavior.

### Virtual runtime lifecycle

Execution workers expose both currently connected iPhones and known iOS Simulator definitions. macOS workers use `simctl` for Simulator definitions and lifecycle. The MiniPC proxies Boot/Stop to the owning worker rather than trying to run Apple SDK tooling inside the Linux control-plane container.

### Live fleet wall

`/fleet` is the real fleet view. It intentionally does not open a high-rate stream for every device: tiles refresh inexpensive still screenshots, while the selected tile alone requests the signed live-stream capability. This follows the lab UX pattern from Baguette/STF and keeps video transport separate from scheduler/control correctness. Operators can group by worker/platform/kind and multi-select devices for bounded operational actions (reconnect, enable/disable, clear queue/stop); public/send/touch actions are deliberately not exposed as bulk commands.

### Capability-aware allocation

The scheduler remains device-addressed, but the API may resolve a target immediately before schedule creation. The allocator filters the canonical device registry to connected/enabled devices matching optional platform, kind, worker, normalized tags and explicit-device bounds, then ranks current queued/running execution load and active schedules. By default only idle runtimes qualify. Named selectors can be persisted as `scheduler.device_pools`; `/api/schedules/allocate` resolves either a saved pool or ad-hoc selector and writes the selected UDID into the ordinary schedule, so later executions, logs and campaign evidence never depend on a floating pool name. Recurring schedules stay on that chosen device rather than silently roaming between hosts.

Automation Studio exposes the same model as **Specific device** vs **Any matching idle device**. Allocation filters can be saved/updated/deleted as named pools and can require operator-defined device tags. A preview endpoint shows the current first candidate before submission. The Semantic Inspector can inspect either that candidate or the selected concrete device and turn the normalized accessibility snapshot into authoring actions; inspection itself is read-only. Execution hosts are also first-class inventory: configured workers remain visible while offline, and online workers publish capabilities plus bounded load/RAM/CPU/uptime telemetry.

### Account execution profiles and named network routes

An account policy may optionally carry an explicit `executionProfile` with a
stable profile ID plus any combination of a dedicated device UDID, required
device tags and a named `networkRouteId`. The scheduler resolves that profile
after plugin validation and **before schedule persistence**, including plugin
routes and campaigns that call the repository directly. The resolved profile
ID and route ID are copied to both schedule and execution rows so receipts stay
auditable without embedding network secrets in task payloads.

Network routes are worker-local attestations. `PHONE_FARM_NETWORK_ROUTES`
contains only route IDs and optional device scope; the worker may be attached
to an operator-managed VPN/proxy/network namespace, but credentials/endpoints
are never returned by `/v1/host` or stored by the MiniPC. If a selected worker
does not attest the route required by the account profile, schedule creation
fails closed. The execution worker re-checks the same route attestation before
touching the device, so a route removed after scheduling causes an explicit
execution failure rather than silent fallback to another egress path. This
feature is for privacy, testing and operational segmentation; it does not
rotate/fallback routes to evade provider enforcement.

`com.phone-farm.flow/flow@1` is the generic iOS automation contract. Its payload
is an ordered list of portable actions (app launch/terminate, wait, tap, swipe,
type, system buttons and screenshot), authored in Automation Studio and queued
through the exact same scheduler/evidence path as plugin-specific tasks.

## Scheduling

`ScheduleTiming` (`src/types.ts`):

| kind | fields |
| --- | --- |
| `now` | — |
| `once` | `runAt` (ISO) |
| `daily` | `localTime` `"HH:MM"`, `timezone` (IANA) |
| `weekly` | `localTime`, `timezone`, `weekdays` (0–6) |
| `interval` | `everyMinutes`, optional `startOffsetMinutes` |

`run_window_minutes` (default 30) is the grace period after the scheduled time;
past it, the execution is abandoned as "window expired". Recurrence is computed
in `src/scheduler/recurrence.ts`; the next occurrence is written to
`schedules.next_run_at`.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/api/` | Fastify app factory, controllers, middleware, HTTP routes |
| `src/allocation.ts` | capability/load-aware device ranking used before materializing ordinary schedules |
| `src/scheduler/` | runtime, repository, pg-boss queue, recurrence, worker, executor |
| `src/database/` | Drizzle client, schema, migrate/setup entrypoints |
| `src/devices/` | physical-iPhone/iOS-Simulator discovery, registry (`devices.json`), WDA/Appium remotes, registration flow, wda-service, coordinate profiles, passcode lookup |
| `src/flows/` | flow interchange/compatibility adapters (currently bounded Maestro YAML) |
| `src/hosts/` | execution-host capability detection (`simctl`, Appium, WDA) |
| `src/semantic/` | normalized WDA/Appium accessibility snapshots, stable refs and semantic actions |
| `src/flow-plugin.ts` | built-in portable iOS flow task |
| `src/devices/wda/` | `prepare.ts` (patch + build + sign WDA), `start.ts` (single-device WDA supervisor), `target-device.ts` (resolve which device a CLI command targets), diagnostics |
| `src/tiktok/` | TikTok automation entrypoints (`doomscroll.ts`, `post.ts`), OCR, coordinates |
| `src/tiktok-plugin.ts` | Built‑in TikTok plugin: task definitions, device panel, routes |
| `src/instagram/` | Instagram automation entrypoints (`doomscroll.ts`, `post.ts`), OCR, coordinates |
| `src/instagram-plugin.ts` | Built‑in Instagram plugin: task definitions, device panel, routes |
| `src/plugin.ts` | **Stable plugin & auth interfaces** |
| `src/registry.ts` | `PluginRegistry` — task resolution and validation |
| `src/loader.ts` | Dynamic import of `PHONE_FARM_PLUGINS` / `PHONE_FARM_AUTH_PLUGIN` |
| `src/example-plugin.ts` | Minimal reference plugin |
| `static/dashboard/` | HTML templates, browser TS (`tsconfig.web.json` → `static/dashboard/assets/*.js`) |
| `Patches/` | WDA source patches applied by `wda:prepare` |
| `drizzle/` | SQL migrations + journal |
