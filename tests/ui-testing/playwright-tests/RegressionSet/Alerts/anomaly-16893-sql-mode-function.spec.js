// Copyright 2026 OpenObserve Inc.
// openobserve#16893: a function picked on the Filters tab rode along into an SQL-mode save, which the server refused for its missing field.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { listAnomalyDetections, deleteAnomaly } = require('../../utils/api-helper.js');

test.describe('Anomaly SQL mode does not send the Filters tab function (#16893)', {
  tag: ['@anomaly', '@enterprise', '@regression', '@alertsRegression'],
}, () => {
  let pm;
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const templateName = `e2e_16893_tmpl_${run}`;
  const stream = 'e2e_automate';
  let anomalyName = null;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // The wizard's Add button needs at least one template in the org.
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    expect(await pm.anomalyDetectionPage.isAnomalyDetectionAvailable(), 'anomaly detection must be on; this spec runs only in the ENT overlay').toBe(true);
    await pm.anomalyDetectionPage.navigateToAnomalyTab();
  });

  test.afterEach(async ({ page }) => {
    if (anomalyName) {
      const saved = (await listAnomalyDetections(page)).find((a) => a.name === anomalyName);
      if (saved) await deleteAnomaly(page, saved.anomaly_id || saved.id);
    }
    await pm.alertTemplatesPage.deleteTemplateViaApi(templateName);
  });

  test('max picked on Filters then a switch to SQL saves with count', { tag: ['@bug-16893', '@P1'] }, async ({ page }) => {
    anomalyName = `e2e_16893_sql_${run}`;
    await pm.anomalyDetectionPage.openAddAnomalyWizard();
    await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', stream);
    await pm.anomalyDetectionPage.openConfigTab();
    await pm.anomalyDetectionPage.selectQueryMode('filters');
    await pm.anomalyDetectionPage.selectDetectionFunction('max');

    await pm.anomalyDetectionPage.selectQueryMode('custom_sql');
    await pm.anomalyDetectionPage.setCustomSql(
      `SELECT histogram(_timestamp, '5 minute') AS time_bucket, count(*) AS value FROM "${stream}" GROUP BY time_bucket`,
    );
    await pm.anomalyDetectionPage.setHistogramInterval(5, 'm');
    await pm.anomalyDetectionPage.openAlertingTab();
    await pm.anomalyDetectionPage.toggleNotifications(false);

    const saved = await pm.anomalyDetectionPage.saveAndCaptureCreate();
    expect(saved.status, saved.text).toBe(200);
    const sent = saved.body.anomaly_config ?? saved.body;
    expect(sent.query_mode).toBe('custom_sql');
    expect(sent.detection_function).toBe('count');

    await expect.poll(async () => (await listAnomalyDetections(page)).find((a) => a.name === anomalyName)?.detection_function, {
      timeout: 15000,
      message: 'the stored config must read back count',
    }).toMatch(/^count\b/);
  });
});
