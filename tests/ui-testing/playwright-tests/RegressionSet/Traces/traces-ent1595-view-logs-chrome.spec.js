// traces-ent1595-view-logs-chrome.spec.js
// Traces Regression — trace-details View Logs chrome (o2-enterprise#1595)
//
// On a build that has correlation, the
// manual log-stream picker and its View Logs button in the trace-details header
// are redundant: correlated navigation replaces them. They were removed, and this
// pins that removal so they cannot drift back.
//
// The per-span and sidebar View Logs affordances are NOT part of the removal —
// they are how a user reaches logs for one span — so they are asserted present,
// otherwise "hide the chrome" could quietly become "hide the feature".

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { generateMultiHopTrace, ingestTrace } = require('../../utils/service-graph-ingestion.js');

test.describe('Trace details View Logs chrome', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  let traceId;
  let ingestedAtMs;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const trace = generateMultiHopTrace({ latencyMs: 60 });
      const result = await ingestTrace(page, trace);
      expect(result.status, 'trace ingestion must succeed').toBe(200);
      traceId = trace.metadata.traceId;
      ingestedAtMs = Date.now();
      testLogger.info('Ingested view-logs fixture trace', { traceId });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.evaluate(() => localStorage.removeItem('o2_trace_active_tab'));

    const toUs = (ms) => ms * 1000;
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const org = process.env['ORGNAME'] || 'default';
    await page.goto(
      `${baseUrl}/web/traces/trace-details` +
        `?stream=default&trace_id=${traceId}` +
        `&from=${toUs(ingestedAtMs - 15 * 60 * 1000)}&to=${toUs(ingestedAtMs + 5 * 60 * 1000)}` +
        `&org_identifier=${org}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P2: the header log-stream picker and its View Logs button are gone', {
    tag: ['@traceDetails', '@traces', '@functional', '@P2', '@all'],
  }, async ({ page }) => {
    // Gate on the page having rendered, so an absent button cannot be an absent page.
    await expect(page.locator('[data-test="trace-details-flame-graph-tab"]')).toBeVisible({
      timeout: 30000,
    });

    await expect(page.locator('[data-test="trace-details-log-streams-select"]')).toHaveCount(0);
    await expect(page.locator('[data-test="trace-details-view-logs-btn"]')).toHaveCount(0);
  });

  test('P2: a span still offers its own View Logs action', {
    tag: ['@traceDetails', '@traces', '@functional', '@P2', '@all'],
  }, async ({ page }) => {
    const waterfallTab = page.locator('[data-test="trace-details-waterfall-tab"]');
    await waterfallTab.waitFor({ state: 'visible', timeout: 30000 });
    await waterfallTab.click();

    const firstSpanRow = page.locator('[data-test^="trace-tree-span-operation-name-container-"]').first();
    await firstSpanRow.waitFor({ state: 'visible', timeout: 30000 });
    // The action is revealed on hover, the same way a user reaches it.
    await firstSpanRow.hover();

    await expect(
      page.locator('[data-test^="trace-tree-span-view-logs-btn-"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
