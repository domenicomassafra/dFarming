# FARM-017 — Dependency vulnerability remediation without Appium regressions

- Status: **source-complete / physical-regression-pending**
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
- The remaining full-tree findings originally included the pinned Appium 2 toolchain. The modern Appium 3.7.0 runtime is the canonical runtime for FARM-019 (`:4726`, `.appium-runtime`) with XCUITest 12.13.1 and UiAutomator2 8.7.0; the Appium 2 tree has since been retired.
- The physical-iPhone canonical lane still cannot switch wholesale: its custom WDA endpoints must be ported and live-regression-tested first. The sidecar therefore reduces cross-platform blocking but does **not** close this dependency-remediation ticket.

No `--force` remediation was applied. Close this ticket only after the modern WDA/Appium compatibility port and physical-device regression gate are green.

## Re-triage — 2026-09-21

- Root runtime tree: `npm audit` and `npm audit --omit=dev` both report **0 vulnerabilities**.
- The custom physical WDA behavior has been revalidated on XCUITest 12.13.1 /
  WDA 16.12.9, pinned by exact versions and patch SHA, and successfully compiled on
  Xcode 27 / iOS 27 Simulator.
- Appium 2 and the old WDA 8.9.1 patches are removed. Both the physical
  compatibility listener (`:4725`) and generic runtime (`:4726`) now use Appium
  3 and `.appium-runtime`.
- The Appium-3 runtime is live-proven for both iOS Simulator and Android
  Emulator, including distributed scheduler execution through the MiniPC.
- The schema-generation-only Drizzle CLI remains isolated from production; the
  obsolete nested esbuild is bounded to reviewed 0.25.12 and its audit is now
  **0 vulnerabilities** without changing generated schema.
- The generated Appium driver home is hardened after driver installation while
  updating XCUITest to 12.13.1 and UiAutomator2 to 8.7.0; bundled `morgan`
  is reconciled to 1.12.1 and `npm audit --prefix .appium-runtime` reports
  **0 vulnerabilities**.
- This ticket remains live-gated only for the signed physical-iPhone regression
  matrix. Simulator compilation proves source compatibility, not real-device
  trust/signing/Photos/touch behavior.
