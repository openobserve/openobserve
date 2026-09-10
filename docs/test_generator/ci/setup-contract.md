# Test Setup Contract: Access Denied (403) Empty State for Lists  (area: GeneralTests)

Spec: `tests/ui-testing/playwright-tests/GeneralTests/noAccessState.spec.js`

## Streams / data the spec must establish

This feature needs **no ingested streams**. A 403 on the *list* API (not a data stream) is
the trigger. The "data condition" is a **mocked 403 HTTP response** on the list endpoint,
plus a normally-working authenticated session for everything else on the page.

Tag by SCOPE so the Engineer places each piece correctly:

- **`[shared/read-only]`** — authenticated org session (already provided by the shared
  global-setup storageState). Nothing to create; every test just navigates.
- **`[per-test]`** — the `page.route(...)` 403 interception. One test mocks Dashboards, a
  separate test mocks Alerts. Install it **inside the test, before navigation**, and remove
  it (auto-cleanup on `page.unroute`/context close).

## How to create the 403 (copy these EXACT patterns — do NOT invent setup)

**Authentication / navigation** — reuse the shared session, no login step:
- Base fixture: `require('./utils/enhanced-baseFixtures.js')` → `test`, `expect`, plus
  `navigateToBase`.
- Org id: `const { getOrgIdentifier } = require('./utils/cloud-auth.js')` (used across specs,
  e.g. `logs-bugs.spec.js`). `process.env.ORGNAME` also available.
- Navigate via `gotoWithRetry` (from `./utils/navigation.js`):
  `gotoWithRetry(page, `${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${org}&folder=default`, { waitUntil: 'domcontentloaded' })`
  — the `/web/` prefix + `org_identifier` are REQUIRED (bare domain drops the query; see
  `enhanced-baseFixtures.js:141-155`). The `folder=default` param is expected by
  `Dashboards.vue` (see `dashboard-list.js:100-104`).

**The 403 mock** — `page.route` + `route.fulfill({ status: 403 })`, installed BEFORE goto.
Reference pattern: `tests/ui-testing/playwright-tests/RegressionSet/Logs/logs-bugs.spec.js:769-782`
(mocks `**/config` before navigating).

- Dashboards list: intercept `**/api/*/dashboards**`
  ```js
  await page.route('**/api/*/dashboards**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Forbidden' }),
    }),
  );
  ```
  Underlying call: `services/dashboards.ts:43` → `GET /api/{org}/dashboards?page_num=0&page_size=1000&sort_by=name&desc=false&name=&folder={folder}`.
  NOTE the glob `**/api/*/dashboards**` does NOT match the folders call
  `GET /api/v2/{org}/folders/dashboards` (extra path segments) — only the list is 403'd, so
  the left rail still loads and the table body shows no-access.

- Alerts list: intercept `**/api/v2/*/alerts**`
  ```js
  await page.route('**/api/v2/*/alerts**', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) }),
  );
  ```
  Underlying call: `services/alerts.ts` `listByFolderId` → `GET /api/v2/{org}/alerts?sort_by=name&desc=false&name=&folder={folder}`.
  CAUTION: `**/api/v2/*/alerts**` would also hit `GET /api/v2/{org}/alerts/incidents` etc.
  if those fire — but the plain Alerts list page (`/web/alerts`) only calls the list +
  destinations/templates endpoints, so scope the glob to the list by matching the query:
  `**/api/v2/*/alerts?sort_by=***` (query-scoped glob) if broad matching proves noisy.

## Assertions (selectors + copy)

- Forbidden container: `[data-test="o2-table-forbidden"]` (unique to forbidden — the normal
  empty uses `[data-test="o2-table-empty"]`; do NOT confuse them). See
  `OTable.vue:1545-1548` (forbidden) vs `OTableEmpty.vue:31` (default `o2-table-empty`).
- Empty-state content: `[data-test="o2-empty-state"]` (`OEmptyState.vue:42`).
- Copy (en-US, `en-US.json:79-82`):
  - title `You don't have access`
  - description `Contact your administrator if you believe you should have access.`
- Negative control: assert `[data-test="o2-table-empty"]` and "Create your first dashboard"
  are ABSENT while forbidden is shown (proves precedence over the first-run empty).

## Timing / preconditions

- The skeleton holds ≥50ms and suppresses forbidden while loading (`OTable.vue:141-170`,
  `showForbidden` requires `!heldLoading`). Wait for the skeleton to clear before asserting.
  Practical wait: `await expect(page.locator('[data-test="o2-table-forbidden"]')).toBeVisible({ timeout: 15000 })`
  — Playwright's auto-retry already absorbs the hold; do not assert immediately after goto.
- `forbidden` is reset to `false` before each fetch (`Dashboards.vue:921`, `AlertList.vue:1775`)
  and only set to `true` on a 403 — so an intercepted 403 deterministically flips it.
- No SQL-mode / quick-mode toggle needed; Dashboards/Alerts list pages have no such gate.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **403 must be mocked, not created via RBAC.** In OSS there is no role/denial path; a real
  403 role would require enterprise. `page.route` → `route.fulfill({ status: 403 })` is the
  only OSS-reliable trigger. (Enterprise RBAC 403 fixtures, e.g. `rbac_403_*`, are cleaned
  by `cleanup.spec.js` but belong to the enterprise suite, not this spec.)
- **Install the route before `goto`.** The list fetch fires on mount; a route added after
  navigation misses it.
- **`data-test` fallthrough override is load-bearing.** `OTableEmpty` has
  `data-test="o2-table-empty"` hardcoded, but OTable passes `data-test="o2-table-forbidden"`
  on the forbidden branch and Vue 3 fallthrough overrides the root attr. Assert forbidden via
  `o2-table-forbidden`, never via `o2-table-empty`.
- **Do not assert on the folders rail being empty.** Only the list endpoint is 403'd; the
  folder list (`/api/v2/{org}/folders/dashboards`) still succeeds.
- **Text assertions are language-sensitive.** The suite runs against an en-US build; if a
  localized build is used, prefer the aria-label (`svg[role="img"]` aria-label) or the
  `data-test` container over hardcoded English, but for the standard pipeline en-US copy is
  deterministic.
