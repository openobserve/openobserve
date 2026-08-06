# Test Setup Contract: Log Stream Timezone Display (area: Logs)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Stream: `e2e_automate` **[shared/read-only]**
- **Fields**: standard log fields (`_timestamp`, `level`, `job`, `log`, `e2e`, `kubernetes_*`, etc. — same fixture used across all Logs/Streams tests).
- **Why**: all timezone-display tests READ the stream stats (doc_time_min/max) from the schema drawer — they never mutate the stream. The existing `e2e_automate` stream is pre-seeded and reused by dozens of existing specs; using it avoids stream-creation/deletion churn.
- **Precondition**: `e2e_automate` must exist AND have ingested data (so `doc_time_min`/`doc_time_max` are non-empty). The `beforeAll`/`beforeEach` in the spec must ingest data once if not already done.

### Timezone state: **store.state.timezone** **[per-test]**
- **Why**: each test may set a different timezone (UTC, "America/New_York", browser default) and assert the displayed label matches.
- **How to set**: the store mutation `setTimezone` accepts an IANA string; the timezone is persisted to localStorage via `useLocalTimezone()`. The spec calls `page.evaluate` to dispatch it:
  ```js
  await page.evaluate((tz) => {
    // Vuex store — must import the store or use window.__store__ if exposed
  });
  ```
  **NOTE**: the Vuex store may not be directly accessible from `page.evaluate`. The reliable path is:
  - Navigate to Logs page (which renders the DateTime component with the timezone selector)
  - Use the `[data-test="datetime-timezone-select"]` to change timezone via UI (DateTime.vue dispatches `setTimezone` + persists to localStorage)
  - OR navigate via URL with `?timezone=America/New_York` query param (useLogs.ts line 403 persists it)

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Ingest data**: `await ingestTestData(page, 'e2e_automate')` from `tests/ui-testing/playwright-tests/utils/data-ingestion.js` — see `tests/ui-testing/playwright-tests/Dashboards/crossLinking.spec.js:21`.
- **Navigate to Streams page**: `await pm.streamsPage.navigateToStreamExplorer()` — see `tests/ui-testing/playwright-tests/Streams/stream-settings.spec.js:14`.
- **Search for stream**: `await pm.streamsPage.searchStream('e2e_automate')` — see `tests/ui-testing/playwright-tests/Streams/stream-settings.spec.js:29`.
- **Open stream detail (schema drawer)**: `await pm.streamsPage.openStreamDetail('e2e_automate')` — see `tests/ui-testing/playwright-tests/Streams/stream-settings.spec.js:32`.
- **Auth/org**: `<ORGNAME=default>`; the worker auth state comes from `playwright-tests/utils/auth/user.json` — no explicit login needed.
- **Timing**: after opening the schema drawer, wait for the schema content to render (loading state finishes when `indexData.schema` populates), then assert. The `getSchema()` call fetches stream stats and `setSchema()` formats doc_time_min/max with `formatTimestampInTimezone`.

## Preconditions / toggles

- No special toggle needed. The timezone display is always rendered when `indexData.name` is set (which happens as soon as the schema drawer opens with a valid stream).
- The timezone label chip (`v-if="indexData.name"`) renders in the `#header-right` slot regardless of which tab is selected (schema settings, extended retention, configuration, cross-linking).
- To change timezone for testing: either use the DateTime component's timezone selector (`[data-test="datetime-timezone-select"]`) on the Logs page, or set localStorage key `"timezone"` + reload/refresh the schema drawer. The single-source-of-truth approach is via DateTime.vue because it does both `useLocalTimezone(selectedTimezone)` and `store.dispatch("setTimezone", selectedTimezone)`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`NEEDS SELECTOR`**: The header-right chip, the timezone label `<span>`, and the `doc_time_min`/`doc_time_max` `<div>` have NO `data-test` attributes. The Engineer must add selectors OR use fallback locators scoped to `[data-test="schema-drawer"]`.
- **stream schema arrives async**: `getSchema()` (called in `created()`) is async — the drawer renders the spinner (`<OSpinner>`) while `loadingState` is true, then renders content when the API call completes and `setSchema()` populates `indexData`. Assert only after the spinner disappears or the schema table/content is visible.
- **timezone round-trip**: `displayTimezone` is computed at render time. If you change the timezone while the drawer is open, the header-right *should* reactively update (the computed depends on `store.state.timezone` which is reactive). However, the `doc_time_min`/`doc_time_max` values are formatted ONCE in `setSchema()` during the response handler — they will NOT re-format if you change timezone without re-opening the drawer. If testing timezone changes, close and re-open the drawer.
- **`doc_time_min`/`doc_time_max` may be "0" or empty**: if the stream has no data, these values may render as `"1970-01-01T00:00:00:00"` (epoch) or empty. Ensure the stream has ingested data before testing.
- **Cloud vs OSS**: `isCloud` only gates stats tiles (compressed size, index size) — the timeline/header chip renders in both editions.
