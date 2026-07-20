/**
 * RUM Token Lifecycle — End-to-End
 *
 * Verifies the RUM token creation/reset flow that instrumentation depends on:
 *   - the Ingestion → Frontend Monitoring page loads and offers a reset control
 *   - resetting the token produces a NEW, different token that subsequent
 *     reads return (create/reset via POST is not covered by the API suite;
 *     the plain GET-returns-a-token case IS — see
 *     tests/api-testing/tests/rum/test_rum.py — so it is not repeated here)
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080); the
 *     rumtoken routes are part of the standard (OSS) router.
 *
 * NOTE: this spec RESETS the org's RUM token, which invalidates in-flight SDK
 * beacons of any concurrently running dataflow spec — CI runs it in its own
 * isolated shard (see .github/workflows/playwright.yml, "RUM-Token").
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrCreateRumToken, resetRumToken, getRumToken } = require('../utils/rum-token-api.js');

test.describe('RUM Token Lifecycle', () => {
  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('Frontend Monitoring ingestion page exposes the RUM token reset control', {
    tag: ['@rum', '@rumToken', '@P0'],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.rumIngestionPage.gotoFrontendMonitoring();
    await pm.rumIngestionPage.expectResetTokenButtonVisible();
  });

  test('resetting the token issues a new, different token', {
    tag: ['@rum', '@rumToken', '@P1'],
  }, async ({ page }) => {
    const before = await getOrCreateRumToken(page);

    const after = await resetRumToken(page);

    expect(after, 'reset should return a token').toBeTruthy();
    expect(after).not.toBe(before);

    // The freshly reset token is what a subsequent read returns.
    const current = await getRumToken(page);
    expect(current).toBe(after);
  });
});
