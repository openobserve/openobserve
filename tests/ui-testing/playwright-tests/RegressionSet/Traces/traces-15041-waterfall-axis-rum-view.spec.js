const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { stringAttr, ingestOtlpTraces, ingestRumData, waitForSearch, deleteStream } = require('../../utils/traces-api.js');

const MINUTE_MS = 60 * 1000;
const NS_PER_MS = 1000000;
const REQUEST_MS = 400;
const BACKEND_MS = 300;
const VIEW_OPENED_BEFORE_REQUEST_MS = 10 * MINUTE_MS;
const VIEW_TIME_SPENT_MS = 25 * MINUTE_MS;
// A dedicated org keeps _rumdata narrow: past ZO_QUICK_MODE_NUM_FIELDS, SELECT * drops view_id and the bridge finds no page view.
const RUM_ORG = 'e2e15041rum';

function buildFixture() {
  return {
    traceId: generateHexId(16),
    browserSpanId: generateHexId(8),
    backendSpanId: generateHexId(8),
    sessionId: `e2e-15041-${generateHexId(6)}`,
    viewId: generateHexId(8),
    requestAtMs: Date.now() - MINUTE_MS,
  };
}

// The backend root's parent is the browser request, which only the RUM row owns, so the trace bridges to its page view.
async function ingestBackendTrace(request, stream, f) {
  const startNs = BigInt(f.requestAtMs + 40) * BigInt(NS_PER_MS);
  const span = (spanId, parentSpanId, name, offsetMs, durationMs) => ({
    traceId: f.traceId,
    spanId,
    parentSpanId,
    name,
    kind: 2,
    startTimeUnixNano: String(startNs + BigInt(offsetMs * NS_PER_MS)),
    endTimeUnixNano: String(startNs + BigInt((offsetMs + durationMs) * NS_PER_MS)),
    attributes: [],
    status: { code: 1 },
  });
  await ingestOtlpTraces(request, stream, {
    resourceSpans: [{
      resource: { attributes: [stringAttr('service.name', 'e2e-15041-checkout')] },
      scopeSpans: [{
        scope: { name: 'e2e-15041' },
        spans: [
          span(f.backendSpanId, f.browserSpanId, 'POST /api/checkout', 0, BACKEND_MS),
          span(generateHexId(8), f.backendSpanId, 'SELECT orders', 50, 120),
        ],
      }],
    }],
  }, { org: RUM_ORG, message: 'Precondition: backend trace must ingest' });
  await waitForSearch(request, `SELECT span_id FROM "${stream}" WHERE trace_id = '${f.traceId}'`, {
    org: RUM_ORG,
    size: 10,
    expected: 2,
    message: 'the backend spans must become searchable',
  });
}

async function ingestPageVisit(request, f) {
  const shared = { session_id: f.sessionId, view_id: f.viewId, service: 'e2e-15041-web', source: 'browser' };
  const rows = [
    {
      ...shared,
      type: 'view',
      date: f.requestAtMs - VIEW_OPENED_BEFORE_REQUEST_MS,
      view_url: 'https://shop.example.com/checkout',
      view_loading_type: 'initial_load',
      view_time_spent: VIEW_TIME_SPENT_MS * NS_PER_MS,
    },
    {
      ...shared,
      type: 'resource',
      date: f.requestAtMs,
      resource_type: 'fetch',
      resource_method: 'POST',
      resource_url: 'https://shop.example.com/api/checkout',
      resource_status_code: 200,
      resource_duration: REQUEST_MS * NS_PER_MS,
      _o2_trace_id: f.traceId,
      _o2_span_id: f.browserSpanId,
    },
  ];
  await ingestRumData(request, rows, { org: RUM_ORG, message: 'Precondition: the page visit must ingest' });
  await waitForSearch(request, `SELECT view_id FROM "_rumdata" WHERE session_id = '${f.sessionId}'`, {
    org: RUM_ORG,
    type: 'logs',
    size: 10,
    expected: rows.length,
    message: 'the page visit must become searchable',
  });
}

test.describe('Trace waterfall axis for a trace started from a browser page (#15041)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_15041_${generateHexId(4)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream, { org: RUM_ORG });
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the waterfall axis fits the request, not the page visit, and the request bar has a real width', {
    tag: ['@bug-15041', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const f = buildFixture();
    await ingestBackendTrace(page.request, stream, f);
    await ingestPageVisit(page.request, f);

    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId: f.traceId,
      fromUs: (f.requestAtMs - 15 * MINUTE_MS) * 1000,
      toUs: (f.requestAtMs + 15 * MINUTE_MS) * 1000,
      stream,
      org: RUM_ORG,
    });
    expect(await pm.tracesPage.openTraceDetailsTab('waterfall'), 'Precondition: the waterfall tab must open').toBe(true);
    // The page-view row proves the RUM bridge ran; without it the axis never had a page visit to cover.
    await pm.tracesPage.expectWaterfallSpanRow(`rum_view_${f.viewId}`);
    await pm.tracesPage.expectWaterfallSpanRow(f.browserSpanId);
    await pm.tracesPage.expectWaterfallSpanRow(f.backendSpanId);

    const axisMessage = 'the axis must end near the request, not after the 25-minute page visit';
    await expect.poll(() => pm.tracesPage.getWaterfallAxisEndMs(), { timeout: 15000, message: axisMessage }).toBeGreaterThanOrEqual(BACKEND_MS);
    await expect.poll(() => pm.tracesPage.getWaterfallAxisEndMs(), { timeout: 15000, message: axisMessage }).toBeLessThan(2 * REQUEST_MS);

    const backendBar = () => pm.tracesPage.getSpanBarShare(f.backendSpanId);
    await expect.poll(async () => (await backendBar()).share, {
      timeout: 15000,
      message: 'the 300 ms request must fill most of a ~400 ms axis',
    }).toBeGreaterThan(0.5);
    await expect.poll(async () => (await backendBar()).barPx, {
      timeout: 15000,
      message: 'the request bar must be wide enough to see',
    }).toBeGreaterThan(50);
    testLogger.info('Waterfall fits the request', { axisEndMs: await pm.tracesPage.getWaterfallAxisEndMs(), ...(await backendBar()) });
  });
});
