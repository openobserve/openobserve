// A minutes offset, not a day: see seedTimeShiftMetric for why.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { TIME_SHIFT_METRIC, seedTimeShiftMetric } = require('../utils/metrics-explore-seed.js');

const SHIFT_SUFFIX = ' (10 Minutes ago)';

test.describe('Metrics editor — PromQL time shift', () => {
  test.beforeAll(async ({ request }) => {
    await seedTimeShiftMetric(request);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('10m offset draws a "(10 Minutes ago)" twin of every current series', {
    tag: ['@metrics', '@promql', '@timeShift', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);

    await pm.metricsPage.gotoMetricsPage();
    await pm.metricsPage.enterMetricsQuery(TIME_SHIFT_METRIC);

    await pm.metricsPage.openConfigSidebar();
    await pm.dashboardPanelConfigs.addTimeShift();
    await pm.dashboardPanelConfigs.setTimeShiftOffset(0, 10, 'm');

    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    let names = [];
    await expect
      .poll(async () => (names = await pm.dashboardPanelActions.getChartSeriesNames()), {
        timeout: 30000,
        message: 'the editor chart should draw a shifted series',
      })
      .toContainEqual(expect.stringMatching(/ \(10 Minutes ago\)$/));
    testLogger.info('Editor time-shift series', { names });

    // Every shifted series has its current twin, and nothing else is shifted.
    const shifted = names.filter((n) => n.endsWith(SHIFT_SUFFIX));
    const current = names.filter((n) => !n.endsWith(SHIFT_SUFFIX));
    expect(shifted.length).toBeGreaterThan(0);
    for (const s of shifted) expect(current).toContain(s.slice(0, -SHIFT_SUFFIX.length));
    expect(shifted.length).toBeLessThanOrEqual(current.length);
  });
});
