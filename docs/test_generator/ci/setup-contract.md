# Test Setup Contract: Performance Dashboard - API Tab - Black Space on Month Change Under Relative Time  (area: General)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:

- **`_rumdata`** **[shared/read-only]** — fields: `resource_url`, `resource_duration`, `resource_size`, `resource_status_code`, `resource_method`, `service`, `env`, `version`, `session_id`. Why: the API dashboard panels (Top Slowest Resources, Top Heaviest Resources, Top Error Resources) all query this stream. Without data the panels show empty tables — the test validates that panels RE-RENDER filled tables and the dashboard area stays visible (no black space) after a month/time-range change.
- **No per-test stream** needed — the shared `_rumdata` populated by the global RUM fixture is sufficient; the test is a read-only observer.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest**: Generate RUM data via the existing CDN fixture flow. See `tests/ui-testing/playwright-tests/RUM/rum-page-dataflow.spec.js:69-161` (`beforeAll` block) — the `SERVICE`-scoped data lands in `_rumdata` and is searchable. The performance tab tests already depend on this data being present.
  - Exact call: `const { startFixtureServer } = require('../../fixtures/rum/serve.js');` + `startFixtureServer({ clientToken: rumToken, ... })` followed by `driveRumSampleInteractions(app)` then `waitForStreamRows(app, { sql: 'SELECT * FROM "_rumdata" WHERE ...', minRows: 1 })`
  - **Important**: The CDN/NPM dataflow specs use `test.describe.configure({ mode: 'serial' })` and a `beforeAll` that generates one session. This spec should do the same OR reuse a pre-populated stream. The `run-context.json` has `existing_tests_in_diff: false`, so this spec is new — it can depend on the RUM dataflow test's data being present if that test runs first (serial shard), or generate its own via `beforeAll`.

- **Auth/org**: `ORGNAME=default`; the worker auth state / login pattern from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`. Use `const pm = new PageManager(page);` and navigate via `pm.rumPerformancePage.gotoPerformance()`.

- **Timing**: After navigating to the API tab, wait for the dashboard to load (panels rendered, not in schema-loading state). The existing `pm.rumPerformancePage.expectSummaryLoadingResolved()` waits for the Overview tab's spinner to hide. For the API tab, equivalent readiness checks:
  1. Wait for `[data-test="api-dashboard-schema-loading"]` to be hidden (or not exist) — schema resolves via `ensureRumSchema()`.
  2. Wait for panels inside `RenderDashboardCharts` to render (e.g. wait for grid-stack items or a panel container).
  - Load-state: The API tab's `showEmptyState` is false when `presentFields` has the resource columns. The `schemaResolved` gate flips in `ensureRumSchema()`'s `finally`.

## Preconditions / toggles
- Navigate to relative time mode: the URL param `period` should be set (e.g. `period=15m`). The DateTimePicker renders relative presets.
- The month-change action: from the DateTimePicker, click the month/year label to open the month picker, then select a different month. The picker is inside `<DateTime>` component which is rendered by `<DateTimePickerDashboard>`.
- Ensure non-SQL mode is irrelevant here — the API dashboard uses inline SQL queries; no SQL toggle affects it.
- Ensure data exists for BOTH time ranges: if the beforeAll generates data in "now", a month change might select an empty range. The test should either generate data spanning multiple months OR use a relative range large enough to cover the dataset. **Practical path**: generate data once, use a short relative range (e.g. `15m`), switch to `1h` or `1d` instead of changing months, OR pre-seed historical data via the API with past timestamps.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Schema arrives async**: the `useRumPerformanceTab` composable calls `getStream("_rumdata", "logs", true)` in `ensureRumSchema()` on mount. Until this resolves, the dashboard shows the spinner (`[data-test="api-dashboard-schema-loading"]`). Assert readiness only after the schema resolves.
- **`isLoading` is isolated**: In `ApiDashboard.vue`, `isLoading` is a component-local `ref([])` that is NEVER mutated by any code path (the panels inside `RenderDashboardCharts` push to the Charts component's own loading array, not the parent's). The `invisible`/`visible` classes on the content wrapper are therefore a no-op — content is always `visible`. The test must NOT wait for `isLoading` to clear on ApiDashboard; instead wait for panel content to appear.
- **DateTimePicker interaction**: The month picker is a nested Calendar/MonthPicker inside `<DateTime>` → `<QDate>` (or a custom month-grid). The exact selectors for year/month switching are inside the Quasar `QDate` component. Use `page.locator()` on visible month/year buttons or the date-time relative preset buttons: `[data-test="date-time-relative-1-h-btn"]`, `[data-test="date-time-relative-1-d-btn"]`, etc. (see `rumPage.js:84` for the pattern).
- **Panel re-rendering after time change**: `RenderDashboardCharts` watches `currentTimeObj.__global` and re-fetches panel data. The transition from old data → loading → new data is when black space can appear. The test should assert that the dashboard container (`.performance-dashboard` or `[data-test="api-performance-dashboards"]`) has visible, non-empty content within a reasonable timeout after the time change.
- **Height calculation**: The content wrapper uses `max-h-[calc(100vh-196px)]`. At different viewport heights, the grid may render with empty space below the panels. The test window should be a standard size (e.g. 1280x720 or 1920x1080) to match CI viewport settings.
