# Test Setup Contract: Expired Trial Settings Paywall  (area: GeneralTests)

> Read by the Engineer (implements setup), the Healer and the Refiner (consult instead of
> blind-scanning when a data/setup failure appears). This feature has **no data/stream setup** —
> it is a settings-page + route-guard paywall. The critical precondition (an expired trial) is
> **not establishable in OSS**, so the contract documents what CAN and CANNOT be set up.

## Streams / data the spec must establish
- **None.** `/settings/general` renders regardless of ingested data. No stream, field, or index is
  required. (An org with zero streams still reaches `/settings/general` — see `emptyDataAllowedPaths`
  in `web/src/utils/auth.ts:18`.)

## Preconditions / toggles
- **Org + auth (baseline, shared/read-only):** reuse the suite's standard boot —
  `navigateToBase(page)` from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`
  (navigates `/web/?org_identifier=${process.env.ORGNAME}` and verifies auth via
  `[data-test="navbar-main-nav"]`). No extra setup.
- **Edition gate for the paywall cases:** `isCloudEnvironment()` from
  `tests/ui-testing/pages/cloudPages/cloud-env.js` returns `process.env.IS_CLOUD === 'true'`.
  The expired-trial / redirect cases are **cloud-only**; in OSS (`IS_CLOUD` unset/false) they must
  `test.skip`/`test.fixme`. Alternative signal: `pm.editionFeaturesPage.detectEdition()`
  (`tests/ui-testing/pages/generalPages/editionFeaturesPage.js:81`) → `'opensource'` | `'enterprise'`.

## How to create the paywall precondition (cloud only — NOT possible in OSS)
- **There is no existing helper to set `free_trial_expiry` in OSS.** The value is:
  - **read** as `trial_period_expiry = None` under `#[cfg(not(feature = "cloud"))]`
    (`src/db/src/organization.rs:58-59`) — so `GET /{org}/settings` never returns it in OSS;
  - **write**-nulled server-side — `data.free_trial_expiry = None` before persist
    (`src/api/management/src/request/organization/settings.rs:159`), with the comment "always taken
    from orgs table, never from settings".
- On cloud it derives from the `organizations.trial_ends_at` column via
  `o2_enterprise::enterprise::cloud::billings` (still `src/db/src/organization.rs:60-86`, `#[cfg(feature="cloud")]`).
- **Do NOT invent a setup.** If the cloud paywall cases are ever enabled, the org must already be
  trial-expired server-side; there is no client-side/API affordance to force it. For this OSS run,
  leave them as `test.fixme` (parked).

## Existing patterns to copy (navigation + assertions)
- Navigation to General Settings: `pm.settingsFormValidation.navigateToGeneralSettings()`
  (`tests/ui-testing/pages/generalPages/settingsFormValidationPage.js:120-128`) — clicks
  `[data-test="menu-link-/settings-item"]` then the general tab, waits for
  `[data-test="dashboard-add-submit"]` visible. Simpler direct nav:
  `page.goto(`${ZO_BASE_URL}/web/settings/general?org_identifier=${ORGNAME}`)` — see
  `settingsFormValidationPage.js:330-332` (same pattern used for `_meta`).
- Selectors (all exist in `General.vue`): scrape interval
  `[data-test="general-settings-scrape-interval-field"]`, theme chips
  `[data-test="theme-light-chip"]` / `[data-test="theme-dark-chip"]`, save
  `[data-test="dashboard-add-submit"]`, enterprise block `#enterpriseFeature`, Danger Zone
  `[data-test="general-settings-danger-zone"]`.
- Toast success assert: `[data-test-variant="success"]` (used across GeneralTests, e.g.
  `theme-management.spec.js`).
- Serial-mode + `testLogger`/`beforeEach` shape to copy: `theme-management.spec.js`
  (`tests/ui-testing/playwright-tests/GeneralTests/theme-management.spec.js:5-23`).

## Timing / gotchas (so the Healer/Engineer don't rediscover them)
- **Auth check keys off `[data-test="navbar-main-nav"]`**, not a Home tile — the Home tile's
  `menu-link-/-item` no longer renders. (`enhanced-baseFixtures.js:119-135`).
- **On cloud, the default org can be trial-expired** and redirect to `/web/billings/plans` where the
  home menu never renders → auth verification fails. Always navigate with an explicit
  `?org_identifier=${ORGNAME}` and the `/web/` SPA path (`enhanced-baseFixtures.js:141-148`).
- **No paywall banner exists.** "Trial expired" is expressed purely by *absence* of the settings
  sections — assert element `isHidden()`/`count()===0`, not a message. There is no
  `data-test` marking the expired state.
- **Danger Zone is hidden in OSS** (`canDeleteOrg` requires `config.isCloud === "true"`,
  `General.vue:779-783`). Do not assert `general-settings-danger-zone` visible in the OSS baseline;
  it will fail.
- **`config.isCloud` (build flag `VITE_OPENOBSERVE_CLOUD`) ≠ `IS_CLOUD` (test env).** The paywall
  reads the former; the spec gates on the latter. They are independent — do not conflate them.
