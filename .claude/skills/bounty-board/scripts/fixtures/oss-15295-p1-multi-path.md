### Bug Description

Logs page — on a hard refresh with SQL mode on, running any query floods the browser with a storm of identical semantic-groups network requests. This is a checklist of the problem found.

- [ ] **`P1` · Running a query in SQL mode after a hard refresh fires dozens of identical "semantic-groups" API calls, all returning the same data.** Open Logs, keep SQL mode on, hard-refresh the page, then run any query (e.g. `SELECT * FROM "default"`). The Network tab fills with many identical `alerts/deduplication/semantic-groups` requests — most left `(pending)` with 0 kB — every one returning the exact same response. This hammers the backend and queues the browser's HTTP connection pool, slowing down the real search requests on the most-used page.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `web/src/composables/useCorrelationDefaultSlug.ts` + `web/src/composables/useLogs/useSearchResponseHandler.ts` + `web/src/composables/useLogs/useStreamFields.ts`.

  **Mechanism:**
  - Streaming logs search delivers results in many partition chunks. Each chunk calls `handleStreamingHits()` → `processPostPaginationData()` (`useSearchResponseHandler.ts:210-215`) → `filterHitsColumns()` → `await correlationFilters.save()` (`useStreamFields.ts:1278`).
  - `save()` → `sync()` → `getCorrelationFieldNames()` → `loadSemanticGroups()` in `useCorrelationDefaultSlug.ts:43-54`.
  - That `loadSemanticGroups()` caches only the **resolved** value in a plain `Map` (`semanticGroupsCache.has(orgId)`), with **no in-flight promise de-duplication**. `getCorrelationFieldNames()` likewise has no in-flight guard and populates its `fieldNamesCache` only after fully resolving.
  - On a hard refresh the caches are cold. A burst of partition chunks all enter `loadSemanticGroups()` before the first request resolves, so each fires its own `GET /api/{org}/alerts/deduplication/semantic-groups` → one request per partition → the storm. Because the responses are slow/serialized, none resolves in time to seed the cache for the others.
  - **SQL-mode specific:** `sync()` proceeds only when the query string is non-empty; in SQL mode the editor always holds a non-empty query (`SELECT * FROM ...`), so every chunk reaches the fetch. (The shared queryClient-backed caches in `utils/semanticGroupsCache.ts` and `utils/identityConfig.ts` *do* de-dup via `fetchQuery`, but this correlation path bypasses them.)

  **Proposed fix** (any of, preferably 1+3):
  1. Add in-flight promise de-dup in `useCorrelationDefaultSlug.ts`: store the pending `Promise<FieldAlias[]>` in `semanticGroupsCache` (and a pending-promise guard keyed by `orgId/streamName` in `getCorrelationFieldNames`) so concurrent callers share one request.
  2. Route this path through the shared `loadSemanticGroups` in `utils/semanticGroupsCache.ts` (which already de-dups via `queryClient.fetchQuery`) instead of the local `Map`, for a single source of truth and consistent TTL/invalidation.
  3. Stop invoking `correlationFilters.save()` on every streaming chunk — it does not belong inside `filterHitsColumns()` (which runs per partition). Run the correlation-filter sync once per completed query, or debounce it.
  </details>

https://github.com/user-attachments/assets/031b6713-329b-411b-a072-29d720b74938

### Priority

P1 - High

### Severity

Major

### Related Story/Issue

Not Available

### Is this a regression?

Yes

### Steps to Reproduce

1. Open the **Logs** page.
2. Ensure **SQL mode** is ON (query bar shows e.g. `SELECT * FROM "default"`).
3. **Hard-refresh** the page (Cmd/Ctrl+Shift+R) so client caches are cold.
4. Open DevTools → Network, filter to Fetch/XHR.
5. Click **Run query**.
6. Observe many identical `alerts/deduplication/semantic-groups` requests fire at once (most `(pending)`, all with the same response body).

### Environment Details

```yaml
Version: Unknown
Edition: Example
Environment: test.example.com
OS: macOS
Browser: Chrome
```

### Which OpenObserve Functionalities Are Affected?

- [x] Logs / Metrics / Traces
- [x] UI / Styling

