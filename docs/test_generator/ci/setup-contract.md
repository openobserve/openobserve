# Test Setup Contract: Alerts & SLO Folder-scoped Creation  (area: Alerts)

This contract is read by the Engineer (implements setup), the Healer and the
Refiner (consult it instead of blind-scanning when a data/setup failure appears).
Every pattern below is copied from an existing helper — do NOT invent setup.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / reuse.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- `alert_import_<random>` (logs) **[per-test / shared-per-file]** — fields `city`, `country`, `status`, `age`, `test_run_id`, `test_timestamp`, `message`. Why: the imported alert JSON references `stream_name` + `stream_type=logs`, and `validateAlertInputs` requires the stream to exist in the stream list (ImportAlert.vue:669-679). Same stream is the trigger stream for the alert round-trip.
- A second stream is NOT required for the folder-scoping assertions themselves; folder scoping is verified by the create request's `?folder=` / `folder_id` and by which folder the resource is listed under.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Stream (logs with known columns)
- **Helper:** `pm.commonActions.initializeAlertTestStream(streamName)`
  — see `tests/ui-testing/pages/commonActions.js:358`. It POSTs to
  `/api/{org}/{stream}/_json` with a record containing `city/country/status/age/test_run_id/test_timestamp/message`
  and polls `/api/{org}/streams?type=logs` up to 90s for registration.
- **Reference usage:** `tests/ui-testing/playwright-tests/Alerts/alerts-import.spec.js:34`
  (`await pm.commonActions.initializeAlertTestStream(testStreamName);`).

### Folder (alerts namespace — shared by Alerts, anomaly, and SLOs)
- **Helper:** `pm.alertsPage.createFolder(folderName, description)`
  — see `tests/ui-testing/pages/alertsPages/alertsPage.js:1501`.
- **Navigate into folder:** `pm.alertsPage.navigateToFolder(folderName)` (alertsPage.js:1542) —
  clicks the folder tab `[role="tab"]:has([data-test="dashboard-folder-tab-name-<name>"])`
  and waits for `data-state="active"` + the folder-scoped refetch.
- **Ensure-then-create:** `pm.alertsPage.ensureFolderExists(folderName, description)` (alertsPage.js:1622).
- **Cleanup:** `pm.alertsPage.deleteFolder(folderName)` (alertsPage.js:1634) or
  `pm.dashboardFolder.deleteFolder(folderName)` (used in alerts-import.spec.js:156).
- **Reference usage:** `tests/ui-testing/playwright-tests/Alerts/alerts-import.spec.js:68-69`
  (`const folderName = 'auto_' + sharedRandomValue; await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');`).

### Destination + validation infrastructure (needed by alert import validation)
- **Helper:** `pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue)`
  — see `tests/ui-testing/pages/alertsPages/alertsPage.js:3039`. Returns
  `{ streamName, destinationName, templateName }`. The alert-import path requires
  `destinations.length > 0` and every referenced destination to exist
  (`validateAlertInputs` ImportAlert.vue:899-936), so a destination must exist
  before importing.
- **Reference usage:** `tests/ui-testing/playwright-tests/Alerts/alerts-import.spec.js:59`
  (`validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);`).
- Simpler per-test destination creation is also available via
  `pm.alertDestinationsPage.*` (see alerts-import.spec.js:220-257).

### Alert import JSON fixture
- **Production path (preferred):** export an existing alert then import it:
  `const download = await pm.alertsPage.exportAlerts();` (alertsPage.js:2884) →
  `download.saveAs(path)`. The exported JSON carries `org_id`, `stream_name`,
  `stream_type`, `destinations`, etc. — exactly what `validateAlertInputs` expects.
  See alerts-import.spec.js:126-151.
- **Static fixtures** already used: `../test-data/invalid-alert.json`
  (`pm.alertsPage.importInvalidFile(...)`, alerts-import.spec.js:150).

### SLO
- **Navigation:** `pm.sloFormPage.gotoNew(orgId)` → `/web/slos/add?org_identifier=<org>`
  (sloFormPage.js:81). List: `pm.sloListPage.goto(orgId)` (sloListPage.js:50).
- **Fill a count SLO:** `pm.sloFormPage.fillCountSlo({ name, stream, goodExpr, target, windowSecs, sliceSecs })`
  (sloFormPage.js:373). **Fill time-slice:** `fillTimeSliceSlo(...)` (sloFormPage.js:388).
