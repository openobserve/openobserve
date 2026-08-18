# Test Setup Contract: Export Alerts & SLOs as Terraform (Export Resource Dialog) (area: Alerts)

This contract tells the Engineer exactly what data/state the spec must establish and
which EXISTING helper does it. Do NOT invent setup — copy the patterns below. It is
also the first thing the Healer/Refiner reads when a data/setup failure appears.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / pre-seeded.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Alerts export
- **`alerts_p0_stream`** (logs) **[shared/read-only]** — fields: `city`, `latency`, `status`.
  Why: alerts need a stream to evaluate against; the exporter copies `stream_name` verbatim.
  Created by `seedAlertFixtures(page)` (see below), which also creates the template + destination.
- **`auto_p0_dest`** + **`auto_p0_tmpl`** **[shared/read-only]** — the notification destination + template
  the alert references. The exporter writes `destinations` / `template` from the alert payload, so an
  alert must carry a valid one. Created by `seedAlertFixtures(page)`.
- **One or more alerts** (e.g. `simpleAlert(name)` payload) **[per-test]** — the export subject.
  Export reads `POST /api/v2/{org}/alerts/{id}/export`; the alert does NOT need to fire or be measured.

### SLO export
- **A logs stream with a few recent rows** **[per-test]** — SLO export does NOT need a measured SLI:
  `openExport` re-reads the DEFINITION via `GET /api/{org}/slos/{id}` and only requires `body.name`.
  `seedMinimalStream(page, streamName)` is sufficient (200 rows, recent — no 8-day backfill).
- **One or more SLOs** (e.g. `countDefinition({ name, stream })`) **[per-test]** — created via
  `createSloViaApi(page, definition)`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Alerts
- Seed template + destination + stream:
  `await seedAlertFixtures(page)` — `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:144`.
- Create an alert via API:
  `await createAlert(page, simpleAlert(name))` — `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:108`
  (payload builders `simpleAlert` / `multiAlert` at `alerts-api-helpers.js:39-76`).
  List/find id: `findAlertId(page, name)` (`alerts-api-helpers.js:124`); cleanup: `deleteAlerts(page, ids)` (`:129`).
- **UI creation alternative** (heavier): `pm.alertsPage.createAlert(...)` then
  `pm.alertsPage.verifyAlertCreated(...)` — see `tests/ui-testing/playwright-tests/Alerts/alerts-import.spec.js:80`.

### SLOs
- Seed stream: `await seedMinimalStream(page, streamName)` — `tests/ui-testing/playwright-tests/utils/slo-seed.js:246`.
- Create SLO: `await createSloViaApi(page, countDefinition({ name, stream }))` — `slo-seed.js:378`
  (definition builders `countDefinition` / `timeSliceDefinition` at `slo-seed.js:458` / `:415`).
- Unique name: `uniqueName(prefix)` (`slo-seed.js:364`); cleanup: `deleteSlosByPrefix(page, prefix)`
  (`slo-seed.js:857`) + `deleteFixturesByPrefix(page, prefix)` (`slo-seed.js:768`).
- **UI creation alternative**: `pm.sloFormPage.fillCountSlo({...})` + `saveExpectingSuccess()` —
  see `tests/ui-testing/playwright-tests/SLO/slo-crud.spec.js:76-94`.

### Anomaly-detection edge case (Terraform "empty" / "skipped" banners)
- An anomaly alert has no provider resource. To trigger the empty/skipped banners, create an
  anomaly-detection config via the UI (`pm.anomalyDetectionPage`) or check the anomaly API helpers in
  `tests/ui-testing/playwright-tests/utils/api-helper.js:97-140`. NOTE: this is an OPTIONAL edge-case
  test; the core workflows above only need a normal alert/SLO.

## Auth / org / navigation
- Org: `getOrgIdentifier()` (`tests/ui-testing/playwright-tests/utils/cloud-auth.js`) or `process.env.ORGNAME`
  (default `default`). Auth headers: `getAuthHeaders()` (same module) for API calls.
