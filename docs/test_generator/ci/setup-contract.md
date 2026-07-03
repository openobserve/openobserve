# Test Setup Contract: RUM Sessions Health & Metrics Dashboard (area: RUM)

## Streams / data the spec must establish

### [shared/read-only] — All tests read from these, mutations happen only via the UI actions (query, segment filter). Set up ONCE before the describe block.

- **`_rumdata`** `[shared/read-only]` — log stream containing RUM events.
  Fields needed (minimum): `type`, `session_id`, `session_has_replay`, `error_count`,
  `action_frustration_type`, `action_target_name`, `error_message`, `view_url`,
  `geo_info_city`, `geo_info_country`, `geo_info_country_iso_code`, `usr_email`,
  `zo_sql_timestamp` (or `_timestamp`), `view_id`, `view_url`, `resource_url`,
  `application_id`, `env`, `service`, `source`, `api`, `usr_name`, `usr_id`, `user_agent_*`.
  Why: queried by `getSessions()` (page query), window aggregates, insight clusters, and activity sparklines.

- **`_sessionreplay`** `[shared/read-only]` — log stream containing session replay metadata.
  Fields needed (minimum): `session_id`, `start`, `end`, `user_agent_user_agent_family`,
  `user_agent_os_family`, `user_agent_device_family`, `ip`, `source`.
  Why: queried by `getSessionTimeFromReplay()` — provides duration, device class, browser, OS per session.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Ingest to _rumdata
Use the exact pattern from the existing `rum-error-ingestion.js` helper:
- **Helper**: `ingestRumErrors(page, count)` at `tests/ui-testing/playwright-tests/utils/rum-error-ingestion.js:16`
- **Ingestion endpoint pattern**: `POST {baseUrl}/api/{orgId}/_rumdata/_json` with JSON body
  ```js
  // The existing helper ingests 3 different error types by default.
  // For sessions testing, you need MORE events per session (multiple event types within same session_id).
  // Extend the pattern: POST to _rumdata with events that have the same session.id spanning multiple types
  // (type: 'action', type: 'error', type: 'view' etc.)
  ```
- **Reference**: `tests/ui-testing/playwright-tests/RUM/sourcemap-ui.spec.js` (uses `rum-error-ingestion.js` in global setup)

### Ingest to _sessionreplay
There is NO existing helper for `_sessionreplay` ingestion. Use the same `page.request.post` pattern:
```js
await page.request.post(`${baseUrl}/api/${orgId}/_sessionreplay/_json`, {
  headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
  data: sessionReplayPayload
});
```
Each event needs: `session_id`, `start` (epoch ms), `end` (epoch ms), `user_agent_*` fields, `ip`, `source`.

### Auth / org
- `ORGNAME=default` — the standard org identifier (from `process.env.ORGNAME || 'default'`).
- Auth: Basic auth using `ZO_ROOT_USER_EMAIL` / `ZO_ROOT_USER_PASSWORD` (pattern from `rum-error-ingestion.js:74`).
- Or use the `PageManager.loginPage` pattern for browser-based login.

### Timing / waits
After ingesting data, wait for it to be queryable:
- `_rumdata` + `_sessionreplay` need to exist as streams (they auto-create on first ingest).
- After ingestion, navigate to the sessions page and wait for `data-test="rum-sessions-table"` (table) or the loading indicator to disappear.
- Activity sparklines are lazy-loaded via IntersectionObserver — they may not appear until the table row scrolls into viewport.

## Preconditions / toggles
- **Session Replay must be enabled**: `RealUserMonitoring.vue` checks `getStream("_sessionreplay", "logs", false)` and sets `isSessionReplayEnabled=true` only if the stream exists. If `_sessionreplay` is not present, the sessions page shows the "Discover Sessions" empty state instead of the dashboard.
- **Non-SQL mode** (default): the sessions query editor uses non-SQL mode. No special toggle needed.
- **Default time range**: Relative time (e.g., Past 15 Minutes). Tests can select a wider range via the date-time dropdown to ensure data is included.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Stream existence gates the page**: Without `_sessionreplay`, you see the "Get Started" empty state, NOT the sessions table. Must ingest to both `_rumdata` AND `_sessionreplay`.
- **Schema fields gate insight features**: The frustration insight banner only appears if `action_frustration_type` AND `action_target_name` exist in the `_rumdata` schema. Error insight only appears if `error_message` exists. Delta comparison only appears if the previous window also has data.
- **Activity sparklines are lazy-loaded**: They use `IntersectionObserver` — rows must be visible (scrolled into viewport) to trigger fetching. Tests that assert on sparkline content must scroll to the row first.
- **Scroll-end pagination is commented out**: `handleScrollEnd` at `AppSessions.vue:1409` has the `getSessions()` call commented out (`// getSessions()`). Infinite scroll will NOT load more pages — only the first batch of sessions is shown.
- **Stream schema arrives async**: `getStreamFields()` at `AppSessions.vue:654` fetches schema on mount. The KPI aggregate queries depend on `schemaMapping` being populated first. Use the loading guard (`isLoading.length`) before asserting.
- **Window aggregates run in parallel**: The summary query for KPI totals could resolve slightly after the page query, causing a brief flicker where KPI counts are page-scoped before switching to window-accurate.
