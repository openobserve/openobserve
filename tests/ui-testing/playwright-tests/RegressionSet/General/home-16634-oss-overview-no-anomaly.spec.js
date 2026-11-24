// Home Overview on the OSS build must not call the enterprise-only anomaly_detection route, which signed the user out (#16634, fixed by #16648).

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ORG } = require('../../utils/dashboard-auto-run-fixtures.js');

test.describe('Home Overview on the OSS build (#16634)', {
  tag: ['@bug-16634', '@P1', '@regression', '@landingRegression', '@homeOverview'],
}, () => {
  test('Overview sends no anomaly_detection request and the user stays signed in', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pm = new PageManager(page);
    const buildType = await pm.statusPagesPage.detectBuildType(ORG());
    test.skip(buildType !== 'opensource', `OSS build only: the ${buildType} build registers the anomaly_detection routes, so Overview calling them is correct there`);

    const anomalyRequests = [];
    page.on('request', (req) => {
      if (/\/api\/[^/]+\/anomaly_detection/.test(new URL(req.url()).pathname)) anomalyRequests.push(req.url());
    });
    const historyAnswered = pm.homePage.waitForOverviewHistory(ORG());

    await navigateToBase(page);
    await pm.homePage.openHomeTab('overview');
    expect((await historyAnswered).status(), 'Overview recent-events request').toBeLessThan(400);

    await expect(pm.homePage.homeOverviewPanel).toBeVisible();
    expect(anomalyRequests, 'OSS Overview must not call the unregistered anomaly_detection route').toEqual([]);
    await expect(page).not.toHaveURL(/\/login/);
    const historyAfterReload = pm.homePage.waitForOverviewHistory(ORG());
    await pm.homePage.loadHome(ORG());
    expect((await historyAfterReload).status(), 'Overview recent-events request after a reload').toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login/);
    expect(anomalyRequests).toEqual([]);
  });
});
