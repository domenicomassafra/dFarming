# Lessons

- A popular upstream is not automatically the best branch. Kevin's fork currently carries meaningful social/workflow additions beyond the Git-Agni public main, so compare history before rebasing or replacing it.
- WDA is a strong control plane but a contested video plane. Appium Device Farm removed manual WDA streaming because of contention; qvh/H.264 is worth benchmarking, not blindly adopting.
- Agent frameworks such as Ghost add semantic skills and MCP value, but importing their scheduler would duplicate an already-good pg-boss/per-device scheduler.
- The existing `TaskValidationContext.devicePluginData` is the lowest-risk seam for multi-account target validation: no migration required.
- Runtime proof must remain separate from source proof. This host currently has Command Line Tools rather than full Xcode and no Docker.
- Tests should assert user-visible text after stripping markup when templates intentionally split words with presentation tags.
- Do not run `npm audit fix --force` blindly on an automation stack that pins Appium/XCUITest behavior; dependency remediation needs a compatibility ticket.
- Current `npm audit` is not safely auto-fixable: the production advisory chain reaches the latest WebdriverIO through `@wdio/utils -> @puppeteer/browsers -> extract-zip`, while the Appium 2 tree contributes additional dev/runtime advisories. `npm audit fix --dry-run` proposes zero bounded changes; remediation therefore belongs with the Appium 3 / modern XCUITest compatibility lane plus real-device regression proof, not a forced downgrade.
