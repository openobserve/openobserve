# Test Setup Contract: Logs Saved View Column Order Normalization (area: Logs)

Spec: `tests/ui-testing/playwright-tests/Logs/savedViewColOrder.spec.js` · Playwright group: `Logs-Core`

This contract tells the Engineer EXACTLY how to establish the data/state each behavior needs.
Every helper below already exists in the repo — copy the pattern, do NOT invent setup.

---

## Streams / data the spec must establish

- **`e2e_automate` [shared/read-only]** — the standard pre-seeded logs stream.
  - Fields (from `tests/test-data/logs_data.json`): `log`, `stream`, `message`, `code`, `level`,
    `method`, `took`, `FloatValue`, many `kubernetes.*` fields, plus `_timestamp`.
  - Used by: the array round-trip test (Workflow 2) — reorder columns, save, re-apply, verify order.
  - Ingest via the existing helper (see "How to create it" below). If the stream is already
    pre-seeded in the CI environment, `ingestTestData` is still safe to call (idempotent re-ingest).

> Note: NO new stream needs to be created for this feature. The column-order normalization acts on
> saved-view payloads, not on stream schema. Reuse `e2e_automate`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest logs data:**
  ```js
  const { ingestTestData } = require('../utils/data-ingestion.js');
  await ingestTestData(page, 'e2e_automate');
  ```
  Reference: `tests/ui-testing/playwright-tests/utils/data-ingestion.js:11` (posts
  `POST {INGESTION_URL}/api/{org}/e2e_automate/_json` with `tests/test-data/logs_data.json`).
  Usage example: `tests/ui-testing/playwright-tests/Logs/logstable.spec.js:15`.

- **Auth / org (for API calls):**
  ```js
  const { getOrgIdentifier, getAuthHeaders } = require('../utils/cloud-auth.js');
  const orgId = getOrgIdentifier();   // self-hosted: process.env.ORGNAME
  const headers = getAuthHeaders();   // Basic auth (email:password|passcode) + JSON content-type
  ```
  Reference: `tests/ui-testing/playwright-tests/utils/cloud-auth.js:29` and `:64`.

- **Navigate to Logs + select stream + run query:**
  ```js
  const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
  const PageManager = require('../../pages/page-manager.js');
  const logData = require('../../fixtures/log.json'); // logsUrl='/web/logs', Stream='e2e_automate'
  await navigateToBase(page);
  const pm = new PageManager(page);
  await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
  await pm.logsPage.selectStream(logData.Stream);      // logsPage.js:579
  await pm.logsPage.clickRefreshButton();               // logsPage.js:1776 (or runQueryAndWaitForResults :1786)
  ```
  Reference: `tests/ui-testing/playwright-tests/Logs/region.spec.js:40-47` (setup) and
  `logstable.spec.js:18-28`.

- **Add fields as table columns (so there is something to reorder):**
  ```js
  await pm.logsPage.fillIndexFieldSearchInput('kubernetes_container_name');
  await pm.logsPage.hoverOnFieldExpandButton('kubernetes_container_name');
  await pm.logsPage.clickAddFieldToTableButton('kubernetes_container_name');
  ```
  Reference: `tests/ui-testing/playwright-tests/Logs/logstable.spec.js:43-51`;
  helpers at `logsPage.js:3414/3438/3448`.

- **Verify a column header exists (order assertion uses the same selector):**
  ```js
  await expect(page.locator('[data-test="log-search-result-table-th-<field>"]')).toBeVisible();
  // Order check: read all headers in DOM order
  const order = await page.locator('[data-test^="log-search-result-table-th-"]')
    .evaluateAll(els => els.map(e => e.getAttribute('data-test')));
  ```
  Selector source: `web/src/plugins/logs/TenstackTable.vue:75` (`log-search-result-table-th-${header.id}`).
  Helper: `logsPage.js:3448` (`expectFieldInTableHeader`).

- **Save a view through the UI (produces array-format colOrder):**
  ```js
  await page.locator('button').filter({ hasText: 'savesaved_search' }).click(); // left split button
  await page.locator('[data-test="add-alert-name-input"]').fill(viewName);
  await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
  ```
  Reference: `tests/ui-testing/playwright-tests/Logs/region.spec.js:103-106`.
  (POM helper `pm.logsPage.clickSaveViewButton()` / `fillSavedViewName()` / `clickSavedViewDialogSave()`
  at `logsPage.js:1959/1971/1975`.)

- **Apply a saved view through the UI:**
  ```js
  await page.locator('[data-test="logs-search-saved-views-btn"]').getByLabel('Expand').click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').fill(viewName);
  await page.getByTitle(viewName).click();
  ```
  Reference: `tests/ui-testing/playwright-tests/Logs/region.spec.js:111-117`.

