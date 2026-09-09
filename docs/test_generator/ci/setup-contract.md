# Test Setup Contract: Logs Stream Type Persistence  (area: Logs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`cpu_usage`** (metrics-type stream) **[shared/read-only]** — fields: metric value columns
  (seeded by `metrics-ingestion.js`). Why: the single repro needs a `metrics`-type stream to
  navigate `stream_type=metrics` into Logs and reproduce the stale-name leak. This stream is
  NOT mutated by the test; it is only explored.

No logs-type stream needs to be ingested for this spec — the assertions target the stream
*selector/type* state and the localStorage bucket, not query results.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Metrics stream (cpu_usage):** call `await ensureMetricsIngested();` in `beforeEach` (or
  `beforeAll` for shared scope). See the diff spec itself —
  `tests/ui-testing/playwright-tests/Logs/streamsExploreLogsTypePersistence.spec.js:36` — and its
  source `tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js:12` (which dedupes via
  a module-level promise and calls `metricsIngestion.ingestTestMetrics({...})` then
  `metricsIngestion.waitForMetricQueryable('cpu_usage')`). Reference spec using the same pattern:
  `tests/ui-testing/playwright-tests/Metrics/*.spec.js` (metrics.spec.js).

- **Streams → Logs navigation (the explore flow):** use the existing Streams page object:
  - `await pm.streamsPage.navigateToStreamExplorer();` — `tests/ui-testing/pages/streamsPages/streamsPage.js:162`
  - `await page.locator('[data-test="log-stream-table"] [data-otoggle-value="metrics"]').click();`
    (Metrics tab toggle — value is `OToggleGroupItem` `value`, verified `OToggleGroupItem.vue:114`)
  - `await pm.streamsPage.searchStream('cpu_usage');` — `streamsPage.js:185`
  - `await pm.streamsPage.verifyStreamNameVisibility('cpu_usage');` — `streamsPage.js:195`
  - `await pm.streamsPage.exploreStream();` — `streamsPage.js:199` (clicks
    `[data-test="log-stream-explore-btn"]`, pushes `name:"logs"` with `type=stream_explorer`)

- **Logs-page assertions:**
  - `await pm.logsPage.expectStreamSelectorContainsText('cpu_usage');` — `logsPage.js:9796`
  - `await pm.logsPage.clickMenuLinkLogsItem();` — `logsPage.js:4783`

- **Auth/org:** `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js:64`
  (cloud → `cloud-config.json`; self-hosted → `process.env.ORGNAME`). Used to read the
  per-org localStorage bucket `oo_selected_stream_logs_${orgId}`.

- **Base navigation:** `await navigateToBase(page);` — `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141`.

## Preconditions / toggles

- **Live Mode (`auto_query_enabled`) is NOT required for this repro.** The back-to-logs clear
  (`saveLogsStreamType` + `saveLogsStream([])` in `onStreamTypeChange`, IndexList.vue:447-448)
  and the `streamType === "logs"` guard on the selectedStream watcher (Index.vue:1643) both run
  unconditionally. Do NOT gate the test on `ZO_AUTO_QUERY_ENABLED=true`.
- If a FUTURE test asserts the *restore-selection-convenience* path (persist a logs stream →
  navigate away → return and it's auto-selected), that case DOES require
  `auto_query_enabled=true` (server `ZO_AUTO_QUERY_ENABLED`), and should be a separate test with
  an explicit config precondition.

## Timing / hydration (so the Healer/Engineer don't rediscover them)

- After `navigateToStreamExplorer()`, gate on `[data-test="streams-search-stream-input-field"]`
  visible (the helper already does — `streamsPage.js:181-182`) before `searchStream`.
- After `exploreStream()`, the Logs page mounts asynchronously; `resetStreamData` +
  `restoreUrlQueryParams` run in `setupLogsTab()`. Assert the URL (`/stream_type=metrics/`) and
  wait for the stream selector trigger to contain `cpu_usage` (`expectStreamSelectorContainsText`
  already `toBeVisible` + `toContainText` with timeouts).
- The stream list loads via `getStreamList` → `loadStreamLists` (useStreamFields.ts:878/895);
  the `log-search-index-list-select-stream` options and the back-to-logs button depend on
  `searchObj.data.stream.streamType` + `streamLists` being hydrated. Prefer the helper waits over
  raw `networkidle`.

## localStorage bucket keys (what the assertions read)

- Selected stream(s): `oo_selected_stream_logs_${orgId}` (JSON array).
- Stream type: `oo_logs_stream_type_${orgId}` (plain string, default `"logs"` on restore).
- Reads in test: `await page.evaluate((orgId) => localStorage.getItem(`oo_selected_stream_logs_${orgId}`), getOrgIdentifier())`
  then assert the parsed array does NOT contain `cpu_usage` (see diff spec lines 79-85).

## Gotchas

- The bug being fixed was that `saveLogsStream([])` used to **no-op** (so the stale metric name
  survived). The current `streamPersist.ts` **removes** the key on empty — so after
  back-to-logs, `localStorage.getItem(...)` may be `null` (not `"[]"`). The assertion must
  handle `null` (the diff spec guards with `if (persistedLogsStream) { ... }`).
- The back-to-logs button (`log-search-index-list-back-to-logs-btn`) is `v-if`-gated on
  `streamType !== 'logs'` — use `expect(...).not.toBeVisible()` (not `.toHaveCount(0)`) after
  the switch, since a transient stale render can linger until the reactive update settles.
- The stream selector trigger text (`log-search-index-list-select-stream-trigger`) is OSelect-
  derived; use the existing `expectStreamSelectorContainsText` / `indexDropDownTrigger` locators
  rather than re-deriving OSelect internals.
