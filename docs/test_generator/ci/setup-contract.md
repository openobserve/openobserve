# Test Setup Contract: Logs Patterns Multi-Stream Guard (area: Logs)

## Streams / data the spec must establish

The guard in `Index.vue:851` is a **pure client-side check** on
`selectedStream.length` that returns **before** `buildSearch()` and the patterns API. Therefore the
streams need **NO ingested data, NO FTS fields, and NO `enable_log_patterns_extraction`** — they only
need to *exist* and be selectable as logs streams.

- `e2e_multi_patterns_a_<ts>` **[per-test]** — logs-type stream. Why: first half of the multi-stream selection.
- `e2e_multi_patterns_b_<ts>` **[per-test]** — logs-type stream. Why: second half of the multi-stream selection.

Use a unique per-run suffix (`Date.now().toString(36)`) so concurrent runs never collide. Reuse the
cleanup convention from `searchPatterns.spec.js` (its streams are reclaimed via the
`/^e2e_http_patterns/` prefix in `cleanup.spec.js`); name these with a prefix like
`e2e_multi_patterns_` and confirm/`extend cleanup.spec.js`'s prefix list.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Create the streams via API** (no UI, no ingestion):
  `await pm.streamsPage.createStream('e2e_multi_patterns_a_<ts>', 'logs')`
  — see `tests/ui-testing/pages/streamsPages/streamsPage.js:568` (self-hosted uses node-fetch +
  Basic Auth; cloud uses browser `fetch` against `/api/{org}/streams/{name}?type=logs`).
- **Wait for the stream to be listed** before selection:
  `await waitForStreamListed(page, streamName, 'logs')`
  — see `tests/ui-testing/playwright-tests/utils/data-ingestion.js:302`.
- **Select the first stream** (single, replaces):
  `await pm.logsPage.selectStream('e2e_multi_patterns_a_<ts>')`
  — see `tests/ui-testing/pages/logsPages/logsPage.js:944`.
- **ADD the second stream to the selection** (multi-select via checkbox — row click would REPLACE):
  `await pm.logsPage.addStreamToSelection('e2e_multi_patterns_b_<ts>')`
  — see `tests/ui-testing/pages/logsPages/logsPage.js:1098`.
- **Auth/org:** `<org> = getOrgIdentifier()` (`tests/ui-testing/playwright-tests/utils/cloud-auth.js`);
  navigate via `navigateToBase(page)` then `page.goto(\`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}\`)`
  (same pattern as `searchPatterns.spec.js:47,169`).

## How to enter patterns mode in OSS (the ONLY reliable path in this edition)

The Patterns toggle (`data-test="logs-patterns-toggle"`) is gated behind
`v-if="config.isEnterprise == 'true'"` (`SearchBar.vue:108`) and does **not** render in OSS. Do NOT
click it. Enter patterns mode via the URL query param, which `handleBeforeMount`
(`Index.vue:932-941`) + `restoreUrlQueryParams` (`useLogs.ts:441-446`) read and `setupLogsTab`
(`Index.vue:1057-1059`) then acts on by calling `extractPatternsForCurrentQuery()`:

```
const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}`;
await page.goto(`${logsUrl}&stream_type=logs&stream=${streamA},${streamB}&logs_visualize_toggle=patterns`);
```

`restoreUrlQueryParams` splits `stream` on `,` → `selectedStream = [a, b]`
(`useLogs.ts:421`), so the guard condition `!sqlMode && selectedStream.length > 1` is true on mount
and the toast fires immediately.

## Preconditions / toggles

- **Non-SQL mode** (default). Do NOT toggle SQL mode on for the positive case — SQL mode short-circuits
  the guard. (Optional negative test: enable SQL mode via
  `[data-test="logs-search-bar-sql-mode-toggle"]` and assert NO multi-stream toast.)
- Quick mode is irrelevant to the guard; do not bother toggling it for the positive case.

## Assertion target (how the guard's success is observed)

- Error toast visible: `page.locator('[data-test-variant="error"]')` (`OToast.vue:153`).
- Message text (poll, toasts stack): `page.locator('[data-test="o-toast-message"]')` whose
  `allTextContents()` includes
  `"Patterns are not available when multiple streams are selected. Please select a single stream."`
  (i18n `logs.index.patternsUnavailableForMultiStream`, `en-US.json:13404`).
- Copy the toast-poll pattern from `tests/ui-testing/pages/iamPages/iamPage.js:205-210` or
  `tests/ui-testing/pages/generalPages/cipherKeys.js:206-228`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Guard fires before any network call** → the test is deterministic; do NOT add ingestion/FTS/
  patterns-config setup (that's the point of this feature's cheap setup).
- **Patterns toggle is enterprise-gated** → a `clickPatternsToggle()` in OSS finds no element. Use the
  URL-param path. If the Architect wants an enterprise edition of the spec, that toggle path is
  `@enterprise`-tagged like `searchPatterns.spec.js`.
- **Row click REPLACES selection** in the multi-select stream dropdown
  (`rowClickSingleSelect=true`, `IndexList.vue:48`). To ADD the second stream, click the option's
  `[data-select-checkbox]`, not the row (see `addStreamToSelection`, `logsPage.js:1098-1157`).
- **Toasts stack and auto-dismiss**; poll `[data-test="o-toast-message"]` `allTextContents()` rather
  than asserting a single `.first()` text.
- **Stream options are fetched on page load** — a stream created after the logs page loaded only
  appears after a reload (`logsPage.js:1126-1133`). Create both streams *before* navigating, or
  reload after creation.
- **URL `stream` restore is comma-delimited** — `stream=a,b` becomes `[a,b]`; ensure stream names
  contain no commas.
