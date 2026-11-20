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

    const visited = [];
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(frame.url()); });
    // One click, released at once: a retry or a wait for /logs lets the navigation finish before the late write, and the race never happens.
    await pm.tracesPage.clickLogsMenuItem();
    await hold.release();

    await page.waitForURL((url) => isLogsPath(url.href), { timeout: 15000 });
    // release() returns once Traces has every held response, so a late write is already queued; 3 s with no route change means none came.
    await expect(page.waitForURL((url) => !isLogsPath(url.href), { timeout: 3000 }), 'the late Traces write must not take the user back').rejects.toThrow();
    const firstLogs = visited.findIndex(isLogsPath);
    expect(firstLogs, 'the Logs navigation must be recorded').toBeGreaterThanOrEqual(0);
    const afterLogs = visited.slice(firstLogs);
    expect(afterLogs.filter((url) => !isLogsPath(url)), 'no route change away from Logs once Logs was reached').toEqual([]);
    await expect(page, 'Traces query state must not leak into the Logs URL').not.toHaveURL(/[?&]stream_type=traces/);
  });
});
