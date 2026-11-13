// The JSON metrics endpoint takes `_timestamp` in MILLIseconds (the logs one takes micros).
const { expect } = require('@playwright/test');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const { ingestBase } = require('./ingest-url.js');

const org = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const baseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

/** Gauge back-filled over the last 40 minutes, for the time-shift overlay. */
const TIME_SHIFT_METRIC = 'e2e_timeshift_gauge';

/** Three metrics sharing the `e2e_mef_http_` prefix, for Breakdown / Related. */
const DETAIL_METRIC = 'e2e_mef_http_requests_total';
const RELATED_METRIC = 'e2e_mef_http_errors_total';
const RELATED_GAUGE = 'e2e_mef_http_inflight';

async function postRows(request, rows) {
  const res = await request.post(`${ingestBase(baseUrl())}/api/${org()}/ingest/metrics/_json`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: rows,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || body.code !== 200) {
    throw new Error(`metrics _json ingest failed: ${res.status()} ${JSON.stringify(body)}`);
  }
}

async function promql(request, path) {
  const res = await request.get(`${baseUrl()}/api/${org()}/prometheus/api/v1/${path}`, {
    headers: getAuthHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  return body?.data?.result?.length ?? 0;
}

/** Polls an instant query until it returns a series — the ingest ack precedes searchability. */
async function waitForInstantQuery(request, query, timeout = 60_000) {
  await expect
    .poll(() => promql(request, `query?query=${encodeURIComponent(query)}`), {
      timeout,
      intervals: [1000, 2000, 2000, 5000],
      message: `${query} never became queryable`,
    })
    .toBeGreaterThan(0);
}

/** Seconds between the first and last finite sample across every series of an SSE query_range body. */
function sampleSpanSeconds(sseBody) {
  const stamps = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, val] of Object.entries(node)) {
      if (key === 'values' && Array.isArray(val)) {
        for (const pair of val) if (Array.isArray(pair) && Number.isFinite(Number(pair[1]))) stamps.push(Number(pair[0]));
      } else walk(val);
    }
  };
  for (const line of sseBody.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      walk(JSON.parse(line.slice(5)));
    } catch {
      // keep-alive and non-JSON lines carry no samples
    }
  }
  return stamps.length ? Math.max(...stamps) - Math.min(...stamps) : 0;
}

// Same request as a 15m panel's shifted stream; use_cache=false recomputes it and overwrites a cache entry taken before the back-filled rows were readable.
async function waitForPanelShiftedSeries(request, offsetMinutes, timeout = 240_000) {
  await expect
    .poll(
      async () => {
        const endUs = (Date.now() - offsetMinutes * 60_000) * 1000;
        const startUs = endUs - 15 * 60 * 1_000_000;
        const qs = `use_streaming=true&use_cache=false&start=${startUs}&end=${endUs}&step=0&query=${encodeURIComponent(TIME_SHIFT_METRIC)}`;
        // A bodiless POST carrying the JSON content type is rejected with 415.
        const res = await request.post(`${baseUrl()}/api/${org()}/prometheus/api/v1/query_range?${qs}`, {
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!res.ok()) throw new Error(`shifted query_range answered ${res.status()}: ${(await res.text()).slice(0, 200)}`);
        return sampleSpanSeconds(await res.text());
      },
      {
        timeout,
        intervals: [2000, 5000],
        message: `${TIME_SHIFT_METRIC} samples never spanned 10m of the panel's ${offsetMinutes}m-shifted streaming window`,
      },
    )
    .toBeGreaterThanOrEqual(600);
}

// Shift by minutes: PromQL reads unflushed rows only for a window ending after now − 3×ZO_MAX_FILE_RETENTION_TIME (30m by default).
async function seedTimeShiftMetric(request) {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i <= 80; i++) {
    rows.push({
      __name__: TIME_SHIFT_METRIC,
      __type__: 'gauge',
      host: 'ts-a',
      _timestamp: now - (80 - i) * 30_000,
      value: 20 + (i % 5),
    });
  }
  await postRows(request, rows);
  await waitForInstantQuery(request, TIME_SHIFT_METRIC);
  await waitForPanelShiftedSeries(request, 10);
}

// method has 2 values (a breakdown without topk); status pins "500" for Add-to-filter.
async function seedDetailMetrics(request) {
  const now = Date.now();
  const series = [];
  for (const method of ['GET', 'POST']) {
    for (const status of ['200', '500']) {
      for (const instance of ['i-1', 'i-2', 'i-3']) series.push({ method, status, instance });
    }
  }
  const rows = [];
  for (let i = 0; i <= 40; i++) {
    const ts = now - (40 - i) * 15_000;
    series.forEach((labels, s) => {
      rows.push({ __name__: DETAIL_METRIC, __type__: 'counter', ...labels, _timestamp: ts, value: (s + 1) * 10 * i });
      rows.push({ __name__: RELATED_METRIC, __type__: 'counter', ...labels, _timestamp: ts, value: (s + 1) * i });
    });
    rows.push({ __name__: RELATED_GAUGE, __type__: 'gauge', instance: 'i-1', _timestamp: ts, value: i % 7 });
  }
  await postRows(request, rows);
  await waitForInstantQuery(request, DETAIL_METRIC);
  await waitForInstantQuery(request, RELATED_METRIC);
}

module.exports = {
  TIME_SHIFT_METRIC,
  DETAIL_METRIC,
  RELATED_METRIC,
  RELATED_GAUGE,
  seedTimeShiftMetric,
  seedDetailMetrics,
};
