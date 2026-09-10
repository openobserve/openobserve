# Test Setup Contract: MCP Server Connection Setup  (area: GeneralTests)

> Read by the Engineer (implements setup), the Healer, and the Refiner. This feature is a **pure IAM
> credential flow** — it needs **no stream ingestion** and no seeded telemetry data. The preconditions
> that matter are: an authenticated session, an org, and the backend serving the service-account and
> MCP endpoint. Do **not** invent a stream or ingest data for this spec.

## Streams / data the spec must establish
- **None.** The MCP card makes no stream/detection calls (`content.detect` is omitted — see
  `McpServerCard.vue:374-421`; no `detectionAnchor` step, no `useStreamDetect`). Do not add stream setup.

## How to establish the preconditions (copy these EXACT patterns — do NOT invent setup)

### Authentication / org
- Use the same auth-state fixture every other spec uses. The `enhanced-baseFixtures` fixture already
  boots a context with saved auth (`tests/ui-testing/playwright-tests/utils/auth/user.json`) and
  `navigateToBase(page)` lands on `/web/?org_identifier=${process.env.ORGNAME}`.
  - Reference: `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141-187`
    (`navigateToBase`) and the fixture at `:21-111`.
  - Org is `process.env.ORGNAME || 'default'` (same convention as
    `tests/ui-testing/pages/iamPages/iamPage.js:168-171` `serviceAccountEmailFor`).

### Navigation to the page
- Follow the established IAM navigation pattern, then the MCP tab:
  - `const pm = new PageManager(page);` → `await pm.iamPage.gotoIamPage();` (clicks
    `[data-test="menu-link-\/iam-item"]` — see `tests/ui-testing/pages/iamPages/iamPage.js:12,103-105`).
  - Then click the MCP Server tab `[data-test="iam-mcp-server-tab"]`. **This locator does not yet exist
    in `iamPage.js`** — add it (the page object is the right home; mirror `serviceAccountsTab` at
    `iamPage.js:13`). Route URL is `/iam/mcpServer`; assert with `await expect(page).toHaveURL(/iam\/mcpServer/)`.
  - Reference spec for the IAM nav pattern:
    `tests/ui-testing/playwright-tests/GeneralTests/serviceAccount.spec.js:27-38` (`gotoIamPage` →
    `iamURLValidation` → tab click).

### Readiness / timing
- After navigating, wait for a known element — **do not** use `waitForLoadState('networkidle')`
  (deployed envs continuously poll RUM/analytics; see the warning in
  `serviceAccount.spec.js:19-25` and `enhanced-baseFixtures.js:141-187`).
- Wait for the endpoint block `[data-test="ai-integrations-mcp-endpoint"]` (visible) before asserting
  anything, or the card root `[data-test="ai-integrations-mcp-card"]`.

### Generating a token (the one mutating action)
- The credential mint is a **real backend call** `POST /api/{org}/service_accounts`
  (`web/src/services/service_accounts.ts:22-24`, invoked at `web/src/composables/useMcpCredential.ts:142`).
  This creates a **new service account** named `mcp-<Date.now().toString(36)>.<org>@sa.internal`.
- **Cleanup:** each generation leaves a service account behind. If the spec generates a token, plan
  cleanup via the existing service-account delete pattern
  (`serviceAccount.spec.js:137-160` — create→`serviceAccountEmailFor(name)`→delete). The MCP card names
  are non-deterministic (`Date.now()` base36), so cleanup must list/delete by email prefix `mcp-` rather
  than a known name — or accept the residue and note it (a Healer hint). Prefer asserting the
  post-generation panel **without** requiring cleanup on the happy path.

## Preconditions / toggles (edition-sensitive — this run is OSS)
- **OSS build:** `config.isEnterprise` and `config.isCloud` are `"false"`
  (`web/src/aws-exports.ts:30-35`). Consequences:
  - The OAuth auth-mode tab (`ai-integrations-mcp-auth-oauth`) and OAuth banner **never render** — token
    mode is forced. Do **not** write a test expecting OAuth; park it as `test.fixme` (enterprise/cloud+SSO).
  - RBAC is off (`zoConfig.rbac_enabled` false), so a successful generation yields
    `credential.scope === "rbacDisabled"` → the `[data-test="ai-integrations-mcp-rbac-note"]` text, **not**
    the readonly note and **not** the unscoped warning. Assert the `rbac-note`.
  - `service_account_enabled` defaults to enabled (`?? true`), so generation normally succeeds. If a
    given env disables it, generation surfaces the `[data-test="ai-integrations-mcp-credential-error"]`
    banner instead — treat that as a legitimate alternate path, not a flake (see `McpServerCard.vue:521-528`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Token is masked on the page.** The rendered config snippet and credential header show
  `Basic ••••••••••••••••`; the raw `Basic <base64>` only exists in the code block's copy payload / revealed
  state. Assert the masked text, and assert the raw token string does **not** appear in `page.textContent()`.
- **Placeholder before generation.** Pre-generation, the config snippet literally contains
  `Basic <base64 of service-account-email:token>` — never a real credential, never `[BASIC_PASSCODE]`.
- **One-click install button is client-dependent.** Absent for the default `claudeCode`; present only for
  `cursor` and `vscode` (token mode). Select `ai-integrations-mcp-client-cursor` first. `claudeDesktop`'s
  deep link is OAuth-only → no button on OSS.
- **Success banner has no `data-test`** (see `NEEDS SELECTOR` in the design doc). Assert via
  `ai-integrations-mcp-credential-header` visibility + the `credential.email` text, not the banner.
- **Generate is offered even with rbac/service accounts off** (client-side never gates it); the backend
  decides. Don't gate the button on config flags in the test.
- **Route is present on OSS** (no build/runtime gate) — `useEnterpriseRoutes.ts:165-179` + IAM tab with no
  `visible` gate (`IdentityAccessManagement.vue:113-123`). Direct URL `/iam/mcpServer` works after auth.
- **Session credential cache** (`useMcpCredential.ts:49-50`): a minted credential is reused on remount for
  the same org, so re-visiting the page in one session shows the post-generation panel — don't assert a
  fresh pre-generation state after an earlier generation in the same worker.
