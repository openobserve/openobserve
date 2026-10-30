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

    // The control side: a form that named nothing would pass the character rule trivially.
    expect(alertName,
      'Precondition: opening the form from a panel must prefill a name'
    ).not.toBe('');

    // AddAlert.schema.ts rejects exactly this class, and the panel title carries spaces.
    expect(alertName,
      'Bug #9875: a panel-derived name must satisfy ALERT_NAME_UNSUPPORTED_CHARS, which rejects whitespace'
    ).not.toMatch(/[:#?\s'"%&]/);

    // Which provenance wins depends on whether useAutoName re-derives the name from the
    // form before it is read, so accept either — the character rule above is the bug.
    expect(alertName,
      'the generated name must still identify what it came from — the panel or its stream'
    ).toMatch(new RegExp(`${PANEL_TITLE.replace(/\s+/g, '_')}|${STREAM}`, 'i'));

    testLogger.info('PASSED: panel-derived alert name is space-free (Bug #9875)');
  });
});
