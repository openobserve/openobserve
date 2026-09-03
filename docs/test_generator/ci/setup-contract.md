# Test Setup Contract: Query Editor AI Bar Visibility  (area: Logs)

## Streams / data the spec must establish

**None.** This feature is pure build/config gating. The AI bar and AI toggle visibility depend
only on `config.isEnterprise` (build-time, `"false"` on OSS) and `store.state.zoConfig.ai_enabled`
(server `/config`, absent/false on OSS). No stream, schema, FTS field, or ingested data is needed —
the assertions are "element is absent" on a freshly loaded Logs page.

- No `[shared/read-only]` or `[per-test]` data setup required.
- Do **not** add ingestion in this spec — it adds runtime cost with zero effect on the assertions.

## How to establish the page (copy these EXACT patterns — do NOT invent setup)
- Navigate: `await pm.logsPage.navigateToLogs();`
  — see `tests/ui-testing/playwright-tests/Logs/secondsPrecisionAdded.spec.js:25` and
  `tests/ui-testing/playwright-tests/Logs/pagination.spec.js:45`.
  It appends `?org_identifier=<id>&fn_editor=true` and waits for
  `[data-test="logs-vrl-function-editor"]` (mounts both the main and VRL editors).
- Page object: `const pm = new PageManager(page);` (or the fixture-provided instance) — `pm.logsPage`
  already exposes `queryEditor = '[data-test="logs-search-bar-query-editor"]'` and
  `fnEditor = '[data-test="logs-vrl-function-editor"]'`
  (see `tests/ui-testing/pages/logsPages/logsPage.js:40,186`).
- Auth/org: default org + worker auth state via the shared fixture
  (`require('../utils/enhanced-baseFixtures.js')` + `navigateToBase`) — same as every Logs spec.
- Timing: wait for the editor root to be `attached`/`visible` before asserting absence:
  `await page.locator('[data-test="logs-search-bar-query-editor"]').waitFor({ state: 'visible' })`.
  For "absent" assertions use `await expect(locator).toHaveCount(0)` after the editor is ready —
  do NOT use `toBeVisible()` on an element that legitimately never mounts (it will never resolve).

## Preconditions / toggles
- OSS build is assumed (run-context `edition: oss`): `config.isEnterprise === "false"`.
  No toggle/state manipulation is needed or possible from the test — the gate is static.
- The VRL editor is mounted by `fn_editor=true`; its AI selectors use the **default**
  `query-editor` prefix (`query-editor-ai-toggle-btn`, `query-editor-ai-input-bar`), NOT
  `logs-search-bar-*`.

## Assertion cheat-sheet (OSS)
| Assertion | Selector | Expected |
|-----------|----------|----------|
| Main AI toggle absent | `[data-test="logs-search-bar-ai-toggle-btn"]` | `toHaveCount(0)` |
| Main AI bar absent | `[data-test="logs-search-bar-ai-input-bar"]` | `toHaveCount(0)` |
| VRL AI toggle absent | `[data-test="query-editor-ai-toggle-btn"]` | `toHaveCount(0)` |
| VRL AI bar absent | `[data-test="query-editor-ai-input-bar"]` | `toHaveCount(0)` |

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`show-ai-icon` is a dead prop.** `SearchBar.vue:1343` passes `:show-ai-icon="…"` but
  `QueryEditor.vue` never declares it; it falls through to the root div inert. The real gate is the
  internal `aiFeatureEnabled` computed. Never assert on `show-ai-icon`.
- **VRL editor uses the default prefix.** Only the main editor gets `data-test-prefix="logs-search-bar"`.
  The VRL editor's AI selectors are `query-editor-*` — asserting on `logs-search-bar-ai-*` inside the
  VRL editor would silently pass (count 0) for the wrong reason.
- **`isAIMode` external-control path does NOT check `aiFeatureEnabled`** (QueryEditor.vue:278-281).
  It is only unreachable on OSS because the toggle that would emit `update:nlp-mode` is hidden.
  If a future test somehow sets `searchObj.meta.nlpMode` directly, the bar WOULD render — don't do
  that in an OSS spec.
- **Two `isNaturalLanguageDetected` flags exist** (SearchBar's toolbar flag vs QueryEditor's internal
  flag); neither can surface AI UI on OSS (toolbar "Ask AI" is `config.isEnterprise == 'true'`-gated;
  the editor's auto-detect is `aiFeatureEnabled`-gated).
- **Unit tests already cover this** in `web/src/components/QueryEditor.spec.ts` (lines 156-196);
  the E2E spec is the UI-level regression net for the same gate — keep the two in sync.
