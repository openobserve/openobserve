# Test Setup Contract: Date-Time Picker Forward Shift Cap  (area: GeneralTests)

This feature is a **pure UI control** on the shared DateTime picker — no backend state, no
stream, no ingested data. The only "data" a test must establish is a known **absolute time
window in the past**, and that is done with the existing copy/paste infrastructure (epoch
microseconds), not ingestion.

## Streams / data the spec must establish
**None.** The picker + shift buttons render in the Logs search bar before any stream is
selected. The existing `datetime-picker-copy-paste.spec.js` navigates to `/web/logs` and opens
the picker with no stream selection — do the same.

The only precondition per test is the clipboard window:

- **`[per-test]`** a pasted absolute epoch-microsecond range (via `pm.dateTimePickerPage`),
  used to (a) force the picker onto the Absolute tab and (b) give the shift a concrete,
  timezone-independent window to assert against.
  - Deterministic "shift-by-duration" tests use a fixed PAST anchor far from now
    (e.g. the copy-paste spec's `ANCHOR_START_MICROS`/`ANCHOR_END_MICROS` style constants).
  - The "cap at now" test must compute its anchor **dynamically from the page's clock**
    (`Date.now() * 1000` in-page) so the window ends a few seconds before now.

## How to create it (copy these EXACT patterns — do NOT invent setup)
- **Navigation + auth**: `await navigateToBase(page);` then
  `await page.goto(\`${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}\`);`
  followed by `await page.waitForLoadState('domcontentloaded');` and
  `await pm.dateTimePickerPage.openPicker();`
  — see `tests/ui-testing/playwright-tests/GeneralTests/datetime-picker-copy-paste.spec.js:45-54`.
  Auth is via saved storage state (`tests/ui-testing/playwright-tests/utils/auth/user.json`);
  the `context` fixture in `enhanced-baseFixtures.js:30-38` already grants
  `clipboard-read`/`clipboard-write`, which paste needs.
- **Establish a past absolute window (paste)**: reuse the page object, not raw locators —
  `await pm.dateTimePickerPage.seedClipboard('2026-07-23T10:00:00Z - 2026-07-23T11:00:00Z');`
  then `await pm.dateTimePickerPage.clickPaste();` (forces Absolute + success toast)
  — see `datetime-picker-copy-paste.spec.js:186-194`. For epoch control use
  `pasteAndReadBackRange()` (`dateTimePickerPage.js:168-175`).
- **Assert the window after a shift (copy-back)**: reopen the picker (shift closes it),
  then `await pm.dateTimePickerPage.clickCopy();` +
  `await pm.dateTimePickerPage.readCopiedRange();` returns `{ start_date, end_date }` in
  epoch **microseconds** — timezone-independent and exact for second-aligned values
  — see `datetime-picker-copy-paste.spec.js:81-88`.

## Page object gap (must be added before the spec runs)
`tests/ui-testing/pages/generalPages/dateTimePickerPage.js` currently has **no next/prev
helpers**. The Engineer must add (next to `copyBtn`/`pasteBtn`):
- `this.nextShiftBtn = page.locator('[data-test="date-time-next-btn"]')`
- `this.prevShiftBtn = page.locator('[data-test="date-time-prev-btn"]')`
- helpers: `expectNextEnabled()`, `expectNextDisabled()` (use `toBeEnabled()`/`toBeDisabled()`),
  `clickNext()`, `clickPrev()`.

## Preconditions / toggles
- **Relative vs Absolute**: the picker mounts in Relative (`15m`) where Next is **disabled**.
  Every forward-shift test must first land on Absolute — paste does this automatically (and
  `expectAbsolutePanelActive()` can confirm via `[data-test="datetime-start-time"]`).
- **Host mode**: prefer the Logs host (`auto-apply`) so there is no Apply button to manage and
  a shift commits immediately. If the Metrics host is used, `autoApplyDashboard` is false and
  the deep watcher is bypassed in favor of `saveDate("absolute")` inside `shiftTimeRange` — the
  observable result is the same, but the picker has an Apply button present.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **The picker closes on shift.** `shiftTimeRange` sets `menuOpen.value = false`
  (`DateTime.vue:1267`). To copy-back the shifted window, reopen the picker first.
- **Next is disabled by default (Relative).** A test that clicks Next without first switching
  to Absolute will find the button disabled — establish the absolute window via paste first.
- **"Cap at now" is time-sensitive.** `isNextShiftDisabled()` uses `endUTC + 1_000_000 <= Date.now()*1000`
  and `shiftTimeRange('next')` clamps with `Math.min(delta, Date.now()*1000 - endTime)`. Real
  "now" advances during the test, so:
  - Use a generous tolerance on `end_date ≤ now` (capture `now` from the page, allow a couple of
    seconds of drift), OR
  - Treat the precise cap as **unit-covered** (`DateTime.spec.ts:637-716`, fake timers) and keep
    the E2E "cap" test coarse (assert `end_date` does not exceed a captured `now + smallSlack`).
- **Time precision is second-aligned.** `convertUnixTime` truncates to whole seconds, so the
  copy-back epoch round-trip is exact only for second-aligned input; compare on whole seconds
  (`Math.floor(micros / 1_000_000)`) like `datetime-picker-copy-paste.spec.js:117-119`.
- **Week periods convert to days** before shift arithmetic (`DateTime.vue:937-940`); irrelevant
  for paste-based absolute windows, but do not rely on a relative `w` shift in E2E.
- **Multiple `date-time-btn`?** `SearchHistory.vue` uses a different `data-test-name`
  (`search-history-date-time`), and the page object already scopes the trigger with `.first()`.
