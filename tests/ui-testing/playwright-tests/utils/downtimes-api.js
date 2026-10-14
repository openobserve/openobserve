// Copyright 2026 OpenObserve Inc.

// Downtimes REST + oracle helpers for tests/ui-testing/playwright-tests/Downtimes/. No expect() here: assertions belong in specs.

const testLogger = require('./test-logger.js');
const { getAuthHeaders } = require('./cloud-auth.js');
const {
  api,
  baseUrl,
  ingestUrl,
  orgId,
  uniqueName,
  waitForStreamSearchable,
} = require('./oncall-seed.js');

const MICROS = 1_000_000;
const PARKING_FOLDER_NAME = 'e2e_dt_slo_parking';
// One notifier tick is 30 s; holding past it proves a count is settled, not just early.
const DEFAULT_HOLD_MS = 40_000;

const v1 = () => `${baseUrl()}/api/${orgId()}`;
const v2 = () => `${baseUrl()}/api/v2/${orgId()}`;
const enc = encodeURIComponent;
const nowUs = () => Date.now() * 1000;
const sleep = (page, ms) => page.waitForTimeout(ms);

async function must(res, what, payload) {
  if (res.ok()) return res.json().catch(() => ({}));
  const body = await res.text().catch(() => '<unreadable>');
  throw new Error(
    `${what} failed: HTTP ${res.status()} — ${body}` +
    (payload === undefined ? '' : `\nPayload: ${JSON.stringify(payload).slice(0, 2000)}`),
  );
}

async function jsonOrNull(res) {
  if (!res.ok()) return null;
  return res.json().catch(() => null);
}

