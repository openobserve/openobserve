# Test Setup Contract: Keyboard Shortcut Cheatsheet Edition Gating (area: GeneralTests)

This feature is **data-free** — no streams, ingestion, or API-seeded rows are required. The
preconditions are authentication + the correct build edition, both of which already exist in the
shared fixtures. Do NOT invent stream/ingestion setup for this spec.

## Streams / data the spec must establish
None. The cheatsheet content is static (`SHORTCUT_REGISTRY`) and filtered only by build-time
`config.isEnterprise`/`config.isCloud` and the `/config`-derived `zoConfig` flags.

## How to establish the preconditions (copy these EXACT patterns — do NOT invent)

### 1. Auth + navigation
- Use the shared fixture: `const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');`
  then `await navigateToBase(page);` in `beforeEach` (see
  `tests/ui-testing/playwright-tests/GeneralTests/status-pages-enterprise-gating.spec.js:50-55`).
- The global setup already writes the auth state to `playwright-tests/utils/auth/user.json`; the
  fixture loads it via `storageState` (`enhanced-baseFixtures.js:23-45`). `ORGNAME` defaults to
  `default` via `process.env['ORGNAME'] || 'default'` in the URL (`enhanced-baseFixtures.js:148`).
- `pm = new PageManager(page);` (`tests/ui-testing/pages/page-manager.js`).

### 2. Edition detection (frontend signal — the cheatsheet gate is frontend-driven)
The cheatsheet's `visible` gates read `config.isEnterprise` / `config.isCloud` from `@/aws-exports`
(build-time `VITE_OPENOBSERVE_ENTERPRISE` / `VITE_OPENOBSERVE_CLOUD`), NOT the backend `build_type`.
So detect the edition from the **frontend**, not the backend `/config`:
- `await pm.editionFeaturesPage.detectEdition()` — reads the header edition button label
  (`upgrade-to-enterprise-btn`), which reflects `config.isEnterprise`/`isCloud`.
  Reference: `tests/ui-testing/pages/generalPages/editionFeaturesPage.js:81-88`.
- Returns `'opensource' | 'enterprise' | 'cloud'`. For this run assert/skip on `'opensource'`.
- Do **not** use `pm.statusPagesPage.detectBuildType()` (backend `build_type`) — that is the wrong
  source for a frontend-gated feature (see the note in
  `status-pages-enterprise-gating.spec.js:12-16` on why the two can diverge).

### 3. Open the cheatsheet (two exact entry points)
- **Menu path:** click `[data-test="menu-link-help-item"]` → click `[data-test="menu-link-shortcuts-item"]`.
  Reference component: `web/src/components/Header.vue:255-293`; the item `@select="openShortcuts"`
  bubbles to `MainLayout.vue:76`.
- **Keyboard path:** `page.keyboard.press('?')` (produces the `shift+?` combo the manager registers).
  See `ShortcutCheatsheet.vue:438-447` and `manager.ts:174-190`.

## Preconditions / toggles
- Non-cloud, OSS build: `config.isEnterprise === "false"` and `config.isCloud === "false"`.
- English default locale (chip `data-test` slugs are derived from translated module titles — keep
  language at default; see Edge Case 6 in the design doc).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Search input selector:** `data-test="shortcut-cheatsheet-search"` is on the OSearchInput wrapper;
  the real `<input>` is at `[data-test="shortcut-cheatsheet-search-field"]` (OInput derives
  `${data-test}-field` — `web/src/lib/forms/Input/OInput.vue:317,358`).
- **`shift+?` combo:** press `?` (or `Shift+/`), not `Shift` then `?` as separate key names. The
  manager reconstructs `shift+?` from `shiftKey` + `e.key === "?"`.
- **Gated modules are *absent*, not disabled:** on OSS the Settings/Online Evals/Actions/Running
  Queries chips don't exist in the DOM at all. Assert `count === 0` / `not.toBeVisible()`, never
  "disabled"/"locked".
- **No `/config` timing race for OSS gating:** every OSS-gated page requires `isEnterprise || isCloud`
  first (via `enterprise`/`cloud`/`incidents`/`rbac`/`metaAdmin`/`cloudMetaAdmin` gates), which is
  already `false` from build flags before `/config` loads — so the OSS assertions are deterministic
  with no wait-for-config needed. (The flag-gated pages only matter on ENT/Cloud, which this run does not exercise.)
- **Chip highlight is transient:** `onModuleClick` adds `bg-shortcut-highlight-bg` ~280 ms after the
  scroll then fades it after ~1.6 s. If asserting the highlight, poll for the class right after the
  click; don't rely on it persisting.
- **Chip container disappears on empty search:** `shortcut-cheatsheet-chips` is `v-if="filteredModules.length"`,
  so a no-results search also removes the chips.
