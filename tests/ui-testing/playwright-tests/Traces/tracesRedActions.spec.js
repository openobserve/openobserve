// tracesRedActions.spec.js — Create alert and Add to dashboard from the Traces RED charts and the ≡ menu.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

const RED_TITLE_PREFIXES = ['Rate · ', 'Errors · ', 'Duration · '];

test.describe('Traces RED actions', () => {
  let pm;

  // The Errors seed query needs at least one error span in the window.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      await ingestTraces(page, 6, { forceScenario: 'error' });
      await ingestTraces(page, 10, { forceScenario: 'success' });
    } catch (e) {
      testLogger.warn('RED actions trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  async function searchAndShowCharts() {
    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    expect(await pm.tracesPage.hasTraceResults(), 'Trace results must be available').toBeTruthy();
    expect(await pm.tracesPage.ensureMetricsDashboardVisible(), 'RED charts must show').toBeTruthy();
    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered, `Panels rendered: ${rendered.join(', ')}`).toContain('Errors');
  }

  test('Errors ⋮ → Create alert opens the alert form with a traces HAVING query and a ≥ 1 row trigger', {
    tag: ['@tracesRedActions', '@traces', '@P0', '@all'],
  }, async ({ page }) => {
    await searchAndShowCharts();

    await pm.tracesPage.createAlertFromChartMenu('Errors');

    await pm.createAlertFromSourceDialog.expectDialogVisible();
    const preview = pm.createAlertFromSourceDialog.queryPreview;
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview).toContainText(/HAVING/i);
    await expect(preview).toContainText("span_status = 'ERROR'");

    await pm.createAlertFromSourceDialog.clickContinue();
    await pm.tracesPage.expectAlertFormPrefilledFromTraces();
  });

  test('≡ → Add RED charts to dashboard adds Rate, Errors and Duration panels', {
    tag: ['@tracesRedActions', '@traces', '@P0', '@all'],
  }, async ({ page }) => {
    const dashboardTitle = `traces_red_${Date.now()}`;
    const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithPanel(
      dashboardTitle,
      'seed',
      'e2e_automate',
    );

    try {
      await searchAndShowCharts();

      await pm.tracesPage.clickAddRedChartsToDashboard();
      await pm.tracesPage.expectAddToDashboardPanels(3);
      await pm.tracesPage.selectDashboardInAddDialog(dashboardTitle);
      await pm.tracesPage.confirmAddToDashboard();

      await expect(page).toHaveURL(new RegExp(`dashboard=${dashboardId}`), { timeout: 30000 });
      for (const prefix of RED_TITLE_PREFIXES) {
        await expect(page.getByText(prefix, { exact: false }).first()).toBeVisible({ timeout: 30000 });
      }
    } finally {
      await pm.apiCleanup.deleteDashboard(dashboardId, folderId);
    }
  });
});
