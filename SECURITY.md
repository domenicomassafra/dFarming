# Security Policy

Do not report vulnerabilities through public issues. Until a dedicated address is configured, contact the repository owners privately through the GitHub organization.

Never attach a self-hosted production runner to this repository's workflows. Never include device passcodes, Apple signing material, real UDIDs, authentication tokens, screenshots, uploaded media, or production logs in an issue or pull request.

## Dependency audit boundaries

The MiniPC control-plane release installs production dependencies only. Use
`npm audit --omit=dev` as the production dependency gate and treat any non-zero
result as a release blocker.

Execution workers install the root dependency graph, which contains the modern
Appium 3 runtime but not the legacy physical-iPhone server. The optional
physical-iPhone lane keeps Appium 2 in `toolchains/legacy-ios-appium`; it is
installed only when `PHONE_FARM_ENABLE_PHYSICAL_IOS=true`. Its advisories are
audited separately with `npm run audit:legacy-ios` and must not be silenced
with `npm audit fix --force`: upgrading that lane requires real physical-device
WDA compatibility proof.

Likewise, `drizzle-kit` is a schema-generation CLI rather than a runtime
dependency. It lives in `toolchains/db-schema` and is audited separately with
`npm run audit:db-schema`. The ordinary root `npm audit --audit-level=high`
gate covers what normal workers install, while `npm audit --omit=dev` remains
the stricter MiniPC production-release gate.
