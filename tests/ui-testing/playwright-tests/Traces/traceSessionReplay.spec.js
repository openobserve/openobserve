// A dangling-parent trace matched by a `_rumdata` row drives the replay gate; `_sessionreplay` must exist for the empty state.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { generateHexId } = require('../utils/trace-ingestion.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const BASE = (process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = getOrgIdentifier() || 'default';
const AUTH_HEADERS = getAuthHeaders();
const RUN_ID = Date.now();
const RUM_BRIDGE_OPERATION = 'GET https://e2e.example.com/api/data';

const seeded = {
  replayableTraceId: null,
  replayableBridgeSpanId: null,
  sessionId: null,
  regularTraceId: null,
  fromUs: null,
  toUs: null,
};

async function pollForTraceSpan(page, streamName, operationName, maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const endTime = (Date.now() + 60000) * 1000;
    const startTime = endTime - 60 * 60 * 1000 * 1000;
    const sql = `SELECT * FROM "${streamName}" WHERE operation_name = '${operationName}' ORDER BY _timestamp DESC`;
    let hits = [];
    try {
      const res = await page.request.post(`${BASE}/api/${ORG}/_search?type=traces`, {
        headers: AUTH_HEADERS,
        data: { query: { sql, start_time: startTime, end_time: endTime, from: 0, size: 10 } },
      });
      if (res.ok()) {
        const body = await res.json().catch(() => null);
        hits = body?.hits || [];
      }
    } catch {
      hits = [];
    }
    if (hits.length >= 1) return true;
    // Poll interval for the search-API hit check above, not a UI-sync sleep.
    await page.waitForTimeout(3000);
  }
  throw new Error(`trace span "${operationName}" not searchable in stream ${streamName} after ${maxAttempts} attempts`);
}

