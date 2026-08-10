const { test, expect } = require('@playwright/test');
const testLogger = require('./utils/test-logger.js');

/**
 * Auth-warm spec — mints a shared-auth artifact WITHOUT running the heavy
 * org-wide cleanup.
 *
 * The alpha1 barrier (pre_test_cleanup job) splits its Dex logins across multiple
 * users (ALPHA1_USER_INDEX). User 1 runs cleanup.spec.js (which also mints its
 * artifact via globalSetup); users 2..N have no cleanup to do, so they run THIS
 * spec instead. globalSetup already performed the Dex login and wrote
 * user<N>.json / cloud-config<N>.json before this test executes — all this test
 * does is confirm the session loads, so the job fails loudly if login didn't take.
 *
 * Runs with SKIP_INGESTION=true in the barrier (no per-shard ingestion here).
 */
test.describe('Alpha1 auth warm-up', () => {
  test('minted session is usable', {
    tag: ['@auth-warm', '@all']
  }, async ({ page, baseURL }) => {
    const userIndex = (process.env.ALPHA1_USER_INDEX || '1').trim();
    testLogger.info(`[alpha1] auth-warm: verifying minted session for user index ${userIndex}`);

    await page.goto(`${baseURL}/web/`, { timeout: 60000, waitUntil: 'domcontentloaded' });

    // If the saved session were invalid we'd be bounced to Dex/login here.
    const url = page.url();
    expect(url, `expected an authenticated app URL, got ${url}`).not.toContain('dex');
    expect(url, `expected an authenticated app URL, got ${url}`).not.toMatch(/\/web\/login$/);

    // Home menu item is only present once the SPA has an authenticated session.
    await expect(page.locator('[data-test="menu-link-\\/-item"]')).toBeVisible({ timeout: 30000 });
    testLogger.info(`[alpha1] auth-warm: session for user index ${userIndex} is valid`);
  });
});
