# Test Setup Contract: Logs Toolbar Pins  (area: Logs)

This feature is **pure client-side state** — pin choices live in `localStorage`. There is
**no stream/data ingestion** and **no server-side fixture**. The only "data" the tests
need is seeded `localStorage` keys before the app boots, plus a logged-in session.

## Streams / data the spec must establish
- **None.** No streams, no ingested records, no saved views, no scheduled jobs. Every
  behavior (pin, unpin, default, collapse, cross-scope isolation) is driven by the
  `localStorage` keys below and viewport width.

## How to create the preconditions (copy these EXACT patterns — do NOT invent setup)

### 1. Seed pin storage (the ONLY setup)
Use the page object's seeder, which writes via `page.addInitScript` so the keys are
present **before** the app boots and reads them:

```js
// [per-test] seed empty (fresh profile) — histogram default fallback applies
await pm.logsToolbarPinsPage.seedPinStorage();

// [per-test] seed an explicit pin set — used by order/collapse/corrupt tests
await pm.logsToolbarPinsPage.seedPinStorage({ pins: ['sqlMode'], decided: true });

// [per-test] seed corrupt JSON — exercises the fallback path
await pm.logsToolbarPinsPage.seedPinStorage({ pins: 'not json at all' });
```
Reference: `tests/ui-testing/pages/logsPages/logsToolbarPinsPage.js:74-97`
(`seedPinStorage`). Existing call sites: `tests/ui-testing/playwright-tests/Logs/logsToolbarPins.spec.js:42,55,90,107,180`.

Storage keys written/read by the app (`web/src/composables/useToolbarPins.ts:43-54`):
- `logs_toolbar_pinned_items` — JSON array of pinned keys (logs scope)
- `logs_toolbar_histogram_pin_decided` — `"true"` = user decided (disables histogram default)
- `traces_toolbar_pinned_items` — JSON array (traces scope); default `savedViews` until `traces_toolbar_saved_views_pin_decided === "true"`

### 2. Auth / org
`test.beforeEach` already runs `navigateToBase(page)` (auth check + `/web/` base nav) and
constructs `pm = new PageManager(page)` — see `tests/ui-testing/playwright-tests/Logs/logsToolbarPins.spec.js:28-32`.

Org identifier: `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js:64`
(cloud → `cloud-config.json`, self-hosted → `ORGNAME` env). Pass it to `navigateToLogs(org)`.

### 3. Navigation & timing
```js
await pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier());
```
`navigateToLogs` (`logsToolbarPinsPage.js:99-104`) does `page.goto(ZO_BASE_URL/web/logs?org_identifier=…)`
then waits for the More button (`expectToolbarReady`) — that is the readiness gate. Do
**not** assert pin visibility before `expectToolbarReady` passes.

Cross-scope navigation (logs↔traces) MUST be client-side via nav-rail click
(`gotoTracesViaNav` / `gotoLogsViaNav`, `logsToolbarPinsPage.js:128-138`), **never**
`page.goto`, or the module-level `scopeStates` map resets and the isolation assertion fails.

Width-driven collapse: use `setViewportWidthAndSettle(width)`
(`logsToolbarPinsPage.js:157-185`), which resizes, waits two `requestAnimationFrame`s,
then polls until the visible pinned set stops changing (ResizeObserver settle). Never
read layout immediately after `page.setViewportSize`.

## Preconditions / toggles
- **Non-SQL mode** is the default; pin toggles are reachable regardless of SQL mode.
  No toggle is required before pinning.
- **Full viewport width** (≥1700px) is required when a test asserts that *all* pinned
  left-section controls are simultaneously visible (e.g. the collapse test's `kept[0]`
  guard). At default Playwright width some pinned controls may already be collapsed.
- The histogram **default fallback** only applies when `logs_toolbar_histogram_pin_decided`
  is absent/not `"true"`. Seed `{ decided: true }` to suppress it for tests that want an
  empty/controlled pin set.

## Gotchas (so the Healer/Engineer don't rediscover them)
- **`addInitScript` re-runs on every navigation.** `seedPinStorage` guards with a
  `sessionStorage.__pinSeedApplied` stamp (`logsToolbarPinsPage.js:76-84`) so a `reload()`
  after toggling does not wipe the test's own pin. Don't bypass the seeder with a raw
  `page.addInitScript` that re-writes on every navigation.
- **The syntax guide pinned control has NO assertable `data-test`.** `SearchBar.vue:351-357`
  puts `logs-search-bar-syntax-guide-pinned-btn` on `<SyntaxGuide>`, but its `ODropdown`
  root drops the attribute (`SyntaxGuide.vue:18`). Assert syntax-guide pin state via the
  menu pin button `title` only: `logs-search-bar-menu-pin-syntax-guide-btn`
  (`expectPinToggleTitle`, `logsToolbarPinsPage.js:275-277`).
- **Pin title semantics:** `title="Unpin from toolbar"` = pinned; `title="Pin to toolbar"`
  = unpinned. Strings from `web/src/locales/languages/en-US.json:1126-1127`. The page
  object exposes them as `pinTitle = { pinned: 'Unpin from toolbar', unpinned: 'Pin to toolbar' }`.
- **Pinned-count is NOT monotonic in viewport width.** A narrower toolbar collapses the
  toggle group first, freeing width budget for MORE pins. Assert "visible set is a priority
  prefix", never exact counts or named breakpoints (see
  `tests/ui-testing/playwright-tests/Logs/logsToolbarPins.spec.js:175-216`).
- **Traces scope keys differ:** `histogram` = "metrics" in traces, and only `histogram` +
  `savedViews` exist; `quickMode`/`sqlMode`/`functionEditor`/`syntaxGuide` do not. The
  traces metrics pin selector is `traces-search-bar-menu-pin-metrics-btn` (maps to the
  `histogram` key).
- **Cross-scope isolation holds only within one document.** The page object's
  `stampDocument()`/`expectSameDocument()` (`logsToolbarPinsPage.js:112-125`) enforce
  that a `page.goto` reload did not occur between logs and traces navigation.