- **Seed the LEGACY object-format colOrder (headline normalization test).**
  The UI can no longer produce an object colOrder, so craft it through the saved-views API.
  Robust path (copy a REAL, valid searchObj — do NOT hand-build one):
  1. Create a view through the UI with a known column order (above) — or reuse any existing view.
  2. Read its payload: `GET {INGESTION_URL}/api/{org}/savedviews/{view_id}` → `body.data.data`
     is the full `searchObj` (contains `resultGrid.colOrder["e2e_automate"]` = array).
  3. Corrupt it to object form:
     ```js
     const arr = body.data.data.resultGrid.colOrder['e2e_automate']; // e.g. ['b','a']
     const objForm = {}; arr.forEach((f, i) => objForm[i] = f);
     body.data.data.resultGrid.colOrder['e2e_automate'] = objForm;   // {0:'b',1:'a'}
     // also mirror into selectedFields so fallback logic is bypassed/consistent:
     body.data.data.stream.selectedFields = [...arr];
     ```
  4. Write it back: `PUT {INGESTION_URL}/api/{org}/savedviews/{view_id}` with
     `{ data: body.data.data, view_name: body.data.view_name }`.
  5. In the UI, apply the view and assert the columns render in `arr` order.
  - API contract: `src/common/meta/saved_view.rs:20-28` — `data` is arbitrary `serde_json::Value`
    (no schema validation), `view_name` must be unique per org.
  - Client reference: `web/src/services/saved_views.ts` (`getViewDetail`, `put`).
  - API auth is the same Basic auth headers used for ingestion (`getAuthHeaders()`).

## Preconditions / toggles

- **Non-SQL mode**: ensure the SQL toggle is OFF (`searchObj.meta.sqlMode=false`). `applySavedView`
  force-sets `sqlMode=false` on apply anyway (`SearchBar.vue:3675`); start in non-SQL mode for
  predictability.
- **Quick mode**: turn OFF before adding fields (`logstable.spec.js:24-25`
  `pm.logsPage.ensureQuickModeState(false)`), so explicit field selection drives the columns.
- **Timestamp column is always pinned first** and excluded from `selectedFields`
  (`TenstackTable.vue:859-870`, normalization `.filter(field !== timestamp_column)`). Assertions
  must ignore the leading `_timestamp` column.
- **Saved view name uniqueness**: backend enforces unique `view_name` per org
  (`saved_view.rs` doc). Use a randomized suffix, e.g. `view-${Date.now()}`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Column drag-reorder uses vue-draggable (Sortable.js), NOT HTML5 drag.**
  `Playwright locator.dragTo()` (HTML5 `dragstart`) often does NOT fire Sortable events. Use manual
  pointer events (`mouse.move` → `mouse.down` → `mouse.move` → `mouse.up`) on the header cells
  (`[data-test="log-search-result-table-th-<field>"]`). If drag proves too flaky, the alternative is
  to seed the order via the API (object-format view) and assert normalization on apply — which is
  the feature's actual headline behavior.
- **Schema/columns arrive async.** After `applySavedView`, the table re-renders on a 1000ms
  `setTimeout` + `extractFields()` (`SearchBar.vue:4092-4103`). Wait for a specific column header
  (`[data-test="log-search-result-table-th-<field>"]`) to be visible before asserting order — do not
  assert immediately after clicking the view.
- **`Object.values` ordering caveat:** integer-like keys are iterated in ascending numeric order, so
  `{0:'b',1:'a'}` → `['b','a']` (matches original array order). Only seed contiguous integer-keyed
  objects (the historical shape); sparse/non-numeric keys are not a real-world case.
- **Applying a view re-runs the search** and re-renders the saved-views list. Re-open the dropdown
  only after the table stabilizes — see the `clickSavedViewsExpand()` wait logic at
  `logsPage.js:1915-1957`.
- **Default columns**: if `selectedFields` is empty the table shows only `_timestamp` + `source`
  (`useStreamFields.ts:982-997`). Always add ≥2 fields (or seed `selectedFields`) before reordering,
  or there is nothing to reorder.

## Scope tags

- `e2e_automate` stream: **[shared/read-only]** — reused by all tests; no per-test stream needed.
- Legacy object-format saved view: **[per-test]** — each test that exercises the normalization
  creates its own uniquely-named view (random suffix) and deletes it in a `finally`/`afterEach`
  (via `DELETE /api/{org}/savedviews/{view_id}`) to avoid name collisions across runs.