- **Save + wait:** `pm.sloFormPage.saveExpectingSuccess()` (sloFormPage.js:357) —
  waits for the URL to leave `/slos/(add|edit)`, which is the confirmation the
  create/update request completed.
- **Row presence:** `pm.sloListPage.expectRowVisible(name)` (sloListPage.js:143);
  folder column reads from `foldersByType.alerts` (SloList.vue:540-542).

### Anomaly config
- **Page object:** `pm.anomalyDetectionPage` (page-manager.js:255). Folder travels
  through the same inline folder selector as the regular alert
  (`inline-select-folder-dropdown`). No dedicated anomaly folder helper exists;
  reuse the alert create path with `add-anomaly` mode (AlertList.vue:67-71 routes
  `name: 'addAnomalyDetection'` with `folder: activeFolderId`).

## Auth / org
- `ORGNAME=default`; the worker auth state / login is handled by the enhanced
  base fixtures. Org identifier via `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js` (also used at
  alerts-import.spec.js:6). Base URL `process.env.ZO_BASE_URL` (default
  `http://localhost:5080`). Navigation URL fixture: `logData.alertUrl` =
  `/web/alerts/` (`tests/ui-testing/fixtures/log.json:85`).

## Timing / hydration gotchas
- **Stream registration is async** — after `initializeAlertTestStream`, reload the
  page before opening the wizard so the SPA's stream-list fetch sees the new stream
  (commonActions.js:387-425 comment; alerts-import.spec.js:45-47 does
  `page.reload()` + `networkidle`).
- **SLO edit hydration** — `load()` runs in async `onMounted`; wait for the name
  field to be non-empty (`pm.sloFormPage.waitForHydration()`, sloFormPage.js:107)
  before asserting persisted values.
- **Import success navigation is delayed 400ms** (ImportAlert.vue:530-540) to let
  Monaco's debounce finish; wait for the alert-list page / cell, not the transient
  success toast (alertsPage.js:2995-3001).
- **Folder list must be loaded** into `store.state.organizationData.foldersByType.alerts`
  before the import/SLO folder picker shows options — it is populated by the
  Alerts/SLO list `FolderList` on page load, so navigate through the list first
  (do not deep-link straight into import/SLO-add without visiting the list).

## Preconditions / toggles
- OSS build (`build_type=opensource`): anomaly detection is available in OSS; the
  `alert-sources` route (incidents) is NOT (bounces to alertList) — not needed here.
- SLO count/time_slice require a stream of the chosen type; for PromQL shapes the
  stream type must be `metrics` (both query-language toggles are `v-if="isMetricsStream"`,
  AddSlo.vue:790).
- Alert import requires at least one destination (see above).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Folder dropdown has no unique `data-test` on the SLO form / import** — it is
  the shared `SelectFolderDropDown` selector `alerts-index-dropdown-stream_type`
  (and `alerts-folder-move-new-add` / `alerts-folder-move-dialog`). On the import
  screen there are TWO folder pickers rendered (one per tab), but only one tab is
  visible at a time (`v-if="activeTab === ..."` in BaseImport), so scope the
  locator to the visible tab.
- **Import correction cards are conditional** — they only render when
  `validateAlertInputs` pushes errors; a clean exported file produces no error
  cards, only creation-result rows (`alert-import-creation-*`).
- **OSelect commits asynchronously** — use the page objects' `selectOption`
  (retries until the trigger reports the value) rather than a bare click; a
  silently-uncommitted select is the most common false pass (sloFormPage.js:150-225,
  oselectHelpers.js).
- **SLO folder change on the form does not alter the list's active folder** — the
  list is folder-scoped by `route.query.folder` (SloList.vue:466-468), and the
  form seeds `folder_id` from `route.query.folder` (AddSlo.vue:638). Assert the
  created SLO appears under the folder you picked via the folder column / list
  scope, not by assuming the rail moved.
- **Exported alert carries the source `folder_id`?** No — `createAlert` deletes
  `input.id` and overwrites `input.folder_id = folderId` (ImportAlert.vue:967, 970),
  so the imported copy always lands in the picker's folder, regardless of the
  export's origin. This is the exact behaviour to assert.
