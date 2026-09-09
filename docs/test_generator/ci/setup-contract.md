# Test Setup Contract: List Pagination & Back-Navigation State Restoration  (area: Alerts)

> Read by the Engineer (implements setup), the Healer and the Refiner (consult instead of blind-scanning on data/setup failures). Scope is the **Alerts** spec
> `tests/ui-testing/playwright-tests/Alerts/alerts-list-pagination-restore.spec.js`. Secondary notes for SLO/Dashboard variants are included because they share the pattern, but they are not required for the primary spec.

## Streams / data the spec must establish

- **`default` alerts folder — 25+ alerts** **[per-test]** — each a plain scheduled alert. Fields carried by the seeded row: `name`, `stream_type=logs`, `stream_name=alerts_p0_stream`, `is_real_time=false`, `trigger_condition`, `destinations=[auto_p0_dest]`, `enabled=true`. Why: the Alerts list is `pagination="client"` with default `pageSize=20`, so > 20 rows is required to reach page 2 (the "Showing 21 - 40" assertion). The alert list endpoint fetches up to 1000 rows in one call (`AlertList.vue` `getAlertsFn` → `alertsService.listByFolderId(1, 1000, …)`), so 25 alerts all render and paginate client-side.
- **The alert fixture prerequisites** (stream + template + destination) **[per-test, idempotent]** — `alerts_p0_stream` (logs stream), `auto_p0_tmpl` (http template), `auto_p0_dest` (self-referencing http destination). Why: `simpleAlert`'s `destinations:[DEST]` must resolve; the Add-alert button is also disabled until templates/destinations exist.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Seed fixtures (stream/template/destination):** `await seedAlertFixtures(page)` — see `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:156–178`. Idempotent (create-if-absent + update). Creates `alerts_p0_stream`, `auto_p0_tmpl`, `auto_p0_dest` (a dogfood destination pointing back at this instance's own ingest, so no third-party webhook).
- **Create the 25 alerts via API (fast path — do NOT use the UI wizard):**
  ```js
  const { seedAlertFixtures, createAlert, simpleAlert, deleteAlerts } = require('../../utils/alerts-api-helpers.js');
  await seedAlertFixtures(page);
  const names = Array.from({ length: 25 }, (_, i) => `page_restore_${uniq}_${i}`);
  for (const n of names) await createAlert(page, simpleAlert(n));   // POST /api/v2/{org}/alerts?folder=default
  ```
  - `createAlert` = `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:120–122` (POST `/api/v2/{org}/alerts?folder=default`).
  - `simpleAlert` = `alerts-api-helpers.js:39–57` (canonical scheduled-alert payload, `destinations:[DEST]`).
  - Reference specs already using this exact pattern: `tests/ui-testing/playwright-tests/Alerts/alerts-priority-tags.spec.js:195–197` and `tests/ui-testing/playwright-tests/Alerts/alerts-multialert-ui.spec.js:31–42` (`createAlert(page, multiAlert(name))`).
- **Cleanup:** `deleteAlerts(page, ids)` (`alerts-api-helpers.js:141–146`) in `afterEach`; capture ids from the `createAlert` responses. Alerts are folder-scoped (`folder=default`); the list GET (`listAlerts`) can find ids by name for teardown.
- **Auth/org:** use `getAuthHeaders()` / `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (already used by the helpers). Navigate with `page.goto('/web/alerts?org_identifier=' + getOrgIdentifier())`. Reuse the `PageManager` (`new PageManager(page)`) and `enhanced-baseFixtures.js` login flow as every Alerts spec does (see `tests/ui-testing/playwright-tests/Alerts/alerts-e2e-flow.spec.js:1–13`).

## Preconditions / toggles

- **Default folder only.** The round trip in this spec uses the `default` folder (no folder creation needed). `createAlert` posts with `?folder=default`; the list opens on `folder=default` (or no `folder` param → `activeFolderId` resolves `"default"`).
- **No SQL/enterprise toggles.** This is OSS; the Anomaly Detection tab is unavailable (`isAnomalyDetectionEnabled` false on OSS) — do not target the anomaly tab. Plain scheduled alerts render on the default "all" tab.
- **Wait for the list to be loaded before paging:** gate on the pagination info skeleton disappearing — e.g. `await expect(page.locator('[data-test="o2-table-pagination-info-skel"]')).toHaveCount(0)` and `await expect(page.locator('[data-test="o2-table-pagination-info"]')).toBeVisible()` inside `alert-list-table`.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Alerts pagination is NOT URL-synced.** `AlertList.onPageChange` (`AlertList.vue:2280–2282`) writes only to Vuex (`alertListFilters.currentPage`), never to the URL. Assert on `o2-table-pagination-info` ("Showing 21 - 40 of N") and/or which rows are visible — **not** on a `page` query param (that's SLO/Dashboards).
2. **The store is the restore source and must persist across the round trip.** The test must stay in one SPA session: navigate to page 2 (persist watch commits `currentPage`), navigate to detail, back — with **no full page reload** in between (a reload re-seeds from a fresh store). Use the header back button (`[data-test="app-page-header-back"]`) or browser `goBack()`.
3. **The restore is async and races TanStack.** After returning, `watch(loading,{once})` re-applies the page in `setTimeout(0)`. Assert only after the table has finished loading (skeleton gone) — polling with `expect(...).toHaveText(/21 - 40/)` + `toPass`/`toHaveText` timeout is the robust pattern.
4. **Row order is not guaranteed.** `AlertList` maps the API list in server order (no client sort applied to `filteredResults`). To assert "a page-2 row is visible", pick a name you know is NOT on page 1, or assert the footer range instead of a specific name's position.
5. **Pagination selectors are shared and un-prefixed.** `o2-table-next-page-btn`, `o2-table-pagination-info`, etc. exist on every OTable. Always scope to `[data-test="alert-list-table"]` to avoid matching a second table (e.g. a drawer/editor).
6. **The next-page button is disabled on the last page.** With 25 rows / pageSize 20 there are exactly 2 pages, so `next-page` works from page 1 (→ page 2) and is then disabled. The `last-page-btn` is rendered (totalCountExact) and disabled on page 2.

## Secondary variants (reference only — not required for the Alerts spec)

- **SLO list (URL-backed):** seed > 25 SLOs via `createSloViaApi(page, countDefinition({ name, stream }))` — `tests/ui-testing/playwright-tests/utils/slo-seed.js:378–392` + `countDefinition` (`:458–491`); seed a selectable stream with `seedMinimalStream(page, streamName)` (`:246–263`). The SLO list page size is fixed at **25**. Pagination restore is via `?page=` in the URL (assert the URL + footer). Reference: `tests/ui-testing/playwright-tests/SLO/slo-crud.spec.js:102`.
- **Dashboards (URL-backed):** create dashboards via `pm.dashboardCreate.createDashboard(name)` (`tests/ui-testing/pages/dashboardPages/dashboard-create.js:211`); no dedicated bulk API helper exists, so 21+ dashboards is expensive — do not target Dashboards in this spec unless the Architect explicitly scopes it in.
