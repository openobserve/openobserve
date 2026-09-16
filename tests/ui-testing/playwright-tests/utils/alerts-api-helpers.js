// Copyright 2026 OpenObserve Inc.

/**
 * Shared API helpers for the Alerts 4.0 (multi-alert) UI specs.
 *
 * The remaining UI specs (`-ui`, `priority-tags`) use this to seed fixtures and
 * build canonical payloads via the API before asserting on the render surface.
 * The pure-API contract/regression coverage moved to pytest
 * (tests/api-testing/tests/alerts/); this module deliberately contains NO
 * test/expect calls — assertions belong in the spec files.
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

/** A scheduled cron alert whose cadence cell renders the raw cron string verbatim. */
function cronAlert(name) {
  const a = simpleAlert(name);
  a.trigger_condition = {
    ...a.trigger_condition,
    frequency_type: 'cron',
    frequency: 1,
    cron: '0 */10 * * * *',
  };
  return a;
}

/** V1 composite payload. Operands are stable alert IDs, never display names. */
function compositeAlert(name, childIds, overrides = {}) {
  return {
    alert_type: 'composite',
    name,
    description: 'Composite alert Playwright fixture',
    enabled: false,
    destinations: [DEST],
    context_attributes: {},
    trigger_condition: { silence: 10 },
    creates_incident: false,
    workflows: [],
    tags: [],
    composite_condition: {
      expression: childIds.map((id) => `{${id}}`).join(' && '),
      warning_counts_as_firing: true,
      stale_child_policy: 'use_last_state',
    },
    ...overrides,
  };
}

// ---- CRUD helpers ----------------------------------------------------------

async function createAlert(page, payload) {
  return api(page, 'post', `${urls().v2}/alerts?folder=default`, payload);
}

async function validateComposite(page, payload) {
  return api(page, 'post', `${urls().v2}/alerts/composites/validate`, payload);
}

async function getCompositeReferences(page, alertId) {
  return api(page, 'get', `${urls().v2}/alerts/${encodeURIComponent(alertId)}/composite-references`);
}

/**
 * Create `count` plain scheduled alerts in one go and return [{id, name}].
 *
 * The ten-child cap and the server-side child-limit cases both need more
 * children than is tolerable to create one await at a time, so these are
 * issued concurrently and resolved against a single list read.
 */
async function createChildAlerts(page, prefix, count) {
  const names = Array.from({ length: count }, (_, i) => uniq(`${prefix}_${i}`));
  const responses = await Promise.all(
    names.map((name) => createAlert(page, simpleAlert(name))),
  );

  // Fail here, loudly, rather than handing back {id: undefined}. An undefined
  // id flows into a composite expression as the literal string "{undefined}"
  // and only surfaces much later as an unexplained locator timeout.
  const rejected = responses
    .map((response, i) => ({ name: names[i], status: response.status() }))
    .filter(({ status }) => status < 200 || status >= 300);
  if (rejected.length) {
    throw new Error(
      `createChildAlerts: ${rejected.length}/${count} creates failed: `
      + rejected.map((r) => `${r.name} -> ${r.status}`).join(', '),
    );
  }

  const byName = new Map((await listAlerts(page)).map((a) => [a.name, a.alert_id]));
  const missing = names.filter((name) => !byName.get(name));
  if (missing.length) {
    throw new Error(
      `createChildAlerts: created but absent from the list read (raise page_size?): ${missing.join(', ')}`,
    );
  }
  return names.map((name) => ({ name, id: byName.get(name) }));
}

/**
 * Create a composite over `childIds` and return {response, id, name}.
 *
 * `response` is handed back unasserted so a caller can examine a deliberate
 * rejection; `id` is undefined in that case. A 2xx with no resolvable id is
 * never legitimate, though, so that combination throws.
 */
async function createCompositeAlert(page, name, childIds, overrides = {}) {
  const response = await createAlert(page, compositeAlert(name, childIds, overrides));
  const id = await findAlertId(page, name);
  if (response.ok() && !id) {
    throw new Error(`createCompositeAlert: "${name}" saved but absent from the list read`);
  }
  return { response, name, id };
}

