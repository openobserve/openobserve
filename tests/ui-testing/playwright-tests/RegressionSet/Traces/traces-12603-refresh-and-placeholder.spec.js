const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateBasicTrace, ingestTrace } = require('../../utils/service-graph-ingestion.js');

const TRACE_STREAM = 'default';
const SERVICE_NAME = `r12603-gateway-${Date.now()}`;
// Ends mid-comparison, so the traces SQL parser rejects it on restore.
const UNPARSABLE_FILTER = 'service_name = ';

test.describe('Traces hard refresh and query placeholder', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let traceId;
  let spanId;
  let ingestedAtMs;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    try {
      const trace = generateBasicTrace({ clientService: SERVICE_NAME });
      const result = await ingestTrace(page, trace);
      expect(result.status, 'trace ingestion must succeed').toBe(200);
      traceId = trace.metadata.traceId;
      spanId = trace.payload.resourceSpans[1].scopeSpans[0].spans[0].spanId;
      ingestedAtMs = Date.now();
      testLogger.info('Ingested #12603 fixture trace', { traceId, spanId });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    pm.tracesPage.startCollectingPageErrors();
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('hard refresh of a filtered Traces list keeps the list rendered', {
    tag: ['@bug-12603', '@P0', '@regression', '@traces', '@tracesRegressionRefresh'],
  }, async () => {
    await pm.tracesPage.navigateToTracesWithFilter({ filter: `service_name = '${SERVICE_NAME}'`, stream: TRACE_STREAM });
    await pm.tracesPage.expectTracesListRendered();

    await pm.tracesPage.hardReload();
    await pm.tracesPage.expectTracesListRendered();
    await pm.tracesPage.expectQueryEditorContains(SERVICE_NAME);
    expect(pm.tracesPage.getPageErrors(), 'Bug #12603: a hard refresh must not throw').toEqual([]);
  });

  test('hard refresh with a filter the parser rejects keeps the Traces page rendered', {
    tag: ['@bug-12603', '@P0', '@regression', '@traces', '@tracesRegressionRefresh'],
  }, async () => {
    await pm.tracesPage.navigateToTracesWithFilter({ filter: UNPARSABLE_FILTER, stream: TRACE_STREAM });
    await pm.tracesPage.expectTracesSearchBarRendered();

    await pm.tracesPage.hardReload();
    await pm.tracesPage.expectTracesSearchBarRendered();
    await pm.tracesPage.expectQueryEditorContains('service_name');
    expect(pm.tracesPage.getPageErrors(), 'Bug #12603: restoring an unparsable filter must not throw').toEqual([]);
  });

  test('hard refresh of trace details with a selected span keeps the details rendered', {
    tag: ['@bug-12603', '@P0', '@regression', '@traces', '@tracesRegressionRefresh'],
  }, async () => {
    const fromUs = (ingestedAtMs - 15 * 60 * 1000) * 1000;
    const toUs = (ingestedAtMs + 5 * 60 * 1000) * 1000;
    await pm.tracesPage.navigateToTraceDetailsSpanUrl({ traceId, spanId, fromUs, toUs, stream: TRACE_STREAM });
    await pm.tracesPage.expectTraceDetailsSelectedSpan(spanId);

    await pm.tracesPage.hardReload();
    await pm.tracesPage.expectTraceDetailsSelectedSpan(spanId);
    expect(pm.tracesPage.getPageErrors(), 'Bug #12603: a hard refresh of trace details must not throw').toEqual([]);
  });

  test('Traces query placeholder never suggests match_all', {
    tag: ['@bug-12603', '@P0', '@regression', '@traces', '@tracesRegressionPlaceholder'],
  }, async () => {
    await pm.tracesPage.navigateToTracesUrlWithStream(TRACE_STREAM);
    await pm.tracesPage.waitForTraceSearchResults();

    const { samples, examples } = await pm.tracesPage.sampleQueryPlaceholder();
    testLogger.info('Traces placeholder examples observed', { examples });

    // match_all is the second example in the unfiltered list, so two completed examples prove the filter ran.
    expect(examples.length, 'Precondition: the placeholder must cycle through at least two examples').toBeGreaterThanOrEqual(2);
    expect(samples.filter((s) => s.includes('match_all')), 'Bug #12603: the Traces placeholder must not suggest match_all').toEqual([]);
  });
});
