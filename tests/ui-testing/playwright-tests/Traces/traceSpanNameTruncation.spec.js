// traceSpanNameTruncation.spec.js
// Tests for OpenObserve Traces — truncation of long span operation/service names
// in the trace-detail view. Verifies the standalone header operation name and the
// waterfall tree's per-span operation/service names truncate with an ellipsis
// while exposing the full value via a native `title` attribute on hover, and that
// truncation does not break span-row selection (the click handler lives on the
// row container, not the truncated name span).

const { test, expect, navigateToBase, generateUUID } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Trace Span Name Truncation testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.tracesPage.navigateToTracesUrl();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  /**
   * Open the freshly-ingested trace and wait for the detail view to be ready:
   * select stream → 15m → run search → open the first trace result → wait for the
   * header operation name + first tree row to render.
   */
  async function openTrace(pm, streamName) {
    // The stream-list is fetched once on page load; a stream ingested after that
    // load is absent from the selector options, so re-navigate with the stream
    // query param to refresh the list and auto-select the freshly-ingested stream.
    await pm.tracesPage.navigateToTracesUrlWithStream(streamName);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    await pm.tracesPage.clickFirstTraceResult();
    await pm.tracesPage.waitForTraceDetailsReady();
  }

  test("should truncate a long operation name in the header and tree with full-name title tooltips", {
    tag: ['@trace-span-name-truncation', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing header and tree operation-name truncation + title tooltips');

    const suffix = generateUUID();
    const streamName = `trace_truncation_${suffix}`;
    const longName = `HTTP POST /api/v1/orders/${'x'.repeat(120)}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: longName,
      kind: 2,
      attributes: { 'http.method': 'POST', 'http.status_code': '200' },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, longName);

    await openTrace(pm, streamName);

    await pm.tracesPage.expectTraceDetailsOperationNameTitle(longName);
    await pm.tracesPage.expectTraceTreeSpanOperationNameTitle(longName);
    await pm.tracesPage.expectTraceTreeSpanServiceNameTitle('genai-test-service');

    testLogger.info('Test completed');
  });

  test("should truncate a long service name with its full value as the title tooltip", {
    tag: ['@trace-span-name-truncation', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing long service-name truncation + title tooltip');

    const suffix = generateUUID();
    const streamName = `trace_truncation_${suffix}`;
    const longName = `HTTP POST /api/v1/orders/${'x'.repeat(120)}`;
    const serviceName = `service-${'y'.repeat(120)}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: longName,
      kind: 2,
      serviceName,
      attributes: { 'http.method': 'POST', 'http.status_code': '200' },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, longName);

    await openTrace(pm, streamName);

    await pm.tracesPage.expectTraceTreeSpanServiceNameTitle(serviceName);

    testLogger.info('Test completed');
  });

  test("should keep a truncated long-named span row clickable and open the span sidebar", {
    tag: ['@trace-span-name-truncation', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing span-row selection is unaffected by truncation');

    const suffix = generateUUID();
    const streamName = `trace_truncation_${suffix}`;
    const longName = `HTTP POST /api/v1/orders/${'x'.repeat(120)}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: longName,
      kind: 2,
      attributes: { 'http.method': 'POST', 'http.status_code': '200' },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, longName);

    await openTrace(pm, streamName);

    const clicked = await pm.tracesPage.clickTraceTreeSpanByOperationName(longName);
    expect(clicked).toBeTruthy();
    await pm.tracesPage.expectTraceDetailsSidebarVisible();

    testLogger.info('Test completed');
  });
});
