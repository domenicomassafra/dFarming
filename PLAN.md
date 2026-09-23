# Plan — dFarming best-of-breed mobile control plane

## Architecture decision

Keep dFarming as the fleet and scheduler core, preserving the Kevs/Agni lineage only as provenance. Add a small account/policy control plane inside this TypeScript project. Keep semantic/LLM automation behind adapters instead of importing Ghost, Hermes, DSH or an MCP server wholesale.

Production topology is explicitly hybrid: the Linux MiniPC is the always-on authority for web/API, PostgreSQL/pg-boss metadata, policy, campaigns and canonical media, while any compatible machine may also be an execution host. macOS nodes can host physical iPhones, iOS Simulators and Android runtimes; Linux nodes, including the MiniPC itself, can host Android physical/emulated runtimes when ADB/Appium/Android Emulator are installed. Linux must never advertise iOS Simulator/WDA ownership. Device control is proxied through authenticated worker gateways while execution workers claim their device queues from the MiniPC database. Pools may mix hosts and physical/virtual kinds; exact kind remains a hard filter while soft kind preference lets the scheduler choose the least-loaded matching device. Heavy SDK/runtime images are not duplicated merely for symmetry: reuse existing capacity first and add emulator runtimes to another host only when the extra capacity is worth the disk cost.

### Layer 1 — Fleet core (existing, keep)

Unified device registry with platform/kind/backend metadata, WDA for physical iPhones, a separate Appium 3 runtime lane for iOS Simulators and Android physical/emulated devices, remote screen/input, PostgreSQL + pg-boss, per-device queues, versioned task contracts, execution logs and plugin loading.

### Layer 2 — Account and policy plane (build here)

Canonical account inventory, account-to-device binding, disabled/paused state, future action policy and health. Task validation must bind an explicit handle to the device before enqueue.

### Layer 3 — Deterministic skills/workflows (existing + extend)

TikTok and Instagram plugins remain deterministic recipes. Known work should not spend LLM tokens or depend on agent availability.

### Layer 4 — Semantic agent bridge (next)

Accessibility tree / stable element refs / text targeting / waits / traces. Hermes-native is the preferred owner-facing adapter; Ghost/MCP remains a generic adapter. The bridge consumes the fleet core rather than owning it.

### Layer 5 — Content/campaign plane (next)

Assets, account targets, calendars, campaigns, review state, safe publish intent, attribution and results.

### Layer 6 — Observability (next)

Per-action traces, screenshots around failures, account/device health, policy refusals, queue latency, workflow success rate.

## Delivery waves

### Wave A — source truth and control-plane foundation (complete)

Done criteria: baseline tests repaired, donor/autoplan artifacts exist, doctor implemented, account inventory/API implemented, account-binding validation implemented, full source suite green.

### Wave B — semantic automation adapter (source complete)

Done criteria: token-efficient WDA accessibility snapshot, stable element refs, find/tap/wait/type primitives, redacted traces, tests with captured fixtures. No LLM dependency in core.

### Wave C — agent integration (source complete)

Done criteria: Hermes adapter proves semantic device control through the shared primitives; optional MCP adapter can expose the same primitives. No duplicated WDA lifecycle.

### Wave D — campaign/account policy (source complete)

Done criteria: account pause/allow-list policy, campaign records, targeting, approval states and immutable execution attribution.

### Wave E — video benchmark (harness complete, live measurement blocked)

`npm run benchmark:video -- --udid <UDID>` now measures a no-stream control baseline, WDA MJPEG, and optionally qvh/H.264 while sampling screenshot/control latency. Keep current MJPEG until physical-device measurements prove lower contention/latency and acceptable reliability.

### Wave F — live acceptance and packaging (source harnesses complete, host blocked)

`npm run acceptance:live -- --udid <UDID>` now produces a receipt for health → screenshot → semantic tree → stream → optional input → optional scheduled task. launchd render/install/uninstall/status support also exists. The remaining proof requires full Xcode selected, Apple signing ready, PostgreSQL available and a physical iPhone attached; services must not be installed merely to create a crash loop on an unready host.

### Wave G — distributed MiniPC production runtime (virtual workers live-proven; physical iPhone pending)

`docker-compose.production.yml` packages the Linux control plane and PostgreSQL with persistent storage and restart policies. The actual `minipc-ubuntu` control plane is deployed and proven healthy over tailnet HTTPS with the canonical PostgreSQL service and migrations. `PHONE_FARM_ROLE=device-worker` packages macOS launchd with Appium, WDA supervision, queue execution and the authenticated device gateway but deliberately omits the web server. Remote screenshots, semantic trees, MJPEG and input are proxied through the gateway; canonical media is fetched from the MiniPC on demand with size/SHA-256 verification. Mac Studio/iOS Simulator and MateBook Linux/Android Emulator are both proven through the distributed scheduler and transport gateway. Final physical-iPhone closure still requires attached signed hardware.

### Wave H — cross-platform lab + semantic Studio (virtual matrix live; physical hardware pending)

