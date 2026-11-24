// Go To Logs on an aggregate panel opens the log lines behind it, keeping its WHERE, not the aggregate query (#16395).

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
import { ingestion } from '../../Dashboards/utils/dashIngestion.js';
const testLogger = require('../../utils/test-logger.js');
const {
  NAMESPACE_FIELD,
  STREAM,
  ORG,
  namespaceTablePanel,
  createDashboard,
  deleteCreatedDashboards,
  decodeUrlSafeBase64,
} = require('../../utils/dashboard-auto-run-fixtures.js');

test.describe('Panel Go To Logs (#16395)', {
  tag: ['@bug-16395', '@P1', '@regression', '@dashboardRegression', '@goToLogs'],
}, () => {
  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test("Go To Logs on an aggregate table panel opens its WHERE as log lines, not the panel's counts", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    const pm = new PageManager(page);
    const where = `${NAMESPACE_FIELD} = 'ziox'`;
    const dashboardId = await createDashboard(`go_to_logs_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, {
      panels: [namespaceTablePanel('p_gtl', 'gtl', where)],
    });
    await pm.dashboardAutoRun.openDashboard(ORG(), dashboardId, ['p_gtl']);
    await pm.dashboardAutoRun.expectPanelRows('p_gtl', { shows: ['ziox'], hides: ['velero'] });

    const logsTab = await pm.dashboardPanelEdit.goToLogsInNewTab('p_gtl');
    const params = new URL(logsTab.url()).searchParams;
    expect(decodeUrlSafeBase64(params.get('query')), 'Logs gets the log lines behind the panel, filtered by its WHERE').toBe(
      `SELECT * FROM "${STREAM}" WHERE ${where} ORDER BY _timestamp DESC`,
    );
    expect(params.get('show_histogram')).toBe('true');

    const logs = new PageManager(logsTab).logsPage;
    await logs.expectLogTableColumnSourceToContainText('ziox');
    for (const row of await logs.getResultRowTexts()) {
      expect(row).toContain('ziox');
    }
    await logsTab.close();
  });
});
