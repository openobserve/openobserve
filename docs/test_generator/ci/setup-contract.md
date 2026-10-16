# Test Setup Contract: Create Alert from Dashboard Panel  (area: Alerts)

Spec: `tests/ui-testing/playwright-tests/Alerts/alerts-from-panel.spec.js` (Playwright group `Alerts`).

The feature is a *surface* on shared "create an alert from here" machinery. The tests must establish
**a saved dashboard panel** whose query (a) has a stream, and (b) is either multi-query or a PromQL
formula so the **confirm dialog** actually appears. The common single-query/single-stream panel
**skips the dialog** and goes straight to the form (see `needsConfirmation`,
`web/src/utils/alerts/alertPrefill.ts:347-354`) — do NOT build that panel and then assert a dialog.

## Streams / data the spec must establish

- **`e2e_automate`** **[shared/read-only]** — a logs stream used to build ordinary dashboard panels.
  Fields include `kubernetes_container_name`, `took`, `FloatValue` (ingested as lowercase
  `floatvalue`), `method`, `level`. Why: every SQL panel needs a stream; the bar/line/scatter panels
  in the threshold-flow tests read `kubernetes_container_name` / `took` / `floatvalue`.
- **`e2e_mef_http_requests_total`** and **`e2e_mef_http_errors_total`** **[shared/read-only]** — PromQL
  counter metrics (labels `method`, `status`, `instance`). Why: building a PromQL **formula** panel
  (`A / B * 100`) whose two input metrics become the dialog's `streamCandidates`
  (`create-alert-stream-option-<metric>`). See `Metrics/metrics-promql-formula.spec.js:147-149`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Logs ingestion: `await ingestion(page)` (defaults to `e2e_automate`) — helper at
  `tests/ui-testing/pages/dashboardPages/dashIngestion.js:55`, imports `logs_data.json`
  (`tests/test-data/logs_data.json`). Reference usage:
  `tests/ui-testing/playwright-tests/Dashboards/dashboard-create-alert.spec.js:52`.
- PromQL metrics seeding: `await seedDetailMetrics(request)` — helper at
  `tests/ui-testing/playwright-tests/utils/metrics-explore-seed.js:64` (exports `DETAIL_METRIC`,
  `RELATED_METRIC`). Reference usage: `tests/ui-testing/playwright-tests/Metrics/metrics-promql-formula.spec.js:49`
  (called in `beforeAll`).
- Auth/org: `ORGNAME` env var + `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`;
  force the org by navigating with `?org_identifier=${process.env["ORGNAME"]}` (see
  `dashboard-create-alert.spec.js:31-45,58-60`). `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`.
- Wait for chart render before clicking Create Alert: the panel adapter reads `executedQuery` from
  `metaData.queries` (populated by PanelSchemaRenderer's `metadata-update` emit). Use
  `waitForStreamComplete(page)` (`tests/ui-testing/playwright-tests/utils/streaming-helpers.js`) around
  `applyDashboardBtn()` and `savePanel()`, then
  `pm.dashboardPanelActions.waitForChartToRender()` /
  `pm.dashboardPanelActions.getChartRendererCanvasElement().first().waitFor(...)`. See
  `dashboard-create-alert.spec.js:94-97,178-181`.

## Panel construction patterns (for the dialog-triggering cases)

- **Multi-query PromQL formula panel (stream picker + threshold/window/query-preview)**: build via the
  Metrics Explorer builder exactly as `Metrics/metrics-promql-formula.spec.js:95-127` does — two
  code-mode PromQL inputs (`A`, `B`) over `RELATED_METRIC`/`DETAIL_METRIC`, a formula `A / B * 100`,
  hide the two inputs, run, add-to-dashboard, save panel. Then hover the saved panel, open the kebab,
  click `[data-test="dashboard-create-alert-from-panel"]`. This yields `streamCandidates.length === 2`,
  a single visible formula query (so `pickQueryOnly` is **false** — threshold shape, window, and query
  preview are all visible).
- **Single-query SQL panel (straight-to-form, no dialog)**: `dashboard-create-alert.spec.js:80-110` —
  bar chart on `e2e_automate`, Y field `kubernetes_container_name`. Use to assert the no-dialog
  navigation path and `Alert_from_<title>` name prefill.
- **Multi-query SQL panel (query picker / `pickQueryOnly`)**: add ≥2 query tabs in the panel editor
  (`[data-test="dashboard-panel-query-tab-add"]`), keep both visible, save. Then Create Alert → dialog
  shows `create-alert-query-picker` + `create-alert-picked-query-text`, and hides threshold/window.

## Dialog interaction selectors (no page object exists yet — use raw locators)

- Continue: `[data-test="create-alert-from-source-dialog"] [data-test="o-dialog-primary-btn"]`.
- Cancel: `[data-test="create-alert-from-source-dialog"] [data-test="o-dialog-secondary-btn"]`.
- Reference for both the selector pattern and the wait-for-URL assertion:
  `Metrics/metrics-promql-formula.spec.js:150-151`.
- Form prefill banner (non-blocking warnings): `[data-test="add-alert-prefill-warning-<key>"]`
  (`web/src/components/alerts/AddAlert.vue:159-168`).

## Preconditions / toggles

- Ensure a dashboard folder for cleanup navigation:
  `returnToDashboardFolder` + `deleteDashboard` from `Dashboards/utils/dashCreation.js`
  (pattern in `dashboard-create-alert.spec.js:26-45,129`).
- No SQL-mode toggle needed: this flow is not the Logs page; it is dashboard panels only.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The dialog is app-root mounted** (`CreateAlertDialogProvider` in `App.vue`); it is NOT inside the
  panel dropdown, so do not scope its locators to the panel container.
- **Single-query/single-stream panel skips the dialog** — asserting `create-alert-from-source-dialog`
  there will hang. Construct a multi-query or multi-stream-formula panel for any dialog assertion.
- **`pickQueryOnly` hides threshold/window/query-preview** — with multiple query choices the dialog
  shows only the query picker and the picked-query block.
- **Wait for the panel to actually render** before clicking Create Alert, or `executedQuery` is
  undefined and (with a `$var` in the query) a blocking `unresolvedQuery` disables Continue.
- **Stream name case**: ingest lowercases field names (`FloatValue` → `floatvalue`); the scatter test
  in `dashboard-create-alert.spec.js:409-410` already accounts for this.
- **The alert form reads prefill from `sessionStorage`**, not the URL — assert the URL contains
  `prefill=panel` and **not** `panelData=`, then assert the pre-filled name/query on the form.
