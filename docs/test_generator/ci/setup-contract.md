# Test Setup Contract: Query Editor Keyboard Accessibility (Escape / focus)  (area: Logs)

> Read by the Engineer (implements setup), the Healer and the Refiner (consult instead of
> blind-scanning when a data/setup failure appears). Every item below is copied from an existing
> spec/helper — do NOT invent a new setup.

## Streams / data the spec must establish
- **`<unique>` logs stream** — **`[shared/read-only]`** — one stream with a handful of rows is
  enough; the feature only needs the editor to be active and a results/field-list panel to be
  present (so there IS a "next control" for Escape to land on). Fields: at minimum `_timestamp`
  and `message` (the standard ingest in the reference below produces these). Why: the Escape
  action is data-independent; rows exist purely to keep the results panel (and its focusable
  controls) mounted.
- No edge-case stream variants are needed (no FTS/field-completion dependency for the Escape path).

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Ingest:** `ingestRows(request, ORG, STREAM, rows)` from
  `tests/ui-testing/playwright-tests/utils/auto-run-helpers.js:62-71`
  (`POST /api/<org>/<stream>/_json`, batched 2000/request). Reference usage:
  `tests/ui-testing/playwright-tests/Logs/logs-jk-navigation.spec.js:175-188`
  (beforeAll ingests `TOTAL` rows, then polls a total-count search until it matches).
- **Org naming:** use a unique org per run, e.g. `const ORG = \`kbd${Date.now()}\``
  (mirrors `jknav${Date.now()}` at `logs-jk-navigation.spec.js:25`).
- **Navigate:** use the URL-with-query-params pattern (NOT a UI click-through), copied from
  `logs-jk-navigation.spec.js:42-44`:
  ```
  /web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m&refresh=0
    &sql_mode=false&quick_mode=false&show_histogram=false&query=${b64("")}
  ```
  `b64()` is the base64url helper at `logs-jk-navigation.spec.js:35-40`. The `sql_mode=false` keeps
  the editor in non-SQL (filter) mode by default; the Escape behavior is language-agnostic, so this
  is fine — if a SQL-mode variant is desired, drop `sql_mode=false` (SQL is auto-detected).
- **Auth/org:** `getAuthHeaders()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js:29`
  (already used inside `ingestRows`); `navigateToBase(page)` from
  `tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` before `page.goto(url)` — see
  `logs-jk-navigation.spec.js:16-24,80`.

## Editor interaction helpers (copy these EXACT patterns)
- **Focus the editor (reliably):** `logsPage.clickQueryEditor()` at
  `tests/ui-testing/pages/logsPages/logsPage.js:2968-2988` — focuses via
  `window.monaco.editor.getEditors().find(e => host.contains(e.getDomNode())).focus()`, with a
  wrapper-click fallback. This is the correct way to focus (clicking the outer wrapper does not
  reliably focus Monaco's hidden `inputarea`).
- **Editor selector:** `logsPage.queryEditor = '[data-test="logs-search-bar-query-editor"]'`
  (`logsPage.js:40`). The inner Monaco host is `[data-test="query-editor"]`
  (`id="logs-search-bar-editor-sql"`); `window.monaco` is exposed by the editor
  (`CodeQueryEditor.vue:816-820`), and the model is read as
  `window.monaco.editor.getModels()[0].getValue()`.
- **Wait for editor ready:** `logsPage.waitForQueryEditorReady()` /
  `waitForQueryEditorValue()` exist at `logsPage.js:1328-1354, 3084-3089`; wait for Monaco to attach
  (`window.monaco.editor.getEditors()`) before focusing.
- **Wait for results (so a next-control exists):** `logsPage.waitForRunQueryButton()` and/or assert a
  result row is attached, e.g. `[data-test="o2-table-row-0"]` — reference
  `logs-jk-navigation.spec.js:94-107`.

## Preconditions / toggles
- **Non-fullscreen for the primary behavior:** the editor defaults to collapsed
  (`data-fullscreen="false"` on `.query-editor-container`). No toggle needed; the expanded case is a
  separate test that clicks `[data-test="logs-query-editor-full_screen-btn"]`.
- **Non-SQL / non-quick mode** via the URL params above (avoids auto-run noise); copy the
  localStorage-clear step at `logs-jk-navigation.spec.js:81-86` to reset persisted toggles.
- **Suggest widget (for the two-Escape workflow):** type a trigger character (`'`, `.`, `(`, `,`,
  or ` `) in the focused editor to open the widget — no special setup beyond a focused editor.

## Focus assertions (how the test proves Escape moved focus)
- **Focus-left-editor (robust):** after `page.keyboard.press("Escape")`, assert
  `document.activeElement` is NOT inside `[data-test="query-editor"]` nor
  `[data-test="logs-search-bar-query-editor"]`:
  ```
  await page.evaluate(() => {
    const a = document.activeElement;
    return !a?.closest('[data-test="query-editor"], [data-test="logs-search-bar-query-editor"]');
  });
  ```
- **Focus-stayed (fullscreen / dialog):** assert the inverse (activeElement IS inside the editor
  host) after Escape collapses the fullscreen, and assert
  `[data-fullscreen="false"]` on `.query-editor-container`.
- **Deterministic target (optional):** the first focusable control after the editor in document
  order is in the field list / results panel. Candidate selectors (verify at implementation time):
  `[data-test="log-search-index-list-select-stream-trigger"]` (stream selector trigger) — the exact
  target depends on which panel control is first and visible; prefer the focus-left-editor assertion
  as the primary check.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **First Escape vs second Escape:** if the suggest widget is open, the first Escape only closes it
  (Monaco default); the `o2.editor.escapeToNextControl` precondition includes
  `!suggestWidgetVisible`. A "Escape leaves the editor" test must ensure no widget/selection is
  active (fresh focus is fine) or press Escape twice.
- **`window.monaco` must be loaded** before any editor focus/read; if a click lands before Monaco
  attaches, use `clickQueryEditor()`'s fallback or wait on `waitForQueryEditorReady()`.
- **`focusControlAfter` skips zero-size/hidden candidates** (`getClientRects().length === 0`) and
  `tabindex="-1"`; `focusableUnavailable` buttons are `aria-disabled` (still tabbable) and remain
  valid targets — do not assert a specific "disabled" control is skipped.
- **Fullscreen is CSS-fixed, not the browser Fullscreen API** — collapse is driven only by
  `handleEscKey` (window keydown) or the full-screen button; the `data-fullscreen` attribute is the
  stable test hook (`SearchBar.vue:1253-1263`).
- **The `defaultPrevented` contract is inverted from intuition:** a wrapper that takes Escape does
  NOT `preventDefault` (focus stays); a wrapper that declines calls `preventDefault` (focus moves on).
  Do not write a test asserting the opposite.
