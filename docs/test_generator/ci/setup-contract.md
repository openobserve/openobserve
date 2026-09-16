# Test Setup Contract: Alert Chart Error State  (area: Alerts)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — set up ONCE / use the pre-seeded stream.
- **`[per-test]`** — set up INSIDE that test, uniquely named.

### Error-state test (headline)
- **NON-EXISTENT stream name** **[per-test]** — an alert whose `stream_name` is a unique,
  never-ingested name (e.g. `alert_chart_missing_<uniq>`). Why: `generate_sql` validates the stream
  and 400s `"Stream '<name>' of type 'logs' does not exist"` (`src/api/management/src/request/alerts/mod.rs:3744-3768`),
  which `AlertGroupChart.build()` surfaces in `[data-test="alerts-alertgroupchart-error"]`.
  - **Do NOT ingest this stream** and do **NOT** reuse the seeded `alerts_p0_stream` name — the
    point is that it must NOT exist.
  - The alert create endpoint does **not** validate the stream (`mod.rs:219-273`), so creating an
    alert over a missing stream succeeds; only `generate_sql` (the chart) fails.

### Happy-path test (panel renders) + range-toggle test
- **`alerts_p0_stream`** **[shared/read-only]** — logs stream seeded by `seedAlertFixtures` with
  fields `city` (group key), `latency` (measure), `status`, and three rows
  (`bangalore/890`, `mumbai/950`, `delhi/990`). Why: `multiAlert`/`simpleAlert` reference it, so
  `generate_sql` returns SQL and the chart renders `[data-test="alerts-alertgroupchart-panel"]`.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Seed + create alerts (happy path / range):**
  - `seedAlertFixtures(page)` — `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:276`
    (seeds template + `auto_p0_dest` destination + ingests the 3-row stream).
  - `createAlert(page, multiAlert(name))` or `createAlert(page, simpleAlert(name))` —
    `alerts-api-helpers.js:120` (POST `/api/v2/{org}/alerts?folder=default`).
  - Resolve id via `findAlertId(page, name)` — `alerts-api-helpers.js:190`.
  - Cleanup via `deleteAlerts(page, ids)` — `alerts-api-helpers.js:220`.

- **Create the error-state alert (headline):**
  - Reuse the canonical payload but override the stream name:
    ```js
    const payload = { ...simpleAlert(name), stream_name: `alert_chart_missing_${uniq('x')}` };
    const r = await createAlert(page, payload);           // create does NOT validate stream
    const id = await findAlertId(page, name);
    ```
    (`simpleAlert` at `alerts-api-helpers.js:39`; `uniq` at `:22`.) `seedAlertFixtures` is NOT needed
    for this test (and the missing stream must stay missing).
  - Cleanup: `deleteAlerts(page, [id])`.

- **Navigation:** `pm.alertDetailPage.open(alertId)` — `tests/ui-testing/pages/alertsPages/alertDetailPage.js:32`
  (goto `/web/alerts/detail/<id>?org_identifier=<org>&folder=default`).
  - `pm` = `new PageManager(page)` (`tests/ui-testing/pages/page-manager.js`); `alertDetailPage` exposed at `:165`.

- **Auth/org:** `getOrgIdentifier()` and `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`; `BASE` from `alerts-api-helpers.js:15`.
  Login via the standard `enhanced-baseFixtures.js` `navigateToBase(page)` pattern
  (`tests/ui-testing/playwright-tests/Alerts/alerts-multialert-ui.spec.js:20,46`).

- **Readiness gate:** wait for `[data-test="alerts-alertdetail-title"]` to contain the alert name
  (page loaded) before asserting chart state — `pm.alertDetailPage.expectTitle(name)`.

## Preconditions / toggles
- Non-SQL mode is irrelevant here (the chart is on the detail page, not the search page).
- The alert must be a scheduled **logs** alert (not SLO / anomaly / composite) so the chart mounts
  (`AlertDetail.vue:183` `v-if="alert && !isSloAlertView && !isAnomalyAlert"`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- The panel/error resolve **asynchronously** (`generate_sql` round-trip in `build()` on mount + on
  `props.alert` watch). Assert with a timeout; never assert `panel` is absent before the error has
  actually resolved, and vice versa.
- `generate_sql` returns the 400 body as `{ error?, message, code }`; the component renders
  `parseSearchError(error).message`, i.e. the **sentence** `"Stream '<name>' of type 'logs' does not
  exist"` — assert `toContainText("does not exist")` rather than a full exact string (the exact
  stream name is randomized per test).
- The happy-path panel element (`alerts-alertgroupchart-panel`) can render with **empty/sparse data**
  (seeded stream has only 3 rows); assert the panel is **attached**, not that a specific series/line
  is drawn. Do not assert on `canvas` content.
- Range items have no chart-specific `data-test`; target
  `[data-test="alerts-alertgroupchart-range"] >> [data-test="o-toggle-group-item-<v>"]`
  (`OToggleGroupItem.vue:35` fallback).
- `alertDetailPage.js` currently has **no** chart selectors — the Engineer must add
  `alerts-alertgroupchart-*` locators (and ideally `expectChartErrorVisible` / `expectChartPanelVisible`)
  to `tests/ui-testing/pages/alertsPages/alertDetailPage.js`.
- Do NOT attempt to delete the shared `alerts_p0_stream` to force the error state — that would break
  every other Alerts spec in parallel. Use the missing-stream-name approach instead.
