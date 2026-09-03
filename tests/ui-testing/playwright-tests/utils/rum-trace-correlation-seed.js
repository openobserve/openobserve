// RUM → distributed-trace correlation seed helper.
// --------------------------------------------------------------------------
// The RUM trace time-range feature is only observable when a `_rumdata` row
// carries a trace id (stored as `_o2_trace_id`) AND a matching OTLP trace
// exists in the `default` traces stream with the same 32-char padded hex id.
// No existing ingestion helper emits a trace id into `_rumdata` (the CDN/NPM
// fixtures and `ingestRumErrors` do not), so this module is the single source
// of truth for that correlated seed.
//
// It writes three streams, exactly as the Setup Contract prescribes:
//   - `_rumdata`       : one `action` event + one `resource` event sharing the
//                        same `action_id`; the resource carries `_o2_trace_id`.
//   - `_sessionreplay` : one row so SessionViewer.getSession() derives
//                        start_time/end_time (drives the events sidebar + the
//                        PlayerTracesTab window).
//   - `default`        : one OTLP trace whose traceId equals the `_o2_trace_id`.
// It then polls until BOTH the `_rumdata` row is searchable and the trace time
// index (`traces/time_range`) reports `status: "found"` with a range, so the
// UI assertions never race the async index seeding.

const crypto = require('crypto');
const testLogger = require('./test-logger.js');
const { rumTestContext, basicAuthHeader } = require('./rum-env.js');
const { waitForStreamRows } = require('./rum-stream-verify.js');

const SPAN_START_OFFSET_MS = 120000; // 2 min before "now" — outlives the ±10 s guess
const SESSION_WINDOW_MS = 300000; // 5 min — session replay window that covers the span

/** 32-char padded hex trace id (crypto.randomBytes is always 16 bytes). */
function generatePaddedTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * A trace id with leading zeros, as SDK 0.4.0-beta.7 … 0.4.2-beta.2 stored it
 * (BigInt toString(16) drops leading zeros). The traces stream stores the
 * PADDED form; `_rumdata` stores the STRIPPED form. normalizeTraceId() must
 * re-pad the stripped value to the padded id.
 */
function generateLegacyStrippedTraceId() {
  const padded = '0'.repeat(8) + crypto.randomBytes(12).toString('hex');
  const stripped = padded.replace(/^0+/, '') || '0';
  return { padded, stripped };
}

