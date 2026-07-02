# Test Setup Contract: Logs Visualization State Persistence (area: Logs)

## Streams / data the spec must establish

- **`e2e_automate` [shared/read-only]** — fields include `log`, `stream`, `code`, `kubernetes_host`, `kubernetes_container_name`, `level`, `message`, `_timestamp`. Why: all toggle-persistence tests need a stream with data to verify tab switching preserves search results and visualization state.
- No per-test stream needed — all tests just READ the existing `e2e_automate` data; none mutate the stream.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest `e2e_automate`: use `pm.ingestionPage.ingestion()` — see `tests/ui-testing/pages/generalPages/ingestionPage.js:36`.
  This ingests `logsdata` (from `tests/test-data/logs_data.json`) to the `e2e_automate` stream via `POST /api/{org}/{stream}/_json`.
- Or use the fixture helper: `await ingestTestData(page)` — see `tests/ui-testing/playwright-tests/Logs/logspage.spec.js:14-16`.
- Auth/org: Use `navigateToBase(page)` + `getOrgIdentifier()` — see `tests/ui-testing/playwright-tests/Logs/logspage.spec.js:43-67`.

  **Example beforeEach pattern (from logspage.spec.js:43-67):**
  ```js
  await navigateToBase(page);
  pm = new PageManager(page);
  await ingestTestData(page);
  await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
  await pm.logsPage.selectStream("e2e_automate");
  await applyQueryButton(pm);
  ```

- Timing: After `selectStream` and query execution, wait for `networkidle` and verify `[data-test="logs-search-search-result"]` is visible before asserting any toggle-persistence behavior.

## Preconditions / toggles

- Ensure non-SQL mode for the base toggle tests (FTS/filter mode is default).
- `store.state.zoConfig.timechart_enabled` must be `true` for the Visualize toggle to render.
- `store.state.zoConfig.auto_query_enabled` controls live-mode toggle visibility — tests for live-mode persistence should verify the config first.
- Enterprise-only: `logs-patterns-toggle` is gated on `config.isEnterprise == 'true'` (not available in OSS).

## Gotchas (so the Healer/Engineer don't rediscover them)

- The `logs-visualize-toggle` button is **conditionally rendered** based on `store.state.zoConfig.timechart_enabled` (SearchBar.vue:78). If the zoConfig hasn't loaded yet, the toggle won't exist — wait for the toggle to be visible before clicking.
- The `logs-visualize-toggle` button is **disabled** when `searchObj.data.stream.selectedStream.length > 1` (multi-stream not supported for visualization). Tests must select exactly one stream before toggling to visualize.
- On narrow viewports (`availableLeftWidth < 176`), the toggle group collapses into a dropdown (`logs-view-mode-dropdown-btn`). Tests should use a wide viewport to avoid this.
- Visualization config restoration from URL uses `visualization_data` query param — if testing share link persistence, this URL param must exist.
- Stream schema arrives async — after ingesting data, wait for `networkidle` and `[data-test="logs-search-search-result"]` before asserting. The resolver reads `selectedStreamFields`; if you query before it loads, it returns `[]`.
- `store.state.zoConfig` values (`timechart_enabled`, `auto_query_enabled`) may not be available immediately at mount time — Index.vue's watchers use `{ immediate: true }` but test helpers should add explicit waits if needed.
