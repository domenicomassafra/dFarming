# Security Policy

Do not report vulnerabilities through public issues. Until a dedicated address is configured, contact the repository owners privately through the GitHub organization.

Never attach a self-hosted production runner to this repository's workflows. Never include device passcodes, Apple signing material, real UDIDs, authentication tokens, screenshots, uploaded media, or production logs in an issue or pull request.

## Dependency audit boundaries

The MiniPC control-plane release installs production dependencies only. Use
`npm audit --omit=dev` as the production dependency gate and treat any non-zero
result as a release blocker.

Execution workers install one modern Appium 3 runtime. The physical-iPhone
compatibility server on `:4725` and the cross-platform runtime server on `:4726`
both execute the root `appium-runtime` package and share the pinned
`.appium-runtime` driver home. The former exists only to preserve the existing
physical social-recipe port contract; there is no Appium 2 dependency tree.

The physical WDA extensions are carried as a reviewed patch against exactly
XCUITest `12.13.1` / WebDriverAgent `16.12.9`. `wda:patch` verifies the manifest
versions and SHA-256 and fails closed on version drift or a partially applied
patch. Updating that driver requires re-porting/reviewing the patch and then
real physical-device regression proof; never use `npm audit fix --force` as a
substitute for that compatibility gate.

Appium's driver packages bundle parts of their dependency graph. The setup
pipeline therefore runs `appium:runtime:harden`: it pins the installed driver
versions, upgrades the bundled `morgan` copies to the reviewed `1.12.1`
release, reconciles the generated driver-home lock with those installed bytes,
and finishes with `audit:appium-runtime` at `--audit-level=low`. This bounded
remediation does not change Appium, XCUITest, UiAutomator2, or dFarming runtime
contracts.

Likewise, `drizzle-kit` is a schema-generation CLI rather than a runtime
dependency. It lives in `toolchains/db-schema`, pins its compatibility version,
and overrides the obsolete nested esbuild implementation to the reviewed
`0.25.12`; `npm run audit:db-schema` must remain green. The ordinary root
`npm audit --audit-level=high` gate covers what normal workers install, while
`npm audit --omit=dev` remains the stricter MiniPC production-release gate.
