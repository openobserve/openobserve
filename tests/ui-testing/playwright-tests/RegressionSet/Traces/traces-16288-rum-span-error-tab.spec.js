const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { stringAttr, ingestOtlpTraces, ingestRumData, waitForSearch, deleteStream } = require('../../utils/traces-api.js');

const MINUTE_MS = 60 * 1000;
const NS_PER_MS = 1000000;
// A dedicated org keeps _rumdata narrow: past ZO_QUICK_MODE_NUM_FIELDS, SELECT * drops view_id and the bridge finds no page view.
const RUM_ORG = 'e2e16288rum';
const ERROR_TYPE = 'TypeError';
const ERROR_MESSAGE = "Cannot read properties of undefined (reading 'token')";

function buildFixture() {
  return {
    traceId: generateHexId(16),
    browserSpanId: generateHexId(8),
    backendSpanId: generateHexId(8),
    sessionId: `e2e-16288-${generateHexId(6)}`,
    viewId: generateHexId(8),
    errorId: generateHexId(8),
    requestAtMs: Date.now() - MINUTE_MS,
  };
}

// The backend root's parent is the browser request, which only the RUM row owns, so the trace bridges to its page view.
async function ingestBackendTrace(request, stream, f) {
  const startNs = BigInt(f.requestAtMs + 20) * BigInt(NS_PER_MS);
  await ingestOtlpTraces(request, stream, {
    resourceSpans: [{
      resource: { attributes: [stringAttr('service.name', 'e2e-16288-auth')] },
      scopeSpans: [{
        scope: { name: 'e2e-16288' },
        spans: [{
          traceId: f.traceId,
          spanId: f.backendSpanId,
          parentSpanId: f.browserSpanId,
          name: 'POST /api/login',
          kind: 2,
          startTimeUnixNano: String(startNs),
          endTimeUnixNano: String(startNs + BigInt(80 * NS_PER_MS)),
          attributes: [],
          status: { code: 1 },
        }],
      }],
    }],
  }, { org: RUM_ORG, message: 'Precondition: backend trace must ingest' });
  await waitForSearch(request, `SELECT span_id FROM "${stream}" WHERE trace_id = '${f.traceId}'`, {
    org: RUM_ORG,
    size: 10,
    expected: 1,
    message: 'the backend span must become searchable',
  });
}

async function ingestFailedLogin(request, f) {
  const shared = { session_id: f.sessionId, view_id: f.viewId, service: 'e2e-16288-web', source: 'browser' };
  const rows = [
    {
      ...shared,
      type: 'view',
      date: f.requestAtMs - MINUTE_MS,
      view_url: 'https://shop.example.com/login',
      view_loading_type: 'initial_load',
      view_time_spent: 2 * MINUTE_MS * NS_PER_MS,
    },
    {
      ...shared,
      type: 'resource',
      date: f.requestAtMs,
      resource_type: 'fetch',
      resource_method: 'POST',
      resource_url: 'https://shop.example.com/api/login',
      resource_status_code: 401,
      resource_duration: 120 * NS_PER_MS,
      _o2_trace_id: f.traceId,
      _o2_span_id: f.browserSpanId,
    },
    {
      ...shared,
      type: 'error',
      date: f.requestAtMs + 200,
      error_id: f.errorId,
      error_type: ERROR_TYPE,
      error_message: ERROR_MESSAGE,
      error_source: 'source',
    },
  ];
  await ingestRumData(request, rows, { org: RUM_ORG, message: 'Precondition: the failed login must ingest' });
  await waitForSearch(request, `SELECT type FROM "_rumdata" WHERE session_id = '${f.sessionId}'`, {
    org: RUM_ORG,
    type: 'logs',
    size: 10,
    expected: rows.length,
    message: 'the failed login must become searchable',
  });
}

test.describe('Error tab of RUM spans in the trace view (#16288)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_16288_${generateHexId(4)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream, { org: RUM_ORG });
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a failed browser request shows its HTTP status and a browser error shows its type and message', {
    tag: ['@bug-16288', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const f = buildFixture();
    await ingestBackendTrace(page.request, stream, f);
    await ingestFailedLogin(page.request, f);

    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId: f.traceId,
      fromUs: (f.requestAtMs - 15 * MINUTE_MS) * 1000,
      toUs: (f.requestAtMs + 15 * MINUTE_MS) * 1000,
      stream,
      org: RUM_ORG,
    });
    expect(await pm.tracesPage.openTraceDetailsTab('waterfall'), 'Precondition: the waterfall tab must open').toBe(true);
    // The page-view row proves the RUM bridge ran, so the browser spans below are the ones the fix builds.
    await pm.tracesPage.expectWaterfallSpanRow(`rum_view_${f.viewId}`);

    await pm.tracesPage.selectWaterfallSpanById(f.browserSpanId);
    await pm.tracesPage.openSidebarErrorTab();
    await pm.tracesPage.expectSidebarErrorSummaryContains('401');

    await pm.tracesPage.selectWaterfallSpanById(`rum_error_${f.errorId}`);
    await pm.tracesPage.openSidebarErrorTab();
    await pm.tracesPage.expectSidebarErrorTitle(ERROR_TYPE);
    await pm.tracesPage.expectSidebarErrorMessage(ERROR_MESSAGE);
  });
});
