// Leaving Traces while its stream list is still loading reaches the clicked page; the late Traces URL write must not cancel it (#15543, fixed by #16529).

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const isLogsPath = (url) => new URL(url).pathname.endsWith('/logs');

test.describe('Leaving Traces mid-load (#15543)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('clicking Logs while Traces still loads lands on Logs and stays there after Traces finishes', {
    tag: ['@bug-15543', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const hold = await pm.tracesPage.holdStreamResponses();
    await pm.tracesPage.navigateToTraces();
    await expect.poll(() => hold.held.length, { timeout: 15000, message: 'Precondition: Traces must be waiting on its stream list' }).toBeGreaterThan(0);

    await pm.tracesPage.clickLogsMenuItem();
    await hold.release();

    await page.waitForURL((url) => isLogsPath(url.href), { timeout: 15000 });
    // The late write lands a moment after the held responses resolve, so the route must still be Logs once Traces has had time to finish.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await expect.poll(() => isLogsPath(page.url()), { timeout: 5000, intervals: [1000, 1000, 1000, 1000, 1000], message: 'the late Traces write must not take the user back' }).toBe(true);
    await expect(page, 'Traces query state must not leak into the Logs URL').not.toHaveURL(/[?&]stream_type=traces/);
  });
});