/** Ingest ONE OTLP trace with a CONTROLLED traceId into the `default` stream. */
async function ingestOtlpTrace(page, { traceId, spanStartOffsetMs = SPAN_START_OFFSET_MS }) {
  const { orgId, baseUrl, email, password } = rumTestContext();
  const auth = basicAuthHeader(email, password);
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const spanStartNs = nowNs - BigInt(spanStartOffsetMs) * 1_000_000n;
  const spanId = crypto.randomBytes(8).toString('hex');

  const data = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'checkout-svc' } }] },
        scopeSpans: [
          {
            scope: { name: 'e2e-rum-trace' },
            spans: [
              {
                traceId,
                spanId,
                name: 'checkout-op',
                kind: 2,
                startTimeUnixNano: String(spanStartNs),
                endTimeUnixNano: String(nowNs),
                attributes: [],
                status: {},
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await page.request.post(`${baseUrl}/api/${orgId}/v1/traces`, {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    data,
  });
  // OTLP returns 200 on full success and 206 on partial — both are OK.
  if (!res.ok() && res.status() !== 206) {
    throw new Error(`OTLP trace ingest failed: ${res.status()} ${await res.text()}`);
  }
  return { traceId, spanId };
}

/** Ingest the RUM `_rumdata` action+resource pair and the `_sessionreplay` row. */
async function ingestRumSession(
  page,
  { sessionId, actionId, traceId, includeTraceId, startMs, endMs, service },
) {
  const { orgId, baseUrl, email, password } = rumTestContext();
  const auth = basicAuthHeader(email, password);
  const nowMs = Date.now();

  // One action event (the sidebar-clicked event) + one related resource event
  // sharing the SAME action_id. The resource is the row that renders the
  // view-trace-btn because it carries `_o2_trace_id`.
  const records = [
    {
      date: nowMs,
      type: 'action',
      action_id: actionId,
      action_type: 'click',
      session_id: sessionId,
      service,
      version: '1.0.0-e2e',
    },
    {
      date: nowMs,
      type: 'resource',
      action_id: actionId,
      resource_url: 'http://localhost/checkout',
      resource_method: 'GET',
      resource_duration: 100000000,
      resource_status_code: 200,
      session_id: sessionId,
      service,
      version: '1.0.0-e2e',
      ...(includeTraceId ? { _o2_trace_id: traceId } : {}),
    },
  ];

  const rumRes = await page.request.post(`${baseUrl}/api/${orgId}/_rumdata/_json`, {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    data: records,
  });
  if (!rumRes.ok()) {
    throw new Error(`_rumdata ingest failed: ${rumRes.status()} ${await rumRes.text()}`);
  }

  // `_sessionreplay` row: SessionViewer.getSession() reads min(start)/max(end)
  // (ms) to derive the window used by the events sidebar + PlayerTracesTab.
  // `segment: "[]"` keeps getSessionSegments() from JSON.parse(undefined).
  const replayRows = [
    {
      session_id: sessionId,
      start: startMs,
      end: endMs,
      source: service,
      segment: '[]',
      user_agent_user_agent_family: 'Chrome',
      user_agent_os_family: 'Mac OS',
      ip: '127.0.0.1',
    },
  ];
  const replayRes = await page.request.post(`${baseUrl}/api/${orgId}/_sessionreplay/_json`, {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    data: replayRows,
  });
  if (!replayRes.ok()) {
    throw new Error(`_sessionreplay ingest failed: ${replayRes.status()} ${await replayRes.text()}`);
  }
}

/**
 * Poll `GET /api/{org}/traces/time_range?trace_id=…` until the index reports
 * `status: "found"` with a `range`, or the deadline passes (returns null).
 * The index is seeded asynchronously on ingestion, so this is the ONLY
 * reliable gate before asserting indexed-window behavior.
 */
async function pollTraceTimeRange(page, traceId, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const { orgId, baseUrl, email, password } = rumTestContext();
  const auth = basicAuthHeader(email, password);
  const nowUs = Date.now() * 1000;
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url =
      `${baseUrl}/api/${orgId}/traces/time_range` +
      `?trace_id=${traceId}` +
      `&start_time=${nowUs - 3600 * 1000000}` +
      `&end_time=${nowUs + 3600 * 1000000}` +
      `&hint_ts=${nowUs}`;
    const res = await page.request.get(url, { headers: { Authorization: auth } });
    if (res.ok()) {
      const body = await res.json().catch(() => null);
      const result = (body?.results || []).find((r) => r?.trace_id === traceId);
      if (result?.status === 'found' && result?.range?.start_time != null && result?.range?.end_time != null) {
        return { stream: result.stream, range: result.range };
      }
    }
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(intervalMs);
  }
}

/**
 * Seed a fully correlated RUM session. Returns the ids + window + indexed range
 * so the spec can compute the exact expected `from`/`to` for the drawer test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {boolean} [options.withBackendTrace=true] ingest the matching OTLP trace
 * @param {boolean} [options.includeTraceId=true]    resource row carries `_o2_trace_id`
 * @param {boolean} [options.legacyStrippedId=false] store a zero-stripped id in `_rumdata`
 * @param {number}  [options.spanStartOffsetMs]      span start offset (defaults to 2 min)
 * @returns {Promise<{traceId, sessionId, actionId, startMs, endMs, range}>}
 */
async function seedCorrelatedSession(page, options = {}) {
  const {
    withBackendTrace = true,
    includeTraceId = true,
    legacyStrippedId = false,
    spanStartOffsetMs = SPAN_START_OFFSET_MS,
  } = options;

  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sessionId = `e2e-rum-trace-${runId}`;
  const actionId = `e2e-action-${runId}`;
  const service = `e2e-rum-trace-test-${runId}`;

  let paddedTraceId;
  let rumTraceId;
  if (legacyStrippedId) {
    const { padded, stripped } = generateLegacyStrippedTraceId();
    paddedTraceId = padded;
    rumTraceId = stripped;
  } else {
    paddedTraceId = generatePaddedTraceId();
    rumTraceId = paddedTraceId;
  }

  const nowMs = Date.now();
  const startMs = nowMs - SESSION_WINDOW_MS;
  const endMs = nowMs;

  testLogger.info('Seeding correlated RUM session', { sessionId, actionId, traceId: paddedTraceId });

  await ingestRumSession(page, {
    sessionId,
    actionId,
    traceId: rumTraceId,
    includeTraceId,
    startMs,
    endMs,
    service,
  });

  let range = null;
  if (withBackendTrace) {
    await ingestOtlpTrace(page, { traceId: paddedTraceId, spanStartOffsetMs });
  }

  // Wait for the _rumdata row(s) to be searchable. The trace id column may not
  // be hydrated in the schema yet on a first-ever ingest; query by session id
  // first (always present), then the trace id (feature column).
  const rumHits = await waitForStreamRows(page, {
    sql: `SELECT * FROM "_rumdata" WHERE session_id = '${sessionId}'`,
    minRows: 2,
    timeoutMs: 45000,
  });
  if (rumHits.length < 2) {
    throw new Error(`_rumdata rows not searchable for session ${sessionId}`);
  }
  // The session viewer's events sidebar + PlayerTracesTab window both depend on
  // the _sessionreplay row being searchable (SessionViewer.getSession()).
  const replayHits = await waitForStreamRows(page, {
    sql: `SELECT * FROM "_sessionreplay" WHERE session_id = '${sessionId}'`,
    minRows: 1,
    timeoutMs: 45000,
  });
  if (replayHits.length === 0) {
    throw new Error(`_sessionreplay row not searchable for session ${sessionId}`);
  }
  if (includeTraceId) {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumdata" WHERE session_id = '${sessionId}' AND _o2_trace_id = '${rumTraceId}'`,
      minRows: 1,
      timeoutMs: 45000,
    });
    if (hits.length === 0) {
      throw new Error(`_o2_trace_id not searchable in _rumdata for session ${sessionId}`);
    }
  }

  if (withBackendTrace) {
    range = await pollTraceTimeRange(page, paddedTraceId);
  }

  testLogger.info('Correlated RUM session seeded', { sessionId, traceId: paddedTraceId, range });
  return { traceId: paddedTraceId, sessionId, actionId, startMs, endMs, range };
}

module.exports = {
  seedCorrelatedSession,
  generatePaddedTraceId,
  generateLegacyStrippedTraceId,
  pollTraceTimeRange,
};
