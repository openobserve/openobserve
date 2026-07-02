/**
 * RUM Onboarding Snippets — End-to-End
 *
 * Verifies the Frontend Monitoring onboarding page renders correct, copy-ready
 * instrumentation snippets for BOTH integration paths (NPM install + SDK init),
 * with the real org identifier / ingestion site / insecureHTTP flag injected.
 *
 * Prerequisites:
 *   - OpenObserve ENTERPRISE build on ZO_BASE_URL (default http://localhost:5080)
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const SITE_HOST = BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const INSECURE = BASE.startsWith('http://');

test.describe('RUM Onboarding Snippets', { tag: '@enterprise' }, () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    // Ensure a token exists so the snippet block (v-if="rumToken") renders.
    await page.goto(`${BASE}?org_identifier=${ORG}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await getOrCreateRumToken(page);

    await page.goto(
      `${BASE}/web/ingestion/recommended/frontend-monitoring?org_identifier=${ORG}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(page.locator('[data-test="rumweb-title-text"]')).toBeVisible({ timeout: 15000 });
  });

  test('shows the NPM install command for both browser packages', {
    tag: ['@rum', '@onboarding', '@P1'],
  }, async ({ page }) => {
    // The first CopyContent block holds the npm install command.
    const npmBlock = page.locator('[data-test="rum-content-text"]').first();

    await expect(npmBlock).toContainText('npm i @openobserve/browser-rum @openobserve/browser-logs');
  });

  test('init snippet injects the current organization identifier', {
    tag: ['@rum', '@onboarding', '@P0'],
  }, async ({ page }) => {
    // The init-config block is the second CopyContent (after the npm command).
    const initBlock = page.locator('[data-test="rum-content-text"]').nth(1);

    await expect(initBlock).toContainText(`organizationIdentifier: '${ORG}'`);
  });

  test('init snippet injects the ingestion site host without protocol', {
    tag: ['@rum', '@onboarding', '@P1'],
  }, async ({ page }) => {
    const initBlock = page.locator('[data-test="rum-content-text"]').nth(1);

    await expect(initBlock).toContainText(`site: '${SITE_HOST}'`);
  });

  test('init snippet sets insecureHTTP to match the endpoint protocol', {
    tag: ['@rum', '@onboarding', '@P1'],
  }, async ({ page }) => {
    const initBlock = page.locator('[data-test="rum-content-text"]').nth(1);

    await expect(initBlock).toContainText(`insecureHTTP: ${INSECURE}`);
  });

  test('init snippet exposes a copy control', {
    tag: ['@rum', '@onboarding', '@P2'],
  }, async ({ page }) => {
    // Two copy buttons: npm command + init config.
    const copyButtons = page.locator('[data-test="rum-copy-btn"]');

    expect(await copyButtons.count()).toBeGreaterThanOrEqual(2);
    await expect(copyButtons.nth(1)).toBeVisible();
  });
});