/** Poll `fn` until `done(value)` or the timeout; returns the last value (the caller asserts). */
async function pollUntil(page, fn, done, { timeoutMs = 120_000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (!done(value) && Date.now() < deadline) {
    await sleep(page, intervalMs);
    value = await fn();
  }
  return value;
}

// ------------------------------------------------------------------ gate

/** Is the downtimes feature reachable here? Throws on 401/5xx so a broken deployment fails instead of skipping. */
async function isDowntimesAvailable(page) {
  const cfgRes = await page.request.get(`${v1()}/config`, { headers: getAuthHeaders() });
  if (cfgRes.status() === 401 || cfgRes.status() >= 500) {
    throw new Error(`downtimes probe: GET /api/{org}/config answered HTTP ${cfgRes.status()}`);
  }
  const config = (await jsonOrNull(cfgRes)) || {};
  if (config.downtimes_enabled !== true) {
    return {
      available: false,
      reason: `downtimes_enabled is ${JSON.stringify(config.downtimes_enabled)} on /api/{org}/config (build_type=${config.build_type})`,
      config,
    };
  }
  const res = await page.request.get(`${v2()}/downtimes?page_size=1`, { headers: getAuthHeaders() });
  if (res.ok()) return { available: true, reason: '', config };
  const body = await res.text().catch(() => '');
  if (res.status() === 404 || (res.status() === 403 && /not supported|not enabled/i.test(body))) {
    return { available: false, reason: `downtimes route answered HTTP ${res.status()}: ${body.slice(0, 120)}`, config };
  }
  throw new Error(`downtimes probe failed: HTTP ${res.status()} on /downtimes — ${body.slice(0, 200)}`);
}

// ------------------------------------------------------------------ folders

async function listDowntimeFolders(page) {
  const body = await jsonOrNull(await api(page, 'get', `${v2()}/folders/downtimes`));
  return Array.isArray(body) ? body : (body?.list ?? []);
}

async function createDowntimeFolder(page, name) {
  const payload = { name, description: 'e2e downtimes' };
  const body = await must(await api(page, 'post', `${v2()}/folders/downtimes`, payload), `Create downtime folder ${name}`, payload);
  const id = body.folderId ?? body.folder_id ?? body.id;
  if (!id) throw new Error(`Downtime folder created but no id returned: ${JSON.stringify(body)}`);
  return id;
}

/** Returns the raw response so a spec can assert the 400 for a non-empty folder. */
async function deleteDowntimeFolder(page, folderId) {
  return api(page, 'delete', `${v2()}/folders/downtimes/${enc(folderId)}`);
}

/** The long-lived folder SLO-target downtimes are parked in: they can never be deleted. */
async function ensureParkingFolder(page) {
  const existing = (await listDowntimeFolders(page)).find((f) => f.name === PARKING_FOLDER_NAME);
  if (existing) return existing.folderId ?? existing.folder_id ?? existing.id;
  try {
    return await createDowntimeFolder(page, PARKING_FOLDER_NAME);
  } catch (e) {
    // A parallel worker may have created it between the read and the write.
    const again = (await listDowntimeFolders(page)).find((f) => f.name === PARKING_FOLDER_NAME);
    if (again) return again.folderId ?? again.folder_id ?? again.id;
    throw e;
  }
}

// ------------------------------------------------------------------ schedules / targets

function windowFromMs(startMs, endMs, timezone = 'UTC') {
  const startsAt = Math.floor(startMs) * 1000;
  const endsAt = Math.floor(endMs) * 1000;
  return {
    repeat: 'none',
    starts_at: startsAt,
    ends_at: endsAt,
    timezone,
    duration_secs: Math.round((endsAt - startsAt) / MICROS),
    weekdays: [],
  };
}

/** A one-time window that is already open. */
function activeWindow({ startOffsetSec = -60, durationSec = 3600 } = {}) {
  const start = Date.now() + startOffsetSec * 1000;
  return windowFromMs(start, start + durationSec * 1000);
}

/** A one-time window that opens later, so the downtime is `scheduled`. */
function futureWindow({ startInSec = 1800, durationSec = 3600 } = {}) {
  const start = Date.now() + startInSec * 1000;
  return windowFromMs(start, start + durationSec * 1000);
}

/** A daily recurring window at `HH:MM` UTC. */
function dailyWindow({ startTimeLocal = '03:00', durationSec = 3600 } = {}) {
  return {
    repeat: 'daily',
    starts_at: nowUs(),
    ends_at: null,
    timezone: 'UTC',
    start_time_local: startTimeLocal,
    duration_secs: durationSec,
    weekdays: [],
  };
}

const idsTarget = (module, ids, extra = {}) => ({ module, folders: { kind: 'all' }, ids, ...extra });
const alertIdsTarget = (ids, extra = {}) => idsTarget('alerts', ids, extra);
const folderTarget = (module, folderIds, extra = {}) => ({ module, folders: { kind: 'some', folder_ids: folderIds }, ...extra });
const allFoldersTarget = (module, extra = {}) => ({ module, folders: { kind: 'all' }, ...extra });
const pair = (key, value, operator = '=') => ({ type: 'pair', key, operator, value });

// ------------------------------------------------------------------ downtime CRUD

/** POST a downtime and return the raw response, for specs that assert a refusal. */
async function createDowntimeRaw(page, folderId, body) {
  const payload = { show_banner: false, ...body, folder_id: folderId };
  return api(page, 'post', `${v2()}/downtimes?folder=${enc(folderId)}`, payload);
}

/** @returns {Promise<{id: string, name: string, folderId: string}>} */
async function createDowntime(page, folderId, body) {
  const payload = { show_banner: false, ...body, folder_id: folderId };
  const res = await api(page, 'post', `${v2()}/downtimes?folder=${enc(folderId)}`, payload);
  const created = await must(res, `Create downtime "${payload.name}"`, payload);
  if (!created.id) throw new Error(`Downtime created but no id returned: ${JSON.stringify(created)}`);
  testLogger.info('Downtime created', { id: created.id, name: payload.name });
  return { id: created.id, name: payload.name, folderId };
}

async function getDowntimeResponse(page, id, folderId) {
  const q = folderId ? `?folder=${enc(folderId)}` : '';
  return page.request.get(`${v2()}/downtimes/${enc(id)}${q}`, { headers: getAuthHeaders() });
}

/** The stored downtime, or null when it does not exist. */
async function getDowntime(page, id, folderId) {
  return jsonOrNull(await getDowntimeResponse(page, id, folderId));
}

/** Re-PUT the stored row with `changes` merged and the loaded version, as the edit page does. */
async function updateDowntime(page, id, folderId, changes) {
  const current = await getDowntime(page, id, folderId);
  if (!current) throw new Error(`updateDowntime: ${id} not found`);
  const body = {
    folder_id: current.folder_id,
    name: current.name,
    reason: current.reason,
    condition: current.condition,
    targets: current.targets,
    schedule: current.schedule,
    show_banner: current.show_banner,
    notifications: current.notifications,
    version: current.version,
    ...changes,
  };
  const res = await api(page, 'put', `${v2()}/downtimes/${enc(id)}?folder=${enc(folderId)}`, body);
  return must(res, `Update downtime ${id}`, body);
}

async function cancelDowntime(page, id, folderId) {
  const res = await api(page, 'post', `${v2()}/downtimes/${enc(id)}/cancel?folder=${enc(folderId)}`);
  return must(res, `Cancel downtime ${id}`);
}

async function extendDowntime(page, id, folderId, bySecs) {
  const body = { by_secs: bySecs };
  const res = await api(page, 'post', `${v2()}/downtimes/${enc(id)}/extend?folder=${enc(folderId)}`, body);
  return must(res, `Extend downtime ${id}`, body);
}

async function moveDowntimes(page, ids, dstFolderId, srcFolderId) {
  const body = { downtime_ids: ids, dst_folder_id: dstFolderId };
  const res = await api(page, 'patch', `${v2()}/downtimes/move?folder=${enc(srcFolderId)}`, body);
  return must(res, 'Move downtimes', body);
}

/** Raw response: a delete of an active or SLO-corrected row is a 409 the spec may assert. */
async function deleteDowntime(page, id, folderId) {
  return api(page, 'delete', `${v2()}/downtimes/${enc(id)}?folder=${enc(folderId)}`);
}

/** @returns {Promise<{items: object[], total: number, counts: object}>} */
async function listDowntimes(page, params = {}) {
  const q = new URLSearchParams({ page_size: '500', ...Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
  ) });
  const res = await page.request.get(`${v2()}/downtimes?${q}`, { headers: getAuthHeaders() });
  const body = await must(res, 'List downtimes');
  return { items: body.items ?? [], total: body.total ?? 0, counts: body.counts ?? {} };
}

