// Shared RUM traffic generation + network observation for the sample fixture app.
// --------------------------------------------------------------------------
// Drives the deterministic interactions in fixtures/rum/cdn-sample/app.js so
// the SDK emits a known set of signals (custom action, info/error logs, an
// uncaught error, a resource fetch), then navigates to force a batch flush.
// Also centralizes the request/response listeners the data-flow specs use to
// observe SDK beacons and CDN asset downloads, so the CDN, NPM and RUM-page
// specs share ONE implementation and stay in sync.
//
// NOTE: this module intentionally holds the fixture APP's selectors — the
// sample app is a committed test fixture, not the OpenObserve UI, so its
// selectors live here (one place) rather than in pages/ page objects, which
// model the product UI.

/**
 * Count RUM ingestion beacons by endpoint. Attach BEFORE any navigation.
 * Counts request INITIATIONS, not deliveries — in-flight fetches can be
 * net::ERR_ABORTED by a flush navigation, and when the instance sends no CORS
 * headers for the fixture origin the browser hides responses even for
 * delivered beacons. Delivery must therefore be verified against the streams
 * (see rum-stream-verify.js) while the app is still open.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} org organization identifier in the ingest URL
 * @returns {{rum: number, logs: number, replay: number}} live tally object
 */
function attachBeaconCounter(page, org) {
  const beacons = { rum: 0, logs: 0, replay: 0 };
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes(`/rum/v1/${org}/`)) return;
    if (url.includes('/replay')) beacons.replay += 1;
    else if (url.includes('/logs')) beacons.logs += 1;
    else if (url.includes('/rum')) beacons.rum += 1;
  });
  return beacons;
}

/**
 * Track every CDN asset the SDK pulls at runtime (main bundles + the lazy
 * recorder/profiler webpack chunks downloaded AFTER init). Attach BEFORE
 * navigation.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{assets: Array<{url: string, status: number}>,
 *            failures: Array<{url: string, error: string}>,
 *            chunkLoaded: (name: string) => boolean}}
 */
function attachCdnAssetTracker(page) {
  const assets = [];
  const failures = [];
  page.on('response', (res) => {
    if (!res.url().includes('browsersdk.openobserve.ai')) return;
    assets.push({ url: res.url(), status: res.status() });
  });
  page.on('requestfailed', (req) => {
    if (!req.url().includes('browsersdk.openobserve.ai')) return;
    const error = (req.failure() || {}).errorText;
    // ERR_ABORTED = cancelled by page lifecycle (navigation/close), not an
    // asset problem.
    if (error === 'net::ERR_ABORTED') return;
    failures.push({ url: req.url(), error });
  });
  const chunkLoaded = (name) =>
    assets.some((a) => a.url.includes(`/chunks/${name}-`) && a.status >= 200 && a.status < 300);
  return { assets, failures, chunkLoaded };
}

/**
 * Wait until the REAL SDK objects have replaced the async-loader queue stubs
 * (i.e. the bundle downloaded, parsed and init() ran). Explicit signal —
 * replaces waitForLoadState('networkidle'), which Playwright discourages and
 * which never settles reliably with streaming/WebSocket connections.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeoutMs=30000]
 */
async function waitForRumSdkReady(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () =>
      window.OO_RUM &&
      typeof window.OO_RUM.getInternalContext === 'function' &&
      window.OO_LOGS &&
      typeof window.OO_LOGS.logger === 'object',
    { timeout: timeoutMs },
  );
}

/**
 * Drive the deterministic fixture interactions, then navigate to flush.
 * @param {import('@playwright/test').Page} page a page already loaded on the fixture app
 */
async function driveRumSampleInteractions(page) {
  await page.locator('[data-test="rum-sample-track-action-btn"]').click();
  await page.locator('[data-test="rum-sample-log-info-btn"]').click();
  await page.locator('[data-test="rum-sample-log-error-btn"]').click();
  await page.locator('[data-test="rum-sample-throw-error-btn"]').click();
  await page.locator('[data-test="rum-sample-fetch-btn"]').click();
  // The fetch button downloads openobserve-rum-slim.js from the CDN to create
  // a resource-timing entry. Let it finish before navigating — otherwise the
  // navigation aborts it mid-flight (net::ERR_ABORTED noise, no resource event).
  await page
    .waitForResponse((r) => r.url().includes('openobserve-rum-slim'), { timeout: 15000 })
    .catch(() => {});

  // Navigating fires beforeunload/visibility flush of the SDK's batched beacons.
  // The products grid rendering is the explicit "navigation done" signal.
  await page.locator('[data-test="nav-products-link"]').click();
  await page.waitForSelector('[data-test="product-grid"]', { timeout: 15000 }).catch(() => {});
}

module.exports = {
  driveRumSampleInteractions,
  attachBeaconCounter,
  attachCdnAssetTracker,
  waitForRumSdkReady,
};
