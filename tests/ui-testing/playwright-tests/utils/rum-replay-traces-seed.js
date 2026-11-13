// One RUM session for the session player: a replay in the browser SDK v7.10+ Change format, plus
// more correlated requests than the Traces tab's old 250-row cap, each with a real server span.

const crypto = require('crypto');
const { expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { rumTestContext, basicAuthHeader } = require('./rum-env.js');
const { ingestBase } = require('./ingest-url.js');

const TRACE_ID_FIELD = '_o2_trace_id';
const TRACES_STREAM = 'default';
const MINUTE_MS = 60 * 1000;
// A session that ended within 5 minutes plays as live and holds back its newest segment.
const SESSION_AGE_MS = 20 * MINUTE_MS;
const FILLER_REQUESTS = 255;
const SPAN_MS = 40;

// Record and change type ids of the SDK's Change format (packages/browser-rum sessionReplayConstants).
const RECORD = { FullSnapshot: 2, IncrementalSnapshot: 3, Meta: 4, Focus: 6, Change: 12 };
const CHANGE = {
  AddNode: 1,
  Text: 4,
  AddRoleAnnotatedStrings: 11,
  InputValue: 12,
  InputSelection: 13,
  ClearStrings: 14,
  ImageContent: 15,
};
const ROLE = { NodeName: 1, AttributeName: 2, AttributeValue: 3, Text: 4, InputValue: 5 };
const SELECTED = 0;
const MOUSE_MOVE = 1;

// Sorted after every filler, so a list cut at 250 rows loses all of them.
const SPECIAL_REQUESTS = [
  {
    op: 'GET /api/search?q=50% off&tag=café',
    url: 'https://shop.example.com/api/search?q=50%25%20off&tag=caf%C3%A9',
    route: '/api/search',
    browserMs: 273.25,
    duration: '273.25ms',
    browserStatus: 200,
    serverStatus: 200,
  },
  {
    op: 'GET /api/files/Q4 report #2 (final).pdf',
    url: 'https://shop.example.com/api/files/Q4%20report%20%232%20(final).pdf',
    route: '/api/files/:name',
    browserMs: 1534,
    duration: '1.53s',
    browserStatus: 200,
    serverStatus: 200,
  },
  {
    op: `POST /api/notes?title="launch plan"&owner=o'neil+co`,
    url: 'https://shop.example.com/api/notes?title=%22launch%20plan%22&owner=o%27neil%2Bco',
    route: '/api/notes',
    browserMs: 88.5,
    duration: '88.50ms',
    browserStatus: 201,
    serverStatus: 201,
  },
  {
    op: 'GET /api/orders/ord-404',
    url: 'https://shop.example.com/api/orders/ord-404',
    route: '/api/orders/:id',
    browserMs: 61.75,
    duration: '61.75ms',
    browserStatus: 404,
    serverStatus: 404,
    httpStatus: 'HTTP 404',
  },
  // The browser reads no status for a CORS-opaque failure, so only the server span knows the 503.
  {
    op: 'POST /api/pay',
    url: 'https://pay.example.com/api/pay',
    route: '/api/pay',
    browserMs: 412.5,
    duration: '412.50ms',
    browserStatus: 0,
    serverStatus: 503,
    httpStatus: 'HTTP 503',
  },
];

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function buildFixture() {
  const run = hex(4);
  const t0 = Date.now() - SESSION_AGE_MS;
  const fillers = Array.from({ length: FILLER_REQUESTS }, (_, i) => {
    const id = String(i).padStart(3, '0');
    return {
      op: `GET /api/items/${id}`,
      url: `https://shop.example.com/api/items/${id}`,
      route: '/api/items/:id',
      browserMs: 20 + i,
      duration: `${(20 + i).toFixed(2)}ms`,
      browserStatus: 200,
      serverStatus: 200,
      date: t0 + 1000 + i * 15,
    };
  });
  const specials = SPECIAL_REQUESTS.map((req, k) => ({ ...req, date: t0 + 5000 + k * 200 }));
  const requests = [...fillers, ...specials].map((req) => ({ ...req, traceId: hex(16), spanId: hex(8) }));
  return {
    run,
    t0,
    sessionId: `e2e-v710-${hex(6)}`,
    viewId: `e2e-v710-view-${hex(6)}`,
    applicationId: `e2e-v710-app-${run}`,
    service: `rum-v710-api-${run}`,
    viewUrl: 'https://shop.example.com/checkout',
    replayEndMs: t0 + 8000,
    page: {
      title: `Checkout replay ${run}`,
      status: 'Awaiting payment',
      plan: 'basic',
      confirmed: `Order confirmed ${run}`,
      paid: 'Payment received',
      coupon: `SAVE-${run}`,
      chosenPlan: 'pro',
    },
    requests,
  };
}

/** Collects strings into role groups in first-use order, which is the order the decoder numbers them. */
function roleStrings() {
  const ids = new Map();
  const groups = [];
  return {
    ref(role, value) {
      if (!ids.has(value)) {
        ids.set(value, ids.size);
        const last = groups[groups.length - 1];
        if (last && last[0] === role) last.push(value);
        else groups.push([role, value]);
      }
      return ids.get(value);
    },
    change: () => [CHANGE.AddRoleAnnotatedStrings, ...groups],
  };
}

// Ids follow list order, and each node is appended to its parent (insertion point = id - parentId).
function checkoutDom(page) {
  return [
    { parent: null, name: '#document' },
    { parent: 0, name: '#doctype', doctype: ['html', '', ''] },
    { parent: 0, name: 'HTML', attrs: [['lang', 'en']] },
    { parent: 2, name: 'HEAD' },
    { parent: 2, name: 'BODY' },
    { parent: 4, name: 'H1', attrs: [['id', 'replay-title']] },
    // An inline role-annotated literal, which the SDK writes instead of a table entry.
    { parent: 5, name: '#text', literal: { role: ROLE.Text, string: page.title } },
    { parent: 4, name: 'P', attrs: [['id', 'replay-status']] },
    { parent: 7, name: '#text', text: page.status },
    { parent: 4, name: 'INPUT', attrs: [['id', 'coupon'], ['type', 'text']] },
    { parent: 4, name: 'INPUT', attrs: [['id', 'gift'], ['type', 'checkbox']] },
    { parent: 4, name: 'SELECT', attrs: [['id', 'plan']] },
    { parent: 11, name: 'OPTION', attrs: [['value', page.plan], ['selected', '']] },
    { parent: 12, name: '#text', text: 'Basic plan' },
    { parent: 11, name: 'OPTION', attrs: [['value', page.chosenPlan]] },
    { parent: 14, name: '#text', text: 'Pro plan' },
  ];
}

const NODE = { title: 6, status: 8, coupon: 9, gift: 10, proOption: 14 };

function fullSnapshotData(page) {
  const strings = roleStrings();
  const adds = checkoutDom(page).map((node, id) => {
    const at = node.parent === null ? null : id - node.parent;
    const add = [at, strings.ref(ROLE.NodeName, node.name)];
    if (node.doctype) add.push(...node.doctype);
    if (node.literal) add.push(node.literal);
    if (node.text) add.push(strings.ref(ROLE.Text, node.text));
    for (const [key, value] of node.attrs || []) {
      add.push([strings.ref(ROLE.AttributeName, key), strings.ref(ROLE.AttributeValue, value)]);
    }
    return add;
  });
  return [strings.change(), [CHANGE.AddNode, ...adds]];
}

// ClearStrings restarts the table at 0, so the references below index the strings added after it.
function changeData(page) {
  return [
    [CHANGE.ClearStrings],
    [CHANGE.AddRoleAnnotatedStrings, [ROLE.Text, page.confirmed, page.paid], [ROLE.InputValue, page.coupon]],
    [CHANGE.Text, [NODE.title, 0], [NODE.status, 1]],
    [CHANGE.InputValue, [NODE.coupon, 2]],
    [CHANGE.InputSelection, [SELECTED, NODE.gift], [SELECTED, NODE.proOption]],
    [CHANGE.ImageContent, [NODE.title, 'canvas-resource-id']],
  ];
}

function mouseMove(timestamp, x, y) {
  return {
    type: RECORD.IncrementalSnapshot,
    timestamp,
    data: { source: MOUSE_MOVE, positions: [{ x, y, id: 4, timeOffset: 0 }] },
  };
}

function replaySegments(fx) {
  const { t0, page } = fx;
  return [
    {
      creation_reason: 'init',
      has_full_snapshot: true,
      records: [
        { type: RECORD.Meta, timestamp: t0, data: { href: fx.viewUrl, width: 1024, height: 768 } },
        { type: RECORD.Focus, timestamp: t0, data: { has_focus: true } },
        { type: RECORD.FullSnapshot, format: 1, timestamp: t0, data: fullSnapshotData(page) },
      ],
    },
    {
      creation_reason: 'segment_duration_limit',
      has_full_snapshot: false,
      records: [{ type: RECORD.Change, timestamp: t0 + 3000, data: changeData(page) }],
    },
    {
      creation_reason: 'segment_duration_limit',
      has_full_snapshot: false,
      records: [mouseMove(t0 + 5000, 200, 150), mouseMove(fx.replayEndMs, 320, 240)],
    },
  ];
}

function replayRows(fx) {
  return replaySegments(fx).map((segment, index) => {
    const start = segment.records[0].timestamp;
    const end = segment.records[segment.records.length - 1].timestamp;
    const body = {
      application: { id: fx.applicationId },
      session: { id: fx.sessionId },
      view: { id: fx.viewId },
      start,
      end,
      creation_reason: segment.creation_reason,
      records: segment.records,
      records_count: segment.records.length,
      has_full_snapshot: segment.has_full_snapshot,
      index_in_view: index,
      source: 'browser',
    };
    const segmentJson = JSON.stringify(body);
    return {
      _timestamp: (end + 500) * 1000,
      application_id: fx.applicationId,
      session_id: fx.sessionId,
      view_id: fx.viewId,
      start,
      end,
      creation_reason: segment.creation_reason,
      records_count: segment.records.length,
      has_full_snapshot: segment.has_full_snapshot,
      index_in_view: index,
      raw_segment_size: segmentJson.length,
      compressed_segment_size: segmentJson.length,
      source: 'browser',
      user_agent_user_agent_family: 'Chrome',
      user_agent_os_family: 'Mac OS X',
      user_agent_device_family: 'Mac',
      ip: '127.0.0.1',
      segment: segmentJson,
    };
  });
}

function rumRows(fx) {
  const base = {
    session_id: fx.sessionId,
    view_id: fx.viewId,
    view_url: fx.viewUrl,
    view_loading_type: 'initial_load',
    service: 'shop-frontend',
    application_id: fx.applicationId,
    source: 'browser',
    session_has_replay: true,
  };
  const view = { ...base, _timestamp: fx.t0 * 1000, date: fx.t0, type: 'view', usr_id: 'e2e-user' };
  const resources = fx.requests.map((req) => ({
    ...base,
    _timestamp: req.date * 1000,
    date: req.date,
    type: 'resource',
    resource_url: req.url,
    resource_type: 'fetch',
    resource_method: req.op.split(' ')[0],
    resource_status_code: req.browserStatus,
    resource_duration: Math.round(req.browserMs * 1000000),
    [TRACE_ID_FIELD]: req.traceId,
  }));
  return [view, ...resources];
}

// Spans are SERVER spans with an UNSET status, as OpenTelemetry leaves a 4xx or 5xx answer.
function tracePayload(fx) {
  const str = (key, value) => ({ key, value: { stringValue: String(value) } });
  const int = (key, value) => ({ key, value: { intValue: String(value) } });
  const spans = fx.requests.map((req) => {
    const startNs = BigInt(req.date + 5) * 1000000n;
    return {
      traceId: req.traceId,
      spanId: req.spanId,
      name: req.op,
      kind: 2,
      startTimeUnixNano: String(startNs),
      endTimeUnixNano: String(startNs + BigInt(SPAN_MS) * 1000000n),
      attributes: [
        str('http.method', req.op.split(' ')[0]),
        str('http.route', req.route),
        str('http.url', req.url),
        int('http.response.status_code', req.serverStatus),
      ],
      status: { code: 0 },
    };
  });
  return {
    resourceSpans: [
      {
        resource: { attributes: [str('service.name', fx.service)] },
        scopeSpans: [{ scope: { name: 'rum-v710-e2e' }, spans }],
      },
    ],
  };
}

function apiContext() {
  const { orgId, baseUrl, email, password } = rumTestContext();
  return {
    orgId,
    baseUrl,
    headers: { Authorization: basicAuthHeader(email, password), 'Content-Type': 'application/json' },
  };
}

async function post(page, url, data, what) {
  const { headers } = apiContext();
  const res = await page.request.post(url, { headers, data });
  const body = await res.text();
  if (!res.ok()) throw new Error(`${what} ingest failed: HTTP ${res.status()} ${body.slice(0, 500)}`);
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  const failed = Number(parsed?.status?.[0]?.failed) || 0;
  const rejected = Number(parsed?.partialSuccess?.rejectedSpans) || 0;
  if (failed > 0 || rejected > 0) throw new Error(`${what} ingest dropped rows: ${body.slice(0, 500)}`);
}

async function countRows(page, type, sql, fx) {
  const { orgId, baseUrl, headers } = apiContext();
  const res = await page.request.post(`${baseUrl}/api/${orgId}/_search?type=${type}`, {
    headers,
    data: {
      query: {
        sql,
        start_time: (fx.t0 - 60 * MINUTE_MS) * 1000,
        end_time: (Date.now() + 10 * MINUTE_MS) * 1000,
        from: 0,
        size: 1,
      },
    },
  });
  if (!res.ok()) return -1;
  return Number((await res.json())?.hits?.[0]?.n ?? 0);
}

async function waitForCount(page, type, sql, fx, expected, message) {
  await expect
    .poll(() => countRows(page, type, sql, fx), { message, timeout: 120000, intervals: [2000, 3000, 5000] })
    .toBe(expected);
}

/** Ingests the replay, the RUM events and the traces, and returns once search sees every row. */
async function seedReplayTracesSession(page) {
  const fx = buildFixture();
  const { orgId, baseUrl } = apiContext();
  const ingest = ingestBase(baseUrl);
  await post(page, `${ingest}/api/${orgId}/_sessionreplay/_json`, replayRows(fx), '_sessionreplay');
  await post(page, `${ingest}/api/${orgId}/_rumdata/_json`, rumRows(fx), '_rumdata');
  await post(page, `${ingest}/api/${orgId}/v1/traces`, tracePayload(fx), 'traces');

  const session = `session_id = '${fx.sessionId}'`;
  await waitForCount(page, 'logs', `SELECT COUNT(*) AS n FROM "_sessionreplay" WHERE ${session}`, fx, 3,
    'all three replay segments must be searchable');
  await waitForCount(page, 'logs', `SELECT COUNT(*) AS n FROM "_rumdata" WHERE ${session} AND type = 'resource'`, fx,
    fx.requests.length, 'every resource event must be searchable');
  await waitForCount(page, 'traces',
    `SELECT COUNT(DISTINCT trace_id) AS n FROM "${TRACES_STREAM}" WHERE service_name = '${fx.service}'`, fx,
    fx.requests.length, 'every request trace must be searchable');

  testLogger.info('Seeded v7.10 replay and traces session', {
    sessionId: fx.sessionId,
    requests: fx.requests.length,
  });
  return {
    sessionId: fx.sessionId,
    viewerStartUs: (fx.t0 - 60 * MINUTE_MS) * 1000,
    replaySeconds: Math.floor((fx.replayEndMs - fx.t0) / 1000),
    page: fx.page,
    specialOps: SPECIAL_REQUESTS.map((req) => req.op),
    requests: fx.requests.map(({ op, duration, httpStatus }) => ({
      op,
      duration,
      status: httpStatus ? '1 ERROR' : 'SUCCESS',
      httpStatus: httpStatus || null,
    })),
  };
}

module.exports = { seedReplayTracesSession };
