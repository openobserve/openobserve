// A Date variable substitutes its date in the variable's own output format, and a per-use ${day:<format>} overrides it (#16191).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  namespaceTablePanel,
  createDashboard,
  deleteCreatedDashboards,
  trackPanelRuns,
} = require('../../utils/dashboard-auto-run-fixtures.js');

const DAY = '2026-11-05';

test.describe('Dashboard Date variable output formats (#16191)', () => {
  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test('a dmy Date variable reaches the panel SQL as DD/MM/YYYY, and ${day:mdy} as MM/DD/YYYY', {
    tag: ['@bug-16191', '@P2', '@regression', '@dashboardRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pm = new PageManager(page);
    const runs = trackPanelRuns(page);
    // Inequalities keep the query valid and its rows intact while both substituted values stay visible in the SQL.
    const panel = namespaceTablePanel('Panel_16191', 'day16191', "kubernetes_namespace_name != '$day' AND kubernetes_namespace_name != '${day:mdy}'");
    const dashboardId = await createDashboard(`e2e_16191_${Date.now()}_${testInfo.repeatEachIndex}`, {
      panels: [panel],
      variables: [{ type: 'date', name: 'day', label: 'day', value: DAY, dateFormat: 'dmy', options: [], hideOnDashboard: false }],
    });

    await pm.dashboardPanelActions.openDashboardById(dashboardId);
    await expect.poll(() => runs.of('day16191').length, { timeout: 30000, message: 'Precondition: the panel must run' }).toBeGreaterThan(0);
    const sql = runs.of('day16191').at(-1);
    testLogger.info('Panel SQL', { sql });
    expect(sql, 'the variable\'s own dmy format').toContain("!= '05/11/2026'");
    expect(sql, 'the per-use mdy override').toContain("!= '11/05/2026'");
    expect(sql, 'no raw placeholder may reach the query').not.toContain('$day');
    testLogger.testEnd(testInfo.title, 'passed');
  });
});
