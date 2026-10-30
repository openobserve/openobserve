const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const STRING_SEVERITIES = ['error', 'warn', 'info', 'error', 'info', 'debug'];
const NUMERIC_SEVERITIES = [3, 4, 6, 3, 6, 7];

const buildRows = (severities) =>
  severities.map((sev, i) => ({
    severity: sev,
    job: 'e2e_histogram_breakdown',
    message: `histogram breakdown seed ${i}`,
  }));
test.describe("Logs histogram severity breakdown", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const seededStreams = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    // Must precede navigation: addInitScript only applies to subsequent loads.
    await pm.logsPage.captureHistogramFrames();
    await navigateToBase(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Histogram severity setup completed');
  });

  // Without this the seeded streams accumulate in the org on every nightly run.
  test.afterEach(async () => {
    while (seededStreams.length) {
      const name = seededStreams.pop();
      await pm.logsPage.deleteStream(name).catch((e) =>
        testLogger.warn(`Failed to delete stream ${name}: ${e.message}`)
      );
    }
  });
  test("a stream with a categorical severity field should drive a stacked histogram", {
    tag: ['@bug-11353', '@P2', '@regression', '@logsRegression', '@logsRegressionHistogram']
  }, async ({ page }) => {
    testLogger.info('Test: severity drives a stacked histogram (Feature #11353)');

    const stream = `e2e_sev_str_${Math.random().toString(36).substring(2, 7)}`;
    seededStreams.push(stream);
    await pm.logsPage.ingestData(stream, buildRows(STRING_SEVERITIES));

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.waitForStreamAvailable(stream, 90000, 3000);
    await pm.logsPage.selectStream(stream);
    await pm.logsPage.clickRefresh();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await expect.poll(async () => (await pm.logsPage.getHistogramMetadata()).length, {
      timeout: 60000, intervals: [1000, 2000, 3000],
    }).toBeGreaterThan(0);

    const meta = await pm.logsPage.getHistogramMetadata();
    const withBreakdown = meta.filter((m) => m.histogram_breakdown_field);
    testLogger.info(
      `metadata frames: ${meta.length}, with breakdown field: ${withBreakdown.length}, ` +
      `fields seen: ${JSON.stringify([...new Set(meta.map((m) => m.histogram_breakdown_field ?? null))])}`
    );

    expect(withBreakdown.length,
      'Feature #11353: the backend must nominate a histogram breakdown field for a stream carrying severity'
    ).toBeGreaterThan(0);

    expect(withBreakdown[0].histogram_breakdown_field,
      'Feature #11353: severity is the highest-priority breakdown field, so it must be the one chosen'
    ).toBe('severity');

    // Without zo_sql_breakdown in the rewritten query the UI falls back to a flat series.
    const q = withBreakdown[0].converted_histogram_query || '';
    testLogger.info(`converted histogram query: ${q}`);
    expect(q,
      'Feature #11353: the rewritten histogram query must project the breakdown field as zo_sql_breakdown'
    ).toContain('zo_sql_breakdown');
    expect(q,
      'Feature #11353: the rewritten histogram query must group by the breakdown'
    ).toMatch(/GROUP BY .*zo_sql_breakdown/i);

    await pm.logsPage.expectBarChartHasContent();

    testLogger.info('✓ PASSED: severity drove a stacked histogram (Feature #11353)');
  });
  test("a numeric severity field should still render the histogram", {
    tag: ['@bug-11441', '@P0', '@regression', '@logsRegression', '@logsRegressionHistogram']
  }, async ({ page }) => {
    testLogger.info('Test: numeric severity still renders the histogram (Bug #11441)');

    const stream = `e2e_sev_num_${Math.random().toString(36).substring(2, 7)}`;
    seededStreams.push(stream);
    await pm.logsPage.ingestData(stream, buildRows(NUMERIC_SEVERITIES));

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.waitForStreamAvailable(stream, 90000, 3000);
    await pm.logsPage.selectStream(stream);
    await pm.logsPage.clickRefresh();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await expect.poll(async () => (await pm.logsPage.getHistogramMetadata()).length, {
      timeout: 60000, intervals: [1000, 2000, 3000],
    }).toBeGreaterThan(0);

    const meta = await pm.logsPage.getHistogramMetadata();
    testLogger.info(
      `metadata frames: ${meta.length}, ` +
      `eligible: ${JSON.stringify([...new Set(meta.map((m) => m.is_histogram_eligible))])}, ` +
      `fields: ${JSON.stringify([...new Set(meta.map((m) => m.histogram_breakdown_field ?? null))])}`
    );

    // is_histogram_eligible is the backend's own verdict, so false here reproduces the bug.
    expect(meta.some((m) => m.is_histogram_eligible === true),
      'Bug #11441: a numeric severity must leave the query histogram-eligible'
    ).toBe(true);

    const errored = (await pm.logsPage.getHistogramFrames()).filter((f) => f.error || f.error_detail || f.code >= 400);
    expect(errored,
      `Bug #11441: no histogram frame may error on a numeric severity — got ${JSON.stringify(errored.slice(0, 1))}`
    ).toHaveLength(0);

    await pm.logsPage.expectBarChartHasContent();

    testLogger.info('✓ PASSED: numeric severity still renders the histogram (Bug #11441)');
  });
});
