# Test Setup Contract: Splunk HEC Ingestion  (area: GeneralTests)

Spec target: `tests/ui-testing/playwright-tests/GeneralTests/splunkHec.spec.js`
Edition: OSS (self-hosted). The Splunk HEC *documentation page* is edition-agnostic; the
Ingestion Tokens page is OSS-available but is skipped on cloud by the existing
`ingestionTokens.spec.js` — carry the same `test.skip(isCloudEnvironment())` ONLY for the
tokens-page tests, never for the Splunk HEC documentation-page tests.

## Streams / data the spec must establish

- **`default` stream** **[shared/read-only]** — Splunk HEC events with no `index` field (or
  `"index":"default"`) land here automatically. **No pre-creation needed.** Why: the end-to-end
  ingestion test (Workflow 4) POSTs an envelope with `"index":"default"` and (optionally) verifies
  the event via `_search`. It is fine to read `default` without mutating a stream that other specs
  share, because HEC events are additive and the assertion is a COUNT/specific-value match, not a
  total.
- No other stream is required. If a test wants an isolated destination, use a unique index value
  (e.g. `splunk_e2e_<timestamp>`), which HEC will create on demand — then clean up with
  `apiCleanup.deleteStream(name, 'logs')`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Navigation (UI)
- Base + auth: `await navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141` (already handles auth,
  org switch, self-heal).
- Splunk HEC documentation page — deep-link:
  `await page.goto(\`${process.env.ZO_BASE_URL}/web/ingestion/custom/logs/splunkhec?org_identifier=${process.env.ORGNAME || 'default'}\`)`
  then `await page.waitForLoadState('domcontentloaded')`.
  Alternative: `pageManager.ingestionConfigPage.navigateToCustom(orgId)` →
  click `[data-test="ingestion-logs-tab-splunkhec"]`.
  See `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:56-61` for the custom-page
  navigation pattern.
- Ingestion Tokens page — via IAM rail (existing helper):
  `await pageManager.ingestionTokensPage.gotoIamPage(); await pageManager.ingestionTokensPage.gotoIngestionTokensTab();`
  See `tests/ui-testing/pages/iamPages/ingestionTokensPage.js:62-69` and its usage in
  `tests/ui-testing/playwright-tests/GeneralTests/ingestionTokens.spec.js:24-26`.

### Auth
- Self-hosted: `getAuthHeaders()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js:29`
  returns `{ Authorization: 'Basic <email:password>', 'Content-Type': 'application/json' }` using
  `ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD`. Use it for the **token-management** REST calls
  (`/api/{org}/ingestion-tokens`).
- The **collector** endpoint does NOT use Basic auth. Build the Splunk header manually:
  `{ 'Authorization': 'Splunk <guid>', 'Content-Type': 'application/json' }`.
  `getAuthHeaders()` will NOT work here (the middleware only parses the `Splunk` scheme).

### Creating a token + Splunk GUID (two equivalent paths — pick one)
1. **Via UI (reuse existing page object):**
   `tests/ui-testing/pages/iamPages/ingestionTokensPage.js` already covers open/fill/create
   (`clickCreateToken`, `fillTokenName`, `fillTokenDescription`, `clickCreate`) and the revealed
   dialog (`revealedTokenCode`, `closeRevealedDialog`). **It does NOT yet have helpers for the
   Splunk-specific controls** — the Engineer must add page-object methods targeting:
   - checkbox `[data-test="ingestion-token-splunk-checkbox"]`
   - per-row action `[data-test="ingestion-token-{name}-splunk"]`
   - revealed-dialog GUID `[role="dialog"] code` (the block whose label is "Splunk HEC token")
   - copy button `[data-test="copy-splunk-token-btn"]`
   Model them on the existing methods in that file (lines 77-133).
