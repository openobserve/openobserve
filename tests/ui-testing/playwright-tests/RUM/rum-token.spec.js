/**
 * RUM Token Lifecycle — End-to-End
 *
 * Verifies the RUM token creation/reset flow that instrumentation depends on:
 *   - the Ingestion → Frontend Monitoring page loads and offers a reset control
 *   - the token API returns a usable token
 *   - resetting the token produces a NEW, different token
 *
 * Prerequisites:
 *   - OpenObserve ENTERPRISE build on ZO_BASE_URL (default http://localhost:5080)
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getOrCreateRumToken, resetRumToken, getRumToken } = require('../utils/rum-token-api.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';

test.describe('RUM Token Lifecycle', { tag: '@enterprise' }, () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.goto(`${BASE}?org_identifier=${ORG}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test('Frontend Monitoring ingestion page exposes the RUM token reset control', {
    tag: ['@rum', '@token', '@P0'],
  }, async ({ page }) => {
    await page.goto(
      `${BASE}/web/ingestion/recommended/frontend-monitoring?org_identifier=${ORG}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await expect(page.locator('[data-test="ingestion-reset-token-btn"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test('token API returns a usable RUM token', {
    tag: ['@rum', '@token', '@P0'],
  }, async ({ page }) => {
    const token = await getOrCreateRumToken(page);

    expect(token, 'a RUM token should be returned').toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('resetting the token issues a new, different token', {
    tag: ['@rum', '@token', '@P1'],
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
