const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { generateMultiHopTrace, ingestTrace } = require('../../utils/service-graph-ingestion.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe('Trace Flame Graph zoom (#15476)', () => {
  test.describe.configure({ mode: 'serial' });
  let traceId;
  let ingestedAtMs;
  let pm;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    try {
      const trace = generateMultiHopTrace({ latencyMs: 120 });
      const result = await ingestTrace(page, trace);
      expect(result.status, 'trace ingestion must succeed').toBe(200);
      traceId = trace.metadata.traceId;
      ingestedAtMs = Date.now();
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const from = (ingestedAtMs - 15 * 60 * 1000) * 1000;
    const to = (ingestedAtMs + 5 * 60 * 1000) * 1000;
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const org = process.env['ORGNAME'] || 'default';
    await pm.traceFlameGraphPage.openTraceDetails(baseUrl, org, 'default', traceId, from, to);
  });

  test('zoom in narrows the flame graph time axis and fit restores the full range', {
    tag: ['@traceDetails', '@traces', '@bug-15476', '@regression', '@tracesRegression', '@P2'],
  }, async () => {
    const flame = pm.traceFlameGraphPage;
    await flame.openFlameGraph();

    let full;
    await expect.poll(async () => (full = await flame.axisLabels()).first && full.first !== full.last, { timeout: 15000 }).toBe(true);
    testLogger.info('Axis before zoom', full);

    // Pre-fix the flame graph had no zoom controls at all.
    await flame.expectZoomInVisible();
    await flame.zoomIn(3);

    let zoomed;
    await expect.poll(async () => {
      zoomed = await flame.axisLabels();
      return zoomed.first !== full.first && zoomed.last !== full.last;
    }, { timeout: 10000, message: 'zoom in must move both ends of the time axis inward' }).toBe(true);
    testLogger.info('Axis after zoom in', zoomed);

    await flame.fitToScreen();
    await expect.poll(async () => (await flame.axisLabels()).all, { timeout: 10000 }).toBe(full.all);
  });
});
