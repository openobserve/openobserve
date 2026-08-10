# Test Setup Contract: IAM MCP Server for All Editions  (area: GeneralTests)

## Streams / data the spec must establish

**NONE.** The MCP Server page is purely informational — it displays the endpoint URL, authentication mode, and client-specific config snippets. It does NOT query, list, or depend on any stream, log, metric, or ingested data.

All visible state is derived from:
- The logged-in user's organization identifier
- The organization's ingestion endpoint URL (from `store.state.API_ENDPOINT` or `zoConfig.ingestion_url`)
- The organization passcode (fetched via `GET /api/{org}/passcode` on mount if missing from store)

No streams, fields, or pre-ingested data blocks any behavior on this page.

---

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Auth / login — prerequisite for all tests

Every test navigates via the existing authenticated session from `global-setup.js`, which writes
the auth state file. The test fixture `enhanced-baseFixtures.js` loads it. The reference pattern:

```js
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// In the test:
await navigateToBase(page);
const pm = new PageManager(page);
```

Reference: `tests/ui-testing/playwright-tests/GeneralTests/serviceAccount.spec.js:29-30`

### Navigate to IAM → MCP Server

```js
// Pattern from serviceAccount.spec.js:32-33
await pm.iamPage.gotoIamPage();  // clicks [data-test="menu-link-\/iam-item"]
await pm.iamPage.iamURLValidation();  // asserts URL contains /iam

// Click MCP Server tab
await page.locator('[data-test="iam-mcp-server-tab"]').click();
// Wait for the page content to load
await page.locator('[data-test="iam-mcp-server"]').waitFor({ state: 'visible', timeout: 10000 });
```

Reference for `gotoIamPage` / `iamURLValidation`: `tests/ui-testing/pages/iamPages/iamPage.js:94-117`

### Navigate via Ingestion Recommended tab → McpCrossLink

```js
// Go to Ingestion first, then click Recommended tab's "MCP Server" entry
// The tab name is "recommendedMcp" → the sidebar produces data-test="ingestion-recommended-tab-recommendedMcp"
await page.locator('[data-test="ingestion-recommended-tab-recommendedMcp"]').click();
// Wait for McpCrossLink card
await page.locator('[data-test="mcp-cross-link"]').waitFor({ state: 'visible', timeout: 10000 });
// Click "Open MCP setup"
await page.locator('[data-test="mcp-cross-link-btn"]').click();
// Now on IAM MCP Server page
await page.locator('[data-test="iam-mcp-server"]').waitFor({ state: 'visible', timeout: 10000 });
```

### Wait for endpoint to be populated (auth state)

The endpoint URL is derived from Vuex store which is populated during login. However, the page
uses `useIngestion()` which calls `getEndPoint(getIngestionURL())` — this reads from the store
synchronously, so no async wait is needed for the endpoint itself.

The org passcode is fetched asynchronously on mount if missing. The card handles this gracefully
(placeholder `[BASIC_PASSCODE]` is shown). If a test needs to assert that the REAL passcode is
loaded, wait for the CopyContent pre text to NOT contain the literal `[BASIC_PASSCODE]`:

```js
// The passcode is masked on screen — CopyContent replaces [BASIC_PASSCODE] with masked text.
// When not yet loaded, the placeholder may be visible as literal text. Once loaded, the
// pre element shows masked characters instead.
const firstPreText = page.locator('[data-test="ai-integrations-mcp-card"] [data-test="rum-content-text"]').first();
// If the test cares about loaded passcode, poll:
await expect(firstPreText).not.toContainText('[BASIC_PASSCODE]', { timeout: 15000 });
```

### Validate the edition (OSS vs Enterprise) for conditional features

The OAuth tab and Generate button depend on edition config. Tests can detect the edition from
the page:

- **OAuth tab exists** → Enterprise/Cloud: `page.locator('[data-test="ai-integrations-mcp-auth-oauth"]').count() > 0`
- **Generate button exists** → Enterprise/Cloud with RBAC+SA: `page.locator('[data-test="ai-integrations-mcp-generate-btn"]').count() > 0`
- **OSS** → OAuth tab absent, Generate button absent, Token mode is the only path

