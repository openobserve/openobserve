// Exemplar E2E fixtures, independent of the shared metric seed so request-count assertions see only this suite.
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const testLogger = require('./test-logger.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || 'default';

let runSeq = 0;

/** Stream names for one spec file; a fresh prefix keeps marker counts exact when a data dir is reused. */
function newRun() {
  // Time, process and a per-process counter: parallel workers loading this module in the same millisecond still differ.
  const PREFIX = `e2e_exemplar_${Date.now().toString(36)}_${process.pid.toString(36)}_${(++runSeq).toString(36)}`;
  return {
    PREFIX,
    HIST: `${PREFIX}_latency_seconds`,
    COUNTER: `${PREFIX}_requests_total`,
    SPARSE: `${PREFIX}_empty_seconds`,
    NOTRACE: `${PREFIX}_notrace_seconds`,
    SPIKE: `${PREFIX}_spike_seconds`,
  };
}
const SERVICE = 'e2e-exemplar-svc';

const hex = (bytes) => Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');

/** One exemplar per point; the first trace also exists as a real span, the second is never ingested. */
function buildFixtureIds(points) {
  return Array.from({ length: points }, (_, i) => ({ traceId: hex(16), spanId: hex(8), ingestTrace: i % 2 === 0 }));
}

function histogramPayload(run, ids, nowNs) {
  // 30 s apart: dense enough for the explorer's 1m rate window, sparse enough to hover one marker at a time.
  const step = 30n * 1_000_000_000n;
  const dataPoints = ids.map((id, i) => {
    const t = nowNs - BigInt(ids.length - i) * step;
    return {
      attributes: [{ key: 'route', value: { stringValue: '/pay' } }],
      startTimeUnixNano: String(t - step),
      timeUnixNano: String(t),
      // Cumulative counters must grow, or every rate() and so every percentile is empty.
      count: String(10 * (i + 1)),
      sum: 2.5 * (i + 1),
      bucketCounts: [2, 3, 3, 2].map((c) => String(c * (i + 1))),
      explicitBounds: [0.1, 0.25, 0.5],
      exemplars: [{
        timeUnixNano: String(t - 1_000_000n),
        // Below the p99 line (0.5), so a probe around a marker never touches a series pixel.
        asDouble: 0.2 + i * 0.004,
        traceId: id.traceId,
        spanId: id.spanId,
        filteredAttributes: [{ key: 'http_route', value: { stringValue: '/pay' } }],
      }],
    };
  });
  const counterPoints = dataPoints.map((p, i) => ({
    attributes: p.attributes,
    startTimeUnixNano: p.startTimeUnixNano,
    timeUnixNano: p.timeUnixNano,
    asDouble: 100 + i * 7,
    exemplars: [{ timeUnixNano: p.exemplars[0].timeUnixNano, asDouble: 1, filteredAttributes: [{ key: 'pod', value: { stringValue: 'api-0' } }] }],
  }));
  const plainPoints = dataPoints.map((p) => ({ ...p, exemplars: [] }));
  // No trace_id/span_id: the exemplar has a label but no trace reference, so the card resolves to `none`.
  const notracePoints = dataPoints.map((p) => ({
    ...p,
    exemplars: [{
      timeUnixNano: p.exemplars[0].timeUnixNano,
      asDouble: p.exemplars[0].asDouble,
      filteredAttributes: [{ key: 'route', value: { stringValue: '/pay' } }],
    }],
  }));
  // Value far above the p99 line, so the marker clamps to the top of the drawn axis.
  const spikePoints = dataPoints.map((p) => ({
    ...p,
    exemplars: p.exemplars.map((e) => ({ ...e, asDouble: 1e6 })),
  }));
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: SERVICE } }] },
      scopeMetrics: [{
        scope: { name: 'e2e-exemplars' },
        metrics: [
          { name: run.HIST, unit: 's', histogram: { aggregationTemporality: 2, dataPoints } },
          { name: run.COUNTER, sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: counterPoints } },
          { name: run.SPARSE, unit: 's', histogram: { aggregationTemporality: 2, dataPoints: plainPoints } },
          { name: run.NOTRACE, unit: 's', histogram: { aggregationTemporality: 2, dataPoints: notracePoints } },
          { name: run.SPIKE, unit: 's', histogram: { aggregationTemporality: 2, dataPoints: spikePoints } },
        ],
      }],
    }],
  };
}

function tracesPayload(ids, nowNs) {
  const spans = ids.filter((id) => id.ingestTrace).map((id) => ({
    traceId: id.traceId,
    spanId: id.spanId,
    name: 'POST /pay',
    kind: 2,
    startTimeUnixNano: String(nowNs - 120_000_000_000n),
    endTimeUnixNano: String(nowNs - 119_700_000_000n),
    attributes: [{ key: 'http.route', value: { stringValue: '/pay' } }],
    status: { code: 1 },
  }));
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: SERVICE } }] },
      scopeSpans: [{ scope: { name: 'e2e-exemplars' }, spans }],
    }],
  };
}

