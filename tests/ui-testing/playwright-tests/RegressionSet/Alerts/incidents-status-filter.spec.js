const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("Incidents status filter", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  });

  // Shipped as Active/Resolved/All, not the issue's proposed Open/Acknowledged/
  // Resolved: "active" is the union of open and acknowledged (IncidentList.vue).
  test("the status tabs should default to Active and select one at a time", {
    tag: ['@bug-12611', '@P2', '@regression', '@incidentsRegression']
  }, async () => {
    await pm.incidentsPage.goto();

    await pm.incidentsPage.expectOnlyStatusSelected('active');
    await pm.incidentsPage.expectListUsable();

    for (const status of ['resolved', 'all', 'active']) {
      await pm.incidentsPage.clickStatusTab(status);
      await pm.incidentsPage.expectOnlyStatusSelected(status);
      await pm.incidentsPage.expectListUsable();
      testLogger.info(`Switched to "${status}" and the list still renders`);
    }
  });

  test("a status in the URL should win over the default", {
    tag: ['@bug-12611', '@P2', '@regression', '@incidentsRegression']
  }, async () => {
    await pm.incidentsPage.goto('resolved');
    await pm.incidentsPage.expectOnlyStatusSelected('resolved');
  });

  // Non-obvious and easy to regress: filterByStatus resets severityFilter to
  // "all", so the severity cards keep counting over the visible status scope.
  test("switching status should reset the severity facet", {
    tag: ['@bug-12611', '@P2', '@regression', '@incidentsRegression']
  }, async () => {
    await pm.incidentsPage.goto();

    await pm.incidentsPage.expectSeverityPressed('total');

    await pm.incidentsPage.clickSeverityTile('p1');
    await pm.incidentsPage.expectSeverityPressed('p1');
    await pm.incidentsPage.expectSeverityNotPressed('total');

    await pm.incidentsPage.clickStatusTab('resolved');

    await pm.incidentsPage.expectSeverityNotPressed('p1');
    await pm.incidentsPage.expectSeverityPressed('total');
  });
});
