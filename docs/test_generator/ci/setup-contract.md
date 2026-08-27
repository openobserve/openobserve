# Test Setup Contract: Dashboards E2E Test Stabilization (area: Dashboards)

Primary spec: `tests/ui-testing/playwright-tests/Dashboards/dashboard-filter.spec.js`
(19 tests; all read the same stream `e2e_automate`, create their own dashboard, and clean it up.)

## Streams / data the spec must establish

### `e2e_automate` **[shared/read-only]**
- **Why:** every test reads it — the Query Values variable `variablename` and every filter condition
  (`kubernetes_container_name`, `kubernetes_container_image`, `kubernetes_namespace_name`) resolve
  against this stream's schema and data.
- **Fields (schema, after JSON dot-notation flattening to underscores):**
  - `kubernetes_container_name` — TEXT; value `ziox` present (2002 records) → used by variable default + `=` / `str_match` / `Contains` etc.
  - `kubernetes_container_image` — TEXT; non-null image URLs (e.g. `058694856476.dkr.ecr.../ziox:v0.0.3`) → used by `<>` and nested-group conditions.
  - `kubernetes_namespace_name` — TEXT; values `ingress-nginx` (814), `kube-system` (8) → used by the list filter (`IN ('ingress-nginx','kube-system')`).
  - also present: `kubernetes_pod_name`, `kubernetes_host`, `log`, `_timestamp` (auto), etc.
- **No per-test stream is needed.** No test mutates `e2e_automate`; all tests are read-only against it
  and clean up only their own dashboard.

### No unique per-test streams
All tests use the same `e2e_automate` stream. The only per-test artifacts are **dashboards** (and their
panels/variables), which are created with a generated name and deleted at the end of each test.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `await ingestion(page)` — imported as `{ ingestion }` from
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js`, invoked in the spec's
  `test.beforeEach` (see `dashboard-filter.spec.js:19-23`).
  - It POSTs `tests/test-data/logs_data.json` (3848 kubernetes log records) to
    `${process.env.INGESTION_URL}/api/${getOrgIdentifier()}/e2e_automate/_json` with `getAuthHeaders()`.
  - Retries 401/403 (cloud passcode refresh via `refreshCloudConfig(page)`) and 5xx; throws on other non-ok.
- **Auth/org:** `getAuthHeaders()` + `getOrgIdentifier()` come from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`. Org defaults via `ORGNAME` env /
  `org_identifier` query param. Login is handled by the base fixture (`navigateToBase`) in
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`.
- **Dashboard creation:** `pm.dashboardCreate.createDashboard(name)` →
  `tests/ui-testing/pages/dashboardPages/dashboard-create.js` (waits for POST `/api/{org}/dashboards`,
  navigates to `/dashboards/view`, gates on `[data-test="dashboard-global-date-time-picker"]`).
- **Variable:** `pm.dashboardVariables.addDashboardVariable("variablename","logs","e2e_automate","kubernetes_container_name")`
  → `tests/ui-testing/pages/dashboardPages/dashboard-variables.js:86` (Query Values variable, default type).
  - `customValueSearch=true` and/or `showMultipleValues=true` variants for tests 8 and 11.
- **Panel:** `pm.dashboardCreate.addPanel()` → `pm.chartTypeSelector.selectChartType("line")` →
  `selectStreamType("logs")` → `selectStream("e2e_automate")` →
  `pm.dashboardPanelActions.applyDashboardBtn()` → `waitForChartToRender()`.
- **Time range:** `waitForDateTimeButtonToBeEnabled(page)` (from `pages/dashboardPages/dashboard-time.js`)
  then `pm.dashboardTimeRefresh.setRelative("30","m")` (from `pages/dashboardPages/dashboard-refresh.js`).
- **Cleanup:** `pm.dashboardCreate.backToDashboardList()` then `deleteDashboard(page, name)` (from
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js`).

## Timing / waits (use these, do not hard-sleep)

- Chart data ready: `pm.dashboardPanelActions.waitForChartToRender()` (gates on chart-renderer / no-data clear).
- Variable value stream: `waitForValuesStreamComplete(page, timeout)` from
  `tests/ui-testing/playwright-tests/utils/streaming-helpers.js` (listens for the `/_values_stream`
  `data: [[DONE]]` sentinel before asserting the option is present).
- Variable option present: `selectValueFromVariableDropDown` already polls (close/reopen the dropdown
  until the option `data-test-value` renders) — do not add additional fixed waits.
- Query inspector rows: `pm.dashboardPanelEdit.waitForQueryInspector()` waits for
  `[data-test="query-inspector-dialog"]` AND the `query-inspector-executed-query-${index}` row (the
  dialog mounts before rows populate).
- Stream schema hydration: `StreamFieldSelect` fetches schema async (`getStream(...)`); the field
  dropdown options (`stream-field-select-option` with `data-test-label`) only render after that resolves.
  The page objects already wait on the popover + option — do not query the field list before opening the dropdown.

## Preconditions / toggles

- Non-SQL (visual/auto) builder mode: the filter builder (`DashboardFiltersOption.vue`) is hidden when
  the query is a custom SQL query (`DashboardFiltersOption.vue:4-9`). Do NOT toggle to SQL mode.
- Line chart (`selectChartType("line")`) with `logs` stream type; the default `histogram(_timestamp)`
  + `count(_timestamp)` projection is what the SQL assertions encode.
- The data-view query-inspector button (`dashboard-panel-data-view-query-inspector-btn`) is only rendered
  for non-html/markdown/custom_chart panel types (`AddPanel.vue:62`). Line chart satisfies this.
- OSS edition: `dashboard-apply` is a single primary button (`config.isEnterprise === 'false'`,
  `AddPanel.vue:102`); disabled while a search is in flight — `waitForChartToRender()` covers this.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Field names are underscore-flattened.** `logs_data.json` stores dotted keys
  (`kubernetes.container_name`), but the schema/sql uses underscores (`kubernetes_container_name`).
  Query by the underscore names exactly as the spec does.
- **`--group-index` = nesting depth.** `getGroup(n)` matches `[style*="--group-index: n"]`, and
  `Group.vue` binds `--group-index: groupNestedIndex` (depth), not positional index.
- **Dynamic condition labels.** The condition trigger data-test embeds the built SQL label
  (`dashboard-add-condition-label-${idx}-${computedLabel}`); re-editing an already-valued condition
  relies on the page object's `[data-test^="dashboard-add-condition-label-${idx}-"]` partial fallback.
- **Stale operator search selector.** Page objects look for `[data-test="o-select-search-input"]`, which
  no longer exists (real: `dashboard-add-condition-operator-search`). It degrades gracefully today
  (operator list < 50 items → all rendered, so `data-test-value` click works). Fix the page object rather
  than adding sleeps.
- **`_values_stream` status is the real custom-search signal.** Ingested records can lag indexing; the
  values-stream wait + reopen-poll in `selectValueFromVariableDropDown` is the backstop — a 200 on the
  raw ingest POST does not mean the value is queryable yet.
- **Parallel mode.** `test.describe.configure({ mode: "parallel" })` — dashboards are uniquely named via
  `generateDashboardName()`; never assert on a hardcoded dashboard name.
