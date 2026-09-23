# dFarming task board

## Recovered and source-complete

The original FARM-001…FARM-035 cross-platform line was recovered from Git
history and reconciled with the later iOS hardening rather than resurrected as
an old branch.

- [x] One MiniPC control plane, PostgreSQL/pg-boss scheduler and authenticated workers.
- [x] Physical iOS + iOS Simulator runtime lanes.
- [x] Physical Android + Android Emulator runtime lanes.
- [x] Platform-aware worker handshake, discovery, registry and host capabilities.
- [x] Linux Android worker doctor and systemd-user packaging.
- [x] Stable semantic accessibility model for XCUITest + UiAutomator2.
- [x] Portable versioned flows and bounded Maestro interoperability.
- [x] Capability-aware allocation, tags and persistent device pools.
- [x] Hybrid host/device topology is canonical: pools can mix physical and
  virtual devices across compatible workers, with soft physical/virtual
  preference after load. Android-emulator capability requires both ADB and the
  emulator binary instead of being inferred from ADB alone.
- [x] Fleet wall grouping/filtering, Online/Offline/Disconnected state, safe
  confirmed bulk operations and exactly one focused live stream.
- [x] Optional Android scrcpy H.264 video adapter behind signed capabilities.
- [x] Account-to-device binding, account pause/task policy and execution evidence.
- [x] Current clean source gate: TypeScript + **222/222 tests** + web build.
- [x] Dependency audits: root, production-only, isolated Drizzle CLI and the
  generated Appium driver home all report **0 vulnerabilities**.
- [x] Physical-iOS source lane migrated from the retired Appium 2 tree to the
  pinned Appium 3/XCUITest 12.13.1 + WDA 16.12.9 path; the reviewed custom WDA
  patch is checksum/version-gated and compiles on Xcode 27 / iOS 27 Simulator.
- [x] Approved donor forks created and pinned in `donors.lock.json`.
- [x] Product/runtime rebrand completed across UI, plugin IDs, flow format,
  launchd labels, MCP, stream metadata and the canonical `DFARMING_*`
  configuration namespace. Legacy identifiers remain read-only migration
  aliases for persisted tasks, installed services and existing `.env` files.

Historical FARM ticket files remain for provenance; they are not active WIP.

## Live acceptance — environment dependent

- [x] DFARM-LIVE-01 — dFarming is cut over on the MiniPC while preserving the
  existing `kevs-ios-agents_phone-farm-postgres` volume; exact release SHA,
  Compose health, migrations and the persistent data seam are live-proven.
- [x] DFARM-LIVE-02 — The Mac Studio worker runs from `~/Code/dFarming`; the
  iPhone 17 Simulator is proven end to end through the MiniPC, including
  screenshot, semantic snapshot, MJPEG stream and a harmless Portable Flow.
  Revalidated locally on 2026-09-23 after the dFarming service/plugin rebrand.
- [x] DFARM-LIVE-03A — The MateBook Linux Android worker is deployed with ADB,
  UiAutomator2 and the Google Android emulator lane; screenshot, semantic
  snapshot, MJPEG stream and a harmless Portable Flow are live-proven.
  The emulator was recovered and revalidated on 2026-09-23 after its ADB endpoint
  had been temporarily unavailable during container boot.
- [ ] DFARM-LIVE-03B — Repeat the matrix on an attached physical Android
  device. This is hardware-gated, not source WIP.
- [ ] DFARM-LIVE-04 — Run the cross-platform video benchmark on real hardware;
  keep scrcpy optional until measurements justify a default.

The physical-iPhone WDA regression matrix is also hardware/signing gated. The
Mac Studio currently runs the simulator-only production profile.

The MiniPC has hardware virtualization (/dev/kvm) and is a valid future
Android-emulator worker, but no Android SDK/ADB/emulator is installed there in
the current production image. This is intentional footprint preservation, not
missing source support: use the existing Linux Android worker setup when local
MiniPC emulator capacity is actually needed.

## Non-hardware feature implementation

- [x] DFARM-101 — Named worker-local network-route attestations, account-profile
  binding, pre-persistence refusal and execution-time re-check. Live proof of a
  configured named route remains environment-gated.
- [x] DFARM-102 — dCreator bridge: internal authenticated asset intake,
  versioned jobs, DB-backed idempotency and execution receipts. The real
  dCreator-side caller remains a separate-project integration proof.
- [x] DFARM-103 — Donor adoption governance with promoted seams kept narrow:
  Google emulator capacity, scrcpy video-only, bounded Maestro, Baguette
  accessibility/readiness patterns, mobile-use observe→act patterns and
  device-farm-ios video-capability/benchmark separation. Donor runtimes that
  would duplicate control authority remain explicitly held/reference-only.
- [x] DFARM-104 — Windows Android worker packaging using the canonical Appium,
  scheduler-worker and authenticated gateway processes. Live Windows proof is
  pending until that host is online.
- [x] DFARM-105 — Per-account execution-profile constraints (dedicated device,
  required tags, route ID and explicit profile identity) enforced by the
  scheduler repository before persistence and snapshotted into receipts.
- [x] DFARM-106 — Donor-informed interaction/runtime hardening: structured
  cross-platform observe→act API/MCP/CLI, stable accessibility IDs,
  Maestro `stopApp`/`assertNotVisible`/ID selectors, per-device video
  capability negotiation, backend-aware video benchmarks and Android emulator
  `booting`→`sys.boot_completed` readiness.
- [x] DFARM-107 — Containerized Google Android Emulator is a first-class
  virtual runtime: Docker-label discovery, explicit provider metadata,
  `booting/booted/shutdown` state and dFarming-owned stop/start lifecycle
  with persistent stopped-container discovery, ADB reconnect and
  boot-completion proof.

The open parts of DFARM-101/102/104/105 are live/external integration proofs,
not unmerged source branches or hidden implementation WIP.

## Definition of clean

No active feature branch/worktree/stash is required for the canonical repo.
Source gates must be green. Runtime claims require live receipts; unavailable
hardware is reported as live-gated rather than called complete.
