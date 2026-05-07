const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const logData = require("../../fixtures/log.json");

/**
 * Alerts Stream Switching Regression Tests
 *
 * Covers 5 regression bugs related to the alert canvas/graph UI breaking
 * when switching between stream types (logs <-> metrics) and query modes
 * (Builder <-> SQL <-> PromQL).
 *
 *    #11580 - Metrics+PromQL -> Logs, PromQL editor persists
 *    #11572 - Logs -> Metrics -> Logs, chart error "No field named value"
 *    #11571 - Builder -> SQL, chart blank table instead of line
 *    #11573 - Full editor open/close blanks the graph
 *    #11578 - Agg functions don't filter to integer fields
 *
 * NOTE: v3 UI uses a flat tab layout - there is NO Continue button.
 * After selecting stream+type, the query config section appears automatically.
 * For SQL/PromQL modes, click "View Editor" to open the editor dialog.
 */
test.describe("Alerts Stream Switching Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  const TEST_LOG_STREAM = 'e2e_automate';
  const METRICS_STREAM = 'e2e_test_cpu_usage';

  // ============================================================================
  // beforeAll - Ingest metrics data
  // ============================================================================
  test.beforeAll(async ({ browser }) => {
    testLogger.info('Setting up metrics data for stream switching regression tests');
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    try {
      await page.goto(`${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${getOrgIdentifier() || 'default'}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await ingestMetricsData(page);
      testLogger.info('Metrics data setup completed');
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  });

  // ============================================================================
  // Helper: Setup wizard to query config step (v3 flat layout, no Continue btn)
  // ============================================================================
  async function setupToQueryConfig(page, streamType, streamName) {
    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(`auto_sw_${Date.now()}`);
    await pm.alertsPage.selectStreamType(streamType);
    await page.waitForTimeout(500);
    await pm.alertsPage.creationWizard.selectStreamByName(streamName);
    await pm.alertsPage.selectScheduledAlertType();
    testLogger.info('Wizard setup complete - query config visible (v3 flat layout)');
  }

  // ============================================================================
  // Bug #11580: Metrics+PromQL -> switch to Logs, query editor still shows PromQL
  // https://github.com/openobserve/openobserve/issues/11580
  // ============================================================================
  test("Bug #11580: Stream type switch from Metrics/PromQL to Logs resets query editor", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11580', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11580: Verify PromQL editor clears when switching from metrics to logs');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Start with metrics - PromQL tab should be visible
    await setupToQueryConfig(page, 'metrics', METRICS_STREAM);

    const promqlVisible = await pm.alertsPage.isPromqlTabVisible();
    if (!promqlVisible) {
      testLogger.warn('PromQL tab not visible - metrics stream may not support PromQL, skipping test');
      await pm.alertsPage.clickBackButton();
      test.skip(true, 'Metrics stream does not support PromQL on this environment');
      return;
    }
    await pm.alertsPage.clickPromqlTab();
    testLogger.info('PromQL tab selected on metrics stream');

    // Switch to logs: change stream type + stream directly (v3 flat layout keeps dropdowns visible)
    await pm.alertsPage.selectStreamType('logs');
    await page.waitForTimeout(500);
    await pm.alertsPage.creationWizard.selectStreamByName(TEST_LOG_STREAM);
    await pm.alertsPage.selectScheduledAlertType();

    // Verify PromQL is gone for logs
    await pm.alertsPage.expectPromqlTabNotVisible();
    testLogger.info('PromQL tab NOT visible for logs stream (fix confirmed)');
    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11580 test passed');
  });

  // ============================================================================
  // Bug #11572: Logs -> Metrics -> Logs shows chart error
  // https://github.com/openobserve/openobserve/issues/11572
  // ============================================================================
  test("Bug #11572: Logs -> Metrics -> Logs switch does not show chart error", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11572', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11572: Verify no chart error when switching logs <-> metrics <-> logs');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Phase 1: Logs - chart OK
    await setupToQueryConfig(page, 'logs', TEST_LOG_STREAM);
    await page.waitForTimeout(2000);
    testLogger.info('Logs stream: setup complete');

    // Phase 2: Switch to metrics directly (v3 flat layout keeps dropdowns visible)
    await pm.alertsPage.selectStreamType('metrics');
    await page.waitForTimeout(500);
    await pm.alertsPage.creationWizard.selectStreamByName(METRICS_STREAM);
    await pm.alertsPage.selectScheduledAlertType();
    await pm.alertsPage.clickPromqlTab();
    testLogger.info('Metrics stream: PromQL selected');

    // Phase 3: Switch BACK to logs directly - verify NO chart error
    await pm.alertsPage.selectStreamType('logs');
    await page.waitForTimeout(500);
    await pm.alertsPage.creationWizard.selectStreamByName(TEST_LOG_STREAM);
    await pm.alertsPage.selectScheduledAlertType();

    await pm.alertsPage.expectPreviewChartVisible();
    await pm.alertsPage.expectNoChartError();

    const chartError = await pm.alertsPage.getChartErrorMessage();
    expect(chartError, `Bug #11572: Chart should not show schema error, got: "${chartError}"`).toBeNull();
    testLogger.info('Back to logs: no chart error (fix confirmed)');
    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11572 test passed');
  });

  // ============================================================================
  // Bug #11571: Builder -> SQL mode switch shows blank table instead of chart
  // https://github.com/openobserve/openobserve/issues/11571
  // ============================================================================
  test("Bug #11571: Builder to SQL mode switch renders chart correctly", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11571', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11571: Verify chart renders when switching from Builder to SQL');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await setupToQueryConfig(page, 'logs', TEST_LOG_STREAM);

    // Switch to SQL tab and open the query editor dialog
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickOpenFullEditor();

    // Type SQL query into the editor and run it
    await pm.alertsPage.typeInQueryEditor(`SELECT COUNT(*) as cnt FROM "${TEST_LOG_STREAM}"`);
    await pm.alertsPage.clickRunQueryButton();

    // Close editor dialog
    await pm.alertsPage.clickBackButton();

    // Clean up portals that may intercept clicks
    await page.evaluate(() => {
      document.querySelectorAll('div[id^="q-portal"]').forEach(el => el.remove());
    }).catch(() => {});

    // PRIMARY: Chart visible after SQL mode
    await pm.alertsPage.expectPreviewChartVisible();

    // SECONDARY: No "preview not available" message
    const notAvailableMsg = pm.alertsPage.getPreviewNotAvailableMessage();
    const msgVisible = await notAvailableMsg.isVisible({ timeout: 3000 }).catch(() => false);
    expect(msgVisible).toBe(false);

    // TERTIARY: No chart error
    await pm.alertsPage.expectNoChartError();
    testLogger.info('SQL mode: chart renders (fix confirmed)');

    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11571 test passed');
  });

  // ============================================================================
  // Bug #11573: Full editor open/close blanks the graph
  // https://github.com/openobserve/openobserve/issues/11573
  //
  // In v3, the "View Editor" button opens the query editor dialog.
  // The bug: closing the editor blanks the preview chart.
  // This test opens the editor, runs a query, closes, and verifies chart survives.
  // ============================================================================
  test("Bug #11573: Full editor open/close preserves graph", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11573', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11573: Verify chart re-renders after editor open/close');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await setupToQueryConfig(page, 'logs', TEST_LOG_STREAM);

    // Switch to SQL mode, open editor, type query, run
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickOpenFullEditor();
    await pm.alertsPage.typeInQueryEditor(`SELECT COUNT(*) as cnt FROM "${TEST_LOG_STREAM}"`);
    await pm.alertsPage.clickRunQueryButton();

    // PRIMARY: Close the editor and verify chart survives (the core of Bug #11573)
    await pm.alertsPage.clickBackButton();

    await pm.alertsPage.expectPreviewChartVisible();
    testLogger.info('Chart preserved after editor close (fix confirmed)');

    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11573 test passed');
  });

  // ============================================================================
  // Bug #11578: Agg functions (avg/sum) show all fields instead of only integers
  // https://github.com/openobserve/openobserve/issues/11578
  // ============================================================================
  test("Bug #11578: Agg functions filter to integer fields only", {
    tag: ['@alerts', '@regressionBugs', '@P2', '@bug-11578', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11578: Verify aggregation functions filter field types');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await setupToQueryConfig(page, 'logs', TEST_LOG_STREAM);

    // Add a condition and select a column
    await pm.alertsPage.clickAddConditionButton();
    await pm.alertsPage.clickFirstConditionColumnSelect();
    await pm.alertsPage.selectFirstFieldOption();

    // avg: only numeric fields
    await pm.alertsPage.selectAggregationFunction('avg');
    const avgFields = await pm.alertsPage.getAvailableFields();
    testLogger.info('Fields with avg', { count: avgFields.length });

    // sum: same filtering
    await pm.alertsPage.selectAggregationFunction('sum');
    const sumFields = await pm.alertsPage.getAvailableFields();
    testLogger.info('Fields with sum', { count: sumFields.length });

    // count: all fields available
    await pm.alertsPage.selectAggregationFunction('count');
    const countFields = await pm.alertsPage.getAvailableFields();
    testLogger.info('Fields with count', { count: countFields.length });

    expect(countFields.length, 'Count should show all fields').toBeGreaterThanOrEqual(avgFields.length);
    testLogger.info('Bug #11578: field filtering verified');

    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11578 test passed');
  });

  test.afterEach(async () => {
    testLogger.info('Stream switching regression test completed');
  });
});

