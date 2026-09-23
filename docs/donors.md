# dFarming donor policy

`donors.lock.json` is the machine-readable authority for approved upstream
projects, owner forks and reviewed SHAs.

`donor-adapters.json` is the separate machine-readable adoption decision. A
donor being approved does **not** mean its runtime is loaded. Every donor must
be either promoted behind a narrow seam or explicitly held/reference-only, with
a failure mode that leaves the core usable.

Donors are not allowed to become hidden second control planes. dFarming owns
the canonical registry, scheduler, account policy, flow revisions and
execution evidence. Donor software may own a narrow transport/runtime concern.

## Integration boundaries

- **Appium Device Farm** — reference/optional adapter for Appium session and
  device allocation. dFarming remains the schedule/run authority.
- **DeviceFarmer/STF** — Android device-lab and device-wall donor. It must not
  become the canonical dFarming registry.
- **IDB** — Apple companion/transport donor, especially useful for simulator
  and remote-host operations.
- **pymobiledevice3** — external subprocess/service boundary only because the
  donor is GPL-3.0. Do not link/copy its implementation into the Apache core.
- **Google Android emulator container scripts** — preferred donor for
  containerized Linux Android Emulator capacity.
- **scrcpy** — optional Android video transport; Appium/UiAutomator2 remains
  the control plane for automation.
- **Maestro** — flow interoperability/runner donor. dFarming stores its own
  immutable flow revisions and rejects lossy conversions.
- **Baguette** — iOS Simulator farm/stream/accessibility donor. dFarming has
  adopted stable accessibility identifiers and readiness patterns, while the
  Baguette runtime/video server stays held behind benchmark evidence.
- **mobile-use** — agent-interaction donor. dFarming has adopted a bounded
  structured observe→act seam; mobile-use does not own devices, policy,
  scheduling or receipts.
- **device-farm-ios** — modern physical-iOS video/control separation donor.
  dFarming exposes per-device video capabilities and transport-neutral
  benchmarking; qvh remains optional until physical-hardware measurements.

Forks are for controlled review, patches and reproducibility. Upstream changes
are pulled deliberately, reviewed, tested and then the lock SHA is updated.

## Current promotion set

The promoted seams are narrow capabilities or patterns; promotion does not
imply loading the donor runtime:

| Donor | Promoted seam | Core fallback |
| --- | --- | --- |
| Google Android emulator containers | pinned Linux/KVM emulator capacity | other device workers remain usable |
| scrcpy | opt-in raw H.264 **video only** | screenshot/MJPEG remains available; Appium keeps control |
| Maestro | bounded flow import/export including semantic IDs, stopApp and visibility waits | Portable Flow remains canonical; lossy commands are rejected |
| Baguette | stable accessibility identifiers + simulator readiness patterns | Appium/XCUITest remains the runtime |
| mobile-use | structured observe→act agent API/MCP/CLI | deterministic recipes and Portable Flow remain available |
| device-farm-ios | per-device video capabilities + transport-neutral benchmark seam | WDA/Appium control remains canonical; qvh stays optional |

Appium Device Farm and STF remain architecture/UX references because adopting
their farm authorities would duplicate dFarming's scheduler/registry. IDB is
held until a measured Apple transport gap justifies it. The Baguette and
device-farm-ios *runtime transports* are also still held even though bounded
patterns from those donors are promoted. pymobiledevice3 is held external-only
because of its GPL boundary and because the physical-iPhone lane still needs
hardware proof before another lifecycle component is added.

The test suite cross-checks every lock entry, immutable SHA, runtime-image
digest, adoption decision, promoted implementation path and GPL isolation.
