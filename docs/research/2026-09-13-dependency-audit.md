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