/** Downtimes muting this alert id (quick mutes have server-generated names, so find them by target). */
async function downtimesForAlert(page, alertId) {
  // alert_id resolves the alert through an inventory cached for 60 s, so a fresh alert also needs the explicit-id rows.
  const rows = new Map((await listDowntimes(page, { alert_id: alertId })).items.map((r) => [r.id, r]));
  for (const r of (await listDowntimes(page)).items) {
    if ((r.targets ?? []).some((t) => (t.ids ?? []).includes(alertId))) rows.set(r.id, r);
  }
  return [...rows.values()];
}

// ------------------------------------------------------------------ cleanup

/** Cancel then delete every downtime whose name starts with `prefix`, that targets one of `alertIds`, or that sits in one of `folderIds`; then drop those folders. Best effort: cleanup must never mask a test result. SLO-corrected rows answer 409 and are left parked. */
async function cleanupDowntimes(page, { prefix = null, alertIds = [], targetIds = [], folderIds = [] } = {}) {
  try {
    const rows = new Map();
    if (prefix) {
      for (const r of (await listDowntimes(page, { search: prefix })).items) {
        if (typeof r.name === 'string' && r.name.startsWith(prefix)) rows.set(r.id, r);
      }
    }
    for (const alertId of [...alertIds, ...targetIds].filter(Boolean)) {
      // alert_id also returns org-wide and folder-scoped rows that merely cover the alert; delete only rows naming it.
      for (const r of await downtimesForAlert(page, alertId)) {
        if ((r.targets ?? []).some((t) => (t.ids ?? []).includes(alertId))) rows.set(r.id, r);
      }
    }
    for (const f of folderIds.filter((x) => x && x !== 'default')) {
      for (const r of (await listDowntimes(page, { folder_id: f })).items) rows.set(r.id, r);
    }
    for (const r of rows.values()) {
      if (r.status === 'active' || r.status === 'scheduled') {
        await api(page, 'post', `${v2()}/downtimes/${enc(r.id)}/cancel?folder=${enc(r.folder_id)}`).catch(() => {});
      }
      await api(page, 'delete', `${v2()}/downtimes/${enc(r.id)}?folder=${enc(r.folder_id)}`).catch(() => {});
    }
    for (const f of folderIds.filter(Boolean)) {
      if (f !== 'default') await deleteDowntimeFolder(page, f).catch(() => {});
    }
    if (prefix) {
      for (const f of await listDowntimeFolders(page)) {
        if (typeof f.name === 'string' && f.name.startsWith(prefix)) {
          await deleteDowntimeFolder(page, f.folderId ?? f.folder_id ?? f.id).catch(() => {});
        }
      }
    }
  } catch (e) {
    testLogger.warn('downtime cleanup failed (non-fatal)', { prefix, error: e.message });
  }
}

// ------------------------------------------------------------------ streams / destinations

/** Rows each minute for `minutes`, newest now; lowercase identity values and no `job` field (it competes for `service`). */
function minuteRows({ minutes = 15, services, hosts = ['h1'], extra = {}, endMs = Date.now() }) {
  const rows = [];
  for (let i = 0; i < minutes; i++) {
    for (const service of services) {
      for (const host of hosts) {
        rows.push({
          _timestamp: (endMs - i * 60_000) * 1000,
          service_name: service,
          host,
          status_code: i % 4 === 0 ? 500 : 200,
          latency: 100 + (i % 10) * 50,
          level: 'error',
          ...extra,
        });
      }
    }
  }
  return rows;
}

async function ingestRows(page, stream, rows) {
  const res = await api(page, 'post', `${ingestUrl()}/api/${orgId()}/${stream}/_json`, rows);
  return must(res, `Ingest ${rows.length} rows into ${stream}`);
}

async function seedStream(page, stream, opts) {
  const rows = minuteRows(opts);
  await ingestRows(page, stream, rows);
  await waitForStreamSearchable(page, stream, rows.length);
  return rows.length;
}

/** Keep fresh rows flowing so every 1-minute alert always has data in its window. */
function startBackgroundIngest(page, stream, { services, hosts = ['h1'], extra = {}, everyMs = 30_000, rowsFn = null }) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const rows = rowsFn ? rowsFn() : minuteRows({ minutes: 1, services, hosts, extra });
    if (rows.length === 0) return;
    await ingestRows(page, stream, rows).catch((e) => {
      testLogger.warn('background ingest failed', { stream, error: e.message });
    });
  };
  const timer = setInterval(() => { void tick(); }, everyMs);
  return { stop: () => { stopped = true; clearInterval(timer); } };
}

/** Self-ingest destination like `seedNotificationDestination`, but the template also renders `{rows}` so the sink can be filtered per group. */
async function seedSinkDestination(page, baseName) {
  const template = `${baseName}_tmpl`;
  const destination = `${baseName}_dest`;
  const sink = `${baseName}_sink`;
  const tmplRes = await api(page, 'post', `${v1()}/alerts/templates`, {
    name: template,
    body: '{"text":"{alert_name} {alert_level} {rows}"}',
    type: 'http',
    title: '',
  });
  if (!tmplRes.ok() && tmplRes.status() !== 409) await must(tmplRes, `Create template ${template}`);
  const destRes = await api(page, 'post', `${v1()}/alerts/destinations`, {
    name: destination,
    url: `${v1()}/${sink}/_json`,
    method: 'post',
    template,
    type: 'http',
    headers: getAuthHeaders(),
  });
  if (!destRes.ok() && destRes.status() !== 409) await must(destRes, `Create destination ${destination}`);
  testLogger.info('Downtime sink destination seeded', { destination, sink });
  return { destination, sink, template };
}

