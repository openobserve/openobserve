// A dashboard pinned to Home applies a changed multi-select variable on Refresh, with quoted IN values (#16699, fixed by #16779).

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  ORG,
  NAMESPACE_FIELD,
  STREAM,
  namespaceTablePanel,
  createDashboard,
  deleteDashboard,
  inListValues,
  readHomePin,
  setHomePin,
  restoreHomePin,
} = require('../../utils/dashboard-auto-run-fixtures.js');

test.describe('Home pinned dashboard variables (#16699)', {
  tag: ['@bug-16699', '@P1', '@regression', '@landingRegression', '@homePinnedDashboard'],
}, () => {
  test('a multi-select variable change applies on Refresh with quoted IN values', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(180000);
    const pm = new PageManager(page);
    const autoRun = pm.dashboardAutoRun;
    const title = `home_pin_vars_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;

    await navigateToBase(page);
    await pm.ingestionPage.ingestion();
    // Auto Run would apply the change without Refresh, so it is pinned off to test the Refresh path.
    await autoRun.pinAutoQuery(false);

    const previousPin = await readHomePin();
    let dashboardId;
    try {
      dashboardId = await createDashboard(title, {
        panels: [namespaceTablePanel('p_home', 'home', `${NAMESPACE_FIELD} IN ($ns)`)],
        variables: [{
          type: 'query_values',
          name: 'ns',
          label: 'ns',
          query_data: { stream_type: 'logs', stream: STREAM, field: NAMESPACE_FIELD, max_record_size: null, filter: [] },
          // A scalar saved on a multi-select is what Home used to put into SQL unquoted.
          value: 'ziox',
          options: [],
          multiSelect: true,
          hideOnDashboard: false,
          selectAllValueForMultiSelect: 'first',
          customMultiSelectValue: [],
          escapeSingleQuotes: true,
        }],
      });
      await setHomePin({ dashboardId, folderId: 'default', label: title });

      autoRun.trackRuns();
      await pm.homePage.loadHome(ORG());
      await pm.homePage.openHomeTab(`dash:default:${dashboardId}`);

      await autoRun.expectPanelRows('p_home', { shows: ['ziox'], hides: ['velero'] });
      const base = await autoRun.settledRunCount('home');
      expect(inListValues(autoRun.runsOf('home')[base - 1]), 'saved scalar is quoted as a one-item list').toEqual(["'ziox'"]);

      await autoRun.openVariableDropdown('ns');
      await autoRun.toggleVariableOptions('ns', ['velero']);
      await autoRun.closeVariableDropdownWithEscape('ns');
      await pm.homePage.clickPinnedDashboardRefresh();

      await autoRun.waitForRuns('home', base + 1);
      expect(inListValues(autoRun.runsOf('home')[base]), 'Refresh runs the panel with both selected values').toEqual(["'velero'", "'ziox'"]);
      await autoRun.expectPanelRows('p_home', { shows: ['ziox', 'velero'] });
    } finally {
      await deleteDashboard(dashboardId);
      await restoreHomePin(previousPin);
    }
  });
});