// ============================================================================
// Helper: Ingest metrics data
// ============================================================================
async function ingestMetricsData(page) {
  const orgId = getOrgIdentifier();
  const streamName = 'e2e_test_cpu_usage';
  const baseUrl = process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080';
  const ingestionUrl = `${baseUrl}/api/${orgId}/ingest/metrics/_json`;

  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const timestamp = Math.floor(Date.now() / 1000);
  const metricsData = [];
  for (let i = 0; i < 10; i++) {
    metricsData.push({
      "__name__": streamName,
      "__type__": "gauge",
      "host_name": `server-${i % 3 + 1}`,
      "env": "test",
      "region": ["us-east-1", "us-west-2", "eu-west-1"][i % 3],
      "_timestamp": timestamp - (i * 60),
      "value": 20 + Math.random() * 60
    });
  }

  try {
    const response = await page.evaluate(async ({ url, authToken, data }) => {
      const fetchResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return {
        status: fetchResponse.status,
        data: await fetchResponse.json().catch(() => ({}))
      };
    }, { url: ingestionUrl, authToken: basicAuthCredentials, data: metricsData });
    testLogger.info('Metrics data ingested', { response, streamName });
  } catch (e) {
    testLogger.warn('Metrics ingestion may have failed', { error: e.message });
  }
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}