The worker model now supports physical iPhone, iOS Simulator, physical Android and Android Emulator. A modern Appium 3 sidecar owns XCUITest/UiAutomator2 runtimes while the physical-iPhone WDA lane remains isolated. Execution hosts advertise capabilities and virtual-runtime definitions; the dashboard can boot/shutdown supported simulators/AVDs. Portable Flow v1.1 adds semantic `tapText`, `waitVisible`, `assertVisible`, `waitGone` and targeted `inputText` with bounded auto-waits across the normalized accessibility tree. `/fleet` is now a real low-contention device wall with grouping, multi-selection and safe bulk operational actions; still previews cover the fleet and only one focused live stream runs at a time. On 2026-09-21 both the iPhone 17 Simulator/XCUITest lane and Google Android Emulator/UiAutomator2 lane passed distributed MiniPC acceptance including a harmless scheduled Portable Flow. Physical Android and signed physical-iPhone matrix rows remain hardware-gated.

### Wave I — reusable automation library (source complete)

Portable flows are now persistent product objects rather than ephemeral browser state. PostgreSQL stores a flow identity plus immutable revisions; Automation Studio can create, version, duplicate, restore, delete, import and export them. Native `dfarming-flow@1` JSON is the lossless format; legacy `mobile-farm-flow@1` imports remain accepted during migration, while a bounded Maestro YAML adapter imports/exports only commands with a safe semantic mapping and rejects lossy conversion.

### Wave J — optimized video adapters (source adapter complete, live benchmark pending)

Android workers can optionally expose a version-matched scrcpy server as a video-only raw-H.264 source. Control remains Appium/UiAutomator2, the MiniPC proxies H.264 behind signed stream capabilities, and `benchmark:video` compares the transport against screenshot/control latency. No scrcpy artifact is downloaded or vendored automatically, and the dashboard keeps its existing stream/screenshot fallback until real measurements justify a default change. iOS Simulator Baguette-style transport and physical-iPhone qvh/WDA comparison remain live-gated.

### Wave K — capability-aware scheduling + semantic authoring (source complete, live matrix pending)

Automation Studio can either target a concrete device or ask the control plane to auto-pick an online, enabled, idle device matching platform/kind/worker constraints. Allocation ranks current execution/schedule load but still materializes a normal schedule bound to a concrete UDID for auditability. Flow timing now supports now/once/daily/weekly/interval schedules, and saved library executions carry the exact source flow/version in their immutable payload. The Semantic Inspector reads the live normalized accessibility tree and turns visible elements into semantic steps without hand-entering selector text. Live proof waits for two or more matching worker runtimes.

### Wave L — reusable device pools + host observability (source complete, live worker matrix pending)

Devices now carry normalized operator tags used by Fleet search and allocation. Named selectors are persisted in PostgreSQL as reusable device pools, and Automation Studio can schedule against a saved pool while still resolving to a concrete UDID before materialization. Configured workers stay visible while offline, while reachable hosts advertise capabilities plus bounded CPU/load/RAM/uptime telemetry. The MiniPC remains the metadata authority and workers receive tags/config without secrets or worker-local transport ports.

### Wave R — Add Device operational onboarding (source complete, MiniPC/browser live)

Add Device presents the real two-lane runtime model directly: Appium 3 for iOS Simulator/Android and the isolated WDA lane for physical iPhone. A live readiness strip reports execution-host availability, attachable runtimes and detected unregistered iPhones from the existing control-plane APIs. `Scan hosts` refreshes both host readiness and runtime discovery, and empty states point to the execution layer or USB/WDA recovery path instead of stopping at generic setup text. Production browser acceptance proved `Scan hosts → Attach` end-to-end against the MiniPC using a temporary contract-compatible worker fixture, then removed every fixture and returned the configured Mac worker to its normal offline state.

### Wave S — Overview device inventory UX (source complete, MiniPC/browser live)

The Overview device inventory gains a compact command bar for search, status filtering, platform filtering and shown/total counts while keeping Fleet as the detailed wall. Device fragments expose stable filter metadata so the current query survives HTMX refreshes, and rename/connect/disconnect behavior moves into a dedicated compiled Overview bundle with inline operational feedback. Browser acceptance caught and fixed a missing static-asset route for the new bundle, then proved search/status/platform filters, zero-result state, reset and HTMX filter persistence against the production MiniPC.

### Wave T — Device inventory hierarchy and density (source complete, MiniPC/browser live)

The Overview inventory adds semantic sorting plus persistent Grid/Compact views, reduces card density, moves status into the primary title line and demotes maintenance actions into a compact secondary menu. `Open` is the primary inventory CTA, `Automate` remains available without competing visually, and current search/filter/sort/view state survives HTMX refreshes. Production browser acceptance caught two HTMX persistence edge cases before closeout; the final `afterSettle` path now preserves Compact through both periodic outerHTML swaps and a full reload followed by the next `#device-list` settle. Live proof on Alpha/Mike/Zulu also verified alphabetical sorting, CTA hierarchy and the secondary Rename/Disconnect menu before removing all fixtures.

### Wave U — Automation Studio hierarchy (source complete, MiniPC/browser live)

