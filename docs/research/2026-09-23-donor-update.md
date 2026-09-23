# Donor update — 2026-09-23

The dFarming donor set was refreshed against current upstream repositories. dFarming remains the sole fleet, policy, scheduler and receipt authority; these additions are bounded references or benchmark candidates rather than parallel control planes.

| Donor | Pinned upstream revision | License | dFarming use | Decision |
| --- | --- | --- | --- | --- |
| `tddworks/baguette` | `14a3d23a03989dbce9ef0b75a906cb82e96f38aa` | Apache-2.0 | iOS Simulator farm/video/accessibility/input ideas | Held until measured against the proven Appium/XCUITest lane |
| `minitap-ai/mobile-use` | `62913c933e21b27da353a89316a09f60525af496` | Apache-2.0 | Cross-platform agent/skill interaction patterns | Reference only; no scheduling or registry authority |
| `LWHikarik/device-farm-ios` (`fix/restore-ios-support`) | `37a169d88905b59bc998ea5f251dd00e813aa17c` | MIT | Physical-iOS qvh/video transport experiments | Benchmark only after an iPhone is attached |

Forks are kept in the owner namespace as `dFarming-baguette`, `dFarming-mobile-use`, and `dFarming-device-farm-ios`. The pinned SHA in `donors.lock.json`, not a moving branch name, is the research authority for any future adaptation.
