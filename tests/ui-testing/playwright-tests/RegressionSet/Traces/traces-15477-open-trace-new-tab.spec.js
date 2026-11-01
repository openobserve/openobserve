const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestSequencedErrorSpans } = require('../../utils/trace-ingestion.js');
const { deleteStream } = require('../../utils/traces-api.js');

const DETAILS_PATH = '/traces/trace-details';

test.describe('Open a trace result in a new tab (#15477)', () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = 'e2e_15477_' + Math.random().toString(36).slice(2, 7);
    const ingest = await ingestSequencedErrorSpans(page, stream, 5);
    expect(ingest.status, 'Precondition: seeded spans must ingest').toBe(200);
    await pm.tracesPage.navigateToTracesUrlWithStream(stream);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.switchToSpansMode();
    await expect(pm.tracesPage.traceRowLinks().first()).toBeVisible({ timeout: 30000 });
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('each result row carries a real link to its trace details', {
    tag: ['@enhancement-15477', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const href = await pm.tracesPage.traceRowLinks().first().getAttribute('href');
    expect(href, 'the operation name must be an anchor with an href').toContain(DETAILS_PATH);
    expect(href).toContain('trace_id=');
  });

  test('cmd/ctrl-click and middle-click open the trace in a new tab and keep the list', {
    tag: ['@enhancement-15477', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page, context }) => {
    const opened = pm.tracesPage.trackNewPages(context);

    await pm.tracesPage.traceRowLinks().first().click({ modifiers: ['ControlOrMeta'] });
    await pm.tracesPage.expectOneNewPage(opened);
    await expect(opened[0]).toHaveURL(new RegExp(DETAILS_PATH));
    await opened[0].close();
    opened.length = 0;

    await pm.tracesPage.firstRowNonLinkCell().click({ button: 'middle' });
    await pm.tracesPage.expectOneNewPage(opened);
    await expect(opened[0]).toHaveURL(new RegExp(DETAILS_PATH));
    await opened[0].close();

    expect(page.url(), 'the original tab must stay on the results list').not.toContain(DETAILS_PATH);
  });

  test('a plain click still opens the trace in the same tab', {
    tag: ['@enhancement-15477', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page, context }) => {
    await pm.tracesPage.traceRowLinks().first().click();
    await expect(page).toHaveURL(new RegExp(DETAILS_PATH));
    expect(context.pages()).toHaveLength(1);
  });
});
