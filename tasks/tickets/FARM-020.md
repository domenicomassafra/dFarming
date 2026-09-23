# FARM-020 — Portable Automation Studio

- Status: **source-complete**
- Date: 2026-09-13

## Objective

Make general mobile automation a first-class product surface rather than keeping recorded gestures inside one TikTok workflow implementation.

## Implemented

- Built-in `com.dfarming.flow/flow@1` task contract, plugin version `1.1.0`.
- Bounded portable steps: launch, terminate, wait, tap, swipe, type, Home/lock/wake/unlock/volume and screenshot.
- Same pg-boss scheduling, stop semantics, logs and execution evidence as every other task.
- Browser Automation Studio with device picker, ordered step editor, per-step parameters, reordering/removal and Run now.
- Device page exposes a Portable Flow entry point on every runtime.
- Appium runtimes hide iPhone/WDA-specific social calibration UI instead of pretending those recipes are portable.
- Existing TikTok/Instagram recipes are explicitly rejected on generic Appium runtimes until they are ported semantically.
- Accessibility-first steps inspired by Maestro/Playwright-style authoring: `tapText`, `waitVisible`, `assertVisible`, `waitGone`, and `inputText`.
- Semantic steps accept optional element type, exact-match mode and bounded timeout; both WDA and Appium backends use the same stable-ref semantic controller.
- Automatic polling/waits avoid hard-coded sleeps for ordinary UI readiness and survive device-size changes better than pixel-only flows.
- Canonical PostgreSQL Flow Library with immutable version history (`flow_definitions` + `flow_versions`).
- Automation Studio can create, save a new version, load, duplicate, delete and restore an older revision without bypassing the scheduler.
- Native `dfarming-flow@1` JSON export/import for portable backups and sharing; legacy `mobile-farm-flow@1` remains import-compatible.
- Bounded Maestro YAML compatibility: accessibility-first `launchApp`, `tapOn`, `assertVisible`, `inputText`, `extendedWaitUntil` and supported key presses import into Portable Flow steps; export refuses steps without a lossless mapping instead of silently degrading them.

## Verification

- Flow validation, execution-order, semantic-step, versioned API and Maestro compatibility tests pass.

## Follow-up

- Add tags/folders and parameterized reusable variables/secrets without storing credentials inside flow definitions.
- Add richer cross-platform selectors (resource id / accessibility id / regex) where the normalized tree can represent them safely.
