# Test Setup Contract: RUM SDK O2 Global Rename & Version Bump  (area: RUM)

Spec target: `tests/ui-testing/playwright-tests/RUM/rum-onboarding-snippets.spec.js`
(and page object `tests/ui-testing/pages/rumPages/rumIngestionPage.js`).

This feature is **read-only snippet rendering** — the card does not ingest, mutate, or detect any
data for the snippets being asserted. The single precondition is that **a RUM token exists** so the
card body mounts (`v-if="rumToken"`). No streams, no ingestion, no fixture server are needed for the
snippet assertions below. (The `_rumdata` detection step is `completeOn: "detect"` and optional; it is
NOT exercised by this spec — it belongs to `rum-cdn-dataflow.spec.js` / `rum-page-dataflow.spec.js`.)

## Streams / data the spec must establish

- **`none`** — this spec asserts on rendered code text only. Do NOT ingest any stream or run the
  fixture server; it adds flakiness with zero coverage value here.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **RUM token (the only precondition)** — call `await getOrCreateRumToken(page)` in `beforeEach`,
  exactly as the existing spec does:
  - Helper: `tests/ui-testing/playwright-tests/utils/rum-token-api.js` → `getOrCreateRumToken(page)`
    (GET `/api/{org}/rumtoken`, then POST `/api/{org}/rumtoken` if missing).
  - Reference usage: `tests/ui-testing/playwright-tests/RUM/rum-onboarding-snippets.spec.js:31`.
  - Auth/org: resolved by `rum-env.js` — `ORGNAME` (default `default`), `ZO_BASE_URL`
    (default `http://localhost:5080`), credentials `ZO_RUM_TEST_EMAIL/ZO_RUM_TEST_PASSWORD` (fallback
    `ZO_ROOT_USER_EMAIL/ZO_ROOT_USER_PASSWORD`). `ZO_ALLOW_INSECURE_HTTP=true` required only for
    non-loopback http endpoints.
- **Navigation + readiness** — `await pm.rumIngestionPage.gotoFrontendMonitoring()` then
  `await pm.rumIngestionPage.expectPageLoaded()` (waits for `[data-test="rum-web-setup-card"]`
  visible — this is BOTH the navigation and the "token exists" readiness gate).
  Reference: `rum-onboarding-snippets.spec.js:33-34`; page object `rumIngestionPage.js:24-34`.

## Preconditions / toggles

- Default variant is **NPM** (`variantSel` starts empty → `step.variants[0].id` = `npm`), so the two
  `[data-test="ai-code"]` blocks are, in DOM order: install(NPM command) then init(NPM snippet).
  The existing page object relies on this: `contentBlocks.first()` = npm install, `.nth(1)` = init.
- To reach the **CDN** variant (the headline rename/version behavior), the new test must click the CDN
  toggle. Add a page-object helper, e.g.:
  - `this.variantCdn = page.locator('[data-test="ai-variant-cdn"]').first()`
  - and a `selectCdnVariant()` that clicks it. Note `ai-variant-cdn` matches **2** elements (install +
    init step each render a variant toggle); `.first()` is safe because install and init share
    `variantGroup: "pkg"`, so clicking either switches both.

## Assertion contract (what the CDN test should verify)

- Install CDN block (`contentBlocks.first()` after switching) contains, and old tokens do NOT:
  - `O2_RUM`, `O2_LOGS` (globals) — from `rum.ts:161-162`.
  - `https://browsersdk.openobserve.ai/0.4.3/openobserve-rum.js` and `.../openobserve-logs.js` — from
    `RUM_SDK_VERSION = "0.4.3"` (`rum.ts:33`) + `cdnUrl()` (`rum.ts:36`).
  - NOT contain `OO_RUM`, `OO_LOGS`, or `0.3.4`.
- Init CDN block (`contentBlocks.nth(1)` after switching) contains `O2_RUM.onReady` / `O2_LOGS.onReady`
  — from `rum.ts:168-176`.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **Token is NOT masked on screen.** `maskText()` is identity (`web/src/utils/formatters.ts:243-245`),
  so `code-masked === code-raw` and the token renders in plaintext. Do NOT assert the token is hidden;
  the `ai-code-reveal-btn` exists but is a no-op today.
- **Org/site/insecureHTTP are never masked** (only `clientToken` would be), so the existing
  `organizationIdentifier:` / `site:` / `insecureHTTP:` assertions pass even in the "masked" state.
- **`ai-variant-cdn` is ambiguous (2 matches)** — always `.first()` or scope by `ai-step-install`.
- **Page load == card present.** `expectPageLoaded()` waiting on `rum-web-setup-card` already
  guarantees the token round-trip happened; do not add a separate token wait.
- **Version is a derived constant, not a literal in the DOM** beyond the URL. Assert on the full
  `0.4.3` bundle URL (or a `/\d+\.\d+\.\d+/` semver in the URL), not on the standalone string `0.4.3`
  which only appears in the CDN install *note* (`rumCdnInstallNote` renders `v{version}`).
- **Do not run the CDN fixture server** (`tests/ui-testing/fixtures/rum/serve.js`) for this spec — the
  snippet card is pure static text; the fixture server is for the dataflow specs that actually load the
  SDK bundles and emit RUM events.
