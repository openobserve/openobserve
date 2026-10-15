# Test Setup Contract: Dashboard Panel Notices (area: Dashboards)

> Read by the **Engineer** (implements setup), **Healer** and **Refiner** (consult on data/setup
> failures). Every item names the exact existing helper + `file:line` to copy. Never invent a setup
> when an existing pattern already establishes it.

## Streams / data the spec must establish

| SCOPE | Stream | Fields needed | Why (behavior) |
|-------|--------|---------------|----------------|
| `[shared/read-only]` | `e2e_automate` | `kubernetes_namespace_name`, `kubernetes_pod_name`, `kubernetes_labels_name`, `_timestamp` | baseline panels for last-refreshed clock, chips presence checks |
| `[shared/read-only]` | `e2e_max_query_range` | `kubernetes_namespace_name`, `kubernetes_labels_name`, `_timestamp` | **max-query-range warning** — stream carries `max_query_range` setting |
| `[per-test: series-cap]` | `<generated>` e.g. `e2e_panel_notices_seriescap` | a breakdown field with **>100 distinct values** (e.g. `tenant_id` with 150 values) + a numeric measure | **series-cap chip** — needs `distinct(breakdown) > max_dashboard_series` (default 100) |
| `[per-test: error]` | reuse `e2e_automate` | n/a (query references a non-existent field / malformed SQL) | **query-error icon** (`panel-error-data`) |

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest
- **Default stream**: `import { ingestion } from "./utils/dashIngestion.js";` then
  `await ingestion(page);` — ingests `tests/test-data/logs_data.json` (3848 rows) into `e2e_automate`.
  See `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js:28` and every Dashboards
  spec's `beforeEach` (e.g. `dashboard-refresh-without-cache.spec.js:69`).
- **Named stream**: `await ingestion(page, "e2e_max_query_range");` — see `maxquery.spec.js:67`.
- **Single-row / arbitrary payload** (used for the series-cap stream): copy the `_json` POST in
  `pm.commonActions.ingestTestData(streamName)` at
  `tests/ui-testing/pages/commonActions.js:305-374` (uses `page.request.post` to
  `${ZO_BASE_URL}/api/${org}/${stream}/_json` with `getAuthHeaders()`). For series-cap, POST a
  generated array of ~150 records with a `tenant_id` field taking 150 distinct values. **No existing
  fixture has >100 distinct values** — the fixture's max is `log` (2554, full-text, not a breakdown
  candidate) and `took` (156, numeric float); neither is a reliable breakdown. The generated payload
  is the only deterministic route → flag this case for the Architect (candidate `test.fixme` if the
  generated stream proves flaky).

