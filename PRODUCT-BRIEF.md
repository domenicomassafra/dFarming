# Product brief — Farming Control Plane

## Product thesis

Build a local-first control plane for owner-controlled mobile devices and accounts: physical iPhones, physical Android phones, iOS Simulators and Android emulators. The product should make deterministic, repeatable workflows cheap and reliable, while exposing a separate semantic/agent layer for novel tasks. The fleet core must remain useful when every LLM is disconnected.

The production authority is the always-on Linux MiniPC. Execution hosts own the device-specific runtime: macOS is required for Apple signing/WDA and iOS Simulator, while Android execution can use ADB/Appium. The split must not change the operator experience: browser and agent clients talk to the MiniPC while device input/video is securely proxied to the host that owns each runtime.

## Primary outcome

From one dashboard/API, the owner can see every real or virtual mobile device, its execution host/capabilities, configured accounts, readiness, queued and scheduled work, content waiting to publish and execution evidence. Known workflows run deterministically. Portable flows and semantic-agent adapters cover new workflows without coupling the scheduler to a model vendor.

## Initial product surface

- Physical iPhone registration, signing, WDA/Appium supervision and remote control.
- Fast attach for iOS Simulators and Android physical/emulated runtimes through an isolated Appium 3 sidecar.
- Execution-host capability inventory (`simctl`, `adb`, WDA, Appium) surfaced in the dashboard.
- Portable Automation Studio with versioned scheduler-backed flows shared across supported runtimes.
- Per-device serialized scheduler and execution history.
- Canonical cross-device inventory of TikTok and Instagram accounts.
- Explicit account binding: a task cannot target a handle that is not configured on that phone.
- Content/post pipeline and existing TikTok/Instagram workflow plugins.
- A doctor/preflight command that separates source readiness from live-device readiness.
- Semantic UI adapter based on accessibility identity first, OCR/pixels second.
- Agent adapters: Hermes-native first for the owner's stack, MCP as the optional generic bridge.
- Dockerized Linux control plane with PostgreSQL, persistent canonical media/config and authenticated macOS device-worker gateways.

## Non-goals for v1

- Replacing WebDriverAgent/Appium merely for novelty.
- Coupling the scheduler to a particular LLM, MCP client, or cloud provider.
- Automatic CAPTCHA/login-wall bypass, credential discovery, platform-ban evasion, identity spoofing, or fake-account creation.
- Unbounded mass messaging or engagement. High-impact public/send actions need explicit task intent and policy gates.
- Replacing the live video stack before a real-device benchmark proves a better transport.

## Success criteria

1. `npm run check` is green from a clean install.
2. `npm run doctor` tells the truth about every host prerequisite.
3. A fleet API returns all configured accounts without leaking secrets.
4. A scheduled task with an unconfigured account is rejected before persistence.
5. A live acceptance run can prove registration → WDA → stream → touch → account switch → scheduled task on a physical iPhone.
6. Agent/semantic automation can be added without changing scheduler contracts.
7. The MiniPC can remain online with an execution worker offline and automatically recover its device inventory/configuration when that worker reconnects.
8. Android/Appium and iOS Simulator page sources normalize into the same stable-ref semantic interface used by agents.