async function listAlerts(page) {
  // 1000, not 100: parallel workers each hold up to 11 child fixtures, and a
  // name lookup that silently falls off page 1 is what made bad ids possible.
  return (await (await api(page, 'get', `${urls().v2}/alerts?folder=default&page_size=1000`)).json()).list || [];
}

async function findAlertId(page, name) {
  return (await listAlerts(page)).find((a) => a.name === name)?.alert_id;
}

/**
 * `seedAlertFixtures`, but at most once per worker process.
 *
 * The seed is idempotent, so calling it in every `beforeEach` is harmless in
 * principle — but it is three API calls plus an ingest per test, and against a
 * SHARED dev env that multiplies into real contention once specs run in
 * parallel. Playwright gives each worker its own module registry, so a
 * module-level promise collapses it to one seed per worker while keeping full
 * parallelism.
 *
 * Deliberately separate from `seedAlertFixtures`: specs that assert on freshly
 * ingested rows need the per-test ingest, and silently taking it away from them
 * would trade this flake for a subtler one.
 */
let seedOnce = null;
function seedAlertFixturesOnce(page) {
  if (!seedOnce) {
    seedOnce = seedAlertFixtures(page).catch((error) => {
      seedOnce = null; // let the next test retry rather than inherit the failure
      throw error;
    });
  }
  return seedOnce;
}

/** Best-effort delete of the given alert_ids (used in afterEach). */
async function deleteAlerts(page, ids) {
  const { v2 } = urls();
  for (const id of ids) {
    if (id) await api(page, 'delete', `${v2}/alerts/${id}?folder=default`).catch(() => {});
  }
}

/**
 * Delete composites before their children, whatever order the ids arrive in.
 *
 * A child that is still referenced is refused with 409, so cleanup that walks a
 * flat list leaks fixtures whenever the caller's creation order is not exactly
 * children-then-parents. Composites can nest, so parents are drained in passes
 * until nothing more will go.
 */
async function deleteAlertsCascade(page, ids) {
  const alive = new Set(ids.filter(Boolean));
  for (let pass = 0; pass < 6 && alive.size; pass += 1) {
    const before = alive.size;
    let transportFailed = false;
    const rows = await listAlerts(page).catch(() => {
      transportFailed = true;
      return [];
    });
    const type = new Map(rows.map((r) => [r.alert_id, r.alert_type]));
    const composites = [...alive].filter((id) => type.get(id) === 'composite');
    for (const id of composites.length ? composites : [...alive]) {
      const response = await api(page, 'delete', `${urls().v2}/alerts/${id}?folder=default`)
        .catch(() => {
          transportFailed = true;
          return null;
        });
      // 404 counts as gone; a 409 means a parent is still standing, so leave it
      // for the next pass once that parent has been removed.
      if (response && (response.status() < 400 || response.status() === 404)) alive.delete(id);
    }
    // Stop only when a pass made no progress for a REASON, not because the
    // network dropped. Treating a transient failure as "nothing left to do"
    // abandoned every id on the first hiccup and leaked the whole fixture set
    // — silently, because callers discard the return value.
    if (alive.size === before) {
      if (!transportFailed) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return [...alive];
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

/** Create an alerts folder and return its server-assigned folderId. */
async function createAlertFolder(page, name) {
  const r = await api(page, 'post', `${urls().v2}/folders/alerts`, { name, description: '' });
  return (await r.json()).folderId;
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

/** Full alert object as stored (includes context_attributes, description, priority, tags). */
async function getAlert(page, alertId) {
  const r = await api(page, 'get', `${urls().v2}/alerts/${alertId}?folder=default`);
  return r.ok() ? r.json() : null;
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
  simpleAlert, multiAlert, groupedSimpleAlert, realtimeAlert, cronAlert,
  compositeAlert, validateComposite, getCompositeReferences,
  createChildAlerts, createCompositeAlert, deleteAlertsCascade,
  createAlert, listAlerts, findAlertId, getAlert, deleteAlerts,
  seedAlertFixtures, seedAlertFixturesOnce,
  createAlertFolder, ingest, getAlertGroups, getAlertTransitions,
  waitForAlertOutcome, waitForAlertLevel, isFiringOutcome,
};
