# Test Setup Contract: Navbar Group Flyout Dismisses Open Dropdowns (area: GeneralTests)

## Streams / data the spec must establish
**None.** This is a pure shell-interaction test (header dropdown + left-nav hover). No stream
ingestion, schema, or search data is required. The only "state" that must exist is:

- An authenticated session with the app shell mounted — the left nav rail
  (`data-test="navbar-main-nav"`) and the header (Help/Profile buttons) visible.
- At least one nav **group tile** present on the rail (Data is guaranteed in OSS — see below).
- A reka-ui dropdown that can be opened on demand (the header **Help** menu — always present in OSS).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth + landing page** — reuse the standard fixture, exactly as every GeneralTests spec does:
  ```js
  const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
  const PageManager = require('../../pages/page-manager.js');
  // beforeEach:
  await navigateToBase(page);                 // auth state from global setup (utils/auth/user.json)
  await page.waitForLoadState('domcontentloaded');
  pm = new PageManager(page);
  await expect(pm.homePage.profileIcon).toBeVisible({ timeout: 10000 }); // shell hydrated
  ```
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/theme-management.spec.js:9-23`.
  `navigateToBase` verifies auth by waiting on `[data-test="navbar-main-nav"]`
  (`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:141-187`).

- **Open the dropdown to dismiss** — use the Help menu, which is a reka `ODropdown`
  (`web/src/components/Header.vue:255`), with a ready-made helper:
  ```js
  await pm.homePage.openHelpMenu();           // clicks [data-test="menu-link-help-item"], waits for aboutLink visible
  ```
  Reference: `tests/ui-testing/pages/generalPages/homePage.js:350-354`
  (`openHelpMenu` clicks `helpButton` = `[data-test="menu-link-help-item"]` and waits for
  `aboutLink` = `[data-test="menu-link-about-item"]`).

- **Hover the nav group tile** — reuse the Data tile selector already exported for nav-group specs:
  ```js
  const { NAV_GROUP_TILE, openNavFlyoutChild } = require('../../pages/commonActions.js');
  const dataTile = page.locator(NAV_GROUP_TILE.data);   // '[data-test="menu-link-/streams-item"]'
  ```
  Reference: `tests/ui-testing/pages/commonActions.js:18-69`. `openNavFlyoutChild` shows the
  retry pattern that survives the 120ms open delay + scroll/resize self-close; the new spec should
  copy its `expect(...).toPass(...)` hover-then-assert loop (move pointer to `(0,0)` first so
  `hover()` always fires a fresh `mouseenter`). The new spec hovers and asserts the flyout/help
  state, but does **not** click a child.

- **Assert open/closed state**:
  - Flyout open: `page.locator('[data-test="nav-group-flyout-data"]')` becomes visible.
  - Dropdown dismissed: `pm.homePage.aboutLink` (`[data-test="menu-link-about-item"]`) becomes hidden.

## Preconditions / toggles
- **Group tile must exist.** Data is guaranteed in OSS: `groupNavLinks` emits it whenever ≥2 children
  survive `requires` filtering — `streams` + `ingestion` are always in the OSS `linksList`, and the
  OSS mixin always inserts `pipeline` (`web/src/mixins/mainLayout.mixin.ts:17-26`), giving
  `logstreams`, `pipelines`, `functionList`, `enrichmentTables`, `ingestion` as children.
  (`web/src/lib/core/Navbar/navGroups.ts:272-312`.) Do NOT rely on Infra/Dashboards/Experience — they
  are gate/flag-dependent.
- **Help menu is always present** in the OSS header and is a real reka `ODropdown`, so its
  `[data-reka-popper-content-wrapper]` is present while open — the exact precondition
  `dismissOpenDropdowns()` checks.
- No special mode/toggle required (not SQL mode, not quick mode, not enterprise).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **The dismiss is meaningful because a bare hover does NOT close the dropdown natively.**
  `ODropdown` closes on outside *pointerdown*, Escape, or item select — not on `mouseenter`/hover
  (`web/src/lib/overlay/Dropdown/ODropdown.vue:206-221`). So hovering the tile fires only
  `mouseenter`; the ONLY thing closing the Help menu is the synthetic Escape from
  `dismissOpenDropdowns()`. This makes the "dropdown became hidden" assertion a real test of the change.
- **Hover debounce + self-close race.** Flyout opens after 120ms (`OPEN_DELAY`) and self-closes 220ms
  after mouse-leave / on scroll / resize / outside pointerdown (`ONavGroup.vue:192-193, 404-418`). If
  the page is still settling, a single `hover()` can open then immediately close. Use the
  `expect(...).toPass(...)` retry loop from `openNavFlyoutChild` (move pointer to `(0,0)`, hover, assert).
- **Assert hidden, not absent.** Reka keeps popper content mounted while open and animates out on
  close before unmounting. Use `await expect(aboutLink).toBeHidden()` (waits for `visibility:hidden`/
  detachment) rather than `toHaveCount(0)` or an immediate absence check.
- **Don't use the org selector as the primary dropdown.** It is present only in multi-org setups and
  focuses a search input on open; the Help menu is simpler and always rendered. (Keep org selector /
  profile menu as *optional* alternate-open sources only.)
- **Flyout is teleported to `<body>`**, so scope flyout locators to the page, not to the rail wrapper.
- **The help trigger is a toolbar button** near the profile icon; if a test runs on a narrow viewport
  (the standard fixture is 1500×1024, per `enhanced-baseFixtures.js:32`), the header is fully visible
  — no overflow concern at that width.
