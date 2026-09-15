const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const LOG_STREAM = 'e2e_automate';
const METRICS_STREAM = 'e2e_test_cpu_usage';
const ORG_ID = getOrgIdentifier() || 'default';

test.describe("Alerts measure-column default", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Log ingestion skipped: ${e.message}`));
    // "value" is a metrics-only column, so the metrics leg needs a real metrics stream.
    await pm.pipelinesPage.ingestMetricsData(METRICS_STREAM).catch((e) =>
      testLogger.warn(`Metrics ingestion skipped: ${e.message}`)
    );
    await page.goto(`${logData.alertUrl}?org_identifier=${ORG_ID}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Measure-column default setup completed');
  });

  test("only metrics may pre-select the value column for a measure function", {
    tag: ['@bug-11619', '@P2', '@regression', '@alertsRegression', '@alertsRegressionMeasureColumn']
  }, async () => {
    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(`e2e_11619_${Date.now()}`);

    await pm.alertsPage.switchStreamAndReconfirm('metrics', METRICS_STREAM);
    await pm.alertsPage.selectAggregationFunction('avg');
    const metricsColumn = await pm.alertsPage.getMeasureColumnSelectedValue();
    testLogger.info(`Metrics measure column: "${metricsColumn}"`);

    // The control side: without it, a build that pre-selects nothing anywhere would pass.
    expect(metricsColumn,
      'Precondition: metrics must still default the measure column to "value"'
    ).toBe('value');

    await pm.alertsPage.switchStreamAndReconfirm('logs', LOG_STREAM);
    await pm.alertsPage.selectAggregationFunction('avg');
    const logsColumn = await pm.alertsPage.getMeasureColumnSelectedValue();
    testLogger.info(`Logs measure column: "${logsColumn}"`);

    expect(logsColumn,
      'Bug #11619: logs must leave the measure column unset — "value" is a metrics-only default'
    ).toBe('');

    testLogger.info('PASSED: measure column pre-selected for metrics only (Bug #11619)');
  });
});
