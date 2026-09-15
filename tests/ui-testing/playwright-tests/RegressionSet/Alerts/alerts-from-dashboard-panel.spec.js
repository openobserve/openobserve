const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const STREAM = 'e2e_automate';
// Spaces are the point: alert names reject them, so the title must survive the transform.
const PANEL_TITLE = 'CPU Capacity Panel';

test.describe("Alert from a dashboard panel", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let dashboard;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));
    dashboard = await pm.apiCleanup.createDashboardWithPanel(
      `e2e_9875_${Date.now()}`,
      PANEL_TITLE,
      STREAM,
    );
    testLogger.info(`Created dashboard ${dashboard.dashboardId}`);
  });

  test.afterEach(async () => {
    if (dashboard) {
      await pm.apiCleanup.deleteDashboard(dashboard.dashboardId, dashboard.folderId).catch((e) =>
        testLogger.warn(`Dashboard cleanup failed: ${e.message}`)
      );
      dashboard = undefined;
    }
  });

  test("the alert name generated from a panel title must carry no spaces", {
    tag: ['@bug-9875', '@P3', '@regression', '@alertsRegression', '@alertsRegressionPrefill']
  }, async () => {
    await pm.dashboardPanelActions.openDashboardById(dashboard.dashboardId, {
      folderId: dashboard.folderId,
    });
    await pm.dashboardPanelActions.openCreateAlertFromPanel(PANEL_TITLE);

    const alertName = await pm.alertsPage.getAlertNameValue();
    testLogger.info(`Alert name generated from panel "${PANEL_TITLE}": "${alertName}"`);

    expect(alertName,
      'Bug #9875: alert names reject spaces, so the panel title must be joined with underscores'
    ).not.toMatch(/\s/);

    expect(alertName,
      'the generated name must still identify the panel it came from'
    ).toBe('Alert_from_CPU_Capacity_Panel');

    testLogger.info('PASSED: panel-derived alert name is space-free (Bug #9875)');
  });
});
