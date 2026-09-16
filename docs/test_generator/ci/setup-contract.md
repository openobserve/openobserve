# Test Setup Contract: Profiling UI Feature-Flag Gating  (area: Logs)

This contract describes the data/state each behavior needs and the **exact existing patterns** to
establish it. It is read by the Engineer (implements setup), the Healer and the Refiner (consult on
data/setup failures) — do not invent setup; copy the referenced patterns.

## The one thing that matters most: `profiling_enabled` is a SERVER-side env flag

`store.state.zoConfig.profiling_enabled` is hydrated from the **authenticated per-org config**
`GET /api/{org}/config` (NOT the unauthenticated `GET /config` bootstrap). It is backed by the env
var `ZO_FEATURE_PROFILING_ENABLED` (default `false`, `src/config/src/config.rs:2257-2262`).

Therefore there are exactly two ways to put the UI into the "enabled" state in E2E:

### Option A (recommended, per-test, no infra change): mock the config response
Intercept the authenticated config endpoint and set `profiling_enabled: true` while preserving every
other field (the `setConfig` mutation **replaces the whole `zoConfig` object**, so dropping fields
breaks unrelated features).

```js
// Register BEFORE navigation, so the app's config fetch picks it up.
await page.route('**/api/*/config', async (route) => {
  const response = await route.fetch();           // pass through to the real backend
  const json = await response.json();
  json.profiling_enabled = true;                  // keep the rest intact
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
});
```

Glob notes (Playwright URL glob: `*` = one path segment, no `/`):
- `**/api/*/config` matches exactly `/api/<org>/config` (single org segment).
- It does **NOT** match the bootstrap `GET /config` (no `/api/` prefix) — good, that endpoint
  carries no flags anyway.
- It does **NOT** match deeper paths like `/api/<org>/alerts/deduplication/config` (too many
  segments) — good, those must not be touched.
- Reference for the route-mocking pattern: `tests/ui-testing/playwright-tests/RegressionSet/Logs/logs-bugs.spec.js:769-782`
  (mocks `**/config` to delete `web_url` — same shape, different field/pattern).

### Option B (read-only, no mock): detect the live flag and branch
If the shard cannot mock (or for the "flag off" default case), read the flag from the live config
and assert accordingly — the pattern already exists for `quick_mode_enabled` / `auto_query_enabled`:

```js
// Existing helper shape (page.evaluate → fetch /api/{org}/config → read a flag):
//   tests/ui-testing/pages/logsPages/logsPage.js:10051-10064  (isQuickModeEnabledOnInstance)
//   tests/ui-testing/pages/logsPages/logsQueryPage.js:198-214  (_isAutoQueryEnabled)
//   tests/ui-testing/pages/generalPages/statusPagesPage.js:43-54 (detectBuildType — direct /api/{org}/config)
```

The "flag off" (default OSS) assertions need **no setup at all** — the flag simply isn't set, so all
entry points are hidden.

## Streams / data the spec must establish

**None of the visibility assertions require ingested streams.** The gate is pure config-driven, and
the LogStream type filter + Ingestion tabs render regardless of whether any streams exist.

| Item | Scope | Why |
|------|-------|-----|
| (no stream data required) | — | LogStream filter, Ingestion tabs, and the menu item all render with zero streams |
| **Empty org (no streams, no data)** | `[per-test: home-chip cases only]` | `HomeNoDataState` only renders inside `UsageTab`'s no-data branch (`UsageTab.vue:539` → `no_data_ingest && !isLoadingSummary`), driven by `organizationData.isDataIngested === false` |

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Navigation (the three entry-point views)
- Streams (LogStream): `pm.streamsPage.gotoStreamsPage()` or direct
  `${ZO_BASE_URL}/web/streams?org_identifier=${ORGNAME}`.
  Reference: `tests/ui-testing/pages/streamsPages/streamsPage.js:275-276`, `:1118`.
- Ingestion: `${ZO_BASE_URL}/web/ingestion/custom?org_identifier=${orgId}`.
  Reference: `tests/ui-testing/pages/generalPages/ingestionConfigPage.js:57`.
- Home / Usage: `pm.homePage.gotoHomePage()`.
  Reference: `tests/ui-testing/pages/generalPages/homePage.js:78-82`.

### Auth / org
- Use the standard session: `navigateToBase(page)` + `PageManager` (`require('../../utils/enhanced-baseFixtures.js')`).
  Reference: `tests/ui-testing/playwright-tests/RegressionSet/Logs/logs-14283.spec.js:1-38`.
- Org is `process.env['ORGNAME'] || 'default'`; auth headers come from `getAuthHeaders()` /
  `getOrgIdentifier()` (see `tests/ui-testing/pages/generalPages/ingestionPage.js:52-62`).

### Establishing the empty-org precondition for the Home chip case
The Home chip is the one data-sensitive assertion. Two options, in order of preference:

1. **Use a fresh/clean org with no ingested data.** If the suite already provisions a dedicated
   empty org (or an org whose `isDataIngested` is false), navigate Home against it. Verify with the
   empty-state wrapper `[data-test="home-usage-tab-no-data"]`.
2. **Mock the config + summary to simulate "no data".** `page.route('**/api/*/config', …)` (set
   `profiling_enabled: true`) **plus** mock the org summary used by `UsageTab` so `no_data_ingest`
   is true and the empty state renders. This is fragile — prefer a genuinely empty org.

If **no** empty-org path exists in the suite, flag the Home-chip case to the Architect as a possible
`test.fixme` rather than inventing a brittle mock.

### Timing / hydration gotcha (applies to ALL enabled-state assertions)
The full config is fetched async after mount (`MainLayout.vue getConfig()`), so `zoConfig` is `{}`
briefly and every gated element is hidden. **Wait for the flag to be present before asserting
visibility**, e.g. poll for the target element with a generous timeout, or read the flag from the
live config first (Option B) and only then assert. Asserting "visible" immediately after
`page.goto` races the config fetch.

## Preconditions / toggles
- No SQL/quick-mode toggles, no streams, no ingestion needed for the visibility assertions.
- The "flag off" tests need the backend to be in its **default** state (env var unset) — which is the
  standard CI OSS configuration.
- The "flag on" tests need Option A mock (recommended) or a backend started with
  `ZO_FEATURE_PROFILING_ENABLED=true`.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`setConfig` replaces the whole object** — a mock must spread the real response and only set
  `profiling_enabled: true`; deleting fields breaks unrelated UI.
- **Mock `**/api/*/config`, NOT `**/config`** — the bootstrap `/config` carries no flags; mocking
  only the bootstrap leaves the flag undefined (hidden) even though the mock "set" it.
- **Routes are NOT gated** — do not assert `/web/profiles` is 404/redirected when the flag is off;
  it renders regardless. Assert entry-point visibility only.
- **The LogStream profiles tab has no `data-test`** — target
  `[data-test="log-stream-type-filter"] [data-otoggle-value="profiles"]` (real attribute from
  `OToggleGroupItem.vue:148`). Don't fabricate a `data-test`.
- **Home chip is gated on TWO conditions** — flag AND empty org. If the org has data, the chip's
  absence proves nothing about the flag.
- **Transient window** — config arrives async; poll/wait before "visible" assertions in enabled tests.
- **Truthiness** — the `v-if` reads `store.state.zoConfig?.profiling_enabled` (truthy), so mock the
  literal `true`, not `1`/`"true"`, to match production semantics.
