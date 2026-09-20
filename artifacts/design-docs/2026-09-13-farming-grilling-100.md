# 100-question grilling — farming control plane

> This is a rigorous in-chat grilling surrogate. The canonical `dstack-office-hours` skill requires a structured popup tool that this host session does not expose, so this artifact does **not** claim that official workflow ran. Questions that can be answered from repository/runtime evidence are resolved now; owner-only and live-proof items are marked explicitly.

Legend: **D** = decided from evidence/reversible default; **O** = owner decision before rollout; **L** = live-runtime proof required.

## 1. Goal, scope and economics

### 1. What is the product optimizing first?
**Answer [D]:** Reliable operation of owner-controlled physical iPhones/accounts; growth is an outcome, not a reason to weaken reliability.

### 2. Is this a QA device lab or an operator product?
**Answer [D]:** Operator product first; QA-grade observability is borrowed where useful.

### 3. What is the v1 platform?
**Answer [D]:** Physical iPhone on macOS.

### 4. Which social surfaces are first-class in v1?
**Answer [D]:** TikTok and Instagram because working plugins already exist.

### 5. Do we support Android in this repository?
**Answer [D]:** No in v1; keep interfaces extensible but do not dilute iOS delivery.

### 6. Should known workflows call an LLM?
**Answer [D]:** No. Deterministic recipes first; agent only for unknown/semantic work.

### 7. Is cloud hosting required?
**Answer [D]:** No. Local-first is the default; remote access can be layered with auth later.

### 8. What is the unit of scheduling?
**Answer [D]:** A versioned task bound to one physical device and optionally one configured account.

### 9. What is the main cost to minimize?
**Answer [D]:** Operator time, failed runs, and model-token spend rather than raw compute.

### 10. What defines v1 success?
**Answer [D]:** Source-green plus one complete live iPhone acceptance lane.

## 2. Account model and platform boundaries

### 11. Can a task name an arbitrary handle?
**Answer [D]:** No; explicit account targets must exist in that device plugin configuration.

### 12. Can one account appear on multiple devices?
**Answer [D]:** Represent it if configured, but flag duplicates later because execution ownership becomes ambiguous.

### 13. Can one device host multiple accounts per platform?
**Answer [D]:** Yes; this is already a core use case.

### 14. Do we auto-create accounts?
**Answer [D]:** No.

### 15. Do we discover credentials from the device?
**Answer [D]:** No.

### 16. Do we bypass login walls/CAPTCHAs?
**Answer [D]:** No.

### 17. Do we implement ban-evasion/fingerprinting spoofing?
**Answer [D]:** No.

### 18. Can public/send actions happen without task intent?
**Answer [D]:** No; publishing/sending must come from an explicit task contract and later policy gate.

### 19. Should accounts have a pause state independent of devices?
**Answer [D]:** Yes; add account policy in a later ticket.

### 20. Who decides account ownership/authorization?
**Answer [O]:** Owner configuration; live rollout should only include accounts the owner controls.

## 3. Device fleet and runtime

### 21. What is the source of truth for devices?
**Answer [D]:** `devices.json` today; Postgres for schedules/executions.

### 22. Should we migrate devices into Postgres immediately?
**Answer [D]:** No; not until concurrency/fleet scale proves the file registry limiting.

### 23. What serializes work?
**Answer [D]:** One pg-boss queue per active device.

### 24. Can remote manual input race automation?
**Answer [D]:** No; current API blocks remote input while automation is active.

### 25. What launches WDA?
**Answer [D]:** The existing wda-service supervisor/Appium preparation flow.

### 26. Do we replace WDA with pymobiledevice3?
**Answer [D]:** No wholesale replacement; use pymobiledevice3 only where it adds lifecycle/device-management value.

### 27. Do we require USB forever?
**Answer [D]:** No architectural requirement, but USB is the initial acceptance and most deterministic transport.

### 28. How are ports allocated?
**Answer [D]:** Per registered device, existing WDA/MJPEG port fields.

### 29. What happens when a device is disabled?
**Answer [D]:** No supervision or scheduling; account inventory still reports it as disabled.

### 30. What runtime prerequisite is currently blocking live proof?
**Answer [L]:** Full Xcode is not selected on this Mac; Docker is also absent.

## 4. Scheduler, workflows and reliability

### 31. Do task contracts need versions?
**Answer [D]:** Yes; already implemented and retained.

