# Test Setup Contract: Pipeline Conditions - Null/Empty (Unary) Operators  (area: Pipelines)

> Read by the Engineer (implements setup), the Healer and the Refiner (consult instead of
> blind-scanning when a data/setup failure appears). All patterns below are copied from existing
> specs — do NOT invent setup.

## Streams / data the spec must establish

The condition builder's column options are the flattened schema of the **input stream node**. The
test data fixture `tests/test-data/logs_data.json` ships dotted kubernetes keys
(`kubernetes.container_name`, `kubernetes.host`, `kubernetes.pod_name`, `kubernetes.namespace_name`),
which OpenObserve flattens to underscore schema fields. Those flattened names are what the
condition column select shows and what every helper here keys on.

- **`e2e_conditions_operators${streamSuffix}`** — `[shared/read-only]` — fields include
  `kubernetes_container_name`, `kubernetes_host`, `kubernetes_pod_name`, `kubernetes_namespace_name`
  (all String). Why: every `@condition-null-empty-operators` test fills a condition against
  `kubernetes_container_name` and asserts the operator dropdown / value-input visibility. No test
  mutates the stream, so one stream serves all six unary tests + the "binary still requires value"
  test.
- The same beforeEach already ingests six sibling streams (`e2e_conditions_basic/groups/validation/
  precedence/multiple/delete/operators`) for the other tests in the file — do not remove them; the
  unary tests only *depend on* `..._operators`, but the shared beforeEach owns the full set.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest:** `await pageManager.logsPage.ingestData(streamName, logsdata.slice(0, 10))` in the
  `beforeEach`, with `streamSuffix = `_${testRunId}_w${testInfo.parallelIndex}`` and
  `logsdata = require("../../../test-data/logs_data.json")`.
  Reference: `tests/ui-testing/playwright-tests/Pipelines/pipeline-conditions.spec.js:49-63`
  (the loop over `streamNames`). The helper is
  `tests/ui-testing/pages/logsPages/logsPage.js:6757` (`async ingestData` → POST
  `${INGESTION_URL}/api/${org}/${stream}/_json`, one record per request, 3 retries, 500ms spacing).
- **Auth/org:** `await navigateToBase(page)` (from `utils/enhanced-baseFixtures.js:141`), which
  appends `?org_identifier=${process.env["ORGNAME"]}` to `ZO_BASE_URL`. Ingestion auth headers come
  from `utils/cloud-auth.js` (`getOrgIdentifier()` = `ORGNAME`, `getAuthHeaders()`).
- **Timing:** after the ingest loop, `await page.waitForTimeout(3000)` lets the stream schema
  hydrate. The condition column select (`updateStreamFields` → `getStream(..., true)`) reads the
  schema; querying before it lands yields an empty column list and the `kubernetes_container_name`
  option never appears.
- **Stream-name selection in the node form:** `createPipelineWithCondition(streamName)` already
  enters the stream name and selects it (`enterStreamName` + `selectStreamOptionByName`) — no extra
  setup needed.

## Preconditions / toggles

- The condition drawer requires a stream node as the pipeline input; the source stream must have a
  schema with at least the flattened text field `kubernetes_container_name`.
- No SQL-mode toggle is involved in the pipeline condition drawer (unlike alerts, there is no
  SQL/WHERE preview here). No other feature flags gate the operator list.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Flattened field names:** the ingest payload uses dotted `kubernetes.*` keys, but the condition
  select lists flattened `kubernetes_*` names. Do not search the column options by the dotted form.
- **Value input is `v-if`-removed for unary operators** — `FilterCondition.vue:78`
  (`v-if="!isUnaryOperator(condition.operator)"`). Asserting `verifyValueInputCount(0)` after
  selecting `is_null` is the definitive "value input gone" signal; `verifyValueInputCount(1)` proves
  it returns for a binary operator.
- **Operator select options are keyed by snake_case `data-test-value`** (`is_null`, `is_not_null`,
  `is_empty`, `is_not_empty`), while the rendered trigger shows the capitalized label (`Is Null`,
  `Is Empty`, …). `verifyOperatorSelected` maps wire value → label; `verifyUnaryOperatorsOffered`
  asserts the snake_case `data-test-value` options.
- **Schema error is inline, not a toast:** save-with-empty/partial conditions surfaces
  `[data-test="add-condition-error"]` (the bridged `conditions` field error), not `[role="alert"]`
  (which now matches Monaco's hidden a11y alert). Assert via `verifyNotificationVisible` /
  `verifyNoConditionError`.
- **`selectOperatorFromMenu` / `fillPartialCondition` must NOT press Escape** — that would close the
  topmost dismissable layer (the whole conditions dialog). They wait for the named popover to detach
  instead.
- **Round-trip requires the backend to persist the operator:** the pipeline condition node saves V2
  `{version:2, conditions}` via `addNode`; backend `ConditionOperator` serde renames
  (`src/infra/src/table/alerts/intermediate.rs:337-344`) accept `is_null`/`is_not_null`/`is_empty`/
  `is_not_empty`, so edit-reopen restores them via `ConditionBuilder`'s `normalizeOperators`.
