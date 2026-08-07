# Test Setup Contract: RUM Error Detail Redesign (area: RUM)

## Streams / data the spec must establish

### `_rumdata` **[shared/read-only]**
Error stream with at least one error event containing the fields below. All tests read this data; none mutate it. Set up ONCE in `beforeAll`.

#### Required fields for full error detail rendering
| Field | Required for | Example value |
|-------|-------------|---------------|
| `type` | Signature WHERE clause | `"error"` |
| `error_id` | Error identification, copy-ID button | `"error-typeerror-001"` |
| `error_type` | Header type text, signature, issue grouping | `"TypeError"` |
| `error_message` | Header banner, signature | `"Cannot read property 'name' of undefined"` |
| `error_stack` | Stack trace (Raw/Pretty tabs) | multi-line string (at least 3 frames) |
| `error_handling` | Handling badge (handled/unhandled) | `"unhandled"` or `"handled"` |
| `_timestamp` | Timestamp display, chart markLine, breadcrumb anchor | microsecond epoch (e.g. `Date.now() * 1000`) |
| `session_id` | Breadcrumb timeline, session replay button | `"test-session-001"` |
| `user_agent_user_agent_family` | Browser facet, context card browser | `"Chrome"` |
| `user_agent_os_family` | OS facet, context card OS | `"Mac OS"` |
| `version` | Release facet, deployment chips | `"1.0.0-e2e-test"` |
| `view_url` | Page facet, route display, context card URL | `"http://localhost:8089/checkout"` |
| `service` | Deployment chips | `"e2e-error-detail"` |
| `source` | Source badge | `"source"` or `"console"` |

#### Optional fields (enhance test coverage when present)
| Field | Effect when present | Effect when absent |
|-------|-------------------|--------------------|
| `usr_name` | Context card shows user name + initials | Shows "Unknown User", "?" initials |
| `usr_email` | Context card shows email | Shows "Unknown" |
| `geo_info_city` | Location row in context card | Location row shows "Unknown" |
| `geo_info_country` | Location row | Shows "Unknown" |
| `ip` | IP row in context card | IP row hidden |
| `env` | Env chip in context card + header | Chip hidden |
| `sdk_version` | SDK version chip | Chip hidden |
| `user_agent_user_agent_major` | Browser version display | "Unknown" version |
| `user_agent_os_major` | OS version display | "Unknown" version |
| `_o2_trace_id` / `_oo_trace_id` | TraceCorrelationCard renders | Card hidden |

#### Facet distribution data
To exercise the FacetBreakdown fully (not just one value per dimension), ideally:
- Multiple errors with different browser families (Chrome, Firefox, Safari) — so "Chrome: 67%, Firefox: 22%, Safari: 11%" appears
- Multiple errors with different OS families
- Multiple errors with different `version` values
- Multiple errors with different `view_url` values

This can be accomplished by ingesting 3+ error events with varied `user_agent_user_agent_family`, `user_agent_os_family`, `version`, and `view_url` values.

---

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest error data
Use the existing `ingestRumErrors` helper, which POSTs to `_rumdata/_json`. It already generates errors with `error_type`, `error_message`, `error_stack`, `session_id`, `view_url`, `service`, `version`, browser/os context.

```js
// EXISTING PATTERN — see:
// tests/ui-testing/playwright-tests/utils/rum-error-ingestion.js:17-66
// Usage in tests:
// tests/ui-testing/playwright-tests/RUM/sourcemap-ui.spec.js

const { ingestRumErrors } = require('../utils/rum-error-ingestion.js');

// In beforeAll:
const result = await ingestRumErrors(page, 3);
expect(result.success).toBe(true);
```

**IMPORTANT**: The existing `ingestRumErrors` helper generates events with `error_handling` missing, `source` missing, `usr_name`/`usr_email` missing, and `geo_info_*` missing. These fields must be added to make the error detail page render all panels fully. The recommended approach is to **extend the `generateRumErrors` function** in the spec (or a local copy) to include these extra fields, rather than modifying the shared utility (which other specs use as-is).

**Minimal augmentation** to add to each generated event in `generateRumErrors()`:
```js
error_handling: 'unhandled',  // or alternate: 'handled' for a second event
source: 'source',
usr_name: 'Test User',
usr_email: 'test@example.com',
geo_info_city: 'San Francisco',
geo_info_country: 'United States',
ip: '203.0.113.1',
env: 'production',
sdk_version: '1.2.3',
```

### Auth / org / token
```js
// EXISTING PATTERN — see:
// tests/ui-testing/playwright-tests/utils/rum-env.js:71-73
// tests/ui-testing/playwright-tests/utils/rum-token-api.js:59-60

const { rumTestContext } = require('../utils/rum-env.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');

// rumTestContext() returns { orgId, baseUrl, email, password }
// ORGNAME=default; worker auth state / login via enhanced-baseFixtures
```

The existing RUM tests use `enhanced-baseFixtures.js` which handles authentication. The RUM token can be created API-side; no browser login is needed for the data ingestion step.

