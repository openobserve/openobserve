# Test Setup Contract: Logs Quick Mode Pin to Toolbar (area: Logs)

## Streams / data the spec must establish
The pin feature is UI-state driven and does **not** require query results. However the Logs page must
be functional (a stream selected) for the SearchBar/utilities menu to render and be interactable.
Tag each item by SCOPE so the Engineer puts it in the right place:

- **`e2e_automate` [shared/read-only]** — fields: `kubernetes_pod_id`, `kubernetes_container_name`,
  `level`, `log`, `stream`, `code`, `_timestamp` (plus other kubernetes.* fields). Why: the existing
  Quick Mode specs and page objects assume this stream; needed only to have a selectable stream so the
  toolbar/menu render. Quick Mode pinning does not read schema fields.
- **No per-test streams required** — no test mutates stream data for this feature.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- Ingest `e2e_automate`: call `pm.ingestionPage.ingestion()` — it POSTs
  `${process.env.INGESTION_URL}/api/${orgId}/e2e_automate/_json` with body from
  `tests/test-data/logs_data.json`. See `tests/ui-testing/pages/generalPages/ingestionPage.js:9-35`.
  - Equivalent inline helper: `pm.logsPage.ingestLogs(orgId, streamName, logData)` →
    `tests/ui-testing/pages/logsPages/logsPage.js:1715-1735`.
- Auth/org: use `navigateToBase(page)` (from `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js`)
  then navigate to `/web/logs?org_identifier=${process.env["ORGNAME"]}` — copy the `beforeEach` pattern
  from `tests/ui-testing/playwright-tests/Logs/logsquickmode.spec.js:28-71`.
- Select stream: `pm.logsPage.selectStream("e2e_automate")` →
  `tests/ui-testing/pages/logsPages/logsPage.js:579`.
- Timing: after selecting a stream, apply a query with `pm.logsPage.clickRefreshButton()` (or
  `runQueryAndWaitForResults()`) so the page reaches a stable, live state before interacting with the
  toolbar/menu. No schema/field hydration wait is required for the pin behavior itself.

## Preconditions / toggles
- **Viewport > 1280px**: the pinned toolbar toggle is gated by
  `!shouldMoveSqlToggleToMenu && quickModePinned` (`shouldMoveSqlToggleToMenu = windowWidth <= 1280`).
  Playwright default viewport is `1500 × 1024` (`tests/ui-testing/playwright.config.js:79`), so no
  extra setup is needed. If a test resizes the viewport below 1280, the toolbar toggle will disappear
  regardless of pin state.
- **Non-SQL mode**: the pin feature is independent of SQL mode. Not required, but to avoid SQL-mode
  SELECT rewrites side effects use `pm.logsPage.disableSqlModeIfNeeded()` →
  `tests/ui-testing/pages/logsPages/logsPage.js:5868-5878`.
- **localStorage state** (`logsQuickModePinned`): defaults to **pinned (true)** on first load
  (`useLocalQuickModePin() !== "false"` where the missing key reads as `null`). To assert a clean
  "unpinned → pin → pinned" transition, either (a) `page.evaluate(() => localStorage.setItem('logsQuickModePinned','false'))`
  + reload before the test, or (b) accept the default-pinned start and assert pin→unpin→pin instead.
  Recommend (b) — no fragile localStorage injection.

## Gotchas (so the Healer/Engineer don't rediscover them)
- The utilities menu Quick Mode row has **no `v-close-popup`** — it stays open after toggling. Existing
  page-object methods explicitly press `Escape` to close it (`clickQuickModeToggle`,
  `enableQuickModeIfDisabled`). Always close the menu before asserting the toolbar toggle.
- The pin button (`logs-search-bar-quick-mode-pin-btn`) uses `@click.stop`; clicking it must not toggle
  Quick Mode, and clicking the Quick Mode row must not toggle the pin — assert them independently.
- The toolbar pinned toggle and the menu Quick Mode toggle are two **different** elements:
  - menu row → `logs-search-bar-quick-mode-toggle-btn`
  - toolbar → `logs-search-bar-quick-mode-pinned-toggle-btn`
  Do not confuse them.
- Toggle state is checked via the Quasar `q-toggle__inner` class: `q-toggle__inner--truthy` (on) vs
  `q-toggle__inner--falsy` (off). Copy `getQuickModeState()` →
  `tests/ui-testing/pages/logsPages/logsPage.js:1147-1154`.
- The pin button has no dedicated text; identify it by `data-test` + the `push_pin` icon. Color is the
  pinned indicator: `color=primary` when pinned, `grey-6` when unpinned
  (`SearchBar.vue:601-603`).
- `shouldMoveSavedViewToMenu` (≤1440) and `shouldMoveShareToMenu` (≤1100) are also viewport-gated and
  affect other toolbar buttons, but at the default 1500px viewport all toolbar buttons are present and
  only the utilities menu matters for this feature.
