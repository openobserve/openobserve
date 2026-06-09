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
  test("AI integration credentials should persist when tab is re-clicked", {
    tag: ['@bug-11682', '@P1', '@regression', '@datasourcesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify AI integration credentials persist on click (Bug #11682)');

    // Navigate to Data Sources (Ingestion) page
    await pm.dataPage.gotoDataPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated to Data Sources page');

    // Switch to Custom tab to reveal the AI Integration section
    const customTab = page.getByRole('tab', { name: /Custom/i });
    if (await customTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await customTab.click();
      await page.waitForTimeout(1000);
      testLogger.info('Switched to Custom tab');
    }

    // Find and click the AI Integration section
    const aiIntegrationTab = page.getByRole('tab', { name: /AI Integration/i });
    await expect(aiIntegrationTab, 'AI Integration tab should be visible').toBeVisible({ timeout: 5000 });
    testLogger.info('AI Integration tab found');

    await aiIntegrationTab.click();
    await page.waitForTimeout(1500);

    // Capture credential field count before re-click
    const credentialFields = page.locator(
      '[data-test*="credential"], [data-test*="api-key"], input[type="password"], [data-test*="ai-cred"]'
    );
    const credentialCountBefore = await credentialFields.count();
    testLogger.info(`Credential fields before re-click: ${credentialCountBefore}`);

    // Re-click the AI Integration tab — this was the bug trigger
    await aiIntegrationTab.click();
    await page.waitForTimeout(1500);

    // Verify the page still has content after re-click
    const pageContent = await page.locator('.q-page-container, main, .q-page')
      .first().textContent().catch(() => '');
    const contentLengthAfter = pageContent.trim().length;
    testLogger.info(`Page content length after re-click: ${contentLengthAfter}`);

    expect(contentLengthAfter,
      'Bug #11682: AI Integration panel should not go blank when re-clicking its tab'
    ).toBeGreaterThan(0);

    // Verify credentials didn't disappear
    const credentialCountAfter = await credentialFields.count();
    expect(credentialCountAfter,
      'Bug #11682: Credential fields should not disappear when re-clicking tab'
    ).toBe(credentialCountBefore);

    testLogger.info('PASSED: AI Integration content persists on tab re-click');
  });

  test.afterEach(async () => {
    testLogger.info('Data sources regression test completed');
  });
});
