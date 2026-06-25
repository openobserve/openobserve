# Test Setup Contract: FTS Default Column Selection  (area: Logs)

## Streams / data the spec must establish
Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Stream: `e2e_fts_default` **[shared/read-only]**
- **Why:** The primary FTS auto-pick test (Workflow 1). Needs a stream whose schema has at least one FTS-key field (e.g. `log`) with non-empty values in ingested records.
- **Fields needed:**
  - `_timestamp` (auto-generated)
  - `log` — String / TEXT type. Must be in `full_text_search_keys` for the stream. Must have non-empty values (e.g. `"ts=2026-06-25T12:00:00.000Z caller=main.go:99 level=info msg=started"`).
  - `level` — String (not FTS, for user-pin testing).
  - `kubernetes_pod_name` — String (not FTS, for user-pin testing).
- **Stream settings:** `full_text_search_keys: ["log"]`

### Stream: `e2e_fts_no_keys` **[per-test: TC-02 — no FTS candidates]**
- **Why:** Tests the fallback when NO FTS fields exist — only `source` column shown.
- **Fields:** `_timestamp`, `level` (string, not FTS).
- **Stream settings:** `full_text_search_keys: []` (empty).

### Stream: `e2e_fts_empty_values` **[per-test: TC-03 — all FTS values empty]**
- **Why:** Tests `resolveDefaultColumns` returning `[]` when all candidate values are empty/null.
- **Fields:** `_timestamp`, `message` (in `full_text_search_keys` but all ingested values are `""`).
- **Stream settings:** `full_text_search_keys: ["message"]`

