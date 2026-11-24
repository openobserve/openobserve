// Switching org on a dashboard opened by id lands on the new org's dashboard list instead of reloading the old id there (#16808).

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { ORG, namespaceTablePanel, createDashboard, deleteCreatedDashboards } = require('../../utils/dashboard-auto-run-fixtures.js');

test.describe('Change Organisation on a dashboard opened by id (#16808)', {
  tag: ['@bug-16808', '@P2', '@regression', '@dashboardRegression', '@changeOrg'],
}, () => {
  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test("switching org lands on the new org's dashboard list without a not-found error, and Back skips the old id", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const orgName = `orgsw${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const newOrgId = await pm.createOrgPage.createOrg(orgName);
    expect(newOrgId, 'new org identifier').toBeTruthy();
    const dashboardId = await createDashboard(`org_switch_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, {
      panels: [namespaceTablePanel('p_org', 'org')],
    });

    // The old id reloaded in the new org is what answered 404 and raised the not-found toast.
    const oldIdInNewOrg = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && new URL(req.url()).pathname.includes(`/api/${newOrgId}/dashboards/${dashboardId}`)) {
        oldIdInNewOrg.push(req.url());
      }
    });

    await pm.dashboardAutoRun.openDashboard(ORG(), dashboardId, ['p_org']);
    const newOrgList = pm.dashboardList.waitForListResponse(newOrgId);
    await pm.homePage.selectOrgByIdentifier(orgName, newOrgId);

    await pm.dashboardList.expectListInOrg(newOrgId);
    // The switch reloads the current route before it lands on the list, so any old-id load is already sent once the list has answered.
    await newOrgList;
    expect(oldIdInNewOrg, 'the old dashboard id must not be loaded in the new org').toEqual([]);
    await pm.dashboardList.expectNoDashboardNotFoundToast();

    await pm.dashboardList.expectNoHistoryEntryForDashboard(dashboardId);
  });
});