### 32. Can an old schedule silently run a new task implementation?
**Answer [D]:** No; versioned task lookup must fail loudly if unavailable.

### 33. Do retries apply to public posts/DMs by default?
**Answer [D]:** No; high-impact tasks keep zero automatic retry unless idempotency is proven.

### 34. Should warmup/feed tasks retry?
**Answer [D]:** Bounded retries are acceptable because they are interruptible and lower impact.

### 35. Do schedules need minimum gaps?
**Answer [D]:** Yes; existing scheduler gap guard remains.

### 36. Should queues be per account instead of per device?
**Answer [D]:** Device queue remains authoritative because one iPhone cannot safely execute two UI sessions concurrently.

### 37. How do we prevent wrong-account execution?
**Answer [D]:** Validate account binding before persistence, then verify/switch account in workflow runtime.

### 38. Do we need campaign-level fan-out?
**Answer [D]:** Yes later: campaign → device/account task materialization.

### 39. What happens to stuck pipeline items?
**Answer [D]:** Existing reconciliation returns publishing items to ready; preserve and extend evidence.

### 40. What is the live reliability target?
**Answer [L]:** Define after first acceptance benchmark; do not invent a percentage without measurements.

## 5. Semantic automation and agents

### 41. What perception source is primary?
**Answer [D]:** Accessibility/WDA semantic tree where available.

### 42. What is the fallback perception order?
**Answer [D]:** Semantic tree → targeted OCR → pixels/template match.

### 43. Should an LLM receive raw giant XML?
**Answer [D]:** No; compact normalized snapshots/stable refs.

### 44. Which donor best demonstrates compact refs?
**Answer [D]:** teddyoweh/iphone-mcp.

### 45. Which donor best matches the owner agent stack?
**Answer [D]:** Oceanswave/hermes-iphone-plugin.

### 46. Which donor best demonstrates generic MCP/skills?
**Answer [D]:** Ghost in the Droid.

### 47. Should Ghost own scheduling?
**Answer [D]:** No; avoid two job engines.

### 48. Should Hermes own WDA lifecycle separately?
**Answer [D]:** Ultimately no; adapter should converge on shared fleet lifecycle to prevent duplicate runners.

### 49. Do we need batched agent actions?
**Answer [D]:** Yes later; reduce round trips and allow one traceable flow.

### 50. Can the agent tap unidentified controls to explore production accounts?
**Answer [D]:** No; exploration needs a safe mode or explicit operator scope.

## 6. Content, campaigns and account growth workflows

### 51. What is the canonical content object?
**Answer [D]:** An immutable asset plus metadata/caption/options, referenced by task/campaign.

### 52. Do we keep TikTok and Instagram posting separate?
**Answer [D]:** Separate plugins, shared campaign abstraction later.

### 53. Can the same asset target several accounts?
**Answer [D]:** Yes via campaign fan-out; each resulting execution keeps explicit attribution.

### 54. Do we need draft versus publish?
**Answer [D]:** Yes; already present and should remain explicit.

### 55. Should scheduled public publish require confirmation?
**Answer [D]:** Yes; already enforced for recurring publishes.

### 56. Should content pipelines be fleet-aware?
**Answer [D]:** Yes; existing TikTok fleet pipeline is useful donor code inside the current repo.

### 57. Do we automatically generate comments/DMs at scale?
**Answer [D]:** Not as a default control-plane feature; text generation and sending need explicit scoped workflows/policy.

### 58. Do we need A/B content experiments?
**Answer [D]:** Yes later, but attribution/results first.

### 59. Do we need a media review queue?
**Answer [D]:** Yes in campaign wave: prepared → approved → scheduled → executed.

### 60. Which growth metrics are canonical?
**Answer [O]:** Owner must choose business metrics; system should collect execution facts before prescribing KPIs.

## 7. Observability and evidence

### 61. What must every execution record?
**Answer [D]:** Device, plugin/task version, payload, account target if present, timestamps, outcome and bounded logs.

### 62. Should typed secrets/message bodies appear in traces?
**Answer [D]:** No; redact sensitive text and retain length/metadata where enough.

### 63. When should screenshots be captured?
**Answer [D]:** Around failures and explicit proof points, not unbounded continuous retention.

### 64. Do we need action-level traces?
**Answer [D]:** Yes before semantic-agent rollout.

### 65. Do we distinguish refusal from technical failure?
**Answer [D]:** Yes; policy refusal should be structured, not an opaque error.

