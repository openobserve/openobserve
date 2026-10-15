// The JSON metrics endpoint takes `_timestamp` in MILLIseconds (the logs one takes micros).
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

// Shift by minutes: a window ending past ~30m ago skips the WAL, and back-dated rows reach storage late.
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