/** Delete destinations, then templates, whose name starts with `prefix` (a template in use cannot go first). */
async function deleteDestinationsByPrefix(page, prefix) {
  for (const kind of ['destinations', 'templates']) {
    try {
      const body = await jsonOrNull(await api(page, 'get', `${v1()}/alerts/${kind}`));
      for (const d of (Array.isArray(body) ? body : body?.list ?? [])) {
        if (typeof d?.name === 'string' && d.name.startsWith(prefix)) {
          await api(page, 'delete', `${v1()}/alerts/${kind}/${enc(d.name)}`).catch(() => {});
        }
      }
    } catch { /* best effort */ }
  }
}

// ------------------------------------------------------------------ search / sink oracle

/** SQL hits over the last `sinceSec`, through page.request so no page needs to be loaded. */
async function searchHits(page, sql, sinceSec = 3600) {
  const end = nowUs();
  const res = await page.request.post(`${v1()}/_search?type=logs`, {
    headers: getAuthHeaders(),
    data: { query: { sql, start_time: end - sinceSec * MICROS, end_time: end + 60 * MICROS, size: 1000 } },
  });
  if (!res.ok()) {
    const text = await res.text().catch(() => '');
    // A sink that has received nothing yet does not exist; that is a count of zero, not an error.
    if (/not found|does not exist/i.test(text)) return [];
    throw new Error(`search failed: HTTP ${res.status()} — ${text.slice(0, 200)}\nSQL: ${sql}`);
  }
  return (await res.json().catch(() => ({})))?.hits ?? [];
}

async function searchCount(page, sql, sinceSec = 3600) {
  const hits = await searchHits(page, sql, sinceSec);
  return Number(hits?.[0]?.c ?? 0);
}

const sqlStr = (s) => String(s).replace(/'/g, "''");

/** Sink rows delivered for `alertName` since `sinceUs` (alert notifications render the name into `text`). */
async function alertSinkCount(page, sink, alertName, sinceUs, extraWhere = '') {
  const extra = extraWhere ? ` AND ${extraWhere}` : '';
  const sql = `SELECT COUNT(*) AS c FROM "${sink}" WHERE str_match(text, '${sqlStr(alertName)}') AND _timestamp > ${Math.floor(sinceUs)}${extra}`;
  return searchCount(page, sql, Math.ceil((nowUs() - sinceUs) / MICROS) + 120);
}

/** Anomaly notifications post their own JSON (anomaly_id, alert_type, …); recoveries are excluded. */
async function anomalySinkCount(page, sink, anomalyId, sinceUs) {
  const sql = `SELECT COUNT(*) AS c FROM "${sink}" WHERE anomaly_id = '${sqlStr(anomalyId)}' AND alert_type = 'anomaly_detection' AND _timestamp > ${Math.floor(sinceUs)}`;
  return searchCount(page, sql, Math.ceil((nowUs() - sinceUs) / MICROS) + 120);
}

/** Lifecycle notifications use the prebuilt downtime template, which flattens to downtime_name / downtime_event. */
async function downtimeEventCount(page, sink, downtimeName, event, sinceUs) {
  const byEvent = event ? ` AND downtime_event = '${sqlStr(event)}'` : '';
  const sql = `SELECT COUNT(*) AS c FROM "${sink}" WHERE downtime_name = '${sqlStr(downtimeName)}'${byEvent} AND _timestamp > ${Math.floor(sinceUs)}`;
  return searchCount(page, sql, Math.ceil((nowUs() - sinceUs) / MICROS) + 120);
}

/** Incident notifications post `{"incident": {id, event, …}}`, which flattens to incident_id / incident_event; no event counts them all. */
async function incidentEventCount(page, sink, incidentId, event = null) {
  const byEvent = event ? ` AND incident_event = '${sqlStr(event)}'` : '';
  const sql = `SELECT COUNT(*) AS c FROM "${sink}" WHERE incident_id = '${sqlStr(incidentId)}'${byEvent}`;
  return searchCount(page, sql, 6 * 3600);
}

/** Wait until `countFn()` satisfies `done`; returns the last count. */
async function waitForCount(page, countFn, done, { timeoutMs = 120_000, intervalMs = 5000 } = {}) {
  return pollUntil(page, countFn, done, { timeoutMs, intervalMs });
}

/** Sample a count now and repeatedly over `holdMs` (one notifier tick by default). The spec asserts every sample, which is the "zero" / "exactly once" oracle without the expect.poll false-wait trap. */
async function sampleCountOver(page, countFn, { holdMs = DEFAULT_HOLD_MS, everyMs = 10_000 } = {}) {
  const samples = [await countFn()];
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    await sleep(page, Math.min(everyMs, Math.max(0, deadline - Date.now())));
    samples.push(await countFn());
  }
  return samples;
}

