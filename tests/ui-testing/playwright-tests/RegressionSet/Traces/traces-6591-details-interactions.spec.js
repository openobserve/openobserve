// traces-6591-details-interactions.spec.js
// Traces Regression — Trace Details interactions (#6591)
//
// The trace-details half of #6591:
//
//   6   the details page issued its fetch twice per open
//   7   collapsing a span disabled its ancestors' trace bars
//   8   searching for querier-1 highlighted querier-3
//   11  "Search field not found" after View Logs
//
// Item 8 uses a purpose-built trace whose span names share numeric prefixes
// (querier-1 / querier-3 / querier-13 / querier-31). That is the shape the bug
// was reported with, and a trace of ordinary operation names cannot tell a
// correct substring match apart from the broken one.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const {
  generateMultiHopTrace,
  generateQuerierFanoutTrace,
  ingestTrace,
} = require('../../utils/service-graph-ingestion.js');

function detailsUrl(traceId, ingestedAtMs) {
  const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  const org = process.env['ORGNAME'] || 'default';
  const toUs = (ms) => ms * 1000;
  return (
    `${baseUrl}/web/traces/trace-details?stream=default&trace_id=${traceId}` +
    `&from=${toUs(ingestedAtMs - 15 * 60 * 1000)}&to=${toUs(ingestedAtMs + 5 * 60 * 1000)}` +
    `&org_identifier=${org}`
  );
}

test.describe('Trace Details interactions (#6591)', () => {
  test.describe.configure({ mode: 'serial' });

  let deepTraceId;
  let querierTraceId;
  let querierNames;
  let ingestedAtMs;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const deep = generateMultiHopTrace({ latencyMs: 60 });
      expect((await ingestTrace(page, deep)).status).toBe(200);
      deepTraceId = deep.metadata.traceId;

      const querier = generateQuerierFanoutTrace();
      expect((await ingestTrace(page, querier)).status).toBe(200);
      querierTraceId = querier.metadata.traceId;
      querierNames = querier.metadata.spanNames;

      ingestedAtMs = Date.now();
      testLogger.info('Ingested trace-details fixtures', { deepTraceId, querierTraceId });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.evaluate(() => localStorage.removeItem('o2_trace_active_tab'));
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: opening Trace Details fetches the trace exactly once', {
    tag: ['@traces', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    const detailCalls = [];
    page.on('request', (req) => {
      if (/\/traces\/[0-9a-f]+\/details/.test(req.url())) detailCalls.push(req.url());
    });

    await page.goto(detailsUrl(deepTraceId, ingestedAtMs));
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(page.locator('[data-test="trace-details-flame-graph-tab"]')).toBeVisible({
      timeout: 30000,
    });
    // Give a second fetch time to land before declaring there wasn't one.
    await page.waitForTimeout(4000);

    expect(detailCalls, 'the details page must not load twice').toHaveLength(1);
  });

  test('P1: collapsing a span leaves its ancestors enabled', {
    tag: ['@traces', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    await page.goto(detailsUrl(deepTraceId, ingestedAtMs));
    await page.locator('[data-test="trace-details-waterfall-tab"]').click();
    await page.waitForTimeout(3000);

    const collapseButtons = page.locator('[data-test^="trace-tree-span-badge-collapse-btn-"]');
    const count = await collapseButtons.count();
    expect(count, 'precondition: the trace needs a collapsible mid-level span').toBeGreaterThan(1);

    // A mid-level span, not the root — collapsing the root hides everything and
    // says nothing about whether ancestors were disabled.
    const midSpan = collapseButtons.nth(Math.min(2, count - 1));
    await midSpan.click();
    await page.waitForTimeout(1500);

    const ancestorState = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test^="trace-tree-span-background-"]')]
        .slice(0, 6)
        .map((el) => {
          const style = getComputedStyle(el);
          return { opacity: style.opacity, pointerEvents: style.pointerEvents };
        }),
    );
    expect(ancestorState.length).toBeGreaterThan(0);
    for (const state of ancestorState) {
      expect(state.opacity).toBe('1');
      expect(state.pointerEvents).not.toBe('none');
    }

    const disabledSelectButtons = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-test^="trace-tree-span-select-btn-"]')].filter(
          (el) => el.disabled,
        ).length,
    );
    expect(disabledSelectButtons, 'ancestors must stay selectable').toBe(0);
  });

  test('P1: span search highlights only genuine matches', {
    tag: ['@traces', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    await page.goto(detailsUrl(querierTraceId, ingestedAtMs));
    await page.locator('[data-test="trace-details-waterfall-tab"]').click();
    await page.waitForTimeout(3000);

    await page.locator('[data-test="trace-details-search-input-field"]').fill('querier-1');
    await page.waitForTimeout(2500);

    const highlighted = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test^="trace-tree-span-operation-name-container-"]')]
        .filter((el) => el.querySelector('mark, [class*="highlight"], [class*="search-match"]'))
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
    );

    const matched = (name) => highlighted.some((text) => text.includes(name));
    // "querier-1" is a substring of "querier-13", so both are correct matches.
    expect(matched('querier-1'), 'querier-1 must match itself').toBe(true);
    expect(matched('querier-13'), 'querier-13 contains querier-1').toBe(true);
    // These are the wrong-highlight the bug produced.
    expect(matched('querier-3'), 'querier-3 does not contain querier-1').toBe(false);
    expect(matched('querier-31'), 'querier-31 does not contain querier-1').toBe(false);
  });

  test('P2: View Logs on a span does not error with "Search field not found"', {
    tag: ['@traces', '@regression', '@P2', '@all'],
  }, async ({ page }) => {
    await page.goto(detailsUrl(deepTraceId, ingestedAtMs));
    await page.locator('[data-test="trace-details-waterfall-tab"]').click();
    await page.waitForTimeout(3000);

    const spanRow = page.locator('[data-test^="trace-tree-span-operation-name-container-"]').first();
    await spanRow.waitFor({ state: 'visible', timeout: 30000 });
    // The action is revealed on hover, the way a user reaches it.
    await spanRow.hover();

    const viewLogsBtn = page.locator('[data-test^="trace-tree-span-view-logs-btn-"]').first();
    await viewLogsBtn.waitFor({ state: 'visible', timeout: 15000 });
    await viewLogsBtn.click();
    await page.waitForTimeout(8000);

    // Whether the org has correlated logs or not, the failure mode being pinned
    // is the error message — an honest "nothing correlated" toast is fine.
    const sawFieldError = await page.evaluate(() =>
      /search field not found|field not found/i.test(document.body.innerText),
    );
    expect(sawFieldError).toBe(false);
  });
});