### Stream: `e2e_fts_global_key` **[per-test: TC-04 — global default_fts_keys match]**
- **Why:** Tests that a field NOT in `full_text_search_keys` but matching `default_fts_keys` (zoConfig) is still a candidate.
- **Fields:** `_timestamp`, `message` (string, NOT in per-stream `full_text_search_keys`).
- **Stream settings:** `full_text_search_keys: []`
- **Global config:** `default_fts_keys: ["message"]` (must be set in zoConfig — this is a server-side config; note if the target environment doesn't have this, the test must be marked `fixme` or the stream must use per-stream `full_text_search_keys` instead).

### Stream: `e2e_fts_priority` **[per-test: TC-05 — priority tie-break]**
- **Why:** Tests that when `body` and `message` are both FTS candidates with equal fill rate, `body` wins (higher FTS_PRIORITY).
- **Fields:** `_timestamp`, `body` (TEXT, FTS), `message` (TEXT, FTS).
- **Stream settings:** `full_text_search_keys: ["body", "message"]`
- **Data:** Both fields fully populated in each record.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest data
Use the existing `ingestCustomData` + `waitForStreamData` helpers:

```js
// From tests/ui-testing/playwright-tests/utils/data-ingestion.js
const { ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const orgId = getOrgIdentifier();

// --- [shared/read-only] e2e_fts_default ---
// Example: ingestCustomData(page, 'e2e_fts_default', payload)
// See: tests/ui-testing/pages/logsPages/logsPage.js:2701 (ingestMultipleFields pattern)
// See: tests/ui-testing/pages/logsPages/logsPage.js:6299 (ingestData pattern)
const ftsDefaultPayload = [
  {
    level: "info",
    log: "ts=2026-06-25T12:00:00.000Z caller=main.go:99 level=info msg=started",
    kubernetes_pod_name: "pod-alpha",
    _timestamp: Date.now() * 1000 - 600000000 // 10 min ago in μs
  },
  {
    level: "error",
    log: "ts=2026-06-25T12:00:01.000Z caller=handler.go:200 level=error msg=timeout",
    kubernetes_pod_name: "pod-beta",
    _timestamp: Date.now() * 1000 - 300000000
  },
  {
    level: "info",
    log: "ts=2026-06-25T12:00:02.000Z caller=worker.go:50 level=info msg=completed",
    kubernetes_pod_name: "pod-alpha",
    _timestamp: Date.now() * 1000
  }
];
await ingestCustomData(page, 'e2e_fts_default', ftsDefaultPayload);
await waitForStreamData(page, 'e2e_fts_default', 3, 30000, 2000);
```

### Create streams (API — needed alongside ingestion to set `full_text_search_keys`)
Use the existing stream creation pattern from `streamsPage.js`:

```js
// From tests/ui-testing/pages/streamsPages/streamsPage.js:531-544
// createStream(streamName, streamType = 'logs')
// This creates a stream with an empty settings payload by default.
// To set full_text_search_keys, either:
//   (a) Extend createStream to accept settings overrides, or
//   (b) Use the /api/{org}/streams/{name}/settings?type=logs PUT endpoint directly.
//
// Pattern for setting FTS keys on an existing stream (PUT /settings):
const headers = getAuthHeaders();
const baseUrl = process.env.INGESTION_URL.endsWith('/')
  ? process.env.INGESTION_URL.slice(0, -1)
  : process.env.INGESTION_URL;
await page.request.put(`${baseUrl}/api/${orgId}/streams/e2e_fts_default/settings?type=logs`, {
  headers,
  data: { full_text_search_keys: ['log'] }
});
// See: tests/ui-testing/pages/apiCleanup.js:2398 for the field name in payload
```

### Auth / org
- `ORGNAME=default` — the standard test org.
- Use `navigateToBase(page)` for authenticated page context.
- Import `getOrgIdentifier` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`.

### Timing
- After ingestion, call `waitForStreamData(page, streamName, expectedMinCount, 30000, 2000)` to poll until data is searchable.
- After running a query (clicking Run Query), wait for either the table skeleton to disappear OR the result title to show `data-search-state="complete"`:
  ```js
  await page.locator('[data-test="logs-search-result-title"][data-search-state="complete"]').waitFor({ state: 'visible', timeout: 30000 });
  ```
- The stream schema arrives asynchronously. If the FTS default column doesn't appear immediately after data loads, the schema may not have hydrated `selectedStreamFields` yet. Consider a short wait + re-query if needed.

### Preconditions / toggles
- Ensure non-SQL mode (default state). Quick Mode can be on or off — FTS default applies either way.
  ```js
  // Use the existing helper from logsPage.js:
  await pm.logsPage.ensureQuickModeState(false); // optional — FTS default works in both modes
  ```

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Stream schema arrives async.** After selecting a stream, `selectedStreamFields` (which populates the FTS candidates) is loaded from the `/schema` API. If you query before the schema resolves, `resolveDefaultColumns` sees `[]` candidates and returns `[]`. Always wait for the results table to render with data before asserting column presence.
- **The `default_fts_keys` config is server-side.** Tests that rely on `default_fts_keys` (vs per-stream `full_text_search_keys`) may fail if the target environment doesn't have the expected keys. Prefer per-stream `full_text_search_keys` for reliability.
- **Need to create streams with `full_text_search_keys` BEFORE ingestion.** The FTS field must exist in the schema before `extractFields()` reads it. If ingestion creates the first records, the schema may not include the FTS field until a second ingestion cycle.
  - Recommended: Create stream → set settings → ingest → wait for indexing → navigate to logs → select stream → run query.
- **The `source` column is a fallback, not an error.** Don't assert *against* the source column; assert *for* the FTS column when it's expected. Use `expectLogTableColumnVisible(fieldName, 0)` from logsPage.js:4622.
- **`logTableColumnSource` selector is `[data-test="log-table-column-0-source"]`** — this is the first row's source column cell. When selectedFields are non-empty (FTS default active), this selector still matches because the source column is always rendered alongside custom columns (unless wrap mode changes layout). To distinguish, check for the specific FTS field column.
- **The e2e_automate stream from existing test data has `log` and `message` fields.** These are not in `full_text_search_keys` by default in the standard test data, so the FTS default may NOT trigger on `e2e_automate` unless you configure it. Check the stream's `full_text_search_keys` before assuming FTS auto-pick will work.
- **Closing a column (X button) clears isFtsDefaultColumn but the NEXT search re-resolves it** — this is by design. After closing the auto-picked column, the table shows only `_timestamp` + `source`. Running another query re-triggers the watcher, which sees no selection → resolves again.
- **Schema hydration in `selectedStreamFields` is order-sensitive.** `selectedStreamFields` has items with `ftsKey: true/false`. If the schema API returns fields before the `full_text_search_keys` have been applied (due to async settings update), the `ftsKey` flag will be `false`. Always wait for the schema to be fully hydrated.
