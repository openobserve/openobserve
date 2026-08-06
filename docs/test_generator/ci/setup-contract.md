# Test Setup Contract: Synthetics Extension Setup Dialog  (area: Synthetics)

## Streams / data the spec must establish

**No backend data is required for this feature.** The extension setup flow is a pure UI wizard
that renders checklist steps, toggles, and buttons. No stream ingestion, alert destinations,
folders, or API payloads are needed.

The following preconditions are the **only** data/setup required:

- **`[shared/read-only]` Auth session** — the user must be logged into an organization. The
  org's `zoConfig` must have `synthetics_enabled !== false` (the default is `undefined`, which
  passes the route guard). No `zoConfig.synthetics_recorder_extension_url` override required
  (the default CWS URL works fine for testing Step 1's button just opening a URL).

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Auth + base navigation:**
  ```js
  const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
  // in beforeEach:
  await navigateToBase(page);
  ```
  Reference: `tests/ui-testing/playwright-tests/Alerts/alerts-advanced.spec.js:30-31`

- **Navigate to the create browser test page:**
  ```js
  const { getOrgIdentifier } = require('../utils/cloud-auth.js');
  const BASE = process.env['ZO_BASE_URL'];
  await page.goto(`${BASE}/web/synthetics/add?type=browser&org_identifier=${getOrgIdentifier()}`);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  ```
  The route is `/web/synthetics/add?type=browser` — defined in
  `web/src/composables/shared/useEnterpriseRoutes.ts:189` as `synthetics-add`.
  The `type=browser` query param routes to `CreateBrowserTest.vue`.

- **Page manager setup:**
  ```js
  const PageManager = require('../../pages/page-manager.js');
  const pm = new PageManager(page);
  ```
  No Synthetics-specific page object exists yet; use raw Playwright locators with the
  `data-test` selectors documented in the design doc.

- **Timing / stabilization:**
  ```js
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  ```
  The page needs full hydration because `CreateBrowserTest.vue` fetches locations, folders,
  and destinations on mount (lines 322–324). The `networkidle` wait ensures those parallel
  fetches complete before interacting with the gate phase.

## Preconditions / toggles

- **Extension state:** In Playwright's browser context, no Chrome extension is installed.
  `useSyntheticsRecorder.detectExtension()` will always return `false` because the
  `oo-bridge` content script does not exist in a test page. This is the **default path**
  and the primary one tested — clicking "Record" from the gate SHOULD transition to the
  "extension-setup" phase.
- **Route guard:** Ensure `synthetics_enabled` is not `false` in `/config`. If it is, the
  route guard redirects to `/` (see `syntheticsRouteGuard` at
  `web/src/composables/shared/useEnterpriseRoutes.ts:23-29`). The default OSS setup has this
  `undefined`, which passes.
- **No org-switch needed:** The test runs in the same org the auth warmed up.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The extension can never be "connected" in an E2E test** — there is no Chrome extension in
  Playwright's Chromium. Tests for the "connected" state (Step 3 green checkmark, "Open
  Recorder" button enabled) must be written as **mock/integration tests** or as vitest
  component tests (see `web/src/components/synthetics/ExtensionSetupChecklist.spec.ts`).
  E2E tests can only verify:
  - The checklist renders with all 3 steps
  - The incognito switch toggles and Step 3 visually changes (opacity-60 when
    incognito not done)
  - "Open Recorder" stays disabled until incognitoDone=true
  - "Skip" navigates to the editor phase
  - The dialog-variant (from BrowserJourney) opens when Record/Replay are clicked
    without the extension ready
- **Gate validation blocks Record/Build:** The URL input must contain a valid-looking URL
  (schema-aware zod check). Use `https://example.com` as the test URL.
- **`createBrowserTest` route may be guarded by feature flag:** On enterprise, check if
  route is accessible before running. On OSS, it should be always reachable.
- **The page fetches on mount** — `fetchFolders`, `fetchLocations`, `fetchDestinations`
  all fire in `onMounted`. A `networkidle` wait ensures these resolve before interacting.
