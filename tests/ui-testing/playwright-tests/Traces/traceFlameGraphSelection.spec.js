// traceFlameGraphSelection.spec.js
// Regression cover for openobserve#11615 — selecting a span from the Flame Graph
// used to redirect the user to the Waterfall tab, breaking the analysis flow of
// anyone working in the flame graph. Span details must open WITHOUT leaving the
// Flame Graph tab.
//
// The flame graph is drawn by ECharts to a canvas, so a span has no DOM node to
// click. This spec does not guess coordinates: it walks the canvas until the
// chart's own tooltip appears (which only happens over a real span), and clicks
// that point. Everything asserted afterwards — the active tab, the flame-graph
// sidebar, the absence of the waterfall tree — is ordinary DOM.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { generateMultiHopTrace, ingestTrace } = require('../utils/service-graph-ingestion.js');

// A span the pointer is over renders the ECharts tooltip. Scanning rows top-down
// finds the widest bar (the root) first, which is present in every trace.
const TOOLTIP_SCAN_ROW_STEP = 10;
const TOOLTIP_SCAN_COL_STEP = 40;
const TOOLTIP_SCAN_MAX_DEPTH = 220;

/**
 * Point at successive canvas positions until the flame graph's tooltip appears.
 * Returns {x, y} in page coordinates, or null when no span was found.
 */
async function findSpanOnCanvas(page, canvas) {
  const box = await canvas.boundingBox();
  if (!box) return null;

  const maxY = box.y + Math.min(box.height, TOOLTIP_SCAN_MAX_DEPTH);
  for (let y = box.y + 6; y < maxY; y += TOOLTIP_SCAN_ROW_STEP) {
    for (let x = box.x + 20; x < box.x + box.width - 20; x += TOOLTIP_SCAN_COL_STEP) {
      await page.mouse.move(x, y);
      const tooltip = await page.evaluate(() => {
        const floating = [...document.querySelectorAll('div')].filter((d) => {
          const style = d.getAttribute('style') || '';
          const text = (d.innerText || '').trim();
          return /position:\s*absolute/.test(style) && d.offsetParent && text.length > 3 && text.length < 300;
        });
        return floating.length ? floating[floating.length - 1].innerText : null;
      });
      if (tooltip && /Service:/i.test(tooltip)) {
        return { x, y, tooltip };
      }
    }
  }
  return null;
}

test.describe('Trace Flame Graph span selection', () => {
  test.describe.configure({ mode: 'serial' });

  // A known multi-hop trace, opened by id. The spec is about what a span click
  // does, so it ingests its own trace and navigates straight to it rather than
  // depending on whatever the org already holds or on the traces-list filters.
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
      testLogger.info('Ingested flame-graph fixture trace', { traceId });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);

    // The active tab persists in localStorage, so an earlier test's choice would
    // otherwise decide which tab this one starts on.
    await page.evaluate(() => localStorage.removeItem('o2_trace_active_tab'));

    const toUs = (ms) => ms * 1000;
    const from = toUs(ingestedAtMs - 15 * 60 * 1000);
    const to = toUs(ingestedAtMs + 5 * 60 * 1000);
    // Same URL shape the traces page objects use: ZO_BASE_URL is the server root,
    // the SPA lives under /web.
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const org = process.env['ORGNAME'] || 'default';
    await page.goto(
      `${baseUrl}/web/traces/trace-details` +
        `?stream=default&trace_id=${traceId}&from=${from}&to=${to}&org_identifier=${org}`,
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: selecting a span in the Flame Graph opens its details without leaving the tab', {
    tag: ['@traceDetails', '@traces', '@functional', '@P1', '@all'],
  }, async ({ page }) => {
    const flameTab = page.locator('[data-test="trace-details-flame-graph-tab"]');
    await flameTab.waitFor({ state: 'visible', timeout: 30000 });
    await flameTab.click();

    const chart = page.locator('[data-test="flame-graph-view-chart-wrapper"]');
    await chart.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);

    const canvas = chart.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 15000 });

    const span = await findSpanOnCanvas(page, canvas);
    expect(span, 'Precondition: the flame graph must render at least one span bar').not.toBeNull();
    testLogger.info('Found a span on the flame graph canvas', { x: span.x, y: span.y });

    await page.mouse.click(span.x, span.y);

    // The details open in the flame graph's OWN sidebar — the point of the fix is
    // that the user is not thrown back to the waterfall to read them.
    const sidebar = page.locator('[data-test="trace-details-flame-graph-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-test="trace-details-sidebar-header-toolbar-span-id"]')).toBeVisible();

    // Still on the Flame Graph tab, and the waterfall was never mounted.
    await expect(flameTab).toHaveAttribute('data-state', 'on');
    await expect(page.locator('[data-test="trace-details-waterfall-tab"]')).toHaveAttribute('data-state', 'off');
    await expect(page.locator('[data-test="trace-details-tree"]')).toHaveCount(0);
  });
});