async function post(path, body) {
  const res = await fetch(`${BASE}/api/${ORG()}${path}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch (_) { return text; }
}

/** Ingests metrics with exemplars and the traces for every other exemplar; returns the ids used. */
async function ingestExemplarFixtures(run, points = 32) {
  const ids = buildFixtureIds(points);
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  await post('/v1/traces', tracesPayload(ids, nowNs));
  await post('/v1/metrics', histogramPayload(run, ids, nowNs));
  testLogger.info('Exemplar fixtures ingested', { points, traces: ids.filter((i) => i.ingestTrace).length });
  return { ids, found: ids.filter((i) => i.ingestTrace), missing: ids.filter((i) => !i.ingestTrace) };
}

/** Waits until query_exemplars returns something for the histogram, since ingestion is asynchronous. */
async function waitForExemplars(run, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`${run.HIST}_bucket`);
  while (Date.now() < deadline) {
    const end = Date.now() * 1000;
    const start = end - 3_600_000_000;
    const res = await fetch(`${BASE}/api/${ORG()}/prometheus/api/v1/query_exemplars?query=${query}&start=${start}&end=${end}`, { headers: getAuthHeaders() });
    const body = await res.json().catch(() => null);
    if ((body?.data ?? []).some((s) => (s.exemplars ?? []).length)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// v8 Layout.i is an integer, so each panel gets its own number.
let layoutSeq = 0;

function panel(id, { title, type = 'line', queries, showExemplars, layoutY = 0, unit = 'seconds', unitCustom }) {
  return {
    id,
    type,
    title,
    description: '',
    queryType: 'promql',
    config: { show_legends: true, legends_position: null, decimals: 3, unit, ...(unitCustom ? { unit_custom: unitCustom } : {}), ...(showExemplars === undefined ? {} : { show_exemplars: showExemplars }) },
    queries: queries.map((q) => ({
      query: q.query,
      customQuery: true,
      fields: { stream: '', stream_type: 'metrics', x: [], y: [], z: [], filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
      config: { promql_legend: q.legend ?? '', query_type: q.queryType ?? 'range' },
    })),
    layout: { x: 0, y: layoutY, w: 192, h: 14, i: ++layoutSeq },
  };
}

/** Creates a v8 dashboard with the given panels; returns its id. */
async function createExemplarDashboard(title, panels) {
  const result = await post('/dashboards?folder=default', {
    version: 8,
    title,
    description: 'exemplars e2e',
    tabs: [{ tabId: 'default', name: 'Default', panels }],
  });
  const inner = result[`v${result.version}`] || result;
  return inner.dashboardId || inner.dashboard_id;
}

async function getDashboardJson(dashboardId) {
  const res = await fetch(`${BASE}/api/${ORG()}/dashboards/${dashboardId}?folder=default`, { headers: getAuthHeaders() });
  return res.json();
}

/** Deletes every metrics stream this run created, so reruns do not pile up streams. */
async function deleteRunStreams(run) {
  const res = await fetch(`${BASE}/api/${ORG()}/streams?type=metrics`, { headers: getAuthHeaders() });
  const body = await res.json().catch(() => ({}));
  const names = (body?.list ?? []).map((s) => s.name).filter((n) => n.startsWith(run.PREFIX));
  for (const name of names) {
    await fetch(`${BASE}/api/${ORG()}/streams/${name}?type=metrics&delete_all=true`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
  }
  return names.length;
}

async function deleteDashboard(dashboardId) {
  if (!dashboardId) return;
  await fetch(`${BASE}/api/${ORG()}/dashboards/${dashboardId}?folder=default`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
}

/** Counts matching requests from the moment it is created. */
function requestLog(page) {
  const log = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/prometheus/api/v1/query_exemplars') || url.includes('/prometheus/api/v1/query_range') || url.includes('/traces/time_range')) {
      log.push(new URL(url));
    }
  });
  return {
    exemplars: () => log.filter((u) => u.pathname.endsWith('/query_exemplars')),
    ranges: () => log.filter((u) => u.pathname.endsWith('/query_range')),
    traceLookups: () => log.filter((u) => u.pathname.endsWith('/traces/time_range')),
    clear: () => log.splice(0, log.length),
  };
}

module.exports = {
  newRun,
  ingestExemplarFixtures,
  waitForExemplars,
  panel,
  createExemplarDashboard,
  getDashboardJson,
  deleteDashboard,
  deleteRunStreams,
  requestLog,
};
