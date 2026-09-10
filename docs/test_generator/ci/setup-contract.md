# Test Setup Contract: Dashboard Add Panel Query Type Selector  (area: Dashboards)

Spec: `tests/ui-testing/playwright-tests/Dashboards/dashboard-query-type-selector.spec.js`
Playwright group: `Dashboards-Core` (runs `mode: "parallel"`)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE (or rely on the pre-seeded CI environment).
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate` [shared/read-only]** — logs stream with `kubernetes_*` fields (e.g.
  `kubernetes_container_hash`, `kubernetes_host`, `kubernetes_namespace_name`).
  Why: the SQL-builder baseline (Workflow 2 — build a logs panel to get a non-empty
  SQL query before exercising the Custom→Builder confirmation dialog). Pre-seeded by
  the CI environment; used by every existing dashboard config spec (e.g.
  `configPanelHelpers.buildPanel` → `selectStream("e2e_automate")`).
- **metrics [shared/read-only]** — OTLP metric `cpu_usage` (plus `up`, `memory_usage`,
  `request_count`, `request_duration`) ingested into stream `default`.
  Why: the PromQL toggle only appears when `stream_type == "metrics"` (Workflow 1);
  and `ensureMetricsIngested()` provides a queryable metric for the auto-select path.
  Established ONCE per run via `test.beforeAll` → `ensureMetricsIngested()`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Navigate + create a dashboard:**
  `await setupTestDashboard(page, pm, dashboardName)` —
  see `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:356`.
  (`navigateToBase(page)` is called in `test.beforeEach`; see
  `dashboard-config-promql.spec.js:32-34`.)
- **Add a panel (opens the PanelEditor with the query-type selector):**
  `await pm.dashboardCreate.addPanel()` — see `configPanelHelpers.buildPanel`
  (`tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:111-112`).
- **Choose chart type:**
  `await pm.chartTypeSelector.selectChartType("line")` —
  `tests/ui-testing/pages/dashboardPages/dashboard-chart.js:127`.
- **Switch stream type to metrics (reveals the PromQL item + fires auto-select):**
  `await pm.chartTypeSelector.selectStreamType("metrics")` —
  `tests/ui-testing/pages/dashboardPages/dashboard-chart.js:152`.
- **Metrics data (test.beforeAll):**
  `const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');`
  then `test.beforeAll(async () => { await ensureMetricsIngested(); });` —
  see `tests/ui-testing/playwright-tests/Dashboards/dashboard-config-promql.spec.js:21,28-30`.
- **Cleanup:**
  `await cleanupTestDashboard(page, pm, dashboardName)` —
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:381`.
  Name generator: `generateDashboardName()` from
  `tests/ui-testing/playwright-tests/Dashboards/utils/configPanelHelpers.js:83`.

## Preconditions / toggles

- The query bar (and thus the selector) is visible because `layout.showQueryBar`
  defaults to `true` (`useDashboardPanelDefaults.ts:177`). No toggle needed.
- Fresh panel default state: `queryType="sql"`, `customQuery=false`,
  `stream_type="logs"` (`useDashboardPanelDefaults.ts:128,134,138`) → SQL + Builder
  selected, PromQL button **absent**.
- To exercise the **Custom→Builder confirmation dialog** you must first get a
  non-empty query. Two routes, both copied from existing specs:
  - **Builder logs panel:** `buildPanel` already produces a SQL query against
    `e2e_automate` (auto-generated `SELECT … FROM "e2e_automate"`). Switch to Custom,
    then back to Builder → dialog appears.
  - **PromQL custom:** follow `buildPromQLPanel`
    (`configPanelHelpers.js:313`) — `selectStreamType("metrics")` → click PromQL →
    click Custom → type a query in `[data-test="dashboard-panel-query-editor"]`.
    Then Custom→Builder shows the `switchToBuilderConfirm` message variant.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **PromQL button is `v-if` on `stream_type`, not on stream selection** — it appears
  the moment you `selectStreamType("metrics")`, before any metric is chosen. Auto-select
  fires on that same type change (fresh panel has empty `fields.stream`).
- **Auto-select races the toggle-group render.** The component awaits `nextTick()`
  before setting "promql" because the PromQL item is `v-if`-ed and does not exist yet
  (`QueryTypeSelector.vue:371-382`). Assert `data-state="on"` only after the item is
  visible; use `await expect(promqlBtn).toHaveAttribute("data-state", "on", …)` or a
  short poll, never an immediate read after clicking the type dropdown.
- **Multiple QueryTypeSelector instances exist across the app** (metrics/logs/build
  pages), but on the dashboard add-panel there is exactly one. Scope to it with
  `.first()` if the test ever runs on a page that also hosts another (it will not).
- **Selection is signaled by reka-ui `data-state="on"/"off"`, not a CSS class.**
  Use `toHaveAttribute("data-state", "on")` (existing `metricsBuilderPage.isModeSelected`
  already does this — `tests/ui-testing/pages/metricsPages/metricsBuilderPage.js:363`).
- **Confirm dialog buttons are ODialog footer buttons** scoped under the dialog panel:
  `[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]` (OK) and
  `[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]` (Cancel) — same
  pattern already in `metricsBuilderPage.js:49-50`.
- **Query-type switch (SQL⇄PromQL) never shows a dialog** — it calls `changeToggle()`
  directly. Only builder-mode transitions (Custom→Builder with a query) prompt.
- **Stream-type dropdown `selectStreamType` waits for networkidle** — don't assert the
  PromQL button before the type has actually propagated to `fields.stream_type`.
- **Do not read PromQL response bodies** if a later test extends into Apply/render —
  PromQL responses are live SSE streams; record URL/status only (see
  `dashboard-config-promql.spec.js:854-859`).
