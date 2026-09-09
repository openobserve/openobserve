# Test Setup Contract: Composite Alert Trigger Timestamps (area: Alerts)

This contract tells the Engineer exactly how to establish the data/state the composite-alert
trigger-timestamp spec needs, and names the existing helpers to copy. Everything here is verified
against the repo — do NOT invent new setup.

## Streams / data the spec must establish

- **`alerts_p0_stream`** **[shared/read-only]** — seeded by `seedAlertFixtures(page)`; fields
  `city`, `latency`, `status`. Only needed so `simpleAlert()` children are valid (they reference
  `stream_name: 'alerts_p0_stream'`). The timestamps feature never reads this stream's rows.
- **`alerts_notify_sink` + `auto_p0_tmpl` + `auto_p0_dest`** **[shared/read-only]** — created by
  `seedAlertFixtures(page)`. Children reference destination `auto_p0_dest`; the composite references
  the same destination. No external webhook — the destination self-ingests.
- **N child alerts (scheduled, `enabled: false`)** **[per-test]** — created via
  `createAlert(page, simpleAlert(uniq(...)))` + `findAlertId(page, name)`. These become the
  composite's children.
- **1 composite alert (`enabled: false`)** **[per-test]** — created via
  `createAlert(page, compositeAlert(name, [childIds]))` (payload built in
  `tests/ui-testing/playwright-tests/utils/alerts-api-helpers.js:97`).

### The timestamp data itself (the one non-obvious precondition)

`level_at` (child "Last computed") and `level_since`/transitions (timeline) only become non-null
after the **scheduler actually evaluates** an alert. A fixture created `enabled: false` never does,
so its `level_at` is null → the UI renders "—". Two options:

1. **[RECOMMENDED, matches existing spec]** Route-mock the detail GET and inject `level_at` /
   `level_since` values, exactly as `alerts-composite-ui.spec.js:175-183` already does:
   ```js
   await page.route(`**/api/v2/*/alerts/${composite.id}*`, async (route) => {
     const response = await route.fetch();
     const body = await response.json();
     body.children = body.children.map((c) => ({
       ...c,
       level: 'critical',
       last_outcome: 'firing',
       level_at: 1_786_500_000_000_000,   // microseconds → renders a real date
     }));
     body.evaluation = { result: true, level: 'critical', evaluated_at: 1_786_500_015_000_000 };
     await route.fulfill({ response, json: body });
   });
   ```
   Mock the timeline the same way:
   ```js
   await page.route('**/api/v2/*/alerts/*/composite-timeline*', (route) =>
     route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
       from: 1_000_000_000_000_000, to: 1_000_001_000_000_000,
       children: [
         { alert_id: childA, slot: 0, name: '...', accessible: true, current_level: 'critical',
           level_since: 1_000_000_500_000_000,
           transitions: [{ from_level: 'ok', to_level: 'critical', at: 1_000_000_500_000_000 }] },
       ],
       result: { alert_id: composite.id, slot: null, name: '...', accessible: true,
         current_level: 'critical', level_since: 1_000_000_500_000_000,
         transitions: [{ from_level: 'ok', to_level: 'critical', at: 1_000_000_500_000_000 }] },
     }) }),
   );
   ```
2. **[Slow, real-data path]** Enable the children + composite, then poll with
   `waitForAlertOutcome(page, name)` (`alerts-api-helpers.js:214`). Avoid for this spec — 60s+ and
   timing-dependent.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Seed prereqs:** `await seedAlertFixtures(page);` — see `alerts-api-helpers.js:156`.
- **Create a child:** `createAlert(page, simpleAlert(name))` + `findAlertId(page, name)` — see
  `alerts-composite-ui.spec.js:29-38` (`createChild`).
- **Create the composite:** `createAlert(page, compositeAlert(name, childIds))` — see
  `alerts-composite-ui.spec.js:40-51` (`createCompositeFixture`).
- **Navigate to detail:** `pm.compositeAlertsPage.openDetail(id)` →
  `/web/alerts/detail/${id}?org_identifier=<org>&folder=default` — see `compositeAlertsPage.js:165`.
- **Auth/org:** `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`
  (used by `urls()` in helpers and the page object). Worker auth state is already handled by
  `enhanced-baseFixtures.js` (`navigateToBase`).
- **Cleanup:** `deleteAlerts(page, [...created].reverse())` in `afterEach` — see
  `alerts-composite-ui.spec.js:25-27`.

## Preconditions / toggles

- Detail page must render the composite branch: `alert.alert_type === "composite"` (the composite
  payload from `compositeAlert()` sets `alert_type: 'composite'`).
- Non-SQL / no special mode needed — this feature has no SQL-mode dependency.
- The timeline window defaults to `4h`; asserting the `1h`/`1d` toggle only needs clicking the
  toggle item (`data-test="alerts-composite-timeline-window-1h"` etc.).

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`evaluated_at` is NOT rendered.** The API returns it, but `CompositeAlertDetail.vue` binds only
  `evaluation.result` / `evaluation.level`. Do not assert an `evaluated_at` string on the page — that
  test is a parked `fixme`, not a pass.
- **`level_at` null → "—".** `formatMicros` returns "—" for `null`/`0`/`undefined`. Without the route
  mock, a fresh `enabled:false` fixture always shows "—" and the timestamp assertion fails.
- **Timestamps are locale-formatted** (`toLocaleString()`). Assert non-"—" or a date regex, not an
  exact string.
- **Timeline "empty" is really the fetch-error state.** The backend always returns a `result` lane,
  so `lanes.length === 0` only when the timeline fetch failed (`data = null`).
- **Detail page-object gap.** `compositeAlertsPage.js` lacks `detailLevelAt(id)` and all
  timeline locators. The Engineer must add them (selectors already exist in the DOM — see the
  design doc's Selector Reference).
- **The detail GET is only fetched once** (`AlertDetail.vue:694-709`), so a route mock registered
  before navigation is the only reliable injection point.
- **Timeline fetch is `onMounted` + `watch([timeRange, orgId])`.** A window-click re-fetch means the
  mock must match the new `from`/`to` query or fall through to `route.fetch()`.