Automation Studio now follows one explicit Target → Flow → Schedule → Run path. Pool management, version/export operations and destructive flow actions remain available but no longer compete visually with target selection, authoring, timing and execution. The surface stays monochrome/graphite and keeps all existing scheduler, allocation and versioning behavior. Production browser acceptance also caught and fixed conditional Schedule fields that CSS had made visible despite `hidden`, reducing the live `Run now` surface to only the controls that actually apply.


### Wave V — Single-device workspace hierarchy (source complete, MiniPC/browser live)

The Open-device workspace now follows device status → live/still screen → actions/activity. Lifecycle actions moved out of global navigation into a local command bar, live video falls back explicitly to a still screenshot, and WDA-only controls are capability-gated. Production browser review also kept the screen ahead of actions at narrow widths and collapsed WDA social automations behind a secondary section. The physical-iPhone Add Device flow remains explicitly live-gated until full Xcode + a real iPhone are available.

### Wave W — Runs workspace hierarchy (source complete, MiniPC/browser live)

Runs now centers recent execution state and evidence. Recent runs are primary, schedules are secondary, filters are explicit for device/flow/status, live refresh and manual refresh state are visible, and run details expose device/flow context, timestamps, exit code, errors and evidence logs without changing scheduler behavior. Production browser acceptance also removed the lingering “Details complete.” success noise from dialog-opening actions. Physical-iPhone WDA Add Device remains separately live-gated.

### Wave X — Fleet wall hierarchy (source complete, MiniPC/browser live)

Fleet is organized around a still-preview device wall with exactly one focused live stream, explicit Online / Offline / Disconnected connectivity, host/platform/kind grouping, Device-List-style search/filter controls and confirmed bulk operations. Production browser re-proof on 2026-09-21 covered the real Mac Studio/iOS Simulator and MateBook Linux/Android Emulator workers: host grouping, Android filtering, single-focus stream switching, confirmed Disable → Disconnected, gateway outage → Offline, and full recovery to 2/2 online. The proof also drove the bounded/cached simulator-discovery fixes in `c8c1df7` and `f078bd6`. Physical-iPhone WDA Add Device remains separately live-gated.

### Wave Y — execution profiles, integrations and fleet packaging

Account policies now support explicit execution-profile identities with
dedicated-device, required-tag and named network-route constraints. The
scheduler repository is the final pre-persistence enforcement point, so direct
API schedules, plugin-owned routes and campaign materialization cannot bypass
those constraints; profile/route IDs are retained on schedule/execution
evidence and worker execution fails closed if a required route is no longer
attested locally.

The optional dCreator bridge uses the internal service token, accepts approved
multipart asset bytes into dFarming-owned opaque asset IDs, submits a versioned
job/task envelope and returns scheduler/execution receipts. `(dcreator,
externalId)` is database-unique and a canonical request hash makes retries
idempotent while refusing conflicting reuse. Asset attachment and schedule
creation are atomic. No browser cookies, provider sessions or raw credentials
cross the product boundary.

Windows Android packaging now uses current-user Task Scheduler to supervise the
same Appium 3, pg-boss worker and authenticated device gateway processes as the
other execution hosts; it does not create a Windows control plane. Donor
governance is machine-readable: only Google emulator capacity, scrcpy video and
bounded Maestro interoperability are promoted, while duplicate farm/registry
authorities remain reference-only.

### Wave M — Control Center UX convergence (source complete, MiniPC live)

The dashboard now presents the farm as one control plane instead of a set of disconnected technical pages. Overview exposes product capabilities, attention state and recent runs; Fleet makes offline/empty/online state explicit; Runs supports cross-platform Portable Flow tasks, search and status filtering; Automation Studio uses a compact workspace switch and staged Target → Author → Schedule flow. Saved pool editing now has explicit names and dirty-state protection so previewed edits cannot accidentally schedule against the stale persisted pool.

### Wave N — scheduler/run operations UX (source complete, MiniPC live)

Runs now provides a visual schedule editor instead of raw JSON prompts. Operators can edit immediate, one-shot, daily, weekly and interval timing plus run windows using bounded controls while preserving recurring-publication confirmation. Execution history also exposes a details/log viewer over the canonical execution-detail endpoint so failures and completed runs can be diagnosed without leaving the dashboard.

### Wave O — connected device and flow actions (source complete, MiniPC live)

Overview device inventory now exposes tags and opens Portable Flow Studio directly with a concrete device preselected. Flow Library duplication uses a real named dialog instead of a browser prompt, making the device → author → save/duplicate workflow consistent with the rest of the control plane.

### Wave P — prompt-free device naming (source complete, MiniPC live)

Device naming now uses first-class dialogs in both Overview and the device workspace. The HTMX device fragment is pure markup and no longer injects browser action scripts on each refresh; stable page-level handlers own rename and connect/disconnect behavior instead. Dashboard source no longer contains `window.prompt()` interactions.

### Wave Q — inline operational feedback (source complete, MiniPC live)

Operational failures in Runs and per-device task controls now stay inside accessible live regions instead of interrupting the user with browser alerts. The unthemed fallback follows the same rule, while explicit confirmations remain only for destructive, irreversible or public actions.
