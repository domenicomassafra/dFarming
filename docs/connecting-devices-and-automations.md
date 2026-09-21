# Connecting iPhones, iOS Simulators and automations

The production shape is one MiniPC control plane plus one or more macOS execution hosts. The browser, Hermes and other API clients talk to the MiniPC. A Mac owns Apple USB/Xcode/WDA/Appium transport locally and never becomes a second scheduler or registry authority.

## 1. Pair a macOS worker with the MiniPC

Configure the execution Mac from `.env.device-worker.example` using the same private worker token configured on the MiniPC. The MiniPC worker list is supplied through `PHONE_FARM_DEVICE_WORKERS`, for example:

```text
PHONE_FARM_DEVICE_WORKERS=macstudio=http://macstudio:3010,air=http://macbook-air:3010
```

The two iOS lanes are deliberately isolated:

```text
:4725  Appium 2 + custom WDA    physical iPhone lane
:4726  Appium 3 + XCUITest      iOS Simulator lane
```

`./deploy/setup-device-worker.sh` prepares the modern runtime for every Mac worker. The Appium 2 package is installed from `toolchains/legacy-ios-appium` only when the physical-iPhone lane is enabled, so simulator-only workers do not carry that legacy dependency graph.

## 2. Connect physical iPhones

Connect each owner-controlled iPhone by USB, unlock it, trust the Mac and enable Developer Mode. Full Xcode and valid signing are required.

Open **dFarming → Add device** and use the guided physical-iPhone flow. Each iPhone gets its own registry entry, WDA/MJPEG ports and serialized scheduler queue. Several iPhones can share one Mac while remaining independent devices in the MiniPC control plane.

## 3. Attach an iOS Simulator

Install/select full Xcode and create an iOS Simulator normally. The worker discovers available definitions through `xcrun simctl`.

From the execution-host view, boot the Simulator when needed, then open **dFarming → Add device → iOS Simulator → Scan hosts**. Choose the detected `ios / simulator` runtime and attach it. The Appium/XCUITest lane is used automatically; no manual `devices.json` edit is required.

## 4. Create an automation

Open **Automation Studio → Portable flow**. Pick an iPhone or iOS Simulator and compose semantic steps such as:

```text
launch app
waitVisible "Email"
inputText target="Email" text="hello@example.com"
tapText "Continue"
assertVisible "Welcome"
waitGone "Loading"
tap / swipe
type
Home / lock / wake / unlock / volume
screenshot
```

**Run now** creates a normal versioned scheduler task (`com.phone-farm.flow/flow@1`), so it uses the same queueing, stop behavior, logs and execution evidence as built-in tasks.

Automation Studio can also choose **Any matching idle device**. Select platform,
runtime kind, execution host and/or normalized tags; the control plane previews
the least-loaded eligible runtime and converts the selection into a concrete
device schedule. Saved pools remain selectors in PostgreSQL while each
execution is bound to a concrete UDID.

Physical-iPhone TikTok/Instagram recipes remain on the WDA lane because they
use iOS-specific calibrated behavior. Portable semantic flows are the
cross-platform path for iOS and Android runtimes.

## 5. Semantic/agent control

WDA JSON plus XCUITest/UiAutomator2 XML feed the same semantic snapshot API.
Hermes and other narrow clients use stable refs (`snapshot`, `tap`, `wait`,
`type`) through the dFarming API; they do not open WDA/Appium directly or own
scheduling.

Prefer `tapText`, `waitVisible`, `assertVisible`, `waitGone` and `inputText` over fixed coordinates. Exact matching, accessibility element type and bounded timeouts are available when a flow needs stricter targeting.

## 6. Video and Fleet

Physical iPhones use WDA MJPEG. iOS Simulators use a bounded Appium screenshot-stream fallback. Video remains separable from control, so streaming failure does not become scheduler authority.

The **Fleet** view uses inexpensive still previews for all devices and upgrades only the focused device to a live stream. Filters cover online state, iOS runtime kind and execution host; search covers device name, UDID, worker and tags.
