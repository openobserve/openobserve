# Test Setup Contract: Dashboard Add Panel Stream List Loads Without Preselected Stream (area: Dashboards)

E2E spec: `tests/ui-testing/playwright-tests/Dashboards/add-panel-stream-list.spec.js`
Playwright group: `Dashboards-Visualize` (actual folder `Dashboards`).

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `e2e_automate` **[shared/read-only]** — a **logs**-type stream (fields include
  `kubernetes.pod_name`, `kubernetes.namespace_name`, `kubernetes.host`, `message`, `level`,
  `method`, `took`, `FloatValue`, `log`, etc.). Why: the stream-list dropdown on the logs "Build"
  page and the Dashboards "Add Panel" page is populated from `GET /api/{org}/streams?type=logs` —
  at least one logs stream must exist or the dropdown renders "No options found". Read-only: no
  test mutates the stream, only selects it.

No per-test streams are required for this feature (the behavior under test is the *stream list*
loading, not field schema). Metrics/traces streams are optional and only needed if a test exercises
Workflow 3 (switch stream type → metrics list loads); if that case is included, note it may be
empty in a fresh org unless a metrics stream is also ingested.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest a logs stream: call the shared helper `ingestion(page)` from
  `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js` (defaults to stream
  `e2e_automate`, POSTs `tests/test-data/logs_data.json` to
  `${INGESTION_URL}/api/{org}/e2e_automate/_json`). See usage in
  `tests/ui-testing/playwright-tests/Dashboards/visualize.spec.js:53` (inside `beforeEach`).
  - Auth headers come from `tests/ui-testing/utils/cloud-auth.js` (`getAuthHeaders()` /
    `getOrgIdentifier()`); org id = `process.env.ORGNAME ?? "default"`.
- Navigate to Logs: `page.goto(`${logData.logsUrl}?org_identifier=${process.env.ORGNAME ?? "default"}``)
  where `logData = require("../../fixtures/log.json")` — see `visualize.spec.js:56-58`.
- Page manager: `const pm = new PageManager(page)` (`tests/ui-testing/pages/page-manager.js`).
- Open the "Build" page (primary path, NO stream required): click
  `[data-test="logs-build-toggle"]`, then wait for `[data-test="panel-editor-container"]`
  (`state: "attached"`, mirroring `tests/ui-testing/pages/dashboardPages/visualise.js:53-65`).
- Assert the stream list loaded: open `[data-test="index-dropdown-stream"]`, then expect
  `[data-test="index-dropdown-stream-option"]` to include the ingested stream
  (`e2e_automate`) via `data-test-value`/`hasText` — the select-option pattern already exists in
  `tests/ui-testing/pages/dashboardPages/dashboard-chart.js:157-204` (`selectStream`).
- Dashboard Add Panel path (alternative): `pm.dashboardCreate.createDashboard(name)` then
  `pm.dashboardCreate.addPanel()` — see `tests/ui-testing/pages/dashboardPages/dashboard-create.js:77-211,303-343`.

## Preconditions / toggles

- Logs "Build" toggle (`logs-build-toggle`) is NOT gated on `timechart_enabled` and has no stream
  guard — do NOT use `logs-visualize-toggle` (that one is gated on `timechart_enabled` AND requires
  exactly one selected stream; `visualize.spec.js:90-91` skips it on cloud).
- The field list is visible by default (`layout.showFieldList=true`). If a test first collapses it,
  use `[data-test="panel-editor-field-list-collapsed-icon"]` to re-expand.
- Stream list is org-scoped and cached in Vuex (`store.state.streams.logs`). Within one test,
  switching stream type triggers a fresh `nameList` call per type; a reused page across tests could
  hit the cache — prefer a fresh navigation per test (the `visualize.spec.js` `beforeEach` already
  does this).

## Gotchas (so the Healer/Engineer don't rediscover them)

- The stream dropdown is an `OSelect`; options are only in the DOM after the popover opens
  (`[data-test="index-dropdown-stream-popover"]` + `[data-test="index-dropdown-stream-option"]`).
  Asserting option count requires first clicking the trigger.
- The panel editor mounts asynchronously after the "Build" toggle — always wait on
  `[data-test="panel-editor-container"]` (`state: "attached"`) before touching
  `[data-test="index-dropdown-stream"]`.
- `getStreams` shows a loading toast only when `notify=true`; `PanelFieldList` calls it with
  `notify=false` (`getStreams(stream_type, false)`), so no toast to wait on — wait on the dropdown
  becoming enabled / the popover listing options instead.
- The stale-response guard (`getStreamList`, `PanelFieldList.vue:1047-1056`) means a late logs
  response never clobbers a newer type's list — if a test switches type then immediately reads the
  dropdown, allow a tick/`networkidle` for the new `nameList` to resolve
  (`dashboard-chart.js:151-153` already waits `networkidle` after a type switch).
