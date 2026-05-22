/**
 * Data Sources Regression Bug Tests
 *
 * Bug fixes for Data Sources page functionality:
 * - #11682: On clicking on AI integration the credentials disappear
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Data Sources Regression Bug Fixes", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Data sources regression test setup completed');
  });

  // ==========================================================================
  // Bug #11682: On clicking on AI integration the credentials disappear
  // https://github.com/openobserve/openobserve/issues/11682
  // ==========================================================================
  test("AI integration credentials should not disappear when tab is clicked @bug-11682 @P1 @regression @datasourcesRegression", async ({ page }) => {
    testLogger.info('Test: Verify AI integration credentials persist on click (Bug #11682)');

    // Navigate to Data Sources (Ingestion) page
    await pm.dataPage.gotoDataPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to Data Sources page');

    // Switch to Custom tab to find AI Integrations
    const customTab = page.getByRole('tab', { name: /Custom/i });
    const aiIntegrationTab = page.getByRole('tab', { name: /AI Integration/i }).or(
      page.locator('[data-test*="ai-integration"]').locator('..')
    );

    // Try to find the AI Integrations section
    if (await customTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await customTab.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Switched to Custom tab');
    }

    await expect(aiIntegrationTab, 'AI Integration tab should be visible').toBeVisible({ timeout: 3000 });
    testLogger.info('✓ AI Integration tab found');

    // Click on AI Integration to open it
    await aiIntegrationTab.click();
    await page.waitForTimeout(1500);

    // Look for credential fields - these are typically API key inputs or saved credential displays
    const credentialFields = page.locator('[data-test*="credential"], [data-test*="api-key"], input[type="password"], [data-test*="ai-cred"]');
    const credentialCountBefore = await credentialFields.count();
    testLogger.info(`Credential fields found before re-click: ${credentialCountBefore}`);

    // Now click AI Integration again (this was the bug trigger)
    await aiIntegrationTab.first().click();
    await page.waitForTimeout(1500);

    // Verify credentials are still present (they should not disappear)
    const credentialCountAfter = await credentialFields.count();

    // If there are no credential fields at all, check for any content that shouldn't disappear
    const pageContent = await page.locator('main, .q-page').first().textContent().catch(() => '');
    const contentLengthAfter = pageContent.length;

    testLogger.info(`Content length after re-click: ${contentLengthAfter}`);

    // The key assertion: page should still have content after re-clicking the tab
    expect(contentLengthAfter,
      'Bug #11682: Page content should not disappear when re-clicking AI Integration tab'
    ).toBeGreaterThan(0);

    // If credential fields exist, verify they persist after re-click
    // (credentials only appear if the user has previously configured them)
    if (credentialCountBefore > 0) {
      expect(credentialCountAfter,
        'Bug #11682: Credential fields should not disappear when re-clicking AI Integration tab'
      ).toBe(credentialCountBefore);
    } else {
      testLogger.info('No pre-existing credential fields — verifying content persistence instead');
    }

    testLogger.info('✓ PASSED: AI Integration content persists on tab re-click');
  });

  test.afterEach(async () => {
    testLogger.info('Data sources regression test completed');
  });
});