2. **Via API (fastest for the end-to-end test):** no helper exists yet — add one or call inline:
   ```js
   const org = process.env.ORGNAME || 'default';
   const resp = await page.request.post(`${process.env.ZO_BASE_URL}/api/${org}/ingestion-tokens`, {
     headers: getAuthHeaders(),
     data: { name: `splunk_e2e_${Date.now()}`, description: 'splunk e2e', splunk_token: true },
   });
   const { data } = await resp.json();   // data.splunk_token is the GUID (returned once)
   ```
   Response shape is `OrgIngestionToken` (`name, token, description, is_default, enabled,
   created_by, created_at, splunk_token`) — see
   `src/api/management/src/request/organization/ingestion_tokens.rs:84-146` and
   `src/core/src/ingestion_tokens.rs:106-143`.
   Self-heal on 401/403 with `authedRequest(page, 'post', url, {...})` from
   `tests/ui-testing/playwright-tests/utils/cloud-auth.js:126`.

### Collector ingestion + health (API)
- POST: `page.request.post(\`${process.env.ZO_BASE_URL}/services/collector\`, { headers: { Authorization: 'Splunk <guid>', 'Content-Type': 'application/json' }, data: { event: { level: 'info', log: 'e2e splunk' }, index: 'default', time: Math.floor(Date.now()/1000) } })`.
  Expect 200 + `{"text":"Success","code":0}`.
- Health: `page.request.get(\`${process.env.ZO_BASE_URL}/services/collector/health\`)` — NO auth.
  Expect 200 + `{"text":"HEC is healthy","code":17}`.
- NOTE the base host: the collector is at the server root on `ZO_BASE_URL` (NOT `INGESTION_URL`,
  and NOT under `/api/`). On cloud the two hosts differ; on self-hosted they are the same, but the
  code must use `ZO_BASE_URL` for the collector path.

### Optional: verify ingested event
- Poll search (reuse existing helper): `waitForFieldValueSearchable(page, 'default', 'log', '<unique value>')`
  or `waitForStreamData(page, 'default', 1)` from
  `tests/ui-testing/playwright-tests/utils/data-ingestion.js:178,243`.
- Use a **unique** `log` value (timestamp suffix) so the match is unambiguous against the shared
  `default` stream.

## Preconditions / toggles
- User must be **Admin or Root** in the org (token-management endpoints enforce this in OSS —
  `src/api/management/src/request/organization/ingestion_tokens.rs:59-74,117-131,184-198`).
- No feature flag / config toggle gates the Splunk HEC page or the collector route (verified: the
  route is registered unconditionally; the page has no `v-if`).

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **Collector is root-mounted and org-free.** Path is exactly `/services/collector` (alias
   `/services/collector/event`). No `/api/`, no `/{org}/`, no base-URI. A 404 here means the test
   hit the wrong host/path — use `ZO_BASE_URL`, not `INGESTION_URL`.
2. **The collector uses `Splunk <guid>`, not Basic.** `getAuthHeaders()` (Basic) will be rejected
   with code 3 (`Invalid authorization`). Build the `Splunk` header explicitly.
3. **The GUID is returned exactly once** (create response / revealed dialog / PATCH response). The
   token *list* returns the GUID too (`splunk_token` field), so the table cell / GET is a fallback if
   the reveal was closed early. GUID shape: lowercase 8-4-4-4-12 hex.
4. **Freshly minted GUID is usable immediately** — `db::org_ingestion_tokens::set_splunk_token`
   inserts into `SPLUNK_HEC_TOKENS` synchronously and the `o2oi_` re-validation falls back to the DB
   (`src/db/src/org_ingestion_tokens.rs:208-218`). No 60s wait needed. A cold node still loading its
   cache answers 503/code 9 (`Server is busy`, retryable) — retry, don't treat as a token error.
5. **Revoked/unknown GUID is indistinguishable (code 4/403).** Don't assert a specific text between
   "unknown" and "malformed"; assert code 4 or code 1 with the 403 status.
6. **Token names are restricted** to `[A-Za-z0-9_-]` and unique per org — always use a timestamp
   suffix and avoid spaces/dots/slashes (`src/core/src/ingestion_tokens.rs:88-95`).
7. **Ingestion Tokens page is cloud-skipped** in the existing spec; replicate `test.skip(isCloudEnvironment())`
   only for tokens-page tests. The Splunk HEC docs page needs no skip.
8. **`default` stream is shared** across the whole suite — never assert a total row count; assert on
   a unique injected value, or use an isolated `index` stream.
