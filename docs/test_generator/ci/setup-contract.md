# Test Setup Contract: Alert Destination Usage (Dependency Impact)  (area: Alerts)

The feature is read-only reporting over the dependency graph. Every behavior needs a specific
data precondition: a destination that is (a) unused, (b) used by N alerts, or (c) referenced by
a non-alert consumer. The helper methods below already exist in `apiCleanup.js` — **do not invent
setup**.

## Streams / data the spec must establish

Tag each item by SCOPE — `[shared/read-only]` → establish once / reuse; `[per-test]` → establish
inside that test with a unique name.

- **Template `<seed>_tmpl`** `[shared/read-only]` — created via `pm.apiCleanup.createAlertTemplate(name)`.
  Why: the Add Destination button is disabled with zero templates (`:disabled="!templates.length"`),
  and destinations reference a template. Body defaults to `'{"text": "{alert_name} is active"}'`.
- **Destination `<seed>_dest_unused`** `[per-test: TC-unused]` — HTTP destination (type `http`,
  URL `http://example.com/...`) with no referencing alert and no `uses`. Why: exercises the
  "Unused" chip + "No consumers." dialog. Created via
  `pm.apiCleanup.createAlertDestination(name, templateName)`.
- **Destination `<seed>_dest_used` + N alerts referencing it** `[per-test: TC-used]` — Why:
  exercises the `used-by-<name>-alert` count badge and the alert lane in the impact dialog.
  The existing `seedAlertsInFolder(folderId, count, prefix)` creates a folder + stream + template +
  destination + `count` alerts *all named `<prefix>_*` and all pointing at its OWN destination
  `<prefix>_dest`* (`destinations: [destinationName]`, `enabled: false`). It returns
  `{ alerts, templateName, destinationName, streamName }`. Use it when the destination's own name
  is acceptable; for a destination used by a SPECIFIC pre-created name, the Engineer must add a
  small helper that POSTs an alert with `destinations: [thatName]` (copy the payload shape from
  `apiCleanup.js:275-291`).
- **Stream `<prefix>_stream`** `[per-test]` — required only because alert creation validates the
  source stream exists. `seedAlertsInFolder` ingests one row + `waitForStreamSchema` before
  creating alerts (see `apiCleanup.js:257-307`).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Template:** `await pm.apiCleanup.createAlertTemplate(name)` —
  `tests/ui-testing/pages/apiCleanup.js:355`.
- **Destination (HTTP, uses a template):** `await pm.apiCleanup.createAlertDestination(name, templateName)` —
  `tests/ui-testing/pages/apiCleanup.js:417`. URL is `http://example.com/e2e_pag_sink` (IANA-reserved,
  never contacted; SSRF guard accepts it).
- **Destination + alerts (one-shot seed):** `await pm.apiCleanup.seedAlertsInFolder(folderId, count, prefix)` —
  `tests/ui-testing/pages/apiCleanup.js:257`. Requires a folder first via
  `await pm.apiCleanup.createAlertFolder(name)` — `apiCleanup.js:229`.
- **Alert folder:** `await pm.apiCleanup.createAlertFolder(name)` → `{ folderId, name }` —
  `apiCleanup.js:229`.
- **Cleanup:** `await pm.apiCleanup.deleteAlertDestination(name)` (`apiCleanup.js:463`),
  `await pm.apiCleanup.deleteAlertTemplate(name)` (`apiCleanup.js:393`),
  `await pm.apiCleanup.deleteAlert(alertId, folderId)` (`apiCleanup.js:170`),
  `await pm.apiCleanup.deleteFolder(folderId)` (`apiCleanup.js:193`). Delete alerts before their
  folder/destination/template.
- **Navigation:** `await pm.alertDestinationsPage.navigateToDestinations()` or direct
  `page.goto(`${process.env["ZO_BASE_URL"]}/web/alert-destinations?org_identifier=${process.env.ORGNAME || 'default'}`)`
  then `await pm.alertDestinationsPage.expectDestinationsListTitleVisible()` — see
  `tests/ui-testing/playwright-tests/Alerts/alerts-destinations-prebuilt.spec.js:46-49` and
  `alertDestinationsPage.js:418,1652`.
- **Wait for list ready:** `await pm.alertDestinationsPage.waitForDestinationListReady()` —
  `alertDestinationsPage.js:476` (waits for the Add button).

## Preconditions / toggles

- **Auth/org:** use the worker's org (`process.env.ORGNAME || 'default'`); the shared auth state /
  login is established by the `enhanced-baseFixtures.js` worker fixture (same as every Alerts spec).
  No extra toggle needed.
- **OSS only:** `workflowsEnabled` is always false (enterprise/cloud flag + `zoConfig.workflows_enabled`);
  no workflow data needed; `create-workflow-btn` is absent.
- **Fresh data:** the dependency graph is cached 300 s and the destinations list is cached. After
  creating destinations/alerts via API, the page's `getDestinations(true)` (refresh button,
  `[data-test="alert-destinations-list-refresh-btn"]`) forces a reload + graph rebuild — trigger it,
  or navigate cold, before asserting badge counts.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Async graph vs. table paint:** on a cold read the `Used by` cell shows the neutral `graph-1`
  icon until `graph.nodes.length > 0`. Assert on the badge (`used-by-<name>-alert`) or the
  "Unused" chip (`used-by-<name>-unused`) with a `toBeVisible`/poll, never immediately after the
  row appears.
- **`seedAlertsInFolder` creates its own destination/template/stream.** If a test needs a
  SPECIFIC destination name to be the used one, either use the returned `destinationName` as the
  row under test, or add a dedicated `createAlertWithDestination` helper (copy payload from
  `apiCleanup.js:275-291`). Do NOT reuse `seedAlertsInFolder` and then rename destinations.
- **Delete guard 409:** deleting a destination referenced by an alert/consumer returns 409 and the
  row stays. A test asserting delete-success must first ensure the destination is unused (or
  delete the referencing alert via the impact dialog first).
- **Template required for Add button:** with zero templates the Add button is disabled; create a
  template first or rely on the compiled-in default. `seedAlertsInFolder` already creates one.
- **Alert creation validates the stream:** `seedAlertsInFolder` ingests one row and polls
  `waitForStreamSchema` (`apiCleanup.js:316`) before creating alerts — replicate this if writing a
  new alert helper, or alert creation will 400 on the missing stream.
- **Email destinations need SMTP + real org users:** avoid email destinations for usage tests;
  HTTP destinations (`createAlertDestination`) need no SMTP and are the correct fixture.
- **No existing page-object helper for the "Used by" cell / impact dialog** — none of the
  page objects reference `used-by-` or `dependency-impact-`. The Engineer must use the `data-test`
  selectors directly (see the Feature Design Document selector reference) or add small helpers to
  `alertDestinationsPage.js`.
