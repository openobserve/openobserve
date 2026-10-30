// Copyright 2026 OpenObserve Inc.
/** REST plumbing for trace regression specs; every helper takes an APIRequestContext (page.request or the request fixture). */
const { expect } = require('@playwright/test');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

const MINUTE_US = 60 * 1000 * 1000;
const HOUR_US = 60 * MINUTE_US;

const ingestionBaseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
const apiBaseUrl = () => (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
const orgId = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const stringAttr = (key, value) => ({ key, value: { stringValue: value } });
const intAttr = (key, value) => ({ key, value: { intValue: String(value) } });

/** Ingest an OTLP/JSON `{ resourceSpans }` payload into `stream` and assert it returned 200. */
async function ingestOtlpTraces(request, stream, payload, { message = 'Precondition: traces must ingest', org = orgId() } = {}) {
  const response = await request.post(`${ingestionBaseUrl()}/api/${org}/v1/traces`, {
    headers: { ...getAuthHeaders(), 'stream-name': stream },
    data: payload,
  });
  expect(response.status(), message).toBe(200);
}

/** Ingest RUM rows into `_rumdata` and assert it returned 200. */
async function ingestRumData(request, rows, { message = 'Precondition: RUM rows must ingest', org = orgId() } = {}) {
  const response = await request.post(`${ingestionBaseUrl()}/api/${org}/_rumdata/_json`, {
    headers: getAuthHeaders(),
    data: rows,
  });
  expect(response.status(), message).toBe(200);
}

/** Run one SQL search over [startUs, endUs] (default: the last hour, one minute ahead); `hits` is [] unless the response is OK. */
async function searchStream(request, sql, { type = 'traces', startUs, endUs, size = 100, org = orgId() } = {}) {
  const windowEndUs = endUs ?? Date.now() * 1000 + MINUTE_US;
  const windowStartUs = startUs ?? windowEndUs - HOUR_US;
  const response = await request.post(`${ingestionBaseUrl()}/api/${org}/_search?type=${type}`, {
    headers: getAuthHeaders(),
    data: { query: { sql, start_time: windowStartUs, end_time: windowEndUs, from: 0, size } },
  });
  const text = await response.text();
  return { status: response.status(), text, hits: response.ok() ? JSON.parse(text).hits || [] : [] };
}

/** Poll searchStream until `pick(result)` (default: the hit count) equals `expected`, and return the last result. */
async function waitForSearch(request, sql, { expected, message, pick = (result) => result.hits.length, timeout = 60000, ...searchOpts }) {
  let last = null;
  await expect.poll(async () => {
    last = await searchStream(request, sql, searchOpts);
    return pick(last);
  }, { timeout, intervals: [2000], message }).toBe(expected);
  return last;
}

/** Field names in a stream's schema, or [] when the schema cannot be read. */
async function streamFieldNames(request, stream, { type = 'traces', org = orgId() } = {}) {
  const response = await request.get(`${ingestionBaseUrl()}/api/${org}/streams/${stream}/schema?type=${type}`, { headers: getAuthHeaders() });
  if (!response.ok()) return [];
  return ((await response.json()).schema || []).map((field) => field.name);
}

/** Best-effort stream delete for afterEach, so cleanup never masks the test's own result. */
async function deleteStream(request, stream, { type = 'traces', org = orgId() } = {}) {
  await request
    .delete(`${ingestionBaseUrl()}/api/${org}/streams/${stream}?type=${type}`, { headers: getAuthHeaders() })
    .catch(() => {});
}

/** Create a saved view, assert it returned 200, and resolve to its view_id. */
async function createSavedView(request, view, { message = 'Precondition: saved view must be created', org = orgId() } = {}) {
  const response = await request.post(`${apiBaseUrl()}/api/${org}/savedviews`, {
    headers: getAuthHeaders(),
    data: view,
  });
  expect(response.status(), message).toBe(200);
  return (await response.json()).view_id;
}

/** Best-effort saved-view delete for afterEach; a missing id is a no-op. */
async function deleteSavedView(request, viewId, { org = orgId() } = {}) {
  if (!viewId) return;
  await request
    .delete(`${apiBaseUrl()}/api/${org}/savedviews/${viewId}`, { headers: getAuthHeaders() })
    .catch(() => {});
}

module.exports = {
  orgId,
  stringAttr,
  intAttr,
  ingestOtlpTraces,
  ingestRumData,
  searchStream,
  waitForSearch,
  streamFieldNames,
  deleteStream,
  createSavedView,
  deleteSavedView,
};