// ------------------------------------------------------------------ alert history oracle

async function alertHistory(page, params) {
  const q = new URLSearchParams(Object.fromEntries(
    Object.entries({ size: 500, ...params }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
  ));
  const body = await jsonOrNull(await api(page, 'get', `${v2()}/alerts/history?${q}`));
  return body?.hits ?? [];
}

/** Suppressed history rows carrying this downtime id (alerts, anomalies and synthetics all land here). */
async function suppressedRows(page, { downtimeId, alertId, sinceUs, status = 'suppressed' }) {
  const hits = await alertHistory(page, {
    alert_id: alertId,
    downtime_id: downtimeId,
    status,
    start_time: Math.floor(sinceUs),
    end_time: nowUs() + 60 * MICROS,
  });
  return hits.filter((h) => h.downtime_id === downtimeId);
}

/** Poll until at least `minRows` suppressed rows exist; returns the rows seen (the spec asserts). */
async function waitForSuppressed(page, { downtimeId, alertId, sinceUs, status = 'suppressed', minRows = 1, timeoutMs = 150_000 }) {
  return pollUntil(page, () => suppressedRows(page, { downtimeId, alertId, sinceUs, status }),
    (rows) => rows.length >= minRows, { timeoutMs, intervalMs: 5000 });
}

/** History rows for `alertId` after `sinceUs` whose status is not suppressed. */
async function unsuppressedRows(page, { alertId, sinceUs }) {
  const hits = await alertHistory(page, {
    alert_id: alertId,
    start_time: Math.floor(sinceUs),
    end_time: nowUs() + 60 * MICROS,
  });
  return hits.filter((h) => h.status !== 'suppressed' && Number(h.timestamp) > sinceUs);
}

async function waitForFiringAfter(page, { alertId, sinceUs, timeoutMs = 150_000 }) {
  return pollUntil(page, () => unsuppressedRows(page, { alertId, sinceUs }),
    (rows) => rows.length >= 1, { timeoutMs, intervalMs: 5000 });
}

// ------------------------------------------------------------------ alerts

/** Alert folder for the given name; returns its id. */
async function createAlertFolder(page, name) {
  const payload = { name, description: '' };
  const body = await must(await api(page, 'post', `${v2()}/folders/alerts`, payload), `Create alert folder ${name}`, payload);
  return body.folderId ?? body.folder_id ?? body.id;
}

/** A 1-minute SQL alert. Identity comes from the WHERE equalities and the GROUP BY values, which is what a downtime condition matches. */
async function createSqlAlert(page, {
  name,
  stream,
  sql,
  destinations = [],
  folder = 'default',
  frequencyMinutes = 1,
  periodMinutes = 5,
  silence = 0,
  createsIncident = false,
  multiAlert = false,
  groupBy = [],
  rowTemplate = '',
  enabled = true,
}) {
  const payload = {
    name,
    stream_type: 'logs',
    stream_name: stream,
    is_real_time: false,
    query_condition: {
      type: 'sql',
      conditions: null,
      sql,
      promql: null,
      promql_condition: null,
      aggregation: multiAlert
        ? { group_by: groupBy, function: 'count', having: { column: 'c', operator: '>=', value: 1 }, multi_alert: true }
        : null,
      vrl_function: null,
      search_event_type: null,
      multi_time_range: [],
    },
    trigger_condition: {
      period: periodMinutes,
      operator: '>=',
      threshold: 1,
      frequency: frequencyMinutes,
      frequency_type: 'minutes',
      cron: '',
      silence,
      timezone: 'UTC',
      align_time: true,
    },
    destinations,
    context_attributes: {},
    row_template: rowTemplate,
    enabled,
    creates_incident: createsIncident,
  };
  const res = await api(page, 'post', `${v2()}/alerts?folder=${enc(folder)}`, payload);
  const body = await must(res, `Create SQL alert "${name}"`, payload);
  const id = body?.id ?? body?.alert_id;
  if (!id) throw new Error(`Alert created but no id returned: ${JSON.stringify(body)}`);
  testLogger.info('SQL alert created', { id, name, folder });
  return { id, name, folder };
}

/** A per-group (multi-alert) custom alert: one identity and one notification per `groupBy` value. */
async function createGroupedAlert(page, { name, stream, groupBy, destinations = [], folder = 'default', rowTemplate = '' }) {
  const payload = {
    name,
    stream_type: 'logs',
    stream_name: stream,
    is_real_time: false,
    query_condition: {
      type: 'custom',
      conditions: { version: 2, conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
      sql: null, promql: null, promql_condition: null,
      aggregation: { group_by: groupBy, function: 'avg', having: { column: 'latency', operator: '>', value: 0 }, multi_alert: true },
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 5, operator: '>=', threshold: 1, frequency: 1, frequency_type: 'minutes',
      cron: '', silence: 0, timezone: 'UTC', align_time: true,
    },
    destinations,
    context_attributes: {},
    row_template: rowTemplate,
    enabled: true,
  };
  const res = await api(page, 'post', `${v2()}/alerts?folder=${enc(folder)}`, payload);
  const body = await must(res, `Create grouped alert "${name}"`, payload);
  return { id: body?.id ?? body?.alert_id, name, folder };
}

async function enableAlert(page, alertId, folder = 'default') {
  const res = await api(page, 'patch', `${v2()}/alerts/${enc(alertId)}/enable?value=true&folder=${enc(folder)}`);
  return must(res, `Enable alert ${alertId}`);
}

/** A real-time alert filtering on service_name, suppressed at ingest. */
async function createRealtimeAlert(page, { name, stream, service, destinations = [], folder = 'default' }) {
  const payload = {
    name,
    stream_type: 'logs',
    stream_name: stream,
    is_real_time: true,
    query_condition: {
      type: 'custom',
      conditions: {
        version: 2,
        conditions: {
          filterType: 'group',
          logicalOperator: 'AND',
          conditions: [{ filterType: 'condition', column: 'service_name', operator: '=', value: service, values: [], logicalOperator: 'AND' }],
        },
      },
      sql: null, promql: null, promql_condition: null, aggregation: null,
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 1, operator: '>=', threshold: 1, frequency: 1, frequency_type: 'minutes',
      cron: '', silence: 0, timezone: 'UTC', align_time: true,
    },
    destinations,
    context_attributes: {},
    row_template: '',
    enabled: true,
  };
  const res = await api(page, 'post', `${v2()}/alerts?folder=${enc(folder)}`, payload);
  const body = await must(res, `Create real-time alert "${name}"`, payload);
  return { id: body?.id ?? body?.alert_id, name, folder };
}

/** The trigger route's message: "Alert suppressed by downtime <name>" when covered, "Alert triggered" otherwise. */
async function triggerMessage(page, alertId, folder = 'default') {
  const res = await api(page, 'patch', `${v2()}/alerts/${enc(alertId)}/trigger?folder=${enc(folder)}`);
  const text = await res.text().catch(() => '');
  if (!res.ok()) throw new Error(`Trigger alert ${alertId} failed: HTTP ${res.status()} — ${text}`);
  try {
    const body = JSON.parse(text);
    return typeof body === 'string' ? body : String(body?.message ?? text);
  } catch {
    return text;
  }
}

/** Delete alerts (any folder), then their folders. Best effort. */
async function deleteAlertsAndFolders(page, alerts = [], folderIds = []) {
  for (const a of alerts.filter(Boolean)) {
    await api(page, 'delete', `${v2()}/alerts/${enc(a.id)}?folder=${enc(a.folder || 'default')}`).catch(() => {});
  }
  for (const f of folderIds.filter((x) => x && x !== 'default')) {
    await api(page, 'delete', `${v2()}/folders/alerts/${enc(f)}`).catch(() => {});
  }
}

// ------------------------------------------------------------------ incidents

async function listIncidents(page, { status = null, keyword = null, limit = 200 } = {}) {
  const q = new URLSearchParams({ limit: String(limit), offset: '0' });
  if (status) q.set('status', status);
  if (keyword) q.set('keyword', keyword);
  const body = await jsonOrNull(await api(page, 'get', `${v2()}/alerts/incidents?${q}`));
  return body?.incidents ?? [];
}

/** The open incident whose group values carry this (per-test unique) service name. */
async function findIncidentByService(page, service) {
  const rows = await listIncidents(page, { keyword: service });
  return rows.find((i) => i.group_values?.service_name === service || i.group_values?.service === service)
    ?? (await listIncidents(page)).find((i) => i.group_values?.service_name === service || i.group_values?.service === service)
    ?? null;
}

async function waitForIncidentByService(page, service, { timeoutMs = 150_000 } = {}) {
  return pollUntil(page, () => findIncidentByService(page, service), (i) => !!i, { timeoutMs, intervalMs: 5000 });
}

async function getIncident(page, incidentId) {
  const body = await jsonOrNull(await api(page, 'get', `${v2()}/alerts/incidents/${enc(incidentId)}`));
  return body?.incident ?? body;
}

async function setIncidentSeverity(page, incidentId, severity) {
  const res = await api(page, 'patch', `${v2()}/alerts/incidents/${enc(incidentId)}/update`, { severity });
  return must(res, `Set incident ${incidentId} severity ${severity}`);
}

async function resolveIncident(page, incidentId) {
  await api(page, 'patch', `${v2()}/alerts/incidents/${enc(incidentId)}/update`, { status: 'resolved' }).catch(() => {});
}

// ------------------------------------------------------------------ anomaly detection

/** Backdated steady rows per service, oldest first, inside ZO_INGEST_ALLOWED_UPTO (5 h in CI). */
async function backfillAnomalyStream(page, stream, services, { hours = 4.6, perMinute = 100 } = {}) {
  const minutes = Math.floor(hours * 60);
  const now = Date.now();
  for (let chunk = minutes; chunk > 0; chunk -= 30) {
    const rows = [];
    for (let m = chunk; m > Math.max(0, chunk - 30); m--) {
      const ts = (now - m * 60_000) * 1000;
      for (const service of services) {
        const n = perMinute - 20 + ((m * 7) % 40);
        for (let i = 0; i < n; i++) rows.push({ _timestamp: ts + i, service_name: service, svc_key: service, level: 'info' });
      }
    }
    await ingestRows(page, stream, rows);
  }
}

/** `count` events for `service` stamped inside the current minute. */
async function spike(page, stream, service, count = 800) {
  const base = Date.now() * 1000;
  const rows = Array.from({ length: count }, (_, i) => ({ _timestamp: base - i * 10, service_name: service, svc_key: service, level: 'error' }));
  const res = await ingestRows(page, stream, rows);
  // A detect run that cannot see the spike yet judges its bucket normal and moves the cursor past it for good.
  const sql = `SELECT count(*) AS c FROM "${stream}" WHERE svc_key = '${sqlStr(service)}' AND level = 'error' AND _timestamp >= ${base - count * 10}`;
  const seen = await pollUntil(page, () => searchCount(page, sql, 600), (c) => c >= count, { timeoutMs: 60_000, intervalMs: 1000 });
  if (seen < count) throw new Error(`spike on ${stream}/${service}: only ${seen}/${count} rows searchable after 60 s`);
  // The open minute bucket is never judged, so a detect run before it closes finds nothing.
  await sleep(page, Math.max(0, 60_000 - (Math.floor(base / 1000) % 60_000) - (Date.now() - Math.floor(base / 1000)) + 5_000));
  return res;
}

/** Detector tuned to fire on a one-minute spike (QA recipe): 1m buckets and schedule, 120 s window, 1-day training. `filterField: 'svc_key'` filters on a non-semantic field, so the detector's identity comes from its tags alone. */
async function createAnomalyDetector(page, { name, stream, service, destinations, folder = 'default', tags = [], filterField = 'service_name' }) {
  const payload = {
    alert_type: 'anomaly_detection',
    name,
    stream_name: stream,
    stream_type: 'logs',
    enabled: true,
    folder_id: folder,
    alert_destinations: destinations,
    tags,
    anomaly_config: {
      query_mode: 'filters',
      filters: [{ field: filterField, operator: '=', value: service }],
      custom_sql: null,
      detection_function: 'count(*)',
      histogram_interval: '1m',
      schedule_interval: '1m',
      detection_window_seconds: 120,
      training_window_days: 1,
      retrain_interval_days: 0,
      threshold: 97,
      alert_direction: 'above',
      alert_enabled: true,
    },
  };
  const res = await api(page, 'post', `${v2()}/alerts?folder=${enc(folder)}`, payload);
  const body = await must(res, `Create anomaly detector "${name}"`, payload);
  const id = body.anomaly_id ?? body.id ?? body.alert_id;
  if (!id) throw new Error(`Anomaly detector created but no id returned: ${JSON.stringify(body)}`);
  return { id, name, folder };
}

async function trainDetector(page, id) {
  await api(page, 'post', `${v1()}/anomaly_detection/${enc(id)}/train`, {});
}

async function waitForDetectorReady(page, id, { timeoutMs = 240_000 } = {}) {
  return pollUntil(page, async () => jsonOrNull(await api(page, 'get', `${v1()}/anomaly_detection/${enc(id)}`)),
    (d) => !!(d && (d.is_trained || d.status === 'ready')), { timeoutMs, intervalMs: 5000 });
}

async function detectNow(page, id) {
  return api(page, 'post', `${v1()}/anomaly_detection/${enc(id)}/detect`, {});
}

async function deleteDetector(page, id) {
  await api(page, 'delete', `${v1()}/anomaly_detection/${enc(id)}`).catch(() => {});
}

// ------------------------------------------------------------------ SLO

/** An SLO alert (burn rate by default, or `kind: 'error_budget'`), the payload `buildSloAlertPayload` sends. */
async function createSloBurnAlert(page, { name, sloId, destinations, critical = 1, kind = 'burn_rate' }) {
  const windows = kind === 'burn_rate' ? { long_window_secs: 3600, short_window_secs: 300 } : {};
  const payload = {
    name,
    description: '',
    enabled: true,
    destinations,
    workflows: [],
    is_real_time: false,
    stream_name: '',
    stream_type: 'logs',
    query_condition: {
      type: 'slo',
      slo_condition: {
        slo_id: sloId,
        kind,
        operator: '>',
        critical,
        ...windows,
        multi_alert: false,
      },
      sql: '', promql: '', conditions: [], aggregation: null, promql_condition: null,
      vrl_function: null, search_event_type: null, promql_multi_alert: false,
      multi_time_range: null, promql_warning_value: null,
    },
    trigger_condition: {
      operator: '=', threshold: 0, frequency_type: 'minutes', frequency: 1, silence: 0, period: 1, cron: '', timezone: 'UTC',
    },
    context_attributes: {},
    row_template: '',
  };
  const res = await api(page, 'post', `${v2()}/alerts?folder=default`, payload);
  const body = await must(res, `Create SLO burn alert "${name}"`, payload);
  return { id: body?.id ?? body?.alert_id, name, folder: 'default' };
}

/** 180 rows over the last 3 h, 1/min; every 4th row in the last 40 min is a 500, so good < total there. */
function sloRows(service, { minutes = 180, errorMinutes = 40 } = {}) {
  const now = Date.now();
  const rows = [];
  for (let i = minutes - 1; i >= 0; i--) {
    rows.push({
      _timestamp: (now - i * 60_000) * 1000,
      service_name: service,
      status_code: i < errorMinutes && i % 4 === 0 ? 500 : 200,
      latency: 120,
    });
  }
  return rows;
}

/** Poll until the SLO's first live pass set `watermark_end`; returns the last status (the spec asserts). */
async function waitForSloLive(page, sloId, { timeoutMs = 240_000 } = {}) {
  return pollUntil(page, async () => (await jsonOrNull(await api(page, 'get', `${v1()}/slos/${enc(sloId)}`)))?.status ?? null,
    (status) => status?.watermark_end != null, { timeoutMs, intervalMs: 5000 });
}

/** `slo_slices` rows of an SLO; `slice_start` is in epoch SECONDS. */
async function sliceRows(page, sloId, downtimeId = null) {
  const where = downtimeId
    ? `slo_id = '${sqlStr(sloId)}' AND corrected_by = '${sqlStr(downtimeId)}'`
    : `slo_id = '${sqlStr(sloId)}'`;
  return searchHits(page, `SELECT slice_start, good, total, corrected_by FROM "slo_slices" WHERE ${where}`, 3600);
}

// ------------------------------------------------------------------ synthetics

async function listSyntheticLocations(page) {
  const body = await jsonOrNull(await api(page, 'get', `${v1()}/synthetics/locations`));
  return Array.isArray(body) ? body : (body?.list ?? body?.locations ?? []);
}

async function createSyntheticCheck(page, { name, tags = [], location, destinations = [], folder = 'default' }) {
  const payload = {
    name,
    description: 'e2e downtimes',
    tags,
    type: 'http',
    target: `https://${name.replace(/_/g, '-')}.invalid/health`,
    config: {
      method: 'GET', headers: [], body: null,
      assertions: [{ field: 'status_code', operator: 'eq', value: 200 }],
      timeout_ms: 5000, follow_redirects: true,
    },
    frequency: { type: 'minutes', interval: 1, cron: '', timezone: 'UTC' },
    locations: [location],
    enabled: true,
    destinations,
    retries: 0,
    alert_if_fails: 1,
    cooldown_mins: 0,
  };
  const res = await api(page, 'post', `${v1()}/synthetics?folder=${enc(folder)}`, payload);
  const body = await must(res, `Create synthetic check "${name}"`, payload);
  return { id: body?.id ?? body?.check_id, name, folder };
}

async function deleteSyntheticCheck(page, id, folder = 'default') {
  await api(page, 'delete', `${v1()}/synthetics/${enc(id)}?folder=${enc(folder)}`).catch(() => {});
}

async function createSyntheticsFolder(page, name) {
  const payload = { name, description: '' };
  const body = await must(await api(page, 'post', `${v2()}/folders/synthetics`, payload), `Create synthetics folder ${name}`, payload);
  return body.folderId ?? body.folder_id ?? body.id;
}

async function deleteSyntheticsFolder(page, folderId) {
  await api(page, 'delete', `${v2()}/folders/synthetics/${enc(folderId)}`).catch(() => {});
}

// ------------------------------------------------------------------ banners

async function downtimeBanners(page) {
  const body = await jsonOrNull(await api(page, 'get', `${v1()}/announcements`));
  return (body?.banners ?? []).filter((b) => String(b.id ?? '').startsWith('downtime:'));
}

module.exports = {
  MICROS,
  PARKING_FOLDER_NAME,
  DEFAULT_HOLD_MS,
  nowUs,
  uniqueName,
  pollUntil,
  isDowntimesAvailable,
  listDowntimeFolders,
  createDowntimeFolder,
  deleteDowntimeFolder,
  ensureParkingFolder,
  windowFromMs,
  activeWindow,
  futureWindow,
  dailyWindow,
  idsTarget,
  alertIdsTarget,
  folderTarget,
  allFoldersTarget,
  pair,
  createDowntimeRaw,
  createDowntime,
  getDowntimeResponse,
  getDowntime,
  updateDowntime,
  cancelDowntime,
  extendDowntime,
  moveDowntimes,
  deleteDowntime,
  listDowntimes,
  downtimesForAlert,
  cleanupDowntimes,
  minuteRows,
  ingestRows,
  seedStream,
  startBackgroundIngest,
  seedSinkDestination,
  deleteDestinationsByPrefix,
  searchHits,
  searchCount,
  alertSinkCount,
  anomalySinkCount,
  downtimeEventCount,
  incidentEventCount,
  waitForCount,
  sampleCountOver,
  alertHistory,
  suppressedRows,
  waitForSuppressed,
  unsuppressedRows,
  waitForFiringAfter,
  createAlertFolder,
  createSqlAlert,
  createRealtimeAlert,
  createGroupedAlert,
  enableAlert,
  triggerMessage,
  deleteAlertsAndFolders,
  listIncidents,
  findIncidentByService,
  waitForIncidentByService,
  getIncident,
  setIncidentSeverity,
  resolveIncident,
  backfillAnomalyStream,
  spike,
  createAnomalyDetector,
  trainDetector,
  waitForDetectorReady,
  detectNow,
  deleteDetector,
  createSloBurnAlert,
  sloRows,
  sliceRows,
  waitForSloLive,
  listSyntheticLocations,
  createSyntheticCheck,
  deleteSyntheticCheck,
  createSyntheticsFolder,
  deleteSyntheticsFolder,
  downtimeBanners,
};
