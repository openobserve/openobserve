const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ROOT_OPERATION = 'documentLoad';
const TEN_MINUTES_US = 10 * 60 * 1000 * 1000;

const org = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const baseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
const stringAttr = (key, value) => ({ key, value: { stringValue: value } });

// Every span has its parent, so the RUM bridge never runs and only the ingested attribute can drive the button.
async function ingestBrowserTrace(page, stream, replayFlag) {
  const traceId = generateHexId(16);
  const rootSpanId = generateHexId(8);
  const sessionId = `e2e-15222-${generateHexId(6)}`;
  const nowNs = BigInt(Date.now()) * 1000000n;
  const span = (spanId, name, parentSpanId, offsetMs, durationMs, attributes) => ({
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    kind: parentSpanId ? 3 : 1,
    startTimeUnixNano: String(nowNs + BigInt(offsetMs) * 1000000n),
    endTimeUnixNano: String(nowNs + BigInt(offsetMs + durationMs) * 1000000n),
    attributes,
    status: { code: 1 },
  });
  const response = await page.request.post(`${baseUrl()}/api/${org()}/v1/traces`, {
    headers: { ...getAuthHeaders(), 'stream-name': stream },
    data: {
      resourceSpans: [{
        resource: { attributes: [stringAttr('service.name', 'e2e-15222-web')] },
        scopeSpans: [{
          scope: { name: '@opentelemetry/instrumentation-document-load' },
          spans: [
            span(rootSpanId, ROOT_OPERATION, null, 0, 300, [
              stringAttr('rum.session_id', sessionId),
              stringAttr('rum.session_has_replay', replayFlag),
            ]),
            span(generateHexId(8), 'GET /api/cart', rootSpanId, 20, 120, []),
          ],
        }],
      }],
    },
  });
  expect(response.status(), 'Precondition: browser trace must ingest').toBe(200);
  const nowUs = Date.now() * 1000;
  return { traceId, rootSpanId, sessionId, fromUs: nowUs - TEN_MINUTES_US, toUs: nowUs + TEN_MINUTES_US };
}

async function waitForRootSpan(page, stream, traceId) {
  let root = null;
  await expect.poll(async () => {
    const endUs = Date.now() * 1000 + 60_000_000;
    const response = await page.request.post(`${baseUrl()}/api/${org()}/_search?type=traces`, {
      headers: getAuthHeaders(),
      data: {
        query: {
          sql: `SELECT * FROM "${stream}" WHERE trace_id = '${traceId}' AND operation_name = '${ROOT_OPERATION}'`,
          start_time: endUs - 60 * 60 * 1000 * 1000,
          end_time: endUs,
          from: 0,
          size: 1,
        },
      },
    });
    root = response.ok() ? ((await response.json()).hits || [])[0] || null : null;
    return root !== null;
  }, { timeout: 60000, intervals: [2000], message: 'the seeded root span must become searchable' }).toBe(true);
  return root;
}

async function deleteStream(page, stream) {
  await page.request
    .delete(`${baseUrl()}/api/${org()}/streams/${stream}?type=traces`, { headers: getAuthHeaders() })
    .catch(() => {});
}

test.describe('Traces Play Session Replay for natively instrumented browser spans (#15222)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_15222_${generateHexId(4)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a span whose replay flag is the string "true" offers Play Session Replay and opens its session', {
    tag: ['@bug-15222', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const trace = await ingestBrowserTrace(page, stream, 'true');
    const root = await waitForRootSpan(page, stream, trace.traceId);
    expect(root.rum_session_has_replay, 'Precondition: search serves the flag as a string').toBe('true');

    await pm.tracesPage.navigateToTraceDetailsUrl({ traceId: trace.traceId, fromUs: trace.fromUs, toUs: trace.toUs, stream, org: org() });
    await pm.tracesPage.expectTraceDetailsVisible();
    await pm.tracesPage.expectTraceTreeSpanOperationName(trace.rootSpanId, ROOT_OPERATION);
    await pm.tracesPage.expectSessionReplayButtonVisible();

    await pm.tracesPage.clickSessionReplayButton();
    await pm.rumSessionsPage.expectSessionViewerFor(trace.sessionId);
    await pm.rumSessionsPage.expectSessionViewerBackVisible();
    testLogger.info('Play Session Replay opened the session viewer', { sessionId: trace.sessionId });
  });

  test('a span whose replay flag is the string "false" does not offer Play Session Replay', {
    tag: ['@bug-15222', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const trace = await ingestBrowserTrace(page, stream, 'false');
    const root = await waitForRootSpan(page, stream, trace.traceId);
    expect(root.rum_session_id, 'Precondition: the span carries a RUM session').toBe(trace.sessionId);
    expect(root.rum_session_has_replay, 'Precondition: search serves the flag as a string').toBe('false');

    await pm.tracesPage.navigateToTraceDetailsUrl({ traceId: trace.traceId, fromUs: trace.fromUs, toUs: trace.toUs, stream, org: org() });
    await pm.tracesPage.expectTraceDetailsVisible();
    // The session span must be loaded, or a hidden button proves nothing.
    await pm.tracesPage.expectTraceTreeSpanOperationName(trace.rootSpanId, ROOT_OPERATION);
    await pm.tracesPage.expectSessionReplayButtonHidden();
  });
});
