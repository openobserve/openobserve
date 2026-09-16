# Test Setup Contract: Logs Refresh Cache & Run Query Dropdown  (area: Logs)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate` [shared/read-only]** — a logs stream with ~3848 pre-ingested records.
  Fields (from `tests/test-data/logs_data.json`): `log` (text), `stream` ("stderr"/"stdout"),
  `code` (int), `kubernetes_host`, `kubernetes_container_name`, `kubernetes_namespace_name`,
  `message`, `level`, plus many `kubernetes.*` fields.
  Why: both specs only READ this stream — select it, run a query, then exercise the
  refresh-cache dropdown. No per-test mutation (the dropdown action triggers a re-search,
  it does not modify the stream).

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Ingest: `await ingestTestData(page)` from `tests/ui-testing/playwright-tests/utils/data-ingestion.js`
  (`ingestTestData(page, "e2e_automate")` POSTs `tests/test-data/logs_data.json` to
  `/api/{orgId}/e2e_automate/_json`). Already used identically in the in-diff spec:
  `tests/ui-testing/playwright-tests/Logs/logsRefreshCacheDropdown.spec.js:26-27`.
- Auth/org: `getOrgIdentifier()` + `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` — self-hosted uses `ORGNAME` +
  `ZO_ROOT_USER_EMAIL`/`ZO_ROOT_USER_PASSWORD`; cloud uses `cloud-config.json`. No explicit
  login needed — `navigateToBase(page)` (from `enhanced-baseFixtures.js`) uses the worker auth state.
- Navigate: `await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`)` then
  `await pm.logsPage.selectStream('e2e_automate')` and
  `await pm.logsPage.applyQueryAndWaitForSearchResponse()` — see
  `tests/ui-testing/playwright-tests/Logs/logsRefreshCacheDropdown.spec.js:40-42`.
- Dropdown interaction helpers (already implemented, reuse — do NOT re-derive selectors):
  - `pm.logsPage.openRefreshCacheDropdown()` → clicks `[data-test="logs-search-bar-refresh-cache-dropdown-trigger"]`
    (`tests/ui-testing/pages/logsPages/logsPage.js:11460`).
  - `pm.logsPage.getRefreshCacheAndRunQueryMenuItem()` → `getByRole('menuitem', { name: 'Refresh Cache & Run Query' })`
    (`logsPage.js:11472`).
  - `pm.logsPage.clickRefreshCacheAndRunQuery()` → opens dropdown, waits for a `/_search` request
    with `clear_cache=true`, returns the request `URL` (`logsPage.js:11491`).
  - `pm.logsVisualise.openVisualiseTab()` → clicks `[data-test="logs-visualize-toggle"]` and waits
    for `[data-test="panel-editor-container"]` attached (`tests/ui-testing/pages/dashboardPages/visualise.js:53`).

## Preconditions / toggles
- `zoConfig.timechart_enabled` must be `true` for the Visualize toggle (`logs-visualize-toggle`)
  to render (`SearchBar.vue:76`). Established by the environment/global setup — no per-test action;
  if a local run lacks it, the Visualize-parity test will time out finding the toggle.
- `zoConfig.auto_query_enabled` gates ONLY the Live Mode item (`SearchBar.vue:1236`) — it does NOT
  gate the refresh-cache dropdown or its item (GH #14488 fix). Do NOT attempt to toggle this flag
  for the refresh-item assertions; leave it as-is.
- Non-SQL mode, single stream: the spec selects one stream and stays in the default Logs tab;
  no SQL-mode toggle needed.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`data-test="logs-search-bar-refresh-btn"` matches multiple nodes** — it is reused for the
  dropdown item, the Logs tab's main "Run Query" button (`SearchBar.vue:1137`), and (enterprise)
  the Cancel button (`:1120`). Always disambiguate with `getByRole('menuitem', { name: 'Refresh Cache & Run Query' })`.
- **Reka UI dropdown closes on an outside click.** Assert visibility *before* pressing Escape, and
  re-open before clicking (the helper `clickRefreshCacheAndRunQuery()` already re-opens).
- **Wait for the search response, not a fixed sleep.** `applyQueryAndWaitForSearchResponse()` waits
  for `/_search` 200 before returning; `clickRefreshCacheAndRunQuery()` waits for the
  `clear_cache=true` request via `page.waitForRequest`.
- **Stream schema/index lag.** The `e2e_automate` stream is pre-seeded and read-only here; do not
  re-ingest unique data per test for this feature (no field/value assertions depend on fresh data).
- **Visualize tab mounts async.** `openVisualiseTab()` already gates on `panel-editor-container`
  being attached; do not click the refresh-cache trigger before that gate resolves.
