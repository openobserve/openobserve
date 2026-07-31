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

/** Idempotently seed the template + webhook destination + a 3-group stream the specs need. */
async function seedAlertFixtures(page) {
  const { v1 } = urls();
  await api(page, 'post', `${v1}/alerts/templates`, {
    name: TMPL, body: '{"text":"{alert_name} {alert_level}"}', type: 'http', title: '',
  }).catch(() => {});
  await api(page, 'post', `${v1}/alerts/destinations`, {
    name: DEST, url: 'https://webhook.site/00000000-0000-0000-0000-000000000000',
    method: 'post', template: TMPL, type: 'http', headers: {},
  }).catch(() => {});
  // city = group key, latency = the measure; three groups so a multi-alert can fan out.
  await api(page, 'post', `${v1}/${STREAM}/_json`, [
    { city: 'bangalore', latency: 890, status: 500 },
    { city: 'mumbai', latency: 950, status: 500 },
    { city: 'delhi', latency: 990, status: 500 },
  ]).catch(() => {});
}

module.exports = {
  BASE, STREAM, TMPL, DEST,
  uniq, urls, api,
  simpleAlert, multiAlert, groupedSimpleAlert, realtimeAlert,
  createAlert, listAlerts, findAlertId, deleteAlerts, seedAlertFixtures,
};