### Auth / org
- `ORGNAME=default`; `getAuthHeaders()` / `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (already used by `dashIngestion.js`).
- Worker auth state is established by the standard `navigateToBase(page)` in `beforeEach` (see
  `maxquery.spec.js:66`).

### Dashboard + panel setup
- Create dashboard: `pm.dashboardCreate.createDashboard(name)` — see `maxquery.spec.js:95`.
- Simple panel: `import { addSimplePanel } from "./utils/dashCreation.js";` then
  `await addSimplePanel(pm, "Panel1", { chartType: "area", streamName: "e2e_automate", yAxisField: "kubernetes_namespace_name" });`
  — see `dashboard-refresh-without-cache.spec.js:40` and `dashCreation.js:405`.
- Chart config directly (breakdown/b-axis, custom fields): `pm.chartTypeSelector.selectChartType`,
  `selectStreamType`, `selectStream`, `removeField("y_axis_1","y")`, `searchAndAddField(field, "y"|"b")`,
  then `pm.dashboardPanelActions.applyDashboardBtn()`, `addPanelName`, `savePanel` — copy
  `maxquery.spec.js:40-57` (`buildPanelWithWideRange`).
- Wait for panel idle before asserting notices (diagnostics arrive async): use
  `pm.dashboardVariablesScoped.waitForPanelIdle("Panel1")` (see `dashboard-refresh-without-cache.spec.js:45`)
  or `pm.dashboardMaxQueryRange.waitForPanelsIdle()` (see `dashboard-max-query-range.js:192`).

### Max-query-range warning (headline, proven)
- Set the stream restriction: `await pm.dashboardMaxQueryRange.setMaxQueryRange(2, "e2e_max_query_range");`
  (PUT `/api/{org}/streams/{stream}/settings?type=logs` with `{ max_query_range: hours }`) —
  `dashboard-max-query-range.js:29`. Then build a panel with a 6-week range and reopen the dashboard;
  assert `panel-max-duration-warning` visible. **Full runnable template already exists**: copy
  `maxquery.spec.js:84-128` (Scenario 1). Tooltip text via `panel-max-duration-warning-content`.

### Query-error icon (medium)
- A panel whose query errors. Simplest deterministic route: a custom SQL query referencing a
  non-existent field/stream (the raw/custom-SQL pattern is exercised in
  `dashboard-raw-query.spec.js` / `dashboard-join.spec.js`). Assert `panel-error-data` becomes visible
  after the panel settles into error state. If no deterministic bad-query helper is found, park as
  `test.fixme` rather than guessing.

## Preconditions / toggles
- **Non-view mode**: the notice actions (`Use Top N`, `Edit function`, `Open inspector`) require
  `!viewOnly && !simplifiedPanelView`. Ensure the dashboard is opened in normal edit-capable mode
  (default), not a shared/view-only link.
- **SQL mode**: default. The series-cap SQL path is `sqlProcessData.ts:96-108`; PromQL path is
  `convertPromQLData.ts:339-366`. Use SQL (builder mode) for the series-cap case.
- **max_dashboard_series default = 100** (`store.state.zoConfig.max_dashboard_series`). The series-cap
  case must exceed this.

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **Chips are async**: `resultMetaData` flows through `usePanelDataLoader` → `PanelSchemaRenderer`
   (watch/emit) → host → `PanelErrorButtons`. A chip assertion fired before the panel is idle will
   fail even when the condition is real. Always gate on panel idle first.
2. **Chip collapse on narrow bars**: below `@max-[36rem]` (multiple) / `@max-[32rem]` (single) the
   individual chips fold into `panel-notice-chip-collapsed`. If the CI viewport renders a narrow
   panel, assert the collapsed chip (or the legacy `panel-limit-number-of-series-warning`) instead of
   `panel-notice-chip-series-cap`.
3. **Legacy selector aliases exist**: `panel-limit-number-of-series-warning` → series-cap chip,
   `panel-partial-data-warning` → interrupted chip (see `PanelErrorButtons.vue:266-269`). Prefer these
   if older selectors are referenced elsewhere.
4. **X-alias warning is NOT wired in the dashboard view** — `PanelContainer`/`ViewPanel` never pass
   `xAliasInconsistencyWarning` (defaults `false`). Only the Panel Editor wires it
   (`PanelEditor.vue:267/588`). A dashboard-view test for it will always fail → park as `fixme`.
5. **Series-cap has no existing fixture**: do not try to force it with `e2e_automate` fields
   (max distinct is 7–11 for breakdown candidates). Generate a dedicated high-cardinality stream.
6. **`isPartialData` (interrupted) vs `serverPartial` (partial)** are different gates — do not confuse
   the client-cancel chip (`panel-notice-chip-interrupted`) with the server-partial chip
   (`panel-notice-chip-partial`).
7. **Notice order is deterministic**: `function-error` → `series-cap` → `partial` → `interrupted`
   (`panelNotices.ts:102-153`); a `nth` selector will resolve to that fixed order.
8. **Query Inspector series-cap banner is query-0 only** (`index === 0 && seriesLimit`,
   `QueryInspector.vue:69`).
