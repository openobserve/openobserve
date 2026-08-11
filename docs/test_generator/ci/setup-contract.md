# Test Setup Contract: SLO PromQL Time-Slice Support and Validation  (area: Alerts)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### For PromQL time-slice and count tests (needs metrics stream)

- **`e2e_slo_metrics`** **[shared/read-only]** — A metrics stream with gauge values over time so PromQL expressions like `up` or `rate(x[5m])` return non-empty results.
  - Fields: `__name__`, `__type__` (gauge), `host_name`, `k8s_cluster`, `k8s_container_name`, `region`, `_timestamp`, `value`
  - Why: The form's stream picker needs a selectable metrics stream; the PromQL time-slice preview runs `query_range` against it and needs non-empty results to draw a chart.
  - **IMPORTANT**: PromQL queries targeting this stream reference it by `__name__`, so `e2e_slo_metrics{}` is valid PromQL.

- **`e2e_slo_metrics`** (same stream) — also serves Count PromQL preview.
  - PromQL count expressions like `rate(e2e_slo_metrics[5m])` need at least some samples over the query range.

### For SQL time-slice tests (needs logs stream)

- **`e2e_automate`** **[shared/read-only]** — Already pre-ingested by global setup. Has fields like `level`, `job`, `log`, `city`, `country`, `status`, `age`.
  - Why: SQL time-slice tests need a selectable logs stream. The aggregate expression (e.g. `avg(age)`) needs columns in the schema. This stream is already in the org.

### For edit-mode tests (needs pre-created SLO via API)

- **A stored PromQL time-slice SLO** **[per-test: TC-xx edit tests]** — Created via `sloService.create()` API call with `query_language: "prom_ql"`. The form's `load()` fetches it from `sloService.get()`.
  - **Alternatively**: Create the SLO via UI first, then navigate to its edit URL.

### For alert-SLI tests (needs eligible alert)

- **An eligible alert** **[per-test]** — The alert must exist in the org and meet `slo-eligible` criteria (frequency, evaluation type). Created via alerts API.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Metrics stream for PromQL tests

**Pattern**: `pm.pipelinesPage.ingestMetricsData(streamName, recordCount)`
- See: `tests/ui-testing/playwright-tests/Pipelines/pipeline-metrics.spec.js:72` — calls `ingestMetricsData('cpu_usage', 10)`
- This uses `POST /api/{org}/ingest/metrics/_json` with `__name__`, `__type__: "gauge"`, `_timestamp`, `value`, and label fields.

**Exact call**:
```js
// In beforeAll or test.beforeAll:
// Ensure the test metrics stream exists and has data
await pageManager.pipelinesPage.ingestMetricsData('e2e_slo_metrics', 20);
// Wait for stream to register (mirrors ingestTestData pattern)
await page.waitForTimeout(3000);
```

**ALSO NEEDED**: The metrics stream must appear in the SLO form's stream picker dropdown. The form calls `useStreams().getStreams("metrics", false)` — this fetches from the streams API. After ingestion, poll the streams list to confirm registration (same pattern as `ingestTestData` in `commonActions.js:299-307`):
```js
const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
const orgId = getOrgIdentifier();
let registered = false;
for (let i = 0; i < 30 && !registered; i++) {
  const listResp = await page.request.get(`${baseUrl}/api/${orgId}/streams?type=metrics`, { headers });
  if (listResp.ok()) {
    const body = await listResp.json().catch(() => null);
    registered = (body?.list || []).some(s => s.name === 'e2e_slo_metrics');
  }
  if (!registered) await page.waitForTimeout(1000);
}
```

### Existing logs stream

**Pattern**: Use `e2e_automate` which is seeded by `global-setup` or `pm.commonActions.ingestTestData()`.
- See: `tests/ui-testing/playwright-tests/Alerts/alerts-ui-operations.spec.js:85`
- `await pm.commonActions.ingestTestData(streamName);` — ingests JSON with `{level, job, log}` fields
- Or use the already-existing `e2e_automate` stream which global-setup ingests.

### Pre-creating an SLO via API (for edit tests)

**Pattern**: Direct API call using `page.request` or `apiCall` helper.
- See: `tests/ui-testing/playwright-tests/Alerts/alerts-form-validation.spec.js:42-51` for the `apiCall` pattern.
- The SLO create endpoint: `POST /api/{org}/slos`

**Exact call**:
```js
async function createSloViaApi(page, payload) {
  const org = getOrgIdentifier();
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const headers = getAuthHeaders();
  const resp = await page.evaluate(async ({ url, headers, body }) => {
    const opts = { method: 'POST', headers };
    opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    return { status: r.status, data: await r.json() };
  }, { url: `${baseUrl}/api/${org}/slos`, headers, body: payload });
  return resp;
}
```

