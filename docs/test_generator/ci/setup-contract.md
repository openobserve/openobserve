# Test Setup Contract: Multi-Stream Log Search (UNION ALL BY NAME)  (area: Logs)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

- **`e2e_automate` + `default`** **[shared/read-only]** — pre-seeded with the same `logs_data.json`
  payload via `pm.ingestionPage.ingestionJoin()` / `ingestion()`. Both have the kubernetes field
  set (`kubernetes.container_name`, `kubernetes.namespace_name`, `kubernetes.pod_name`, `log`,
  `stream`, `code`, `level`, `message`, `method`, `took`, `FloatValue`, …).
  Why: filter-across-streams tests need a **shared** field that exists in both streams
  (e.g. `kubernetes.container_name`).

- **`e2e_join_a_<runId>` + `e2e_join_b_<runId>`** **[per-test]** — created by
  `pm.ingestionPage.ingestionJoinUnion(testRunId)`, which returns `{ streamA, streamB }`. Same
  `logs_data.json` payload to both. Use a unique `testRunId` (`Date.now().toString(36)`) per test to
  avoid "stream being deleted" conflicts (SDR pattern).
  Why: the primary UNION ALL BY NAME test uses two isolated streams so results are attributable and
  the test does not interfere with other specs reusing `default`/`e2e_automate`.

> NOTE: There is **no** existing fixture that ingests a stream with a *deliberately different*
> schema (e.g. only non-text fields, or a field present in A but not B). If a test needs the
> "filter field missing from one stream" edge case, the Engineer must build the differing payload
> inline (POST a one-off record array to `_json`) — there is no helper to copy. This case is
> optional; the shared-field + missing-stream message can otherwise be validated by observing the
> default union behavior.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Ingest (shared): `await pm.ingestionPage.ingestion(); await pm.ingestionPage.ingestionJoin();`
  — see `tests/ui-testing/playwright-tests/Logs/join.spec.js:25-26`.
- Ingest (per-test union streams):
  `const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);`
  — see `tests/ui-testing/playwright-tests/Logs/join.spec.js:65-66` and helper
  `tests/ui-testing/pages/generalPages/ingestionPage.js:129-203`.
- Select two streams:
  `await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);`
  — see `tests/ui-testing/playwright-tests/Logs/join.spec.js:69` and helper
  `tests/ui-testing/pages/logsPages/logsPage.js:423-503`.
- Auth/org: self-hosted → `ORGNAME` env var (defaults to `default`); `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js:64-72`. Global auth via
  `navigateToBase(page)` in `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`.
- Timing: after ingestion, poll stream availability via `pm.logsPage.waitForStreamAvailable(stream, …)`
  (already done inside `selectIndexAndStreamJoinUnion`/`selectStream`) before UI selection. Wait for
  the result table (`[data-test="logs-search-result-logs-table"]`, timeout up to 90s in
  `validateResult()`) before asserting rows.

## Preconditions / toggles
- Run query in **non-SQL** mode for the `UNION ALL BY NAME` path. Do NOT call `enableSQLMode()` for
  the primary union test. SQL mode is only for the SQL-mode workflow (Workflow 5) and the
  visualize-gating workflow (Workflow 4, where SQL must remain OFF).
- Histogram toggle can remain default (on). Multi-stream forces histogram hidden (errorCode `-1`).
- Quick mode: default on (from `zoConfig.quick_mode_enabled`); leave as-is unless testing arm
  projection.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Histogram is hidden, not errored**: for multi-stream the histogram errorCode is `-1`, and
  `SearchResult.vue` renders the histogram container only when `errorCode != -1`. Do NOT assert a
  histogram error message; assert the histogram **canvas is absent** (`logs-search-result-bar-chart`
  not visible) and the table is visible.
- **`_stream_name` is not a column**: it is excluded from grid columns (useStreamFields.ts:700).
  To assert stream attribution, read the default `source` cell (full-row JSON, which includes
  `_stream_name`), or assert row count / presence of both streams' data via the `source` column.
- **Visualize block is SQL-mode dependent**: selecting 2 streams with SQL OFF makes the Visualize
  toggle show a toast "Please enable SQL mode or select a single stream to visualize". If the test
  navigates the visual tab, first clear the multi-stream selection (single stream) or enable SQL mode.
- **Stream schema arrives async**: after selecting streams, fields/columns hydrate via
  `extractFields()`/`updateGridColumns()`; wait for the results table rather than asserting on the
  field list immediately after selection.
- **Dedup**: selecting the same stream twice is deduped (`new Set(...)`) — do not use duplicate
  selection to test row duplication.
