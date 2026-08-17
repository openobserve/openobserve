# Test Setup Contract: Design Token Migration & Design System Consistency (area: GeneralTests)

Spec: `tests/ui-testing/playwright-tests/GeneralTests/designTokenConsistency.spec.js`

## Streams / data the spec must establish
**None required.** This feature is a client-side token/CSS migration with `needs_api: false`. The core assertions
(token resolution, dark-mode flip, OButton/OSelect token classes, OTable chrome slugs) are all **read-only UI facts**
that run against an authenticated page with no stream or ingest data.

- **`[shared/read-only]` — Auth session** — the run already uses a saved session at
  `tests/ui-testing/playwright-tests/utils/auth/user.json` (created by global setup). Do **not** create data; just call
  `navigateToBase(page)`.
- **`[shared/read-only]` — the landing/home page** — renders OButton-heavy chrome (theme toggle, profile menu, cards).
  Used for the button-class + dark-flip assertions.
- **`[per-test: TC-table]` — the Streams list page** (`[data-test="menu-link-\\/streams-item"]`) — renders an OTable
  **even when empty** (header chrome + empty state), so it is the data-free way to assert `o2-table-root` /
  `o2-table` / `bg-table-header-bg`. Cell selectors (`o2-table-cell-*`) need ≥1 row and are **out of scope** here.
- **`[per-test: TC-select]` — a Schema view's index-type OSelect** — already exercised in existing specs via
  `[data-test$="-index-type-select-trigger"]` / `-popover` / `-option` (see `streamsPage.js:317-419`). Use it only if the
  spec wants to prove OSelect token chrome + derived slugs; otherwise the predefined-themes drawer (`predefined-themes-drawer`)
  is sufficient and data-free.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Auth / navigate:** `navigateToBase(page)` — `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:134`.
  Wait for auth with `page.waitHelpers.waitForElementVisible('[data-test="navbar-main-nav"]', { timeout: 15000 })`
  (see `enhanced-baseFixtures.js:119`).
- **PageManager:** `const pm = new PageManager(page);` then `pm.themePage` / `pm.streamsPage`
  (`tests/ui-testing/pages/page-manager.js:164,202`).
- **Dark-mode toggle + wait:** `await pm.themePage.switchToDarkMode();` (internally clicks
  `[data-test="navbar-theme-toggle-btn"]` and waits for the `.dark` class) — `themePage.js:127-166`.
- **Token read (the core assertion):** `page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())`
  — already exists as `pm.themePage.getThemeColor()` (`themePage.js:337-341`). Add analogous reads for
  `--color-surface-base` and `--color-text-heading` in the spec (do not add to the page object unless the Engineer prefers).
- **Dark-flip wait:** reuse the `page.waitForFunction((dark) => document.documentElement.classList.contains(dark), 'dark')`
  pattern from `theme-management.spec.js:63-67`.

## Preconditions / toggles
- **Ensure light mode before asserting light token values**, and **restore light mode in `afterEach`** (same cleanup as
  `theme-management.spec.js:242-250`).
- **Do NOT assert exact brand hex** for `--color-primary-*` unless the default theme is guaranteed. `utils/theme.ts`
  writes inline `--color-primary-*` overrides on `<html>` for non-default themes (`theme.ts:182-220`), so assert
  "resolves + flips" (light ≠ dark), not "equals #3f7994".
- **Dark signal is on `<html>`**, not `<body>`: use `document.documentElement.classList.contains('dark')`
  (`themePage.bodyDarkClass === 'dark'`).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`.dark` on `<html>`, not `<body>`** — the legacy `body--dark` class was retired; keying off `<body>` yields a
  false "not dark" (see `theme.ts:206`, `themePage.js:51-54`).
- **Custom theme overrides the palette inline** — after applying a predefined/custom theme, `--color-primary-*` is set as
  an inline style on `<html>` and *beats* the stylesheet; `switchToLightMode()` alone does **not** clear a custom palette.
  For this spec, avoid applying themes; only toggle light/dark. If a prior suite left a custom theme, call
  `pm.themePage.resetToDefaultTheme()` before asserting.
- **View Transition race** — `switchThemeMode` wraps the toggle in `startViewTransition` and toggles a
  `theme-switching` class on `<html>` (`theme.ts:34-73`). Wait on the `.dark` class **presence/absence** (not just the
  button click) before reading computed token values, or you'll read mid-transition values.
- **OTable cell selectors need rows** — `o2-table-cell-*` / `o2-table-th-*` require columns (and rows for cells). The
  empty Streams list still renders `o2-table-root` + `o2-table` + header chrome, so assert those for the data-free case.
- **`check-design-consistency.mjs` is a build gate, not runtime** — do not try to assert "no bypasses" in Playwright;
  it's already enforced by `npm run verify` (`web/package.json:35-39`).
