/**
 * Data Sources Regression Bug Tests
 *
 * Bug fixes for Data Sources page functionality:
 * - #11682: On clicking on AI integration the credentials disappear
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');

test.describe("Data Sources Regression Bug Fixes", () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    testLogger.info('Data sources regression test setup completed');
  });

  // ==========================================================================
  // Bug #11682: On clicking on AI integration the credentials disappear
  // https://github.com/openobserve/openobserve/issues/11682
  // ==========================================================================
  test("AI integration content should persist when integration is re-clicked", {
    tag: ['@bug-11682', '@P1', '@regression', '@datasourcesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify AI integration content persists on re-click (Bug #11682)');

    // Navigate to Data Sources → AI Integrations.
    // The empty child redirect auto-selects the first integration so the detail
    // pane is already populated — no click needed for the initial render.
    const aiUrl = `${process.env.ZO_BASE_URL || 'http://localhost:5080'}/web/ingestion/ai-integrations?org_identifier=${process.env.ORGNAME || 'default'}`;
    await page.goto(aiUrl, { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    testLogger.info('Navigated to AI Integrations');

    // Click the first available AI integration item to view its detail
    const firstIntegration = page.locator('[data-test^="ai-integrations-item-"]').first();
    await expect(firstIntegration, 'At least one AI integration should be visible').toBeVisible({ timeout: 5000 });
    await firstIntegration.click();
    await page.waitForTimeout(1500);
    testLogger.info('Clicked first AI integration item');

    // Verify detail content rendered (any of the three rendering paths:
    // AIRichSetupCard, AIIntegrationCard, or the legacy CopyContent fallback).
    // The "Select an integration" placeholder must NOT be visible, and the
    // detail pane (.card-container) must contain text.
    const placeholder = page.getByText('Select an integration to view details.');
    await expect(placeholder, 'Bug #11682: placeholder should not show after clicking an integration').not.toBeVisible({ timeout: 5000 });

    const detailPane = page.locator('.card-container');
    const contentBefore = (await detailPane.textContent())?.trim() || '';
    testLogger.info(`Detail content length before re-click: ${contentBefore.length}`);

    expect(contentBefore.length,
      'Bug #11682: AI Integration detail should show content on first click'
    ).toBeGreaterThan(0);

    // Re-click the same integration — this was the bug trigger (#11682)
    await firstIntegration.click();
    await page.waitForTimeout(1500);

    // Verify content is still present after re-click (not blank)
    await expect(placeholder, 'Bug #11682: placeholder should not show after re-click').not.toBeVisible({ timeout: 5000 });

    const contentAfter = (await detailPane.textContent())?.trim() || '';
    testLogger.info(`Detail content length after re-click: ${contentAfter.length}`);

    expect(contentAfter.length,
      'Bug #11682: AI Integration content should not disappear when re-clicking'
    ).toBeGreaterThan(0);

    testLogger.info('PASSED: AI Integration content persists on re-click');
  });

  test.afterEach(async () => {
    testLogger.info('Data sources regression test completed');
  });
});
