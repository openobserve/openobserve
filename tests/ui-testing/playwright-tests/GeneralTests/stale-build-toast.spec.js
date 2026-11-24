// OSS#15401: after a redeploy, a stale tab that fails to load a route chunk must show the red new-version toast.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { StaleBuildPage } = require('../../pages/generalPages/staleBuildPage.js');

test.describe('Stale build detection', { tag: ['@generalTests', '@regression', '@P2'] }, () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('a missing route chunk after a redeploy shows the new-version toast (OSS#15401)', async ({ page }) => {
    const staleBuild = new StaleBuildPage(page);
    await staleBuild.expectNoNewVersionToast();

    let configReads = 0;
    // the unauthenticated bootstrap /config carries the build fingerprint the checker compares
    await page.route(/\/config(\?.*)?$/, async (route) => {
      configReads += 1;
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      await route.fulfill({ response, json: { ...body, commit_hash: 'feedfacecafe0000redeployed' } });
    });
    let chunk404s = 0;
    await page.route(/\/assets\/.+\.js(\?.*)?$/, (route) => {
      chunk404s += 1;
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
    });

    await staleBuild.openDashboardsFromMenu();

    await expect.poll(() => chunk404s, { message: 'the route chunk must be requested and fail' }).toBeGreaterThan(0);
    await expect.poll(() => configReads, { message: 'the checker must re-read /config to compare builds' }).toBeGreaterThan(0);
    await staleBuild.expectNewVersionToastShownOnce();

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
