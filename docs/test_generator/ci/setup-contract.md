# Test Setup Contract: Condition Null/Empty Operators (is_null / is_not_null / is_empty / is_not_empty)  (area: Pipelines)

> Read by the Engineer (implements setup), Healer and Refiner (consult instead of
> blind-scanning on data/setup failures). Every pattern below is COPY-PASTE from an
> existing helper + spec line — do NOT invent setup.

## Streams / data the spec must establish

The null/empty operators act on **field values** (null / empty-string), so the test stream must
carry fields that are actually **null** in some records and **string** in others. The existing
`tests/test-data/logs_data.json` (3848 records) already has this shape; no new fixture is needed.

- **`e2e_conditions_null_empty${streamSuffix}`** **[shared/read-only]** — ingest
  `logsdata.slice(0, 10)` (same fixture the current `pipeline-conditions.spec.js` uses).
  Why: the fixture's `code`, `level`, `method`, `took` fields are `null` in some records, and
  `message` / `kubernetes.container_name` are strings — exactly what `is_null` / `is_not_null` /
  `is_empty` / `is_not_empty` need to branch on. Dotted keys flatten to underscores in the stream
  schema, so the pickable columns are `kubernetes_container_name`, `kubernetes_host`,
  `kubernetes_namespace_name`, `kubernetes_pod_name`, `code`, `level`, `message`, `method`,
  `took`, `FloatValue`, etc.

  - **Nullable fields** (for null checks): `code`, `level`, `method`, `took` (present as `null` in
    records where the value is absent). `code` is the recommended field for all four operators —
    it is present and null in the fixture, and it is a small/stable column for a fast schema.
  - **String field** (for the "empty ≠ null" distinction): `message` (string, sometimes `null`).
  - **Non-string field** (for the "empty degrades to null" edge case): `FloatValue` (numeric).

- No per-test stream is required for the core operator flows — they only READ schema + build the
  condition. If the Engineer adds a test that MUTATES a stream or needs a distinct schema, tag that
  stream `[per-test: <TC id>]` and name it uniquely (append `${streamSuffix}`).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest (worker-unique stream):** in `beforeEach`, after `navigateToBase(page)` + a settle wait:
  ```js
  const streamNames = [`e2e_conditions_null_empty${streamSuffix}`];
  for (const streamName of streamNames) {
    await pageManager.logsPage.ingestData(streamName, logsdata.slice(0, 10));
  }
  await page.waitForTimeout(3000); // stream schema hydration
  ```
  References:
  - `tests/ui-testing/playwright-tests/Pipelines/pipeline-conditions.spec.js:54-59` (exact loop + wait).
  - `tests/ui-testing/pages/logsPages/logsPage.js:6733` — `ingestData(streamName, data)` posts each
    record to `${INGESTION_URL}/api/${orgId}/${streamName}/_json` one-by-one (keepAlive:false).

- **Auth/org:** `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`; org id/token come from
  `getOrgIdentifier()` / `getAuthHeaders()` in `tests/ui-testing/playwright-tests/utils/cloud-auth.js`;
  org env is `process.env["ORGNAME"]` (default `default`). Mirror the existing spec's
  `beforeEach` (`pipeline-conditions.spec.js:27-65`) — including the `networkidle` catch + 2s settle
  and the `goto(logData.logsUrl + '?org_identifier=' + ORGNAME)` step.

- **Stream schema is fetched async by the drawer** — see `Condition.vue::getFields()` (mount + 100ms
  delay + `getStream(name, type, true)`). The condition column dropdown only resolves AFTER this.
  Wait for the column options to populate before asserting/selecting (see Gotchas).

- **Pipeline condition node setup** (to reach the operator dropdown):
  `pageManager.pipelinesPage.createPipelineWithCondition(streamName)` — existing helper at
  `tests/ui-testing/pages/pipelinesPages/pipelinesPage.js:1644` (opens list → add pipeline → input
  stream node → delete default output → drag condition node). Then select column + operator via:
  - column: `fillCondition` / `fillPartialCondition` (`pipelinesPage.js:1583` / `1920`)
  - operator: `selectOperatorFromMenu(operator)` (`pipelinesPage.js:1935`) — operator arg MUST be the
    snake_case value (`"is_null"`, `"is_not_null"`, `"is_empty"`, `"is_not_empty"`), because the
    OSelect option's `data-test-value` is the option `value` key, not the display label.

## Preconditions / toggles

- Non-SQL / custom-condition mode: the pipeline condition drawer is always the custom
  `ConditionBuilder` (no SQL-mode toggle applies). No `disableSqlMode` step needed.
- AI-chat mode must be **off** for the default input widths used by existing selectors — the
  existing spec does not toggle it; do not introduce it.
- RBAC/enterprise: run is OSS (default org). No enterprise gating on this UI.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Value input is `v-if`-removed for unary operators** (`FilterCondition.vue:78`). Any assertion or
   helper that reads the value input (`verifyConditionValueInputValue`, `verifyConditionCount`, or
   `this.valueInput` count) will NOT see a unary condition's row. Assert on the **operator select**
   value or the saved payload instead; do not expect a value field after selecting `is_null`/etc.
2. **`fillCondition` always fills a value** (`pipelinesPage.js:1618-1620`). It will hang/error on a
   unary operator because the value field is absent. For unary operators use
   `fillPartialCondition(column)` (column only) + `selectOperatorFromMenu("is_null")` — do NOT call
   `fillCondition`'s value step.
3. **Operator `data-test-value` is snake_case**, not the label: `"is_null"`, `"is_not_null"`,
   `"is_empty"`, `"is_not_empty"`. Passing `"Is Null"` will find no option.
4. **Schema arrives async**: if you select the column before the drawer's `getFields()` resolves,
   the column list is empty. Wait for the column option (or a `networkidle`/timeout) after the
   drawer opens before interacting.
5. **`is_empty`/`is_not_empty` on a numeric field** (e.g. `FloatValue`) degrade to the null check
   (`IS NULL`) in both FE formatter and BE `build_expr` — don't assert an empty-string form there.
6. **Saving without a valid condition shows an INLINE error** at
   `[data-test="add-condition-error"]` (not a toast). Use `verifyNotificationVisible()`
   (`pipelinesPage.js:1912`), which already targets `conditionRequiredToast` = `add-condition-error`.
7. **Cancel/Escape closes the topmost dismissable layer** — always wait for the operator popover to
   hide by its `-popover` data-test (helpers already do), never press `Escape` in the drawer.
