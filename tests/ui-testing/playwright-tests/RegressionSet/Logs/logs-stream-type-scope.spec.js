const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const LOGS_STREAM = 'e2e_automate';

test.describe("Logs explorer stream type scoping", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("the metrics stream picker should not offer logs streams", {
    tag: ['@bug-10059', '@P1', '@regression', '@logsRegression']
  }, async () => {
    await pm.logsPage.openExplorerForStreamType('logs');
    const logsOptions = await pm.logsPage.listStreamOptionValues(LOGS_STREAM);
    expect(logsOptions, `${LOGS_STREAM} must be offered under its own type`).toContain(LOGS_STREAM);

    await pm.logsPage.openExplorerForStreamType('metrics');
    const metricsOptions = await pm.logsPage.listStreamOptionValues(LOGS_STREAM);
    expect(metricsOptions, 'a logs stream leaked into the metrics picker').not.toContain(LOGS_STREAM);

    testLogger.info('✓ PASSED: the stream picker is scoped to its stream type (Bug #10059)');
  });

  test("a non-logs explorer should offer the switch back to logs", {
    tag: ['@bug-12609', '@P2', '@regression', '@logsRegression']
  }, async () => {
    await pm.logsPage.openExplorerForStreamType('logs');
    // Nothing to switch back to while already on logs, so the control must not be there.
    await pm.logsPage.expectBackToLogsStreamTypeButtonAbsent();

    await pm.logsPage.openExplorerForStreamType('metrics');
    await pm.logsPage.expectBackToLogsStreamTypeButtonVisible();

    await pm.logsPage.clickBackToLogsStreamType();
    const options = await pm.logsPage.listStreamOptionValues(LOGS_STREAM);
    expect(options, 'switching back did not restore the logs stream list').toContain(LOGS_STREAM);

    testLogger.info('✓ PASSED: metrics explorer offers a way back to logs (Bug #12609)');
  });
});
