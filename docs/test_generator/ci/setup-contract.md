# Test Setup Contract: App Theme Default (Light/Dark)  (area: GeneralTests)

## Streams / data the spec must establish
None. This is a pure client-side theme test — **no streams, no ingestion, no schema** are needed.
The feature operates entirely on `localStorage` (key `theme`) plus the `.dark` class on `<html>`.
The only "data" to manage is the `localStorage.theme` starting value per test.

## localStorage precondition per test (the ONLY setup that matters)
Tag each by SCOPE:
- **[shared/read-only] — default LIGHT state**: a fresh context / cleared storage with **no**
  `theme` key. Every test that asserts the *default* just READS this state → establish once by
  clearing storage before navigation.
- **[per-test] — DARK default state**: only the "boots dark" test needs `theme === "dark"` seeded
  **before** app scripts run. It MUTATES nothing shared but must not leak into sibling tests →
  seed inside that test's own context via `addInitScript`.

### How to establish each state (copy these EXACT patterns — do NOT invent setup)
- **Clear theme for a light-default test** (runs before app JS so `bootstrapTheme()` sees an empty
  key):
  ```js
  await page.addInitScript(() => {
    localStorage.removeItem('theme');
    localStorage.removeItem('appliedLightThemeName');
    localStorage.removeItem('appliedDarkThemeName');
    localStorage.removeItem('appliedLightTheme');
    localStorage.removeItem('appliedDarkTheme');
  });
  await navigateToBase(page);
  ```
  Pattern reference: the enhanced fixture already supports `context.addInitScript` /
  `page.addInitScript` (see `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:48`).
  The saved auth `storageState` (`utils/auth/user.json`) does **not** seed a `theme` key, so a
  plain `navigateToBase(page)` without any seed is already the light default.
- **Seed `theme === "dark"` for a boots-dark test**:
  ```js
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await navigateToBase(page);
  ```
- **Auth/org**: `await navigateToBase(page)` (see `enhanced-baseFixtures.js:141`). It navigates to
  `${ZO_BASE_URL}/web/?org_identifier=${ORGNAME}` and verifies auth against
  `[data-test="navbar-main-nav"]`. Do not navigate to the bare domain — it drops `org_identifier`.
- **Toggle via UI** (instead of seeding storage): `pm.themePage.switchToDarkMode()` /
  `switchToLightMode()` / `toggleThemeMode()` in `tests/ui-testing/pages/generalPages/themePage.js`.
- **Assert the mode**: use `pm.themePage.isDarkMode()` → reads
  `document.documentElement.classList.contains('dark')` (themePage.js:146-149). For a reload wait:
  ```js
  await page.waitForFunction(
    (darkClass) => document.documentElement.classList.contains(darkClass),
    'dark', { timeout: 10000 }
  );
  ```
  (copied verbatim from `theme-management.spec.js:63-67`).

## Preconditions / toggles
- No SQL/quick-mode/tracing toggles are involved — theme is mode-independent and available on every
  page once authenticated.
- The dark signal is **`.dark` on `<html>`**, NOT `body--dark` on `<body>` (retired). Any assertion
  keyed on the old class will hang.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Strict `=== "dark"`.** Only the literal string `"dark"` is dark. `"DARK"`, `"1"`, `"true"`,
  `""`, or a missing key all resolve to light. Seed exactly `'dark'`, nothing else.
- **Seed before navigation, not after.** The theme is read synchronously in `main.ts`
  (`bootstrapTheme()`) and in the store initializer (`stores/index.ts:99`) at page load. Writing
  `localStorage.theme` *after* `navigateToBase` has no effect on the already-booted mode — you must
  use `addInitScript` (runs before every page script) for the boots-dark case.
- **Wait on `.dark`, not on a fixed delay.** The mode flip goes through `switchThemeMode`
  (view-transition sweep); under reduced-motion or missing View Transitions it applies instantly,
  but the class toggle is still async to the click. Poll via `waitForFunction` (as above), never
  `waitForTimeout`.
- **Serial isolation.** The existing `theme-management.spec.js` runs `test.describe.configure({ mode: 'serial' })`
  to avoid theme-state conflicts and resets to light in `afterEach`. This new spec should either do
  the same or clear `theme` in `beforeEach` so a prior dark-mode test doesn't make a "default is
  light" assertion fail.
- **No data-ingestion timing** to wait on: there is no stream/schema hydration in this feature.
  The only wait is for the layout shell to mount (`profileMenuBtn` visible, as in
  `theme-management.spec.js:20`) before interacting with the navbar toggle.
