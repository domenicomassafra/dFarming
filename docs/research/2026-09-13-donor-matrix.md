# Donor/research matrix — 2026-09-13

| Candidate | Best use | Strengths | Constraints / why not core | Decision |
| --- | --- | --- | --- | --- |
| Kevs-IOS-Agents (current) | Fleet + social workflow core | Physical iPhone, registration, WDA/Appium supervision, Postgres scheduler, TikTok + Instagram, fleet pipelines, Hinge research | Young project; needs stronger semantic agent layer | **KEEP AS CORE** |
| Git-Agni/prod-FARM-IOS-Core | Lineage/upstream reference | ~same architecture, wider adoption, Apache-2.0 | Public main is behind current Kevin feature branch for our needs | Track as lineage/reference |
| ghost-in-the-droid/android-agent @ 7c09f6c | Agent/skill architecture | iOS WDA, normalized screen tree, skills, MCP, bot runner, multi-device jobs, swappable brains | Duplicates scheduler/dashboard; Python stack; importing whole project creates two control planes | **DONOR: semantic/skill ideas** |
| Oceanswave/hermes-iphone-plugin @ bc25eba | Owner-facing agent adapter | Native Hermes tools, pymobiledevice3, semantic tree, WDA self-heal, redacted traces | Not a fleet scheduler | **PREFERRED HERMES ADAPTER DONOR** |
| teddyoweh/iphone-mcp @ bc793d7 | Semantic snapshot design | Real iPhone, compact accessibility snapshots, stable refs, low token use | Single-purpose MCP; no fleet scheduler | **DONOR: snapshot/ref model** |
| ZSeven-W/dsh-ios @ a913c2e | WDA lifecycle/security/testing | Real-iPhone WDA staging, coded failures, signed stream routes, extensive smoke tests | DSH-specific host/panel model | **DONOR: lifecycle + safety + tests** |
| Appium Device Farm | Allocation/topology reference | Mature Appium multi-device sessions, dashboard, hub/node scaling | Manual stream/control removed because WDA streaming competed with automation | Reference only |
| LWHikarik/device-farm-ios | Video transport experiment | qvh/H.264 video separated from modern Appium control; multi-device iOS 26.5 claim | Fork/experimental; extra native bridge dependency | **BENCHMARK DONOR, not default** |
| GADS | Generic lab/device farm | iOS/Android, reservations/workspaces, remote control | Mixed AGPL/proprietary UI; QA-centric | Reference only |
| Baguette | UX/performance inspiration | Excellent simulator streaming/farm UI/accessibility | Simulator-first, not physical-iPhone fleet | UX reference only |
| Maestro | Portable flow/Studio semantics | Apache-2.0 core, readable cross-platform YAML flows, accessibility-first selectors, smart waits, MCP; runs on emulators/simulators and physical Android | Its hosted cloud is optional and Studio itself is not open-source; physical iOS coverage does not replace our WDA lane | **ADOPTED PATTERNS + bounded YAML interchange** |
| Genymobile/scrcpy | Android video/control transport | Low-latency H.264 mirroring/control; standalone server can expose raw video separately from control | Android-only; server protocol is internal/version-sensitive; not a scheduler/account control plane | **ADAPTER SOURCE LANDED; benchmark before default** |
| DeviceFarmer/STF family | Android lab UX/topology | Proven concepts for large Android fleets, remote screens and device allocation | QA/lab centric; not a fit as the scheduler authority | Reference patterns only |
| Meta/Facebook idb | iOS lab/companion topology | MIT; client/companion split, simulator/device lifecycle, remote execution and scalable lab primitives | Not a scheduler, dashboard or social automation product; importing its stack would duplicate our worker boundary | **DONOR: remote companion + simulator lifecycle** |
| iPhone Mirroring MCPs | Quick single-phone agent demo | No WDA signing, easy local control | Apple's Mirroring is one-phone-at-a-time and session-sensitive; poor fleet basis | Reject as core |
| minitap/mobile-use | General agent research | Agentic mobile UI model, modern setup skill | Public docs are inconsistent on physical-iOS maturity | Watch, don't adopt |
| pymobiledevice3 | Device-management substrate | Modern Apple protocol coverage, DVT, tunneling, WDA helpers | GPL-3.0 library implications; not a scheduler/UI | Prefer via isolated adapter / Hermes donor |

## Synthesis

The best solution is **compositional, not a mega-merge**. Keep one authoritative fleet scheduler and expose device runtimes behind narrow capabilities. Appium Device Farm validates the hub/node + mixed real/virtual model; idb validates the remote-companion pattern for Apple labs; Baguette is the strongest iOS-Simulator UX/video donor; DeviceFarmer/STF contributes the low-cost device-wall/focused-control pattern; scrcpy is the preferred Android video benchmark; Maestro is the strongest donor for portable readable flows, accessibility selectors, automatic waits and visual authoring. Deterministic recipes remain the default for known social workflows; portable/semantic flows cover cross-platform general automation.

## Donor provenance

Bounded local clones live under `../donors/` and are not vendored into this repository. Their pinned research heads are recorded above. Any later code adaptation must preserve the upstream license/notice and document the exact imported surface.