### 66. Do we need queue latency metrics?
**Answer [D]:** Yes for fleet capacity planning.

### 67. Do we need per-account success metrics?
**Answer [D]:** Yes, after canonical account IDs/policies exist.

### 68. What is the proof of a publish/send?
**Answer [D]:** UI/result-state evidence specific to the plugin; never infer success solely from tap completion.

### 69. Do we retain raw device logs forever?
**Answer [D]:** No; retention policy should be bounded/configurable.

### 70. Where is current proof weakest?
**Answer [L]:** No live physical-device run on this host yet.

## 8. Security, secrets and safety

### 71. Where do device passcodes live?
**Answer [D]:** Git-ignored `devices.json` mode 0600 today; never API-returned.

### 72. Should Apple signing material enter CI?
**Answer [D]:** No.

### 73. Should production devices attach to PR runners?
**Answer [D]:** No.

### 74. Can dashboard bind publicly without auth?
**Answer [D]:** No; current safe-bind guard remains.

### 75. Do state-changing browser requests need CSRF protection?
**Answer [D]:** Yes; existing origin/Bearer guard remains.

### 76. Do we expose UDIDs to remote untrusted clients?
**Answer [D]:** Minimize exposure; local operator API can use them, public surfaces should prefer opaque IDs later.

### 77. How should stream URLs work if exposed remotely?
**Answer [D]:** Signed, expiring capabilities behind a trusted origin is the DSH-inspired target.

### 78. Do plugins get unrestricted shell?
**Answer [D]:** Only reviewed plugins; process runner should remain observed and scoped.

### 79. Do we auto-install arbitrary community skills into production?
**Answer [D]:** No; install/review/provenance gate first.

### 80. What dependency issue is open right now?
**Answer [D]:** `npm ci` reports 37 advisories including 3 critical; remediate compatibly, not with blind force upgrades.

## 9. UX and operator workflow

### 81. What should the home screen answer immediately?
**Answer [D]:** Which phones/accounts are ready, busy, disabled, unhealthy, and what is next in queue.

### 82. Should accounts be first-class in navigation?
**Answer [D]:** Yes; new `/api/accounts` is the data foundation, UI follows.

### 83. Should the operator see raw UDIDs?
**Answer [D]:** Only in diagnostics/details, not as the primary label.

### 84. How many clicks to schedule a known workflow?
**Answer [D]:** Target 2–3 after selecting device/account; measure after UI tranche.

### 85. Should live control be always streaming?
**Answer [D]:** No; stream on demand to reduce contention.

### 86. Do we need fleet bulk actions?
**Answer [D]:** Yes, but only for reversible/safe actions initially.

### 87. Should an operator be able to pause one account?
**Answer [D]:** Yes; future policy ticket.

### 88. Should errors name the broken prerequisite?
**Answer [D]:** Yes; `doctor` and registration should return actionable coded causes.

### 89. Do we need a global command palette/agent chat?
**Answer [D]:** Optional adapter layer, not required for deterministic v1.

### 90. What visual design system wins?
**Answer [D]:** Keep current dashboard until workflow IA is stable; then run a focused design pass rather than restyling during core work.

## 10. Delivery, testing and rollout

### 91. What is the source gate?
**Answer [D]:** `npm run check` from a clean install.

### 92. What is the host preflight gate?
**Answer [D]:** `npm run doctor` with truthful blocked/ready states.

### 93. What is the real-device acceptance order?
**Answer [D]:** discover → register → sign/build WDA → health → screenshot/stream → touch → app launch → account switch → task → evidence.

### 94. Do mocked tests count as real-device proof?
**Answer [D]:** No.

### 95. Do source-green tests allow merge before live proof?
**Answer [D]:** Only for source-only tickets explicitly marked as such; live-dependent tickets stay open.

### 96. Should we replace the current video transport before benchmark?
**Answer [D]:** No.

### 97. What process manager is desired for production?
**Answer [D]:** launchd on macOS is the current documented direction; finalize after live acceptance.

### 98. Should we publish packages now?
**Answer [D]:** No; stabilize internal control plane first.

### 99. Should dependency upgrades be mixed with feature work?
**Answer [D]:** No; separate remediation ticket and regression gate.

### 100. What owner decisions remain truly blocking architecture?
**Answer [O]:** Fleet scale, exact account/business KPIs, retention duration, and remote-access requirements; none block Wave A source work.