async function ingestDanglingTraceWithRumRow(page, { sessionHasReplay }) {
  const traceId = generateHexId(16); // 32-hex
  const rootSpanId = generateHexId(8);
  const danglingParentSpanId = generateHexId(8);
  const sessionId = `e2e-replay-${generateHexId(6)}`;
  const viewId = `e2e-view-${generateHexId(6)}`;
  const operationName = `rum-replay-root-${RUN_ID}-${generateHexId(4)}`;
  const nowMs = Date.now();
  const startTimeNs = String(nowMs * 1000000);

  const traceData = {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'rum-replay-e2e' } }],
        },
        scopeSpans: [
          {
            scope: { name: 'opentelemetry-instrumentation', version: '1.0.0' },
            spans: [
              {
                traceId,
                spanId: rootSpanId,
                parentSpanId: danglingParentSpanId, // dangling — owned by no span in the trace
                name: operationName,
                kind: 2,
                startTimeUnixNano: startTimeNs,
                endTimeUnixNano: String(nowMs * 1000000 + 150000000),
                attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  const traceRes = await page.request.post(`${BASE}/api/${ORG}/v1/traces`, {
    headers: { ...AUTH_HEADERS, 'stream-name': 'default' },
    data: traceData,
  });
  expect(traceRes.ok(), `dangling-parent trace ingestion should succeed (HTTP ${traceRes.status()})`).toBe(true);

  await pollForTraceSpan(page, 'default', operationName);

  const rumRow = {
    _oo_trace_id: traceId,
    _oo_span_id: danglingParentSpanId,
    type: 'resource',
    // The UI names the bridge span `${resource_method} ${resource_url}` (useRumSpanBuilder createLeafSpan).
    resource_url: RUM_BRIDGE_OPERATION.replace(/^GET /, ''),
    resource_method: 'GET',
    resource_type: 'fetch',
    resource_duration: 250000, // µs
    session_id: sessionId,
    ...(sessionHasReplay ? { session_has_replay: true } : {}),
    view_id: viewId,
    date: nowMs, // epoch ms
  };

  const rumRes = await page.request.post(`${BASE}/api/${ORG}/_rumdata/_json`, {
    headers: AUTH_HEADERS,
    data: [rumRow],
  });
  expect(rumRes.ok(), `_rumdata ingestion should succeed (HTTP ${rumRes.status()})`).toBe(true);

  const rows = await waitForStreamRows(page, {
    sql: `SELECT * FROM "_rumdata" WHERE session_id = '${sessionId}'`,
    minRows: 1,
    timeoutMs: 45000,
  });
  expect(rows.length, `_rumdata row for ${sessionId} should be searchable`).toBeGreaterThanOrEqual(1);

  return {
    traceId,
    bridgeSpanId: danglingParentSpanId,
    sessionId,
    fromUs: nowMs * 1000 - 600 * 1000 * 1000, // 10 min before
    toUs: nowMs * 1000 + 600 * 1000 * 1000, // 10 min after
  };
}

// Every parent is owned, so hasDanglingParent is false and the RUM bridge never runs.
async function ingestRegularTrace(page) {
  const traceId = generateHexId(16); // 32-hex
  const rootSpanId = generateHexId(8);
  const childSpanId = generateHexId(8);
  const operationName = `rum-regular-root-${RUN_ID}-${generateHexId(4)}`;
  const nowMs = Date.now();

  const traceData = {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'rum-regular-e2e' } }],
        },
        scopeSpans: [
          {
            scope: { name: 'opentelemetry-instrumentation', version: '1.0.0' },
            spans: [
              {
                traceId,
                spanId: rootSpanId,
                name: operationName,
                kind: 2,
                startTimeUnixNano: String(nowMs * 1000000),
                endTimeUnixNano: String(nowMs * 1000000 + 100000000),
                status: { code: 1 },
              },
              {
                traceId,
                spanId: childSpanId,
                parentSpanId: rootSpanId,
                name: `${operationName}-child`,
                kind: 3,
                startTimeUnixNano: String(nowMs * 1000000 + 1000000),
                endTimeUnixNano: String(nowMs * 1000000 + 50000000),
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  const traceRes = await page.request.post(`${BASE}/api/${ORG}/v1/traces`, {
    headers: { ...AUTH_HEADERS, 'stream-name': 'default' },
    data: traceData,
  });
  expect(traceRes.ok(), `regular trace ingestion should succeed (HTTP ${traceRes.status()})`).toBe(true);

  await pollForTraceSpan(page, 'default', operationName);

  return {
    traceId,
    fromUs: nowMs * 1000 - 600 * 1000 * 1000,
    toUs: nowMs * 1000 + 600 * 1000 * 1000,
  };
}

test.describe('RUM Session Replay testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const replayable = await ingestDanglingTraceWithRumRow(page, { sessionHasReplay: true });
      seeded.replayableTraceId = replayable.traceId;
      seeded.replayableBridgeSpanId = replayable.bridgeSpanId;
      seeded.sessionId = replayable.sessionId;
      seeded.fromUs = replayable.fromUs;
      seeded.toUs = replayable.toUs;

      const regular = await ingestRegularTrace(page);
      seeded.regularTraceId = regular.traceId;

      // SessionViewer dereferences the `_sessionreplay` schema before the lookup, so the stream must exist.
      const seedSessionId = `e2e-sessionreplay-seed-${generateHexId(6)}`;
      const nowMs = Date.now();
      const replayRow = {
        session_id: seedSessionId,
        start: nowMs,
        end: nowMs + 30000,
        segment: JSON.stringify({ start: nowMs, end: nowMs + 30000, size: 12345 }),
        source: 'browser',
        ip: '127.0.0.1',
        user_agent_user_agent_family: 'Chrome',
        user_agent_os_family: 'Mac OS',
        geo_info_city: 'San Francisco',
        geo_info_country: 'United States',
      };
      const replayRes = await page.request.post(`${BASE}/api/${ORG}/_sessionreplay/_json`, {
        headers: AUTH_HEADERS,
        data: [replayRow],
      });
      expect(replayRes.ok(), `_sessionreplay ingestion should succeed (HTTP ${replayRes.status()})`).toBe(true);
      await waitForStreamRows(page, {
        sql: `SELECT * FROM "_sessionreplay" WHERE session_id = '${seedSessionId}'`,
        minRows: 1,
        timeoutMs: 45000,
      });
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('should not render the Play Session Replay button for a regular trace without a RUM session', {
    tag: ['@rum-session-replay', '@traces', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Opening a regular trace (no dangling parent, no RUM bridge)');
    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId: seeded.regularTraceId,
      fromUs: seeded.fromUs,
      toUs: seeded.toUs,
    });
    await pm.tracesPage.expectTraceDetailsVisible();
    await pm.tracesPage.expectSessionReplayButtonHidden();
    testLogger.info('Play Session Replay button is correctly absent for a regular trace');
  });

  test('should show the Play Session Replay button for a replayable RUM session and open its Session Viewer (no-replay state, no recording stored)', {
    tag: ['@rum-session-replay', '@traces', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Opening the replayable trace and asserting the Play button + navigation');
    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId: seeded.replayableTraceId,
      fromUs: seeded.fromUs,
      toUs: seeded.toUs,
    });
    await pm.tracesPage.expectTraceDetailsVisible();
    await pm.tracesPage.expectTraceTreeSpanOperationName(seeded.replayableBridgeSpanId, RUM_BRIDGE_OPERATION);
    await pm.tracesPage.expectSessionReplayButtonVisible();
    await pm.tracesPage.clickSessionReplayButton();
    await pm.rumSessionsPage.expectSessionViewerFor(seeded.sessionId);
    // The seeded session has a `_rumdata` row but no `_sessionreplay` rows, so the viewer lands on its events-only state.
    await pm.rumSessionsPage.expectEventsOnlyState();
    testLogger.info('Play Session Replay navigated to the Session Viewer for the replayable session');
  });

  test('should hide the Play Session Replay button when the RUM session has no recording', {
    tag: ['@rum-session-replay', '@traces', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Seeding a non-replayable RUM session and asserting the Play button is hidden');
    const nonReplay = await ingestDanglingTraceWithRumRow(page, { sessionHasReplay: false });
    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId: nonReplay.traceId,
      fromUs: nonReplay.fromUs,
      toUs: nonReplay.toUs,
    });
    await pm.tracesPage.expectTraceDetailsVisible();
    // Proves the RUM bridge ran; otherwise a hidden button would pass vacuously.
    await pm.tracesPage.expectTraceTreeSpanOperationName(nonReplay.bridgeSpanId, RUM_BRIDGE_OPERATION);
    await pm.tracesPage.expectSessionReplayButtonHidden();
    testLogger.info('Play Session Replay button is correctly hidden for a non-replayable session');
  });

  test('should show the no-replay empty state for a session with no recording', {
    tag: ['@rum-session-replay', '@all', '@P1'],
  }, async ({ page }) => {
    const neverRecordedId = `e2e-never-recorded-${RUN_ID}`;
    testLogger.info('Opening a never-recorded session viewer and asserting the empty state');
    await pm.rumSessionsPage.gotoSessionViewer(neverRecordedId, {
      startTimeUs: seeded.fromUs,
      endTimeUs: seeded.toUs,
    });
    await pm.rumSessionsPage.expectNoReplayEmptyState(neverRecordedId);
    await pm.rumSessionsPage.expectSessionViewerSubtitleHidden();
    await pm.rumSessionsPage.expectSessionViewerShareLinkHidden();
    await pm.rumSessionsPage.expectSessionViewerBackVisible();
    await pm.rumSessionsPage.clickSessionViewerBackAndExpectLeft(neverRecordedId);
    testLogger.info('No-replay empty state rendered with the session id and retained back navigation');
  });
});