### Navigation to error detail
```js
// EXISTING PATTERN — see:
// tests/ui-testing/pages/rumPages/rumPage.js:217-250

const pm = new PageManager(page); // page manager provides pm.rumPage

// Step 1: Navigate to errors list (auto-runs query)
await pm.rumPage.gotoErrorsList({ service: SERVICE, period: '1h' });

// Step 2: Wait for error rows to appear
await pm.rumPage.waitForErrorRowsPresent(30000);

// Step 3: Open first error
await pm.rumPage.openFirstError();

// Step 4: Wait for detail view to load
await pm.rumPage.expectErrorDetailViewLoaded();
```

**Alternative — direct URL navigation** (the `clickFirstErrorRow` pattern from rumPage.js:143-165):
```js
// EXISTING PATTERN — see:
// tests/ui-testing/pages/rumPages/rumPage.js:143-165

// Requires firstErrorId and firstErrorTimestamp captured from API response
const currentUrl = page.url();
const url = new URL(currentUrl);
const org = url.searchParams.get('org_identifier') || process.env.ORGNAME || 'default';
await page.goto(
  `${process.env.ZO_BASE_URL}/web/rum/errors/view/${errorId}?timestamp=${timestamp}&org_identifier=${org}`
);
```

### Wait for data to hydrate
After navigating to the error detail view, wait for:
1. The loading spinner to disappear:
```js
// EXISTING PATTERN — see:
// tests/ui-testing/pages/rumPages/rumPage.js:167-173
await page.locator('[data-test="error-viewer-loading-indicator"]').waitFor({ state: 'hidden', timeout: 15000 });
```
2. The error viewer container to be visible (already done by `expectErrorDetailViewLoaded()`):
```js
await page.waitForSelector('[data-test="error-viewer-container"]', { timeout: 10000 });
```

---

## Preconditions / toggles

- **RUM must be enabled** for the test organization. The `ingestRumErrors` helper fetches/validates the RUM token; ensure the org has RUM enabled or the token endpoint exists.
- **`_rumdata` stream must exist and accept JSON ingestion.** The `POST /api/{org}/_rumdata/_json` endpoint is the standard RUM ingestion path.
- **Time range**: Error events should have `_timestamp` within the query window. `ingestRumErrors` generates events with timestamps within the last few minutes relative to `Date.now()`.
- **Search index delay**: After ingestion, it may take a few seconds for the ingested rows to become searchable. The existing `waitForErrorRowsPresent()` handles this with polling.
- **Schema hydration**: The stream schema is loaded via `loadSchema()` immediately when `ErrorViewer` activates. No explicit waiting should be needed since the loading spinner guards all panels.

---

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Schema presence map gates aggregates**: `loadSchema()` in `ErrorViewer.vue:190-201` fetches the `_rumdata` stream schema. The SQL builders (`buildSignatureWhere`, `buildIssueImpactSql`, `availableFacets`) all guard optional columns through this map. If the schema returns empty or the ingest format flattens field names unexpectedly, aggregates will quietly skip or return null values. Verify schema fields exist after ingestion.

2. **Dots in field names are flattened by OpenObserve**: The `ingestRumErrors` helper sends nested JSON like `{error: {type: "TypeError"}}`. OpenObserve flattens this to `error_type`. Make sure the augmented fields use underscore naming that matches what the ErrorViewer expects (e.g. `error_handling` not `error.handling`; `user_agent_user_agent_family` not `user_agent.family`).

3. **Breadcrumbs need session_id on error**: The `getErrorLogs()` function in ErrorViewer only runs when `errorDetails.value.session_id` is truthy (ErrorViewer.vue:218). Without session_id, events timeline shows NoData.

4. **Stack trace line rendering**: The raw stack tab only renders frames from index 1+ (ErrorStackTrace.vue:46-47: `v-if="index"`). Index 0 is the summary line shown separately. So ensure `error_stack` has at least 2 lines (index 0 summary + at least 1 frame at index 1).

5. **Facet SQL depends on schema columns**: `availableFacets()` at errorDetailQueries.ts:102 filters facet specs to only those whose columns exist in the schema. If `user_agent_user_agent_family` isn't in the schema, the browser facet group is empty.

6. **Time-based search window**: `getError()` queries with `_timestamp = <value> ORDER BY _timestamp DESC` (ErrorViewer.vue:279). It reads `errorDetails._timestamp` from the search result, which is microsecond precision. The test must use a timestamp value that matches an ingested error row exactly (within 1µs range).

7. **Keep-alive behavior**: If the test navigates between tabs, the ErrorViewer may be cached. Use `page.goto()` for direct navigation rather than clicking through tabs to avoid keep-alive state confusion.

8. **Existing `rum-error-ingestion.js` does NOT generate all needed fields**: The current `generateRumErrors` function (line 112-186) omits: `error_handling`, `source`, `usr_name`, `usr_email`, `geo_info_city`, `geo_info_country`, `ip`, `env`, `sdk_version`, `_o2_trace_id`. Tests that assert on the corresponding UI elements must extend the generated event data.
