# Synthetics result fixtures

Seed rows for `synthetics_results` / `synthetics_step_results`, consumed by
`playwright-tests/utils/synthetics-helpers.js` (`seedResults`). Result rows are written by
the external probes (Lambda / agent), so a CI binary never produces passed or failed rows;
the results and run-detail specs seed them instead.

## Shape

`results.json` is a map of **templates** keyed by role; `seedResults` clones a template per
run and stamps `_timestamp`, `synthetics_id`, `synthetics_name`, `org_id`, `run_id`,
`execution_id`, `job_id`. `step_template` names the matching entry in `step-results.json`
(one step row per journey step) and is stripped before ingest.

| key               | status    | notes                                                                  |
|-------------------|-----------|------------------------------------------------------------------------|
| `browser_passed`  | passed    | 3-step journey, `evidence_key: ""` (deterministic no-artifact state)  |
| `browser_failed`  | failed    | step 3 fails; `failure_detail.screenshot_key` non-empty so the thumb renders; error > 200 chars so the show-more toggle renders |
| `browser_retried` | warning   | `attempts: 2`, `retry_history` lists both attempts (`status_reason: flaky`) |
| `error_dispatch`  | error     | `error_source: dispatch`, ids set → opens RunDetail with the banner    |
| `error_quota`     | error     | `error_source: quota`, ids empty → inline error view, no navigation    |
| `http_passed`     | passed    | `type: http`, `assertions` non-empty → assertions badge                |
| `http_failed`     | failed    | `status_code: 503`, `assertions_passed: false`                         |

Columns follow the reader contract in `web/src/composables/synthetics/syntheticResultsSchema.ts`
(`RUNS_COLUMNS`, `RUN_DETAIL_COLUMNS`, `buildRunsWithStepsSql`, `buildStepAggregateSql`):
the search API rejects a query naming a column absent from the stream schema, so every
ungated column is present on every row (empty string / 0 where not applicable). Nested
objects (`failure_detail`) flatten to `failure_detail_*` on ingest; arrays are stringified.

`retry_step_ids` / `retry_error_classes` / `retry_consistent` are deliberately absent: when the step
stream has no rows the fallback path selects all three together, so a partial set would 400.
`retry_history[].attempt` is 0-based (the reader labels it `attempt + 1`).

## Provenance

Authored from the reader contract (no in-repo writer exists for non-error rows). To refresh
from a real environment, export both streams for one check and re-key the columns above:

```sql
SELECT * FROM "synthetics_results" WHERE synthetics_id = '<id>' ORDER BY _timestamp DESC LIMIT 20
SELECT * FROM "synthetics_step_results" WHERE synthetics_id = '<id>' ORDER BY _timestamp DESC LIMIT 60
```

Sanitize `org_id`, hosts and artifact keys before committing.
