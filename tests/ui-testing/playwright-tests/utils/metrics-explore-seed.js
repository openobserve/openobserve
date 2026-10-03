/**
 * Deterministic metric seeds for the metrics-exploration suites: PromQL time
 * shift, the Explorer detail view (Breakdown / Related) and query history.
 *
 * The shared OTLP seed (shared-metrics-setup.js) picks label values at random
 * and only ever writes "now", so it can neither back a shifted-window overlay
 * nor pin a breakdown value such as status="500". These rows go through the JSON
 * metrics endpoint, whose `_timestamp` is MILLIseconds (the logs one is micros).
 */
const { expect } = require('@playwright/test');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

const org = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const baseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

/** Gauge back-filled over the last 40 minutes, for the time-shift overlay. */
const TIME_SHIFT_METRIC = 'e2e_timeshift_gauge';

/** Three metrics sharing the `e2e_mef_http_` prefix, for Breakdown / Related. */
const DETAIL_METRIC = 'e2e_mef_http_requests_total';
const RELATED_METRIC = 'e2e_mef_http_errors_total';
const RELATED_GAUGE = 'e2e_mef_http_inflight';

async function postRows(request, rows) {
  const res = await request.post(`${baseUrl()}/api/${org()}/ingest/metrics/_json`, {
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

/**
 * One gauge series, a point every 30s over the last 40 minutes.
 *
 * Why the tests shift by minutes and not by a day: a PromQL window that ends
 * before now − 3 × ZO_MAX_FILE_RETENTION_TIME (30 minutes by default) is read
 * from storage only, never the WAL, and back-dated rows reach storage only
 * after the WAL rotates them out — 15-20 minutes on a default server. A shifted
 * window that ends inside the last 30 minutes is answered from the WAL at once.
 */
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
}

/**
 * Two counters and a gauge under one prefix, a point every 15s over the last
 * 10 minutes. method has 2 values (a breakdown chart without topk) and status
 * pins "500" for the Add-to-filter case.
 */
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
