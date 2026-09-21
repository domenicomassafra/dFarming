# FARM-017 — Dependency vulnerability remediation without Appium regressions

- Status: **blocked-live**
- Date: 2026-09-13

## Objective

Review the 37 npm advisories from clean install, group direct/transitive exposure, upgrade compatibly and rerun full + live gates. Never use blind force upgrade.

## Acceptance / proof

- npm audit triage
- bounded upgrades
- full regression

## Triage — 2026-09-13

- Full `npm audit`: 36 findings (2 low, 16 moderate, 15 high, 3 critical).
- Production-only audit: 6 high findings, all in the current WebdriverIO chain (`webdriverio` / `webdriver` / `@wdio/*` → `@puppeteer/browsers` → `extract-zip`).
- `webdriverio@9.31.8` is already the current registry release checked during this tranche; `extract-zip@2.0.1` is also the latest release available on its package line.
- `npm audit fix --dry-run` proposes zero bounded changes. npm's advertised alternative for this chain is a forced WebdriverIO downgrade, which is not acceptable without Appium/iPhone regression proof.
- The remaining full-tree findings include the pinned Appium 2 toolchain. A modern Appium 3.7.0 runtime is now deliberately installed **side-by-side** for FARM-019 (`:4726`, `.appium-runtime`) with XCUITest 12.12.3 and UiAutomator2 8.6.4. This proves modern Appium can coexist without replacing the physical-iPhone lane.
- The physical-iPhone canonical lane still cannot switch wholesale: its custom WDA endpoints must be ported and live-regression-tested first. The sidecar therefore reduces cross-platform blocking but does **not** close this dependency-remediation ticket.

No `--force` remediation was applied. Close this ticket only after the modern WDA/Appium compatibility port and physical-device regression gate are green.

## Re-triage — 2026-09-21

- Root runtime tree: `npm audit` and `npm audit --omit=dev` both report **0 vulnerabilities**.
- The legacy physical-iPhone Appium-2 toolchain is isolated under `toolchains/legacy-ios-appium`; its separate audit reports 26 findings (2 low, 12 moderate, 9 high, 3 critical). It is not loaded on the current Mac Studio simulator-only production profile.
- The Appium-3 runtime is live-proven for both iOS Simulator and Android Emulator, including distributed scheduler execution through the MiniPC.
- The schema-generation-only Drizzle CLI remains isolated from production; its audit currently reports four moderate findings in the old nested esbuild compatibility chain. A forced breaking CLI change is not used to silence a toolchain-only advisory.
- This ticket therefore remains `blocked-live` only on replacing and regression-testing the physical-iPhone legacy lane with a compatible modern path on attached, signed hardware.