- Alerts URL: `/web/alerts?org_identifier=<org>` (see `tests/ui-testing/fixtures/log.json:85` = `alertUrl`).
  Navigate via `pm.commonActions.navigateToAlerts()` or direct `page.goto`.
- SLO URL: `/web/slos?org_identifier=<org>` — `pm.sloListPage.goto(ORG)` (`pages/sloPages/sloListPage.js:45`).

## Preconditions / toggles
- No feature flag / enterprise gate: this is OSS. The Alerts **Add** button is disabled until a
  destination AND template exist — irrelevant for EXPORT of existing alerts, but if you create alerts
  via the UI you must seed those first (`seedAlertFixtures` does).
- The export dialog is a client-side conversion — no backend toggle. It needs no measured data.

## Timing / hydration
- After opening the dialog, the Monaco editor (`CodeQueryEditor`) loads asynchronously. Before
  asserting editor content, wait for the code container (`[data-test="{d}-editor"]` / the
  `.monaco-editor` inside) to be visible — do not read text the instant the dialog opens.
- The dialog's `watch(open)` resets the tab to JSON on every open. If a test re-opens after a
  Terraform download, it starts on JSON again — don't assume tab persistence.
- SLO bulk export shows a loading spinner (`:loading="exporting"`) while it re-reads each SLO;
  the Export button is present but busy. Wait for the dialog to appear rather than clicking Export twice.

## Assertion ground truth (what the tests should check)
- Terraform tab content: the editor text contains `resource "openobserve_alert"` (alerts) or
  `resource "openobserve_slo"` (SLOs), the alert/SLO name, and the generated comment header
  (`# Generated by OpenObserve.`).
- JSON tab content: `JSON.parse(editorText)` — one object for a single export, an array for multi.
- Download artifact: intercept via `page.waitForEvent('download')` OR the blob-capture pattern in
  `alertsPage.exportAlerts()` (`tests/ui-testing/pages/alertsPages/alertsPage.js:2722`), since the
  app downloads via `URL.createObjectURL` + `<a>.click()` (`web/src/utils/dom.ts:3`). The existing
  `exportAlerts()` helper already patches `URL.createObjectURL` to capture the blob.
- Success toast: `[data-test-variant="success"] [data-test="o-toast-message"]` with text
  `Successfully exported …` (alerts, `toastMessages.alerts.successfullyExportedAlert`) or
  `Exported …` (SLO, `slos.exportSucceeded`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Blob download, not HTTP download**: Playwright's `download` event can miss it in headless
  Chromium. Use the `URL.createObjectURL` blob-capture approach already in `alertsPage.exportAlerts()`
  (`alertsPage.js:2740-2793`) rather than `page.waitForEvent('download')`.
- **Download button is disabled on an empty Terraform tab** (`:primary-button-disabled="!hasCode"`).
  An export of ONLY an anomaly-detection alert hits this — assert the disabled state, don't try to click.
- **SLO rows carry measurement status, not definitions** — `openExport` re-reads each SLO, so the
  fixture SLO must still EXIST at export time (don't delete before exporting).
- **Multi-item filename uses a date** (`alerts-YYYY-MM-DD` / `slos-YYYY-MM-DD`); single-item filename
  is the (sanitized) resource name. Assert the file name, not a fixed path.
- **Terraform tab requires clicking the OTab** by its `data-test`; OTab reports `data-state="active"`.
  Use `[data-test="{d}-terraform-tab"]` and, if asserting state, `data-state="active"`.
- **Alert name vs row selector**: row selectors interpolate the alert/SLO NAME (`alert-list-<name>-export-alert`,
  `slos-slolist-export-<name>`). Names must be unique per worker — use `uniqueName()` / a timestamp suffix
  (the app does not enforce uniqueness, and colliding names produce colliding selectors).
