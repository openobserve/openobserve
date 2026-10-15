# Test Setup Contract: Logs Toolbar Pins  (area: Logs)

## Streams / data the spec must establish

None. This feature is pure client-side state in `localStorage` — no stream, ingestion, or
server-side fixture is involved (`needs_api: false`). The only "data" the spec manipulates is the
pin storage keys seeded before the app boots.

Tag by scope so the Engineer places setup correctly:
- **`[per-test / seed]`** — pin storage is seeded per test via an init script, then mutated by the
  test. There is no shared/read-only stream to provision.

| Item | Scope | How established |
|------|-------|-----------------|
| `logs_toolbar_pinned_items` (JSON array of pin keys) | `[per-test / seed]` | `pm.logsToolbarPinsPage.seedPinStorage({ pins, decided })` |
| `logs_toolbar_histogram_pin_decided` (flag) | `[per-test / seed]` | same helper, `decided` arg |
| `traces_toolbar_pinned_items` / `traces_toolbar_saved_views_pin_decided` | read-only (assert) | written by the app; read via `readTracesPins()` |

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth / login:** use the standard worker pattern, not a per-test login:
  `await navigateToBase(page);` then `pm = new PageManager(page);` — see
  `tests/ui-testing/playwright-tests/Logs/logsToolbarPins.spec.js:20-27`.
- **Navigate to Logs:** `pm.logsToolbarPinsPage.navigateToLogs(getOrgIdentifier())` —
  `tests/ui-testing/pages/logsPages/logsToolbarPinsPage.js:99-104`. It `page.goto`es
  `${ZO_BASE_URL}/web/logs?org_identifier=<org>` and waits for the More button to be visible
  (`expectToolbarReady`). `getOrgIdentifier` comes from `utils/cloud-auth.js`.
- **Seed pin storage:** `await pm.logsToolbarPinsPage.seedPinStorage({ pins, decided })` —
  `logsToolbarPinsPage.js:74-97`. It uses `page.addInitScript` so the keys exist before the app
  imports `useToolbarPins` (which reads storage at module-init time). It is guarded by a
  `sessionStorage.__pinSeedApplied` sentinel so a `page.reload()` does NOT re-apply/wipe the seed.
  - `pins` may be an array (JSON-stringified), a raw string (for corrupt-JSON cases), or `undefined`
    (remove key). `decided` sets the histogram default flag (`true`/`false`/`undefined`).
- **Reload:** `pm.logsToolbarPinsPage.reload()` — `logsToolbarPinsPage.js:106-109` (page.reload +
  expectToolbarReady).
- **Cross-scope navigation (same document):** `stampDocument()` → `gotoTracesViaNav()` /
  `gotoLogsViaNav()` — `logsToolbarPinsPage.js:113-138`. Must NOT use `page.goto`, or the shared
  `scopeStates` map resets and the isolation assertion is meaningless.
- **Viewport sweep:** `setViewportWidthAndSettle(width)` — `logsToolbarPinsPage.js:157-185`. Waits
  two rAF frames and polls until the visible pinned set stops changing (ResizeObserver race guard).

## Preconditions / toggles

- None beyond an authenticated OSS session. `navigateToBase` + `navigateToLogs` covers it.
- The More button (`logs-search-bar-utilities-menu-btn`) is the readiness sentinel — it is always
  rendered regardless of pin state or viewport width.

## Gotchas (so the Healer/Engineer don't rediscover them)

- `useToolbarPins` reads `localStorage` **at module import time** (in `getScopeState`), so pin
  storage must be seeded with `addInitScript` BEFORE the app JS boots. Seeding after navigation does
  nothing for the current document.
- `seedPinStorage` uses a `sessionStorage.__pinSeedApplied` guard: it runs on every navigation. Do
  not re-call it mid-test to "reset" pins; use `togglePin` or a fresh context instead, or the reload
  persistence test will be defeated.
- The pinned **Syntax Guide** control has NO DOM selector — `logs-search-bar-syntax-guide-pinned-btn`
  is dropped by `SyntaxGuide`'s `ODropdown` root. Assert syntax-guide pin state only via the menu pin
  button's `title` (`Pin to toolbar` / `Unpin from toolbar`).
- Narrow-width collapse is **non-monotonic**: at very narrow widths the toggle group collapses and
  frees budget, so pinned count can go UP as width shrinks. Assert a canonical-order *prefix*, never
  a fixed count per breakpoint.
- The logs↔traces isolation test must move by **nav-rail click** (same document), never `page.goto`,
  because `scopeStates` is a module-level map that a full load wipes.
- Pin-button state is conveyed only through the `title` attribute (`Pin to toolbar` /
  `Unpin from toolbar`), which maps to `search.pinToToolbar` / `search.unpinFromToolbar` i18n keys —
  the rendered English values are "Pin to toolbar" / "Unpin from toolbar".
