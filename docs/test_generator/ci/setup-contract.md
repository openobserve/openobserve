# Test Setup Contract: Profiles Menu Feature Flag  (area: GeneralTests)

## Streams / data the spec must establish

**None.** This feature is a navigation-menu *gate*, not a data-consuming feature. The assertion is
the presence/absence of the `menu-link-/profiles-item` rail tile, which depends only on the
`profiling_enabled` config flag — no streams, records, or schema are needed. (The `/profiles` page
itself can render an empty state without data, so even an optional "navigate to page" assertion
needs no seed.)

If a future spec DOES assert page content, it would need a **profiles-type** stream (created by
ingesting pprof/profiles data or via the profiles ingestion path); that is explicitly **out of
scope** for the gate test and should not be added to this spec.

## Preconditions / toggles (the one thing that matters here)

The gate reads `zoConfig.profiling_enabled`, which comes from the backend env var
`ZO_FEATURE_PROFILING_ENABLED` (default `false`). Two states, two very different setup
requirements:

| State | Backend flag | Testable in current CI? | How |
|-------|-------------|--------------------------|-----|
| **Hidden** (tile absent) | `false` (unset) | ✅ yes — this is the DEFAULT | No setup; the GeneralTests shard already runs with the flag off. |
| **Shown** (tile present) | `true` | ❌ **not with the current workflow** | Requires `ZO_FEATURE_PROFILING_ENABLED=true` at backend start; `.github/workflows/playwright.yml` only maps three per-shard overrides (`quick_mode_enabled`, `ingest_allowed_upto`, `slo_backfill_chunk_secs`) — there is NO mechanism to set this flag today. |

### Recommended spec shape (mirrors the existing "exactly one runs per environment" pattern)

Read the flag directly from the live config, exactly as `StatusPagesPage.detectBuildType` reads
`build_type` (`tests/ui-testing/pages/generalPages/statusPagesPage.js:43-54`):

```js
// Backend is a separate origin from the Vite-served frontend (no /api dev proxy):
const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
const res = await page.request.get(`${baseUrl}/api/${orgId}/config`);
const profilingEnabled = (await res.json()).profiling_enabled === true;
```

Then two tests with `test.skip(...)`:
1. `test.skip(profilingEnabled === true, 'runs only when the Profiles flag is OFF')` → assert
   `page.locator('[data-test="menu-link-\\/profiles-item"]')` has count `0`.
2. `test.skip(profilingEnabled !== true, 'runs only when the Profiles flag is ON')` → assert the
   tile is visible after the Traces group.

This way the default OSS shard runs test 1 (green) and self-skips test 2, and a future flag-on
shard flips which test runs — no broken/red test, no wasted Healer iteration.

### If the positive ("shown") case must actually run in CI

Add a dedicated shard to `tests/ui-testing/ci-matrix/ci_matrix.json` that sets a per-shard flag
(the `Logs-SelectStar` shard is the reference for a process-level flag that cannot vary within a
shard — see its `_comment` at ci_matrix.json:320-331 and its `"quick_mode_enabled": "true"`):
1. Add a new matrix entry (or extend `GeneralTests`) with e.g. `"profiling_enabled": "true"`.
2. In `.github/workflows/playwright.yml` "Start OpenObserve" step, add a mapping alongside the
   existing three (`ZO_QUICK_MODE_ENABLED`, `ZO_INGEST_ALLOWED_UPTO`, `ZO_SLO_BACKFILL_CHUNK_SECS`):
   `ZO_FEATURE_PROFILING_ENABLED: ${{ matrix.profiling_enabled || 'false' }}`.
3. Add `profilesMenu.spec.js` to that shard's `run_files`.

This is a **workflow/infra change**, not something the spec can establish at runtime — the
Architect should decide whether to (a) do the infra change, or (b) ship the self-skipping spec
and park the positive case.

## How to establish the rest of the test (copy these EXACT patterns — do NOT invent setup)

- **Auth / navigation:** `const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');`
  then `await navigateToBase(page)` in `beforeEach` — see
  `tests/ui-testing/playwright-tests/GeneralTests/status-pages-enterprise-gating.spec.js:50-55`
  and `edition-features.spec.js:82-86`. Global setup mints auth state
  (`tests/ui-testing/playwright-tests/utils/auth/user.json`), so no per-test login is needed.
- **Org id:** `orgId = process.env['ORGNAME'] || 'default'` (same as status-pages spec).
- **Rail-visible wait (auth gate):** `await page.waitHelpers.waitForElementVisible('[data-test="navbar-main-nav"]', { timeout: 15000, ... })`
  — this is what `verifyAuthentication` already does (`enhanced-baseFixtures.js:126-129`); the
  tile absence/presence assertion must come AFTER the rail is visible, or a still-loading rail
  would produce a false "absent".
- **Config flag read (auth header note):** `detectBuildType` in statusPagesPage uses the
  unauthenticated `page.request.get(...)` against the backend and it works because the endpoint is
  `/api/{org}/config` behind the same origin's cookie/session auth via `page.request`. If a Basic
  auth header is ever needed, `status-pages-enterprise-gating.spec.js:31-33` shows the exact
  `Buffer.from(email:password).toString('base64')` pattern — but for the gate spec, mirroring
  `detectBuildType` (no explicit header) is sufficient.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`/config` resolves async on a cold load.** `profiling_enabled` is `undefined` until
  `get_config_full` returns, and `menuReady`/`navLinks` gates the rail on config resolution. Assert
  the tile only after `[data-test="navbar-main-nav"]` is visible AND (for the shown case) allow a
  short settle — the flag may land a tick after the base menu.
- **`data-test` uses the link path, not the route name.** It is
  `menu-link-/profiles-item` (from `link: "/profiles"`), NOT `menu-link-profiles-item`. Escape the
  slash in Playwright: `'[data-test="menu-link-\\/profiles-item"]'`. Same convention as the Home
  tile `menu-link-\\/-item` (see `global-setup-alpha1.js:169`).
- **Traces is a flyout group, not a plain tile.** The anchor "after Traces" is
  `[data-test="nav-group-traces"]`, not `menu-link-/traces-item`. Don't assert ordering against a
  selector that doesn't exist.
- **`custom_hide_menus` is a second gate.** If a future env sets `ZO_CUSTOM_HIDE_MENUS` to include
  `profiles`, the tile is hidden even with the flag on. The current CI does not set it, so this is
  only a forward-looking caveat, not an active failure mode.
- **The route is NOT flag-gated.** A user can reach `/profiles` by URL even when the menu hides it,
  so "menu absent" must NOT be conflated with "page unreachable".
- **Do not seed streams for the gate test.** There is no existing helper that creates a
  *profiles*-type stream cheaply in the OSS suite (the nearest analog,
  `pm.ingestionPage.ingest(...)`, seeds log/metric streams, not profiles). Adding profile-stream
  seeding would be a fragile invention for zero assertion value at the gate level.