Payload for a PromQL time-slice SLO:
```json
{
  "name": "e2e-test-promql-slo",
  "folder_id": "default",
  "sli_type": "time_slice",
  "target": 99.9,
  "window_secs": 2592000,
  "slice_interval_secs": 300,
  "enabled": true,
  "config": {
    "stream": "e2e_slo_metrics",
    "stream_type": "metrics",
    "query": "up",
    "comparator": "<",
    "threshold": 1,
    "query_language": "prom_ql"
  }
}
```

### Auth / org

- Auth state is pre-loaded from `tests/ui-testing/playwright-tests/utils/auth/user.json` by `enhanced-baseFixtures.js`
- Org from `process.env.ORGNAME` / `getOrgIdentifier()`
- Navigation to base: `await navigateToBase(page);` — lands at `/web/?org_identifier=...`

## Preconditions / toggles

- **Navigation to SLO list**: SLOs are under the "Reliability" nav group. Since there is no `NAV_FLYOUT_CHILD.sloList` entry in `commonActions.js`, the spec will need to navigate directly or add a helper:
  ```js
  // Direct URL navigation:
  await page.goto(`${process.env.ZO_BASE_URL}/web/slos?org_identifier=${getOrgIdentifier()}`);
  // Or use the nav group:
  await page.locator('[data-test="nav-group-reliability"]').hover();
  await page.locator('[data-test="nav-group-item-sloList"]').click();
  ```

- **No SQL/quick-mode toggle needed**: The SLO form has no mode toggle to worry about.

- **The form streams dropdown needs stream type selected first**: On the time-slice branch, the stream name picker (`data-test="slos-addslo-timeslice-stream"`) is disabled until a stream type is chosen. Select `metrics` first using the stream type dropdown.

- **PromQL language toggle appears ONLY after selecting "metrics" stream type**. The toggle is between SQL and PromQL, with PromQL as the default for metrics.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Metrics stream schema arrives async**: After selecting a metrics stream in the form, the field list loads via `loadStreamFields()`. The group-by options and field typeahead populate from this. Preview charts also depend on stream availability. Wait for stream registration before navigating to the form.

- **Stream picker in SLO form is an OSelect, not a QSelect**: Different from the alert form's dropdown pattern. It uses `[data-test$="-popover"]` and `[data-test$="-option"]` selectors.

- **SloExpressionField takes data-test as a declared PROP, not an HTML attribute**: When querying by data-test on these fields, use the parent wrapper div (which gets the data-test as a bound attribute via `:data-test="dataTest"`) rather than expecting it on the inner editor element.

- **OSelect sets `inheritAttrs: false`**: The `data-test` attribute on OSelect components is in `$attrs`, not on the DOM element. Use the component wrapper's `$attrs['data-test']` when needed, but for Playwright, target the parent region.

- **Comparators `<` and `>` are special characters in HTML**: Use attribute selectors carefully. For OSelect option values, use `[data-test-value="<"]`.

- **The form's `wireConfig()` uses an allow-list, not a spread**: When asserting on saved payloads, don't expect keys from other SLI types (e.g., `comparator` should NOT be in a count SLI payload, `scope` should NOT be in a PromQL time-slice payload).

- **Preview charts are debounced 500ms**: After typing an expression, wait > 500ms before asserting chart states. Use `waitForTimeout(1000)` or wait for the chart container to show non-loading state.

- **SLO save may fail with budget rejection**: The backend has a row reservation budget (S-14). If the org is near its budget, saves will fail. For CI, prefer small targets (99.9%), 30d windows, and no grouping to minimize reservation.

- **The SLO form shares one `form.config` object across all SLI types**: When switching between SLI types, check that no keys from the previous type leak into the payload. The `wireConfig()` function handles this, but visual verification is helpful.

- **PromQL range evaluation expects `step` in seconds**: The preview function `buildSloPromqlPreviewRange` sends `step: String(sliceIntervalSecs)` (e.g. `"300"` for 5-minute slices). Make sure the slice interval matches the preview's expectations.

- **No `nav-group-item-sloList` entry in `NAV_FLYOUT_CHILD`**: The `openNavFlyoutChild` helper in `commonActions.js` doesn't have an entry for `sloList`. The test must either navigate via direct URL or add a custom helper.

- **Cleanup**: SLOs created during tests should be cleaned up in `afterAll` or `afterEach` via `sloService.delete()`. Use unique names with run IDs to avoid clashes across parallel shards.
