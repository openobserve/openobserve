// Copyright 2026 OpenObserve Inc.

/**
 * Shared API helpers for the Alerts 4.0 (multi-alert) specs.
 *
 * The `-api`, `-ui` and `-regression` specs all drive the same v1/v2 alert
 * endpoints, seed the same fixtures, and build the same canonical payloads.
 * This module is the single source of truth for that plumbing so the three
 * specs stay in lockstep. It deliberately contains NO test/expect calls —
 * assertions belong in the spec files.
 */

const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const STREAM = 'alerts_p0_stream';
const SINK = 'alerts_notify_sink'; // dogfood destination target — this instance's own ingest
const TMPL = 'auto_p0_tmpl';
const DEST = 'auto_p0_dest';

/** Unique, human-readable name so parallel/repeat runs never collide. */
const uniq = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function urls() {
  const org = getOrgIdentifier();
  return { org, v1: `${BASE}/api/${org}`, v2: `${BASE}/api/v2/${org}` };
}

/** page.request wrapper that always carries Basic auth. */
async function api(page, method, url, data) {
  const opts = { headers: getAuthHeaders() };
  if (data !== undefined) opts.data = data;
  return page.request[method](url, opts);
}

// ---- canonical payloads (validated live against the branch) ----------------

/** A pre-feature scheduled alert: no aggregation, no priority/tags, no warning family. */
function simpleAlert(name) {
  return {
    name,
    stream_type: 'logs',
    stream_name: STREAM,
    is_real_time: false,
    query_condition: {
      type: 'custom',
      conditions: { version: 2, conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
      sql: null, promql: null, promql_condition: null, aggregation: null,
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 10, operator: '>=', threshold: 3, frequency: 10, cron: '',
      frequency_type: 'minutes', silence: 10, timezone: 'UTC', align_time: true,
    },
    destinations: [DEST], context_attributes: {}, row_template: '', enabled: true,
  };
}

/** A grouped alert with the per-group opt-in ON (the M-10 "any breaching group" shape). */
function multiAlert(name) {
  const a = simpleAlert(name);
  a.query_condition.aggregation = {
    group_by: ['city'], function: 'avg',
    having: { column: 'latency', operator: '>', value: 500 },
    multi_alert: true,
  };
  a.trigger_condition.threshold = 1; // the "any breaching group" gate (M-10)
  return a;
}

/** Grouped, but the multi_alert flag is deliberately absent — must stay a simple alert. */
function groupedSimpleAlert(name) {
  const a = simpleAlert(name);
  a.query_condition.aggregation = { group_by: ['city'], function: 'avg', having: { column: 'latency', operator: '>', value: 500 } };
  return a;
}

function realtimeAlert(name) {
  const a = simpleAlert(name);
  a.is_real_time = true;
  return a;
}

// ---- CRUD helpers ----------------------------------------------------------

async function createAlert(page, payload) {
  return api(page, 'post', `${urls().v2}/alerts?folder=default`, payload);
}

async function listAlerts(page) {
  return (await (await api(page, 'get', `${urls().v2}/alerts?folder=default&page_size=100`)).json()).list || [];
}

async function findAlertId(page, name) {
  return (await listAlerts(page)).find((a) => a.name === name)?.alert_id;
}

/** Best-effort delete of the given alert_ids (used in afterEach). */
async function deleteAlerts(page, ids) {
  const { v2 } = urls();
  for (const id of ids) {
    if (id) await api(page, 'delete', `${v2}/alerts/${id}?folder=default`).catch(() => {});
  }
}

/**
 * Idempotently seed the template + a "dogfood" destination + a 3-group stream.
 *
 * The destination points back at THIS OpenObserve instance's own ingest endpoint
 * (a dedicated sink stream) rather than an external webhook, so a firing alert
 * actually delivers with no third-party dependency or rate limit. The self-call
 * authenticates via the same Basic-auth headers the specs already use.
 */
async function seedAlertFixtures(page) {
  const { v1 } = urls();
  await api(page, 'post', `${v1}/alerts/templates`, {
    name: TMPL, body: '{"text":"{alert_name} {alert_level}"}', type: 'http', title: '',
  }).catch(() => {});

  const destination = {
    name: DEST,
    url: `${v1}/${SINK}/_json`, // this instance's own ingest -> self-contained delivery
    method: 'post', template: TMPL, type: 'http',
    headers: getAuthHeaders(), // Basic auth so the self-call is authorized
  };
  // create-if-absent, then update so a stale definition on a persistent env is corrected.
  await api(page, 'post', `${v1}/alerts/destinations`, destination).catch(() => {});
  await api(page, 'put', `${v1}/alerts/destinations/${DEST}`, destination).catch(() => {});

  // city = group key, latency = the measure; three groups so a multi-alert can fan out.
  await api(page, 'post', `${v1}/${STREAM}/_json`, [
    { city: 'bangalore', latency: 890, status: 500 },
    { city: 'mumbai', latency: 950, status: 500 },
    { city: 'delhi', latency: 990, status: 500 },
  ]).catch(() => {});
}

/** Ingest rows into a stream (creates it on first write). */
async function ingest(page, stream, rows) {
  return api(page, 'post', `${urls().v1}/${stream}/_json`, rows);
}

/** Per-group state of a multi-alert (empty list on a simple alert). */
async function getAlertGroups(page, alertId) {
  const r = await api(page, 'get', `${urls().v2}/alerts/${alertId}/groups`);
  return r.ok() ? r.json() : { list: [] };
}

/** Durable level-change history for an alert (from_level -> to_level, newest first). */
async function getAlertTransitions(page, alertId, { limit = 20 } = {}) {
  const r = await api(page, 'get', `${urls().v2}/alerts/${alertId}/groups/transitions?limit=${limit}`);
  return r.ok() ? r.json() : { list: [] };
}

/**
 * Poll the alert list until `name` has a run outcome (i.e. the scheduler evaluated it),
 * or the timeout elapses. Returns the list item (or null). Scheduled alerts are picked
 * up within ~15s, so 60s is a generous ceiling.
 */
async function waitForAlertOutcome(page, name, { timeoutMs = 60000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let item = null;
  for (;;) {
    item = (await listAlerts(page)).find((a) => a.name === name) || null;
    if (item && item.last_outcome) return item;
    if (Date.now() >= deadline) return item;
    await page.waitForTimeout(pollMs);
  }
}

/**
 * Poll the alert list until `name` reaches `level` (ok|warning|critical|no_data),
 * or the timeout elapses. Returns the matching list item, or the last item seen
 * (or null) so the caller can assert a helpful message on timeout.
 */
async function waitForAlertLevel(page, name, level, { timeoutMs = 120000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let item = null;
  for (;;) {
    item = (await listAlerts(page)).find((a) => a.name === name) || null;
    if (item && item.level === level) return item;
    if (Date.now() >= deadline) return item;
    await page.waitForTimeout(pollMs);
  }
}

/** True for outcomes that mean the alert fired (delivery success is a separate axis). */
function isFiringOutcome(outcome) {
  return outcome === 'firing' || outcome === 'notify_failed';
}

module.exports = {
  BASE, STREAM, SINK, TMPL, DEST,
  uniq, urls, api,
  simpleAlert, multiAlert, groupedSimpleAlert, realtimeAlert,
  createAlert, listAlerts, findAlertId, deleteAlerts, seedAlertFixtures,
  ingest, getAlertGroups, getAlertTransitions,
  waitForAlertOutcome, waitForAlertLevel, isFiringOutcome,
};
