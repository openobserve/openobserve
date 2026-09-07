# Test Setup Contract: AI Chat Keyboard Shortcut Gate  (area: GeneralTests)

## Streams / data the spec must establish
**None.** This feature is a pure layout/keyboard behavior — it needs no streams, schemas, or
ingested data. Do **not** ingest anything.

## How to reach the app (copy these EXACT patterns — do NOT invent setup)
- Auth + navigation: `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` (exported at line 194).
  It navigates to `${ZO_BASE_URL}/web/?org_identifier=${ORGNAME}`, waits for auth
  (`[data-test="navbar-main-nav"]`), and self-heals on cloud. Reference usage:
  `tests/ui-testing/playwright-tests/GeneralTests/status-pages-enterprise-gating.spec.js:45-50`
  (`beforeEach`: `await navigateToBase(page); pm = new PageManager(page);`).
- `ORGNAME` = `process.env['ORGNAME'] || 'default'` (same fallback as
  `statusPagesPage.detectBuildType`).

## Preconditions / toggles
- **Edition signal (frontend flag):** the gate reads `config.isEnterprise`
  (`VITE_OPENOBSERVE_ENTERPRISE` via `@/aws-exports`), which is a *frontend build-time* flag, not
  the backend `build_type`. The most faithful runtime signal is the header edition button label —
  reuse `editionFeaturesPage.detectEdition()` (`tests/ui-testing/pages/generalPages/editionFeaturesPage.js:81`)
  which returns `'opensource' | 'enterprise' | 'cloud'`. This run is OSS → expect `'opensource'`.
  (Do **not** use `statusPagesPage.detectBuildType()` here — that reads backend `build_type`, which
  can diverge from the frontend flag the gate actually reads.)
- No `ai_enabled` override is possible from the UI on OSS; the `/config` response simply lacks it,
  so `store.state.zoConfig.ai_enabled` stays falsy. No action needed.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Cheatsheet is a red herring.** `ShortcutCheatsheet.vue` renders from the static
  `SHORTCUT_REGISTRY`, so `[data-test="shortcut-cheatsheet-row-aiChatToggle"]` still shows "Ctrl+B"
  on OSS even though the binding is never registered. Never assert on it to prove the gate is closed.
- **`[data-test="menu-link-ai-item"]` is `v-if`-removed on OSS** (Header.vue:216) — use
  `toHaveCount(0)` / `toBeHidden`, not `toBeVisible`.
- **The AI panel is `v-show`-hidden, not removed.** The `<aside class="o2-sidebar-right">` stays in
  the DOM with `display:none` when closed; `O2AIChat` is mounted but `isOpen=false`, so
  `.chat-content-wrapper` is absent. Assert the panel is *hidden/absent*, not that the `<aside>` is
  removed from the DOM.
- **Platform key combo:** use `process.platform === 'darwin' ? 'Meta+B' : 'Control+B'`
  (pattern at `tests/ui-testing/playwright-tests/Alerts/alerts-content-templates.spec.js:128`).
- **NEEDS SELECTOR:** there is no `data-test` on the AI sidebar `<aside>`. Prefer adding one (e.g.
  `data-test="ai-chat-panel"` on the `<aside>` at `MainLayout.vue:122`) or target the stable
  `.o2-sidebar-right` class / `.chat-content-wrapper`. Do not fabricate a selector that doesn't exist.
