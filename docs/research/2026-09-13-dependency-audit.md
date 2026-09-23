# Dependency audit triage — 2026-09-13

## Result

The dependency tree is not safely auto-fixable without changing the automation runtime contract.

- `npm audit`: 36 total findings: 2 low, 16 moderate, 15 high, 3 critical.
- `npm audit --omit=dev`: 6 high findings.
- The production findings are one chain rooted at direct `webdriverio@9.31.8`, through `webdriver`, `@wdio/config`, `@wdio/utils`, `@puppeteer/browsers@2.13.2` and `extract-zip@2.0.1`.
- Registry checks during this tranche showed `webdriverio@9.31.8` as the current WebdriverIO release and `extract-zip@2.0.1` as the latest published `extract-zip` release.
- `npm audit fix --dry-run` reported zero bounded dependency changes.

## Decision

Do not run `npm audit fix --force` and do not accept npm's suggested forced WebdriverIO downgrade as a security fix without live Appium regression evidence. This repository depends on real-device WebDriver/Appium behavior, so package compatibility is part of correctness.

The broader modernization lane remains Appium 3 + a current XCUITest driver/WDA. That stack installed successfully in an isolated `.appium-next` experiment, but modern WDA does not contain the repository's custom `/wda/absolute-actions`, `/wda/import-media`, and sessionless `pressButton` behavior. Those extensions must be ported and regression-tested on a physical iPhone before the canonical runtime can switch.

## Close condition

1. Port the custom WDA behavior onto the supported modern WDA/XCUITest line.
2. Run source tests/typecheck.
3. Run physical-device registration, input, media import and social workflow smoke tests.
4. Re-run `npm audit` and record the residual tree rather than hiding advisories with overrides.

## Source modernization closure — 2026-09-21

- The custom WDA endpoints were first ported to XCUITest 12.12.3 /
  WebDriverAgent 16.12.8, then revalidated and promoted to XCUITest 12.13.1 /
  WebDriverAgent 16.12.9 with the same reviewed patch and a new version-pinned
  manifest.
- The modern patched WDA completed `xcodebuild build-for-testing` successfully
  with Xcode 27 against the booted iOS 27 Simulator before repository cutover.
- The Appium 2 toolchain and obsolete WDA 8.9.1 patches were removed. Both
  `:4725` and `:4726` now execute the root Appium 3 runtime against
  `.appium-runtime`; the separate ports preserve behavior without a second
  vulnerable dependency tree.
- The isolated Drizzle generator retains 0.31.10 compatibility while overriding
  the obsolete nested esbuild to reviewed 0.25.12; its audit is now clean and
  schema generation reports no migration drift.
- Root/source regression remains green. The only unfinished item from this
  historical ticket is the real signed-iPhone regression (registration, touch,
  media import and social smoke) because that proof cannot be substituted with
  Simulator evidence.
