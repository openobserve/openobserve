# Test Setup Contract: Responsive Mobile Navigation  (area: GeneralTests)

## Streams / data the spec must establish

This feature is navigation chrome — it reads **no stream data**. Every behavior works on any
authenticated page. The global setup already ingests `e2e_automate` (see `global-setup.js`), but
**no stream is required** for the mobile-nav assertions. Do NOT add ingestion steps.

Tag each item by SCOPE:
- **`[shared/read-only]`** — authenticated session + org + resolved `/config` (all tests REUSE it).
- **`[per-test]`** — viewport resize (each test mutates its own page viewport, then restores).

- `authenticated session` **[shared/read-only]** — the saved `auth/user.json` storage state from
  `global-setup.js` (global setup logs in and writes it). All tests inherit it via the
  `enhanced-baseFixtures.js` `context` fixture. No per-test login.
- `selected organization` **[shared/read-only]** — `ORGNAME` env var; carried through
  `navigateToBase` (`?org_identifier=…`).
- `resolved /config` **[shared/read-only]** — required for `navLinks` to populate (else the drawer
  rail is empty). Do not assert the rail until a concrete menu item is visible.
- `viewport < 768px` **[per-test]** — each test shrinks its own page and MUST restore/let the
  per-test context teardown (each test gets a fresh context via the fixture, so no manual restore
  needed).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth + navigate:** `const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');`
  then `await navigateToBase(page);` inside the test. This verifies auth against
  `[data-test="navbar-main-nav"]` at the DEFAULT 1500×1024 viewport — **so call it BEFORE resizing**.
  See `tests/ui-testing/playwright-tests/GeneralTests/sanity.spec.js:30-65` (beforeEach pattern) and
  `enhanced-baseFixtures.js:141-187` (the navigateToBase implementation).
- **Page manager:** `const pm = new PageManager(page);` — `tests/ui-testing/pages/page-manager.js`.
- **Shrink to mobile viewport:** `await page.setViewportSize({ width: 390, height: 844 });` — the
  established pattern is `tests/ui-testing/playwright-tests/Alerts/dl-email-destinations.spec.js:493`
  (`page.setViewportSize({ width: 420, height: 900 })`). 390×844 (iPhone-ish) also works; anything
  <768px triggers mobile. Resize AFTER `navigateToBase` (see Gotcha 1).
- **Wait for nav population:** after resize, wait for the hamburger
  `[data-test="header-mobile-nav-toggle"]` to be visible, and (when the drawer is open) for a
  concrete item like `[data-test="menu-link-\\/logs-item"]` inside
  `[data-test="main-layout-mobile-nav-drawer"]`. This gates on `/config` having resolved
  (`menuReady`), which is async.

## Preconditions / toggles

- **OSS mode only** — this run is OSS. Do not assert AI chat (`menu-link-ai-item`) or any
  enterprise/cloud-only header controls; they are `max-md:hidden`/build-gated and absent on OSS.
- **No SQL/non-SQL mode toggling** — irrelevant to navigation chrome.
- **GetStarted dialog** (`[data-test="main-layout-get-started-dialog"]`) can cover the drawer on a
  first-login account. If it appears, dismiss it via its submit before interacting with the drawer.
- **`showClose=false` on the drawer** — the built-in `o-drawer-close-btn` is NOT rendered; only the
  custom `main-layout-mobile-nav-close` closes via button. Scrim tap and Escape also close.

## Gotchas (so the Healer/Engineer don't rediscover them)

1. **Auth verification breaks below 768px.** `navigateToBase` → `verifyAuthentication` waits for
   `[data-test="navbar-main-nav"]` **visible**, but the desktop rail is `max-md:hidden` (hidden
   <768px). Shrink the viewport only AFTER `navigateToBase` resolves, never before.
2. **`navbar-main-nav` is duplicated when the drawer is open.** Desktop rail (`max-md:hidden`) +
   drawer rail both render `<nav data-test="navbar-main-nav">`. Use `:visible` or scope queries to
   `[data-test="main-layout-mobile-nav-drawer"]`.
3. **Group tile selector changes on mobile.** The Data tile is `menu-link-group-data-item` (a
   button) on mobile, NOT `menu-link-/streams-item`. The desktop `openNavFlyoutChild` helper
   (hover + teleported flyout) is unusable on mobile — use the inline-submenu selectors
   (`nav-group-inline-<key>`, `nav-group-item-<name>`).
4. **`navLinks` is empty until `/config` resolves.** Assert concrete menu items, not the rail
   wrapper, and only after `menuReady`.
5. **`setViewportSize` reactively flips `useBreakpoint`.** No reload needed — the drawer width
   (88vw) and ONavGroup trigger-mode both react to the matchMedia `change` event.
6. **No stream/data setup is needed** — do not call `ingestionPage.ingest` or
   `commonActions.ingestTestData`; it adds nothing and slows the shard.
