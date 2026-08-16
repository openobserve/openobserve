# Test Setup Contract: Synthetics Browser Test Journey Recording  (area: Synthetics)

This feature has **no stream/data ingestion dependency** — the journey editor is pure client
state. The preconditions are (a) an **enterprise/cloud build with `synthetics_enabled`**, and
(b) **≥1 enabled public browser location** for the save path. The extension-dependent behaviors
(recording/replay/restore) cannot run in a Playwright environment and must be parked as `fixme`.

## 0. Environment gate (MUST verify before anything else)

- The `synthetics` route tree is registered **only** when
  `config.isCloud == "true" || config.isEnterprise == "true"`
  (`web/src/composables/shared/useEnterpriseRoutes.ts:174`) and the route guard redirects to `/`
  when `store.state.zoConfig.synthetics_enabled === false` (`useEnterpriseRoutes.ts:23-29`).
- **Consequence:** if the E2E target is a pure-OSS build (or `synthetics_enabled` is off), the
  page `/synthetics` does not exist and the whole spec must **skip cleanly** (assert the route /
  `zoConfig.synthetics_enabled` first, or a `test.fixme`/`test.skip` on the whole file). The
  Engineer should confirm the target build before authoring a hard green test that assumes the
  page exists.

## 1. Streams / data the spec must establish

No log streams, metrics, or ingestion are needed. The only server-side data the feature reads:

- **Browser locations** **[shared/read-only]** — from `GET /api/{org}/synthetics/locations`.
  Needed by: the Configure step's location selector, and the **save** path (schema requires
  `locations.length >= 1`). The spec must assert ≥1 *enabled* public browser location exists
  before attempting a save, otherwise `locationsRequired` blocks it. The per-location option
  selector is `synthetics-check-locations-option-${location.id}` (see `CheckLocations.vue:377`).
- **Folders** **[shared/read-only]** — from `getFoldersListByType(store, "synthetics")`. Only
  needed for the folder dropdown; `"default"` works without any custom folder.
- **Existing browser check** **[per-test: edit workflow]** — create one via the API (below) or via
  the UI in a beforeAll, then open `/synthetics/edit/:id?folder=...`.

Tag legend:
- **[shared/read-only]** — set up once (beforeAll) / rely on what the backend already provides.
- **[per-test]** — create inside the test, uniquely named, and clean up.

## 2. How to establish it (copy these EXACT patterns — do NOT invent setup)

- **Auth/org:** use the standard fixture bootstrap — `const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js')`
  then `await navigateToBase(page)` in `beforeEach` (see `tests/ui-testing/playwright-tests/RegressionSet/Reports/reports-regression-bugs.spec.js:16-24`).
  Auth state is provided by global setup (`tests/ui-testing/playwright-tests/utils/auth/user.json`).
  Org identifier: `process.env.ORGNAME || 'default'`, or `getOrgIdentifier()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`. API auth headers: `getAuthHeaders()` (same file).
- **Create a check via API (for the edit workflow / cleanup):**
  `POST /api/{org}/synthetics?folder={folderId}` with a body built by
  `buildCreateBrowserTestPayload(check)` (`web/src/utils/synthetics/buildPayload.ts`). There is **no
  existing synthetics page object or spec** — this is the first; the Engineer must either create
  `tests/ui-testing/pages/syntheticsPages/…` + register it in `tests/ui-testing/pages/page-manager.js`,
  or drive `pm.commonActions` + the raw `data-test` selectors below.
- **Locations prerequisite check (exact call):** `GET /api/{org}/synthetics/locations` →
  filter `enabled !== false` and `kind !== "private" || types includes "browser"` (mirrors
  `CreateBrowserTest.vue:311-322`). If none, park the save test with `test.fixme`.
- **Cleanup:** delete created checks with `DELETE /api/{org}/synthetics/{id}?folder={folderId}`
  (`web/src/services/synthetics.ts:96-101`). Create in a uniquely-named check (e.g.
  `e2e_journey_${Date.now()}`) so cleanup/teardown is unambiguous.
- **Timing:** after "Build manually", the editor mounts `BrowserJourney` synchronously — no
  network wait. After **Record** (no extension), `probeExtension()` waits ~500ms + a 4s command
  timeout before landing on `extension-setup` (`useSyntheticsRecorder.ts:263-287`) — wait for the
  checklist selector with a generous timeout (~10s), not a fixed sleep.

## 3. Preconditions / toggles

- Build must be enterprise/cloud with `synthetics_enabled !== false` (see §0).
- **No Chrome extension is installed in CI** → Record/Replay cannot execute. Tests exercise the
  **"Build manually"** path (`synthetics-create-build-btn`) for all journey authoring, and use the
  **"Record → setup checklist"** path only to assert the fallback UI, never to capture steps.
- For step-authoring tests, a valid gate URL is required before the CTAs enable
  (`synthetics-create-record-btn` / `synthetics-create-build-btn` are `:disabled="!isGateUrlValid"`).

## 4. Gotchas (so the Healer/Engineer don't rediscover them)

- **Route may not exist** (OSS build / flag off). Guard the file; a green test that navigates to
  `/synthetics` on a pure-OSS target will 404/redirect and can never pass.
- **Add Step always creates a `click` step** with an empty locator bundle; the first step must be
  changed to `navigate` (via `synthetics-journey-step-action-select`) before Continue will pass
  (`BrowserJourney.vue:983-993`, `validateJourneySteps`).
- **Locators commit on Enter or the `+` button, never on blur** — typing into
  `synthetics-journey-step-locator-override-input` without Enter leaves a "pending draft" that
  still blocks the save (`BrowserJourneyLocator.vue:183-224`). Press Enter before asserting validity.
- **Recording/replay/restore are extension-only** — don't write green tests for them; mark
  `test.fixme` with the reason "requires OpenObserve Recorder extension, not present in CI".
- **Save requires ≥1 location** — a save test without a selected location fails with
  `locationsRequired`, not a journey error. Select `synthetics-check-locations-option-${id}` first.
- **Unsaved-changes guard** — navigating away mid-edit opens `synthetics-create-unsaved-dialog`;
  tests that abandon the wizard must dismiss it (leave → `onConfirmLeave`).
- **Empty-state Add/Record buttons have no `data-test`** — use the always-present toolbar buttons
  (`synthetics-journey-add-step-btn`, `synthetics-journey-record-btn`).