Reference pattern for feature detection (from edition-features.spec.js): `tests/ui-testing/playwright-tests/GeneralTests/edition-features.spec.js` — uses page content to detect edition rather than env vars.

---

## Preconditions / toggles

- **[shared/read-only] Authentication:** All tests share the same authenticated session. No org switching needed — the default org (`ORGNAME=default`) works. Reference: `tests/ui-testing/playwright-tests/GeneralTests/serviceAccount.spec.js:15-16` (uses `test.skip(isCloudEnvironment(), ...)` for cloud-gated tabs, but MCP Server is **not** cloud-gated).

- **[per-test] Auth mode toggle:** Tests that specifically exercise token mode or OAuth mode should NOT assume the default. On OSS, token is the only mode. On Enterprise/Cloud, OAuth is the default — click the Token tab first:
  ```js
  // Ensure token mode for credential-related tests
  const tokenTab = page.locator('[data-test="ai-integrations-mcp-auth-token"]');
  if (await tokenTab.count() > 0) {
    await tokenTab.click();
  }
  ```

- **Edition-gated tests:** Tag Enterprise-only tests (credential generation) so they skip on OSS. Use the runtime detection pattern:
  ```js
  const isEnt = await page.locator('[data-test="ai-integrations-mcp-generate-btn"]').count() > 0;
  test.skip(!isEnt, 'Credential generation requires Enterprise with RBAC');
  ```
  Alternatively, use the cloud-env helper: `const { isCloudEnvironment } = require('../utils/cloud-auth.js')` — but note that MCP Server is NOT cloud-gated, only the credential generation sub-feature is.

---

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **CopyContent uses generic selectors.** The three CopyContent instances (endpoint, credential header, config snippet) all share `[data-test="rum-copy-btn"]` and `[data-test="rum-content-text"]`. **Always scope to `[data-test="ai-integrations-mcp-card"]`** and use `.nth(0)` / `.nth(1)` / `.nth(2)`:
   - `.nth(0)` → endpoint block
   - `.nth(1)` → credential block (only visible after generation in token mode)
   - `.nth(2)` → client config snippet

2. **The `[BASIC_PASSCODE]` is masked ON SCREEN.** When asserting the snippet content, use `toContainText('••••')` (masked) rather than the email/passcode. The real value is only revealed on copy. CopyContent runs `maskText()` on display and `replaceValues(..., false)` on copy.

3. **Deep links use protocol handlers.** `cursor://` and `vscode:` links will show a browser "Open external application?" dialog in some environments. Tests that click install buttons should use `page.waitForTimeout()` rather than `page.waitForNavigation()` since protocol links don't trigger Playwright navigation events.

4. **The org passcode fetch can be slow or fail.** The page is resilient to this — it shows `[BASIC_PASSCODE]` placeholder. Tests that assert the passcode was loaded should poll with a timeout (see wait pattern above). The fetch fires in `onMounted` *if* the passcode is not already in the store — if a previous test (e.g., ingestion, service accounts) populated it, it may already be cached.

5. **Client tabs all have distinct data-tests.** The 11 client tab selectors follow the pattern `ai-integrations-mcp-client-{id}` where `{id}` is the `CLIENTS[].id` value: `claudeCode`, `cursor`, `vscode`, `claudeDesktop`, `windsurf`, `chatgpt`, `antigravity`, `opencode`, `openclaw`, `hermes`, `codex`. These are exactly the values in the `CLIENTS` array in `McpServerCard.vue:118-267`.

6. **No page object exists for McpServerCard yet.** The test will need to either define inline locators or a new thin page object. The existing `iamPage.js` has no MCP-specific helpers. Follow the pattern from `iamPage.js` (class with `page` constructor arg, locators as class properties, methods for navigation).

7. **The Recommended tab discoverability flow goes through Ingestion.** To test the McpCrossLink path, the test navigates to `/web/ingestion/recommended/mcp?org_identifier=default` (or clicks through the UI). The cross-link card itself is a single-component page (`McpCrossLink.vue`) — it does NOT render the full Recommended sidebar when accessed directly via route; it only renders when navigated from within the Recommended component's `<router-view>`.
