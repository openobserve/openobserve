# Test Setup Contract: DateTime Custom Relative Range Validation  (area: GeneralTests)

The Engineer implements this before writing assertions; the Healer and Refiner consult it when a
data/setup failure appears. **All references are exact file:line** — copy them, do not invent new
setup.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place.

- **`e2e_automate`** **[shared/read-only]** — the standard pre-seeded stream. Used by every
  *no-restriction* test so the picker resolves `queryRangeRestrictionInHour` to `-1` (no clamp)
  once its fields load. Why: Workflows 1–3 (min/truncate/per-unit cap/empty-blur/unit re-cap) need
  an unrestricted picker. **Do not mutate it.** (If a previous run set `max_query_range` on it,
  reset with `resetMaxQueryRange("e2e_automate")` in `beforeEach`.)
- **`e2e_datetime_restriction`** **[per-test: Workflow 4 restriction tests]** — a logs stream whose
  `max_query_range` is set to a small number of hours (e.g. `2`) for the restriction clamp. Why:
  `useStreamFields.ts` only propagates a restriction when `stream.settings.max_query_range > 0`.
  Fields: any ingestible JSON (the restriction is a *settings* value, not a schema field). Use a
  dedicated name so parallel tests never wipe each other's restriction.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest (only needed to make the stream selectable/queryable):**
  `pm.ingestionPage.ingestion()` ingests `e2e_automate` from
  `tests/test-data/logs_data.json` — see `tests/ui-testing/pages/generalPages/ingestionPage.js:52-78`.
  For the dedicated stream use `ingestionMultiOrgStream(orgId, streamName)` —
  `tests/ui-testing/pages/generalPages/ingestionPage.js:140-163` (or reuse the dashboards
  `ingestion(page, streamName)` helper at `tests/ui-testing/playwright-tests/Dashboards/utils/dashIngestion.js`).
- **Set / reset `max_query_range`:**
  `await pm.dashboardMaxQueryRange.setMaxQueryRange(hours, streamName)` and
  `await pm.dashboardMaxQueryRange.resetMaxQueryRange(streamName)` —
  `tests/ui-testing/pages/dashboardPages/dashboard-max-query-range.js:29-63` and `:144-146`.
  It PUTs `{ max_query_range: hours }` to `/api/{org}/streams/{stream}/settings?type=logs`, then
  polls the schema until the setting reports back (`waitForMaxQueryRangeApplied`, `:76-105`).
- **Select the stream in Logs:**
  `await pm.logsPage.selectStream(streamName)` — `tests/ui-testing/pages/logsPages/logsPage.js:944+`.
  It navigates to `/web/logs?org_identifier=...`, waits for the stream via API, opens the OSelect
  and picks the option. After selecting, the stream fields load and `useStreamFields.ts` sets the
  restriction.
- **Auth/org:** `ORGNAME` (default `default`); the standard worker auth state / login pattern from
  `navigateToBase(page)` in `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`.
- **Timing (restriction):** after `selectStream`, the restriction propagates asynchronously through
  `loadStreamFields`. Do **not** assert the custom-input `max` attribute or the narrowed period list
  until the restriction has settled. Deterministic gate: poll for the period select no longer
  offering `days` (i.e. the unit's `relativePeriodsMaxValue` became `-1`), or assert
  `input[type=number]` gained a `max` attribute equal to the restriction. Reuse the polling idiom
  from `waitForMaxQueryRangeApplied` (`dashboard-max-query-range.js:76-105`).

## Preconditions / toggles

- **No-restriction tests:** ensure no `max_query_range` is in force on the selected stream. Default
  is fine for `e2e_automate`, but a shared stream means a prior failed restriction test could leak;
  reset in `beforeEach`/`afterEach` exactly as `maxquery.spec.js` does
  (`tests/ui-testing/playwright-tests/Dashboards/maxquery.spec.js:64-79`).
- **Restriction tests:** run **serial** if they share one stream (the existing `maxquery.spec.js`
  uses `test.describe.configure({ mode: "serial" })` for this reason —
  `maxquery.spec.js:27`), or give each test its own stream to stay parallel-safe.
- **Mode:** Logs host is `auto-apply` (`SearchBar.vue:862`) — no Apply button; a typed value
  commits immediately. Metrics host is manual-apply; use it only if a test asserts the pending-vs-applied
  distinction. For this feature's validation, the Logs host is the primary surface.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`queryRangeRestrictionInHour` is seeded at `100000`** in `searchObj` (`constants.ts:252`) and
  only reset to `-1`/a real value after the selected stream's fields load
  (`useStreamFields.ts:240`). A test that asserts "no clamp" before stream fields settle will see
  the 100000-hour default. Always select a stream and wait for fields before asserting.
- **The custom controls have no `data-test`.** `DateTime.vue:198-223` renders the OInput and OSelect
  bare. Either add `data-test="date-time-relative-custom-value"` /
  `data-test="date-time-relative-custom-period"` to `DateTime.vue` (preferred — `OInput`/`OSelect`
  then derive `-field`/`-trigger`/`-option`), or scope structurally
  (`#date-time-menu input[type="number"]`, `#date-time-menu [data-test-selected-value]`). The
  timezone `OSelect` also lives inside `#date-time-menu`, so an unscoped `[data-test-selected-value]`
  matches two elements — scope to the custom row.
- **Silent clamp, not an error.** The custom value has no error message; an invalid/oversized input
  is clamped or dropped. Assert the *resulting value* (via the trigger label or the input's value /
  `max` attribute), never an error toast.
- **`OInput` forwards `data-test` to the wrapper and derives `<data-test>-field` on the real
  `<input>`** (`OInput.vue:365`). The number input is a native `<input type="number">`; read its
  value/`min`/`max`/`step` attributes directly for clamp assertions.
- **Trigger label pluralization** is `Past {count} {Unit}` via `pastSecond`/`pastMinute`/… keys
  (`en-US.json:608-613`). A clamp assertion can read `getTriggerLabel()` (from
  `dateTimePickerPage.js:206-208`) and expect e.g. `Past 120 Months` after a 5000-months typo.
- **Week arithmetic** converts `w`→`days ×7` only inside `getConsumableDateTime`
  (`DateTime.vue:963-967`); the *display* label still reads `{count} Weeks`, so assert labels, not
  the internal arithmetic.
