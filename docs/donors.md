# dFarming donor policy

`donors.lock.json` is the machine-readable authority for approved upstream
projects, owner forks and reviewed SHAs.

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

Forks are for controlled review, patches and reproducibility. Upstream changes
are pulled deliberately, reviewed, tested and then the lock SHA is updated.
