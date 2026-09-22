# Test Setup Contract: Keyboard Shortcut Cheatsheet Entry Gating (AI Chat)
(area: GeneralTests · edition: OSS)

## Streams / data the spec must establish
**None.** The cheatsheet renders entirely from `SHORTCUT_REGISTRY` + `SHORTCUT_MODULES` + the
`capabilities` computed from build-time flags (`config.isEnterprise` / `config.isCloud`) and the
runtime `/config` flags in the Vuex store (`store.state.zoConfig`). No stream, schema, or ingested
data is required for any behavior or edge case. Do **not** add ingestion/setup calls to this spec.

## Preconditions / toggles
- **Auth session:** already established by the suite's global setup
  (`tests/ui-testing/playwright-tests/utils/auth/user.json`), reused via the `context` fixture in
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:23-45`. Each test starts with
  `navigateToBase(page)` (same file, line 141).
- **Org:** `ORGNAME` env (default `"default"`); `navigateToBase` navigates to
  `/web/?org_identifier=${ORGNAME}`.
- **Edition detection (skip guard):** this spec runs **OSS only**. Detect the live build exactly the
  way the existing gating spec does:
  ```js
  const buildType = await pm.statusPagesPage.detectBuildType(orgId);
  test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);
  ```
  Reference: `tests/ui-testing/playwright-tests/GeneralTests/status-pages-enterprise-gating.spec.js:57-62`
  and `tests/ui-testing/pages/generalPages/statusPagesPage.js:43-54` (`detectBuildType` reads
  `GET ${INGESTION_URL||ZO_BASE_URL}/api/${orgId}/config` → `build_type`). The OSS run context has
  already filtered this spec to OSS, but keep the guard so a stray ENT/Cloud run skips cleanly
  instead of false-failing.

## How to open the cheatsheet (deterministic path)
```js
await pm.statusPagesPage.navigate(orgId); // or any authed route
await page.locator('[data-test="menu-link-help-item"]').click();
await page.locator('[data-test="menu-link-shortcuts-item"]').click();
await expect(page.locator('[data-test="shortcut-cheatsheet-dialog"]')).toBeVisible();
```
- Help menu selectors live in `web/src/components/Header.vue:273,304`; the "Keyboard shortcuts" item
  emits `openShortcuts` → `MainLayout.vue:76` `@open-shortcuts="openShortcutsList"` → sets
  `showShortcuts = true`.
- **Do NOT rely on the `shift+?` keyboard path** for the primary flow: `shift+?` is suppressed while
  an input is focused (`web/src/lib/vue-shortcut-manager/manager.ts:243-267`), which makes it
  non-deterministic at page load. Use it only as an optional secondary assertion (click the dialog
  closed first, then press `Shift+?`).

## Exact assertions (all selector-driven, no text matching)
- Dialog open: `[data-test="shortcut-cheatsheet-dialog"]` visible.
- Present (never-gated Global rows): `[data-test="shortcut-cheatsheet-row-openCheatsheet"]`,
  `[data-test="shortcut-cheatsheet-row-closeDialog"]`.
- **Absent (headline — AI Chat gate):** `[data-test="shortcut-cheatsheet-row-aiChatToggle"]`
  → `expect(await page.locator('...aiChatToggle').count()).toBe(0)`.
- Absent (fully-gated module chips): `-chip-settings`, `-chip-online-evals`, `-chip-actions`,
  `-chip-running-queries`. Present: `-chip-global`.
- Absent (gated pages inside shared modules): `-row-searchSchedulersRefresh`,
  `-row-alertSourcesRefresh`, `-row-iamRolesRefresh`, `-row-iamGroupsRefresh`, `-row-actionsRefresh`.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Chip `data-test` suffix is the translated English title**, slugged
  (`title.toLowerCase().replace(/[\s()—/]+/g, '-')`, `ShortcutCheatsheet.vue:63`): "Online Evals" →
  `shortcut-cheatsheet-chip-online-evals`. If the suite locale is ever non-English, chip suffixes
  change; pin en-US or match by the `shortcut-cheatsheet-chip-` prefix.
- **Category headers (`data-test="shortcut-cheatsheet-category"`) are not uniquely keyed** — never
  assert page gating at the category level; assert at the row level (`-row-<id>`) instead.
- **The AI Chat row id is `aiChatToggle`** (not `aiChat`); its combo is `ctrl+b`/`meta+b` and its
  label is "Toggle AI chat" (`shortcuts.actions.aiChatToggle`). Its gate is
  `isEnterprise && ai_enabled` (`shortcutRegistry.ts:92,214`).
- **`config.isEnterprise` is a build-time string flag** (`"true"`/`"false"` from
  `VITE_OPENOBSERVE_ENTERPRISE`, `aws-exports.ts:33-35`), independent of the backend `build_type`.
  The skip guard uses backend `build_type` (matching the runtime `/config` store), while the
  *assertion* verifies the frontend gate directly via the missing row — exactly the right split.
- **Dialog content mounts only when open.** The `shortcut-cheatsheet-dialog` panel (and its rows)
  are not in the DOM while `showShortcuts` is false; open it before asserting any row count.
