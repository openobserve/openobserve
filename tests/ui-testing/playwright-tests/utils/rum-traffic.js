// Shared RUM traffic generation for the sample fixture app.
// --------------------------------------------------------------------------
// Drives the deterministic interactions in fixtures/rum/cdn-sample/app.js so
// the SDK emits a known set of signals (custom action, info/error logs, an
// uncaught error, a resource fetch), then navigates to force a batch flush.
// Reused by the CDN, NPM and RUM-page data-flow specs so the generated event
// set stays identical across integration paths.

/**
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
  await page.locator('[data-test="nav-products-link"]').click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

module.exports = { driveRumSampleInteractions };
