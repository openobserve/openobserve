# Test Setup Contract: Alerts UI refactor (design-system pass)  (area: Alerts)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

The tab-filtering assertions need **alerts of the three OSS types** (scheduled / realtime /
composite). "Scheduled" vs "Realtime" is decided by the wizard's alert-type choice (backend stores
`is_real_time`); "Composite" is a separate multi-alert type.

- **`e2e_automate`** **[shared/read-only]** — logs stream, pre-ingested by global-setup and
  protected from cleanup on every branch. Use it as the SOURCE stream for scheduled + realtime
  alerts (it is in the wizard's page-load stream cache, so it is always selectable). Why: the tab
  filter reads `is_real_time` off the created alert rows, not the stream.
- **A destination + template** **[shared/read-only]** — the Add Alert button is DISABLED until
  both exist (`:disabled="!destinations.length || !templates.length"`). Create once per shard via
  `ensureValidationInfrastructure` (below).
- **One realtime alert + one scheduled alert** **[per-test]** — created via the wizard so the
  "Realtime" and "Scheduled" tabs each have ≥1 row to show after filtering.
- **Composite alert (optional)** **[per-test: TC-composite]** — needs 2+ child alerts + the
  composite wizard (`pm.compositeAlertsPage`). Only create if the composite-tab case is in scope;
  otherwise assert the tab EXISTS and shows the OTable empty state.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Ingest the shared stream:** `await pm.commonActions.ingestTestData('e2e_automate')`
  — see `tests/ui-testing/pages/commonActions.js:244` and its use at
  `tests/ui-testing/playwright-tests/Alerts/alerts-ui-operations.spec.js:85`.
- **Destination + template (validation infra):**
  `const infra = await pm.alertsPage.ensureValidationInfrastructure(pm, suffix);`
  (`tests/ui-testing/pages/alertsPages/alertsPage.js:2885`) — creates
  `pm.alertTemplatesPage.ensureValidationTemplateExists(templateName)` +
  `pm.alertDestinationsPage.createDestinationWithHeaders(destinationName, url, templateName, headers)`.
  Then `pm.alertTemplatesPage.ensureTemplateExists(templateName)` +
  `pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName)` are the
  simpler non-validation equivalents (see `alerts-ui-operations.spec.js:36-44`).
- **Create a realtime alert:** `await pm.alertsPage.createAlert(streamName, column, value, infra.destinationName, suffix)`
  (wizard selects "Real-time" alert type) — `alertCreationWizard.js:187`. For a more resilient
  default-first-column path use `createAlertWithDefaults` (`alertCreationWizard.js:307`).
- **Create a scheduled alert:** `await pm.alertsPage.createScheduledAlertWithSQL(streamName, infra.destinationName, suffix)`
  — `alertCreationWizard.js:419` (see use at `alerts-ui-operations.spec.js:108`).
- **Navigate to the list:** `await pm.alertsPage.navigateToAlertsPage()` →
  `waitForAlertListPageReady()` waits for `[data-test="alert-list-page"]` + 2s
  (`alertsPage.js:1807,1945`). Base URL/fixture: `logData.alertUrl` = `/web/alerts/`.
- **Auth/org:** ORGNAME from `getOrgIdentifier()` (cloud-auth); the worker auth state is
  established by the standard `navigateToBase`/`enhanced-baseFixtures` pattern used by every spec in
  this shard — no special handling needed.

## Preconditions / toggles
- **OSS edition:** the Anomaly tab is enterprise/cloud-only. Do NOT assert
  `alert-list-tab-anomalyDetection`; the OSS tab set is exactly
  `all`, `scheduled`, `realTime`, `composite`.
- **Folder scope:** default folder is `default`; created alerts land there (or in the folder the
  wizard is on). Tab filtering operates on the ACTIVE folder's `allAlerts`.
- **Refresh after create:** after creating an alert, the list refetches on navigation; wait for
  the row (`tbody tr[data-index]`) rather than asserting immediately.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Tab selectors changed.** Old `[data-test="tab-{value}"]` (AppTabs) is GONE; use
  `[data-test="alert-list-tab-{value}"]`. `alertsPage.js` already updated `all/scheduled/realTime`
  (lines 307-310), but **`compositeAlertsPage.js:25` still has the stale
  `[data-test="tab-composite"]`** — use `[data-test="alert-list-tab-composite"]` for the composite tab.
- **Group selector is unreliable.** `data-test="alert-list-tabs"` sits on `OToggleGroup`, whose
  root is a fragment (`v-if`/`v-else`) and does NOT bind `$attrs`; it may not reach the DOM.
  Click/assert via the item buttons. Active state is `data-state="on"` on the item `<button>`.
- **"Realtime" label, `realTime` value.** The tab value is `realTime` (capital `T`) → selector
  `alert-list-tab-realTime`. The visible label is "Realtime" (i18n `alerts.realTime`).
- **Realtime ≠ Scheduled semantics.** `filterAlertsByTab` treats `is_real_time === true` as
  realtime, `!is_real_time && alert_type !== "Composite"` as scheduled. A realtime alert created
  through the wizard's "Real-time" type must produce `is_real_time: true`, or the tab will show 0.
- **Add button gate.** If the Add button is disabled, the org has no destination/template — run
  `ensureValidationInfrastructure` first; do not fight the disabled state.
- **Library readiness is async.** The gallery skeleton persists until BOTH `manifest` AND
  `readinessKnown` resolve; a failed `/streams` call leaves cards undimmed (not "needs data").
  Wait for the grid (`alert-library-grid`) to leave skeleton state before asserting card chips.
- **Realtime row undercount note.** `verifyAlertCounts()` (alertsPage.js:1590) counts only the
  first page of `tbody tr[data-index]` — fine for small per-test data, but a total-count assertion
  must read the pagination total, not the row count.
