# Test Setup Contract: Settings Query Management Redirect  (area: GeneralTests)

> Read by the Engineer (implements the spec), the Healer and the Refiner (consult instead of
> blind-scanning on a data/setup failure). This feature is pure navigation/gating — **no
> streams or ingested data are required.**

## Build / edition detection
The gate is the **frontend build-time flag** `config.isEnterprise` (`web/src/aws-exports`),
which decides BOTH the `query_management` route registration and the tab visibility. Detect it
the same way the existing edition spec does, via the rendered header button:

- `pm.editionFeaturesPage.detectEdition()` → returns `'opensource'` or `'enterprise'`
  (`tests/ui-testing/pages/generalPages/editionFeaturesPage.js:81`).
- The spec is tagged `@oss`; guard the OSS test with
  `test.skip(edition !== 'opensource', 'Runs only on OSS build')` — mirror
  `tests/ui-testing/playwright-tests/GeneralTests/edition-features.spec.js:88-93`.

Do NOT use `statusPagesPage.detectBuildType()` for this feature: that reads the backend
`/config` `build_type`, which is a different axis than the frontend build flag the query-
management gate actually reads.

## Preconditions / toggles
- Authenticated OSS session via the standard fixture (`navigateToBase` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141`).
- Active org: `ORGNAME` env (fallback `default`).
- **No** backend feature toggles need to be flipped. No streaming/SQL/quick-mode state matters.

## Navigation (copy these EXACT patterns — do NOT invent)
- Navigate to Settings General by direct URL (most robust — this is what the existing
  ManagementPage helpers already do):
  ```js
  await page.goto(`${process.env['ZO_BASE_URL']}/web/settings/general?org_identifier=${process.env['ORGNAME']}`);
  await page.waitForLoadState('domcontentloaded');
  ```
  See `tests/ui-testing/pages/generalPages/managementPage.js:107-110` (`checkStreaming`) for the
  same direct-URL pattern.
- Settings nav-entry fallback (selector is stale-ambiguous across MenuLink vs ONavbar — prefer
  the direct URL above): `pm.managementPage.goToManagement()`
  (`managementPage.js:32-44`) uses `[data-test="menu-link-/settings-item"]` and waits for
  "General Settings" text.

## Assertions the spec must make (OSS)
1. **Tab hidden:** on `/web/settings/general`, the rail `[data-test="section-rail"]` is visible
   and `[data-test="query-management-tab"]` has **count 0** (`await expect(...).toHaveCount(0)`).
   It is not merely disabled — `SectionRail` filters `visible !== false` items out entirely
   (`web/src/components/common/SectionRail.vue:177-184`).
2. **Direct URL 404s:** `page.goto('/web/settings/query_management?org_identifier=…')` renders
   the 404 page — assert `[data-test="error-404-go-home-btn"]` visible. The Running Queries
   page must not render.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **The "redirect" is UNWIRED on OSS.** `handleSettingsRouting` only fires the redirect when
  `route.name === "query_management"`, but that route is registered solely inside
  `useManagementRoutes.ts:145-159` under `if (config.isEnterprise == "true")`. On OSS the route
  never exists, so the redirect branch is dead code. The spec must assert the *observable* OSS
  behavior (tab hidden + direct URL → 404), NOT a redirect to `/settings/general`.
- **404 auto-redirects.** `Error404.vue:88-96` starts a 10 s countdown then `router.push("/")`.
  Assert the 404 quickly; do not assert on the URL after >10 s.
- **Do not assert "Operations group absent"** — group presence depends on other items; only the
  Query Management tab (`query-management-tab`) is the stable target.
- **Selector drift on the nav entry:** the live app uses `menu-link-${link}-item`
  (`MenuLink.vue:240` → `menu-link-/settings-item`); `menu-link-settings-item` appears only in
  ONavbar unit-test mocks. Prefer direct URL navigation to sidestep this.
- **No data seeding needed** — do not add an ingestion step; it adds flake with zero value here.
