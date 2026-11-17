const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { seedBuilt, buildFunnelSessions, runAppId } = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@bug-3072', '@P2', '@regression', '@rumRegression'];
const LINKS = [
  { name: 'Errors', path: 'errors', tab: 'errors', expectMounted: (perf) => perf.expectErrorsDashboardMounted() },
  { name: 'Vitals', path: 'web-vitals', tab: 'web_vitals', expectMounted: (perf) => perf.expectWebVitalsMounted() },
  { name: 'API', path: 'apis', tab: 'api', expectMounted: (perf) => perf.expectApiDashboardMounted() },
];

test.describe('RUM Performance sub-tab links stay on their tab (ENT#3072)', () => {
  test.describe.configure({ mode: 'parallel' });

  // The shell only re-routes once it has seen a RUM stream, so without one a broken link would still look right.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await seedBuilt(page, buildFunnelSessions(runAppId('perf-3072'), Date.now()));
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  for (const link of LINKS) {
    test(`a direct link to ${link.name} opens ${link.name}, not Overview`, { tag: TAGS }, async ({ page }) => {
      const pm = new PageManager(page);
      const perf = pm.rumPerformancePage;
      const addresses = perf.watchAddressChanges();

      await perf.gotoPerformancePath(link.path);
      await link.expectMounted(perf);
      await perf.expectActiveTab(link.tab);
      await perf.expectInactiveTab('overview');

      // The redirect came after the shell's own requests, so the page must settle before its address can be trusted.
      await pm.rumProductAnalyticsPage.waitForNetworkQuiet();
      await expect(page).toHaveURL(new RegExp(`/rum/performance/${link.path}(\\?|$)`));
      await perf.expectActiveTab(link.tab);
      expect(addresses.filter((url) => url.includes('/performance/overview')), 'the page must never pass through Overview').toEqual([]);
    });
  }
});
