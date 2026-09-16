# Test Setup Contract: Logs Search Bar Stream Not Found Message  (area: Logs)

Target spec: `tests/ui-testing/playwright-tests/Logs/streamNotFound.spec.js` (group: `Logs-Queries`)

## Streams / data the spec must establish

The message is produced **client-side** from editor content + the already-loaded stream list — it
does NOT require a backend query or any specific ingested record. The only hard precondition is
that the stream **list** is loaded before typing (see Timing below).

- **`e2e_automate` [shared/read-only]** — fields: `code`, `stream`, `kubernetes_host`,
  `kubernetes_container_hash`, `kubernetes_container_name`, `_timestamp`, etc. (see
  `tests/ui-testing/test-data/logs_data.json`).
  Why: only needed by the POSITIVE edge case (Workflow 2 — typing `SELECT * FROM "e2e_automate"`
  selects the stream and clears the message). NOT needed for the primary negative assertion.
  This is the standard shared logs stream used across the Logs-Queries suite; it is usually
  already present in the seeded org. If the spec runs in a fresh/empty org, seed it (below).

- **a non-existent stream name, e.g. `e2e_does_not_exist_<runToken>` [per-test, generated string]**
  — this is NOT an ingested stream; it must be a name that does NOT exist in the org. Use a
  per-run unique token (`Date.now()` + random) so parallel/repeat runs never collide with a
  still-deleting stream of the same name (stream deletion in OpenObserve is async). Typing
  `SELECT * FROM "e2e_does_not_exist_<runToken>"` is what triggers the message.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- Ingest the shared stream (only if the org may be empty — matches the standard
  `logsqueries.spec.js` beforeEach):
  `await ingestTestData(page);` — see `tests/ui-testing/playwright-tests/Logs/logsqueries.spec.js:36`
  (`ingestTestData` posts to `/api/<org>/e2e_automate/_json`; helper at
  `tests/ui-testing/playwright-tests/utils/data-ingestion.js:11`).
- Auth / org: `navigateToBase(page)` then `page.goto(\`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}\`)`
  — exactly as `logsqueries.spec.js:29-43` and `logsQuickPick.spec.js:28-37`.
  (`logData.logsUrl` = `/web/logs` from `tests/ui-testing/fixtures/log.json`; `getOrgIdentifier()`
  from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`.)
- Generating the unique missing-stream name: copy the token pattern from
  `logsQuickPick.spec.js:149` (`const runToken = \`${Date.now()}${Math.floor(Math.random()*1000)}\``).

## Preconditions / toggles

- **No SQL-mode toggle needed.** SQL mode auto-enables when the typed value contains both
  `select` and `from` (SearchBar.vue:2945). Type the full `SELECT * FROM "…"` string directly.
- **No stream must be pre-selected** for the cleanest reproduction (fresh arrival on
  `/web/logs?org_identifier=…` with no `stream` query param → `selectedStream` is empty and the
  generic "pick a stream" empty state renders before typing). The diff's whole point is that the
  stream-not-found message must NOT be shadowed by that empty state.
- Enter the query with the page-object methods (not raw `page.fill`):
  `await pm.logsPage.clickQueryEditor(); await pm.logsPage.typeInQueryEditor(\`SELECT * FROM "${streamName}"\`);`
  then `await pm.logsPage.waitForQueryEditorValue(streamName);` — see
  `logsqueries.spec.js:163-190` and `:180-194`.

## Timing (critical — this is the one thing that makes the test flaky if skipped)

- **Wait for the stream list to be loaded BEFORE typing.** The detection iterates
  `searchObj.data.streamResults.list` (SearchBar.vue:2992). The initial state is `streamResults: []`
  (`constants.ts:222`), so `[].list` is `undefined` → `.forEach` throws inside a swallowed
  `try/catch` → **no message appears, and it never self-corrects** (the message is only computed
  on editor-content change). The list is populated by `getStreamList` on page load
  (`useStreamFields.ts:878-893`). Wait on a concrete signal, e.g.:
  - `await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate')` (logsPage.js:12275), or
  - wait for the index dropdown `[data-test="log-search-index-list-select-stream"]` to be visible,
    or
  - `await pm.logsPage.waitForFieldListAfterStreamSelection()` after selecting `e2e_automate`.
  Prefer `waitForStreamAvailable('e2e_automate')` (logsPage.js:895) + a visible index dropdown for
  a deterministic readiness gate.

## Gotchas (so the Healer/Engineer don't rediscover them)

- `expectErrorMessageVisible()` (logsPage.js:3920) already matches BOTH `logs-search-error-state`
  and `logs-search-filter-error-message` — use it for presence, but for the message CONTENT assert
  on `[data-test="error-detail-summary"]` (holds the exact `Stream "…" does not exist` text) inside
  the `[data-test="logs-search-filter-error-message"]` container. The message is a single clause
  (no `. `), so `useQueryError` renders it wholly in the summary line with NO expandable detail
  body.
- Assert the NEGATIVE too: `[data-test="logs-search-no-stream-selected-text"]` must NOT be visible
  while the message is — that generic empty state is exactly what the fix stops from shadowing the
  message.
- The editor emits `update:query` on a ~100 ms debounce; `waitForQueryEditorValue` already waits
  for the Monaco model + a 200 ms settle (logsPage.js:2796-2813). Do not click Run — running the
  query would hit the backend (error 20002) and is a DIFFERENT path from this frontend detection.
- `errorCode` for this path is hardcoded `0` (Index.vue:158), so there is NO "Fix query" action
  card and NO "Ask AI" button in OSS — do not assert on either.
- Use the per-run unique stream name in the assertion (match the full token), not a literal
  `"does_not_exist"`, so the message text uniquely identifies THIS run's typed value.
