// The query API writes infinities as "+Inf"/"-Inf", which parseFloat reads as NaN (o2-enterprise#3122, B2).
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const TAGS = ['@bug-3122', '@P3', '@regression', '@metricsRegression', '@metrics'];

test.describe('PromQL Table chart infinite values (ENT#3122)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the Table chart shows +Inf and -Inf for infinite values', { tag: TAGS }, async () => {
    await pm.metricsPage.runPromqlQuery('vector(1)/0');
    expect(await pm.metricsPage.selectChartType('table')).toBe(true);
    await pm.metricsPage.expectPromqlTableValues('+Inf');

    await pm.metricsPage.runPromqlQuery('-vector(1)/0');
    await pm.metricsPage.expectPromqlTableValues('-Inf');
  });

  test('the Table chart keeps NaN for a real NaN', { tag: TAGS }, async () => {
    await pm.metricsPage.runPromqlQuery('vector(0)/0');
    expect(await pm.metricsPage.selectChartType('table')).toBe(true);
    await pm.metricsPage.expectPromqlTableValues('NaN');
  });
});
