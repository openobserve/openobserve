/**
 * Data Sources Regression Bug Tests
 *
 * Bug fixes for Data Sources page functionality:
 * - #11682: On clicking on AI integration the credentials disappear
 * - #11534: AI Frameworks & Agent datasources
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("Data Sources Regression Bug Fixes", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
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
    await pm.dataPage.navigateToAIIntegrations(process.env.ZO_BASE_URL, process.env.ORGNAME);
    testLogger.info('Navigated to AI Integrations');

    // Click the first available AI integration item to view its detail
    await pm.dataPage.clickFirstAIIntegration();
    testLogger.info('Clicked first AI integration item');

    // Verify detail content rendered (any of the three rendering paths:
    // AIRichSetupCard, AIIntegrationCard, or the legacy CopyContent fallback).
    // The "Select an integration" placeholder must NOT be visible, and the
    // detail pane must contain text.
    await expect(pm.dataPage.aiIntegrationPlaceholder,
      'Bug #11682: placeholder should not show after clicking an integration'
    ).not.toBeVisible({ timeout: 5000 });

    const contentBefore = (await pm.dataPage.aiIntegrationDetailPane.textContent())?.trim() || '';
    testLogger.info(`Detail content length before re-click: ${contentBefore.length}`);

    expect(contentBefore.length,
      'Bug #11682: AI Integration detail should show content on first click'
    ).toBeGreaterThan(0);

    // Re-click the same integration — this was the bug trigger (#11682)
    await pm.dataPage.aiIntegrationFirstItem.click();
    await page.waitForTimeout(1500);

    // Verify content is still present after re-click (not blank)
    await expect(pm.dataPage.aiIntegrationPlaceholder,
      'Bug #11682: placeholder should not show after re-click'
    ).not.toBeVisible({ timeout: 5000 });

    const contentAfter = (await pm.dataPage.aiIntegrationDetailPane.textContent())?.trim() || '';
    testLogger.info(`Detail content length after re-click: ${contentAfter.length}`);

    expect(contentAfter.length,
      'Bug #11682: AI Integration content should not disappear when re-clicking'
    ).toBeGreaterThan(0);

    testLogger.info('PASSED: AI Integration content persists on re-click');
  });

  // Asserts category slugs, not tab labels: labels go through i18n, slugs are in the route.
  test("AI datasources should expose every integration category with browsable docs", {
    tag: ['@bug-11534', '@P2', '@regression', '@datasourcesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: AI datasource categories and docs (Feature #11534)');

    await pm.dataPage.navigateToAIIntegrations(process.env.ZO_BASE_URL, process.env.ORGNAME);

    const CATEGORIES = ['frameworks', 'model-providers', 'gateways', 'no-code', 'analytics', 'tools'];
    for (const slug of CATEGORIES) {
      await pm.dataPage.expectAiCategoryVisible(slug);
    }
    testLogger.info(`All ${CATEGORIES.length} AI categories present`);

    // Frameworks is the category the issue asked for, so it gets the real assertions.
    await pm.dataPage.openAiCategory('frameworks');
    const itemCount = await pm.dataPage.expectAiIntegrationsListed(1);
    testLogger.info(`Frameworks lists ${itemCount} integrations`);

    await pm.dataPage.getAiIntegrationItems().first().click();
    const docs = await pm.dataPage.verifyAIDetailRendered();
    testLogger.info(`Framework doc pane rendered ${docs.length} chars`);

    testLogger.info('✓ PASSED: AI datasource categories browsable with docs (#11534)');
  });

  test.afterEach(async () => {
    testLogger.info('Data sources regression test completed');
  });
});
