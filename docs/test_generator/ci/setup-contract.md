# Test Setup Contract: Alert-Based SLI Source for SLOs  (area: SLOs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Preconditions for alert-based SLI tests

- **A scheduled (non-SLO) alert with evaluation history** **[shared/read-only]** — the
  `eligibleAlerts` endpoint (`GET /api/{org}/alerts/slo-eligible`) returns alerts that have a
  frequency. A regular scheduled alert that has been running and has trigger history appears as
  `eligible: true`. Without one the alert-source picker shows the "none eligible" empty state.
  *Field requirements:* name, frequency_secs > 0, eligible: true.
  *Why:* The core picker UI (showing eligible sources, selecting one, auto-setting the slice)
  depends on at least one eligible alert existing.

- **A stream with ingested log data** **[shared/read-only]** — the alert above needs a stream to
  watch. A standard `auto_alert_stream` with `city`, `country`, `status`, `age`, `message` fields
  will work. Ingest some rows so the alert has something to evaluate.

- **An alert destination** **[shared/read-only]** — required to create any alert (the "Add Alert"
  button is disabled without destinations). A self-referencing webhook destination pointing at
  OpenObserve's own ingestion endpoint is the standard pattern used across all alert tests.

- **An alert template** **[shared/read-only]** — also required for alert creation. The default
  template created by `ensureValidationInfrastructure` works.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** Use `pm.commonActions.ingestTestData(streamName)` or
  `pm.commonActions.ingestTestDataWithUniqueId(streamName, uniqueId)`.
  See `tests/ui-testing/playwright-tests/Alerts/alerts-e2e-flow.spec.js:43` for stream init,
  `tests/ui-testing/pages/commonActions.js:244` for ingestTestData, `:324` for ingestTestDataWithUniqueId.

- **Stream initialization:** `pm.commonActions.initializeAlertTestStream(streamName)` —
  `tests/ui-testing/playwright-tests/Alerts/alerts-e2e-flow.spec.js:43`.

- **Alert destination + template (validation infra):**
  `pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue)` —
  `tests/ui-testing/playwright-tests/Alerts/alerts-e2e-flow.spec.js:75`.

- **Create a scheduled alert (the future SLO source):**
  `pm.alertsPage.creationWizard.createAlertWithDefaults(streamName, destinationName, randomValue)` —
  `tests/ui-testing/pages/alertsPages/alertCreationWizard.js:307`.

- **Auth/org:** Standard OSS auth via `page.goto(alertUrl?org_identifier=...)`. The
  `getOrgIdentifier()` helper returns the org from the environment. No special enterprise setup needed.

- **Navigate to SLO list:** `page.goto(/slos?org_identifier=${org})` or use the left-nav
  "SLOs" menu item (link: `/slos`, name: `sloList`).

- **Create an SLO via API (not UI) for the detail-page tests:**
  `POST /api/{org}/slos` with a payload of:
  ```json
  {
    "name": "alert-sli-test-{unique}",
    "sli_type": "alert",
    "config": { "alert_id": "<alert_id>" },
    "target": 99.9,
    "window_secs": 2592000,
    "slice_interval_secs": 300,
    "folder_id": "default",
    "enabled": true
  }
  ```
  Use `sloService.create(org, payload)` or send via `page.request.post()`.
  See `web/src/services/slos.ts:56-58` for the service method.

- **Timing:** After creating a scheduled alert, wait for it to appear in the eligible list.
  The list is fetched once when the "alert" SLI type is selected, so switching to "alert" type
  triggers the API call. After ingestion, allow ~2-3s for the data to be indexed before the
  alert can evaluate.

## Preconditions / toggles

- Ensure the SLOs feature is available (it lives under the Alerts left-nav section).
- No special feature flags required for OSS — the alert SLI type is always visible in the
  SLI type toggle.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The alert source picker loads lazily** — only when the "alert" SLI type is selected
  (`watch(isAlertSli)` in AddSlo.vue:752-765). Navigating directly to an alert-based SLO's
  edit page requires the SLI type to already be "alert" for the source to appear.
- **Eligible alerts need a frequency** — the server classifies alerts as eligible/not based
  on having a valid `frequency_secs`. A realtime alert is never eligible.
- **Slice auto-setting** — picking an alert source auto-sets `slice_interval_secs` to the
  smallest legal value >= the alert's frequency (via `smallestLegalSlice()`). A 60s-frequency
  alert → 60s slice; a 300s → 300s; anything >300s has no legal slice and is ineligible.
- **Group-by is locked for alert SLIs** — the field is disabled and cleared when alert type is
  selected. The `groups_estimate` input is hidden (gated on `isGrouped`).
- **The wire config differs by SLI type** — for alert, only `{alert_id: "..."}` is sent (not
  stream, scope, good_expr, etc.). Sending the flat form config would get a 422.
- **SLO alert preview requires alert history** — the ribbon in `SloAlertPreview` queries the
  availability ledger. A brand-new alert with no evaluation history shows the "no history"
  empty state.
- **The SloAlertPreview is used in TWO places** — the create/edit form (right column) and the
  SLO detail page (trend tab, above the burndown). Both use the same component but with
  different prop sources.
- **Source alert button only appears for alert SLIs** — gated on `sourceAlertId` computed
  from `slo.value?.config?.alert_id` (SloDetail.vue:360-363). Not present for count/time_slice.
