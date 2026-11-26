// API and data-seeding helpers for the Starter Packs specs (enterprise only).

const { randomUUID } = require('crypto');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ROOT = () => ({ email: process.env.ZO_ROOT_USER_EMAIL, password: process.env.ZO_ROOT_USER_PASSWORD });
const MEMBER_PASSWORD = 'Complexpass#123';

const basic = ({ email, password }) => ({
  Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`,
  'Content-Type': 'application/json',
});

/** A short token unique to this run, safe in org, role and user names. */
const runTag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Calls the API as `who` (root by default); `path` is everything after the host. */
async function call(request, method, path, data, who = ROOT(), { host = base() } = {}) {
  const send = () => request.fetch(`${host}${path}`, {
    method,
    headers: basic(who),
    ...(data !== undefined ? { data: typeof data === 'string' ? data : JSON.stringify(data) } : {}),
    failOnStatusCode: false,
  });
  // Shared envs answer an occasional proxy 502 or reset; only idempotent calls are resent.
  const idempotent = ['GET', 'DELETE', 'PUT'].includes(method);
  let resp;
  for (let i = 0; ; i++) {
    try {
      resp = await send();
      if (!(idempotent && i < 3 && [502, 503, 504].includes(resp.status()))) break;
    } catch (e) {
      if (!idempotent || i >= 3) throw e;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  const text = await resp.text().catch(() => '');
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch (_) { /* plain text */ }
  return { status: resp.status(), body };
}

async function createOrg(request, name) {
  const { status, body } = await call(request, 'POST', '/api/organizations', { name });
  const id = body?.data?.identifier ?? body?.identifier ?? body?.organization?.identifier;
  if (status >= 400 || !id) throw new Error(`create org ${name}: ${status} ${JSON.stringify(body).slice(0, 200)}`);
  return id;
}

// ---------- ingestion ----------

const minuteSteps = (n) => {
  const now = Date.now() * 1000;
  return Array.from({ length: n }, (_, i) => now - i * 60_000_000);
};

const metric = (name, type, labels, value, ts) => ({ __name__: name, __type__: type, _timestamp: ts, value, ...labels });

/** OTel hostmetrics-shaped streams; withMemory=false leaves out system_memory_*. */
function hostRows({ withMemory = true } = {}) {
  const rows = [];
  const steps = minuteSteps(15);
  const now = steps[0];
  for (const ts of steps) {
    for (const [h, mem] of [['host-a', 45], ['host-b', 55]]) {
      const b = { host_name: h, service_name: 'otelcol' };
      for (const st of ['user', 'system', 'idle']) {
        rows.push(metric('system_cpu_time', 'counter', { ...b, cpu: 'cpu0', state: st }, 1000 + (now - ts) / 1e6, ts));
        rows.push(metric('system_cpu_utilization', 'gauge', { ...b, cpu: 'cpu0', state: st }, 0.2, ts));
      }
      for (const n of ['1m', '5m', '15m']) rows.push(metric(`system_cpu_load_average_${n}`, 'gauge', b, 0.5, ts));
      for (const d of ['transmit', 'receive']) {
        rows.push(metric('system_network_io', 'counter', { ...b, device: 'eth0', direction: d }, 5000, ts));
        rows.push(metric('system_disk_io', 'counter', { ...b, device: 'sda', direction: d === 'receive' ? 'read' : 'write' }, 3000, ts));
      }
      rows.push(metric('system_disk_weighted_io_time', 'counter', { ...b, device: 'sda' }, 10, ts));
      const fs = { ...b, device: '/dev/sda1', mountpoint: '/', type: 'ext4', mode: 'rw' };
      for (const [st, v] of [['used', 4e9], ['free', 6e9]]) {
        rows.push(metric('system_filesystem_usage', 'gauge', { ...fs, state: st }, v, ts));
        rows.push(metric('system_filesystem_utilization', 'gauge', fs, 0.4, ts));
      }
      if (withMemory) {
        for (const [st, frac] of [['used', mem / 100], ['free', 1 - mem / 100]]) {
          rows.push(metric('system_memory_usage', 'gauge', { ...b, state: st }, frac * 8e9, ts));
          rows.push(metric('system_memory_utilization', 'gauge', { ...b, state: st }, frac, ts));
        }
      }
    }
  }
  return rows;
}

function k8sRows() {
  const rows = [];
  for (const ts of minuteSteps(15)) {
    ['node-1', 'node-2'].forEach((node, i) => {
      const b = { k8s_cluster: 'demo', k8s_node_name: node };
      rows.push(metric('k8s_node_cpu_usage', 'gauge', b, 0.5, ts));
      rows.push(metric('k8s_node_memory_working_set', 'gauge', b, 3e9, ts));
      rows.push(metric('k8s_node_memory_usage', 'gauge', b, 3e9 + i * 1e9, ts));
      rows.push(metric('k8s_node_allocatable_cpu', 'gauge', b, 4, ts));
      rows.push(metric('k8s_node_allocatable_memory', 'gauge', b, 8e9, ts));
      rows.push(metric('k8s_node_allocatable_pods', 'gauge', b, 110, ts));
      // The Overview's k8s_cluster variable reads this stream; without it every panel is left out.
      rows.push(metric('kube_node_info', 'gauge', { k8s_cluster: 'demo', node, kubelet_version: 'v1.30.0' }, 1, ts));
      for (let p = 0; p < 2; p++) {
        const pod = { ...b, k8s_namespace_name: 'shop', k8s_pod_name: `web-${node}-${p}`, k8s_container_name: 'web', k8s_deployment_name: 'web' };
        rows.push(metric('k8s_pod_cpu_usage', 'gauge', pod, 0.1, ts));
        rows.push(metric('k8s_pod_memory_working_set', 'gauge', pod, 2e8, ts));
        rows.push(metric('k8s_pod_phase', 'gauge', pod, 2, ts));
        rows.push(metric('k8s_container_cpu_request', 'gauge', pod, 0.2, ts));
        rows.push(metric('k8s_container_memory_request', 'gauge', pod, 2.5e8, ts));
        const kp = { k8s_cluster: 'demo', namespace: 'shop', pod: `web-${node}-${p}`, container: 'web', node };
        rows.push(metric('kube_pod_status_phase', 'gauge', { ...kp, phase: 'Running' }, 1, ts));
        rows.push(metric('kube_pod_container_status_waiting_reason', 'gauge', { ...kp, reason: 'CrashLoopBackOff' }, 0, ts));
        rows.push(metric('kube_pod_container_status_terminated_reason', 'gauge', { ...kp, reason: 'OOMKilled' }, 0, ts));
      }
    });
    const dep = { k8s_cluster: 'demo', namespace: 'shop', deployment: 'web' };
    rows.push(metric('kube_deployment_status_replicas_available', 'gauge', dep, 4, ts));
    rows.push(metric('kube_deployment_spec_replicas', 'gauge', dep, 4, ts));
  }
  return rows;
}

function k8sEvents(tag) {
  return minuteSteps(15).map((ts, i) => ({
    _timestamp: ts, k8s_cluster: 'demo', k8s_namespace_name: 'shop', kind: 'Event',
    reason: i % 3 === 0 ? 'OOMKilling' : 'Pulled', message: `${tag} event ${i}`,
    instrumentation_library_name: 'k8sobjects', service_name: 'k8s-events',
    body_object_kind: 'Event', body_object_type: 'Warning', body_object_reason: 'OOMKilling',
    body_object_note: 'Memory cgroup out of memory', k8s_node_name: 'node-1',
    k8s_resource_name: 'events', event_name: `node-1.oom${i}`,
  }));
}

const plainLogs = (n = 5) => Array.from({ length: n }, (_, i) => ({ _timestamp: Date.now() * 1000 - i * 1e6, message: `plain log line ${i}`, level: 'info' }));

// A resent ingest only duplicates samples, which no assertion here counts.
async function ingestPost(request, path, rows) {
  let r;
  for (let i = 0; i < 4; i++) {
    r = await call(request, 'POST', path, rows, ROOT(), { host: ingestBase() }).catch((e) => ({ status: 0, body: String(e) }));
    if (r.status === 200) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return r;
}

async function ingestMetrics(request, org, rows) {
  for (let i = 0; i < rows.length; i += 2000) {
    const r = await ingestPost(request, `/api/${org}/ingest/metrics/_json`, rows.slice(i, i + 2000));
    if (r.status !== 200) throw new Error(`ingest metrics into ${org}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}

async function ingestLogs(request, org, stream, rows) {
  const r = await ingestPost(request, `/api/${org}/${encodeURIComponent(stream)}/_json`, rows);
  if (r.status !== 200) throw new Error(`ingest logs into ${org}/${stream}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}

/** Polls until every named stream is listed, since the matcher reads the stream list. */
async function waitForStreams(request, org, type, names, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let have = [];
  while (Date.now() < deadline) {
    const r = await call(request, 'GET', `/api/${org}/streams?type=${type}`);
    have = (r.body?.list ?? []).map((s) => s.name);
    if (names.every((n) => have.includes(n))) return;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`streams ${names} not listed in ${org} (${type}); have ${have.length}`);
}

// ---------- users and roles ----------

// A proxy 502 may hide a create that landed, so a resend's "already exists" counts as done.
async function createWithRetry(request, path, body) {
  let r;
  for (let i = 0; i < 4; i++) {
    r = await call(request, 'POST', path, body).catch((e) => ({ status: 0, body: String(e) }));
    if (i > 0 && r.status === 400 && /exist/i.test(JSON.stringify(r.body))) return { status: 200, body: r.body };
    if (r.status < 500 && r.status !== 0) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return r;
}

async function createUser(request, org, email, role, customRole) {
  const body = { email, password: MEMBER_PASSWORD, first_name: 'sp', last_name: 'e2e', role };
  if (customRole) body.custom_role = [customRole];
  const r = await createWithRetry(request, `/api/${org}/users`, body);
  if (r.status >= 400) throw new Error(`create user ${email}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { email, password: MEMBER_PASSWORD };
}

/** grants: [[resource, permission | permission[]], ...] on `<resource>:_all_<org>`. */
async function createRole(request, org, name, grants, members = []) {
  let r = await createWithRetry(request, `/api/${org}/roles`, { role: name });
  if (r.status >= 400) throw new Error(`create role ${name}: ${r.status}`);
  const add = grants.flatMap(([obj, perms]) => [].concat(perms).map((permission) => ({ object: `${obj}:_all_${org}`, permission })));
  r = await call(request, 'PUT', `/api/${org}/roles/${name}`, { add, remove: [], add_users: members, remove_users: [] });
  if (r.status >= 400) throw new Error(`grant role ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}

// ---------- KV install records ----------

const recordKey = (packId, installId) => `starter_pack.${packId}.${installId}`;

async function kvKeys(request, org, prefix) {
  const r = await call(request, 'GET', `/api/${org}/kv?prefix=${encodeURIComponent(prefix)}`);
  return Array.isArray(r.body) ? r.body.filter((k) => k.startsWith(prefix)) : [];
}

async function kvGet(request, org, key, who) {
  const r = await call(request, 'GET', `/api/${org}/kv/${encodeURIComponent(key)}`, undefined, who);
  if (r.status !== 200) return null;
  return typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
}

const kvPut = (request, org, key, value, who) =>
  call(request, 'POST', `/api/${org}/kv/${encodeURIComponent(key)}`, JSON.stringify(value), who);

const kvDelete = (request, org, key) => call(request, 'DELETE', `/api/${org}/kv/${encodeURIComponent(key)}`);

/** Every install record stored for a pack. */
async function packRecords(request, org, packId) {
  const keys = await kvKeys(request, org, `starter_pack.${packId}.`);
  const out = [];
  for (const k of keys) {
    const rec = await kvGet(request, org, k);
    if (rec) out.push(rec);
  }
  return out;
}

// ---------- object reads, for server-side assertions ----------

const dashboardIdOf = (b) => b?.[`v${b?.version}`]?.dashboardId ?? b?.v8?.dashboardId ?? b?.v5?.dashboardId ?? b?.v3?.dashboardId ?? b?.dashboardId;

const getAlert = (request, org, id) => call(request, 'GET', `/api/v2/${org}/alerts/${id}`);
const getDashboard = (request, org, id, folder = 'default') => call(request, 'GET', `/api/${org}/dashboards/${id}?folder=${folder}`);
const getSavedView = (request, org, id) => call(request, 'GET', `/api/${org}/savedviews/${id}`);

async function listAlerts(request, org, folder) {
  const q = folder ? `?folder=${folder}` : '';
  const r = await call(request, 'GET', `/api/v2/${org}/alerts${q}`);
  return r.body?.list ?? [];
}

async function listDashboards(request, org, folder = 'default') {
  const r = await call(request, 'GET', `/api/${org}/dashboards?folder=${folder}`);
  return (r.body?.dashboards ?? r.body?.list ?? []).map((d) => ({ id: dashboardIdOf(d) ?? d?.id, title: d?.[`v${d?.version}`]?.title ?? d?.title }));
}

/** GET status of each created item; a gone saved view answers 400, so it is mapped to 404. */
async function itemStatuses(request, org, record) {
  const out = [];
  for (const it of record.items ?? []) {
    if (!it.id || it.status !== 'created') continue;
    let status;
    if (it.kind === 'alert') status = (await getAlert(request, org, it.id)).status;
    else if (it.kind === 'dashboard') status = (await getDashboard(request, org, it.id, it.folderId ?? 'default')).status;
    else if (it.kind === 'savedView') {
      const r = await getSavedView(request, org, it.id);
      status = r.status === 400 ? 404 : r.status;
    } else if (it.kind === 'folder') {
      const type = it.itemId === 'alerts' ? 'alerts' : 'dashboards';
      status = (await call(request, 'GET', `/api/v2/${org}/folders/${type}/${it.id}`)).status;
    } else continue;
    out.push({ kind: it.kind, itemId: it.itemId, id: it.id, status });
  }
  return out;
}

// ---------- teardown ----------

/** Records exactly what a spec made so afterAll deletes those, children first and orgs last. */
function makeTracker() {
  const t = { alerts: [], dashboards: [], savedViews: [], folders: [], kv: [], users: [], roles: [], streams: [] };
  const orgs = [];
  return {
    ...Object.fromEntries(Object.keys(t).map((k) => [k, (org, v) => { if (v) t[k].push([org, v]); return v; }])),
    org(id) { if (id) orgs.push(id); return id; },
    /** Adds every created item, and the record itself, from a pack's install record. */
    fromRecord(org, record) {
      if (!record) return;
      t.kv.push([org, recordKey(record.packId, record.installId)]);
      for (const it of record.items ?? []) {
        if (!it.id) continue;
        if (it.kind === 'alert') t.alerts.push([org, it.id]);
        else if (it.kind === 'dashboard') t.dashboards.push([org, { id: it.id, folder: it.folderId ?? 'default' }]);
        else if (it.kind === 'savedView') t.savedViews.push([org, it.id]);
        else if (it.kind === 'folder') t.folders.push([org, { id: it.id, type: it.itemId === 'alerts' ? 'alerts' : 'dashboards' }]);
      }
    },
    async cleanup(request) {
      const gone = [];
      const del = async (path) => { const r = await call(request, 'DELETE', path).catch(() => ({ status: 0 })); gone.push(`${r.status} ${path}`); };
      for (const [org, id] of t.alerts) await del(`/api/v2/${org}/alerts/${id}`);
      for (const [org, d] of t.dashboards) await del(`/api/${org}/dashboards/${d.id}?folder=${d.folder}`);
      for (const [org, id] of t.savedViews) await del(`/api/${org}/savedviews/${id}`);
      for (const [org, f] of t.folders) await del(`/api/v2/${org}/folders/${f.type}/${f.id}`);
      for (const [org, key] of t.kv) await del(`/api/${org}/kv/${encodeURIComponent(key)}`);
      for (const [org, email] of t.users) await del(`/api/${org}/users/${encodeURIComponent(email)}`);
      for (const [org, role] of t.roles) await del(`/api/${org}/roles/${role}`);
      for (const [org, s] of t.streams) await del(`/api/${org}/streams/${encodeURIComponent(s.name)}?type=${s.type}`);
      for (const id of orgs) await del(`/api/organizations/${encodeURIComponent(id)}`);
      return gone;
    },
  };
}

/** Tracks every pack record in an org, plus anything the pack made that the record lost. */
async function trackPackObjects(request, tracker, org) {
  try {
    await trackPackObjectsOnce(request, tracker, org);
  } catch (_) { /* cleanup still deletes what was already tracked */ }
}

async function trackPackObjectsOnce(request, tracker, org) {
  for (const packId of ['hosts', 'kubernetes']) {
    for (const rec of await packRecords(request, org, packId)) tracker.fromRecord(org, rec);
  }
  for (const a of await listAlerts(request, org)) {
    if ((a.tags ?? []).some((tag) => String(tag).startsWith('pack:'))) tracker.alerts(org, a.alert_id ?? a.id);
  }
}


// ---------- sessions ----------

const path = require('path');
const fs = require('fs');

const rootAuthFile = path.join(__dirname, 'auth', 'user.json');

/** A signed-in browser context for `who` (root reuses global setup's session). */
async function newSession(browser, who = null) {
  const opts = { viewport: { width: 1500, height: 1024 } };
  if (!who && fs.existsSync(rootAuthFile)) {
    const context = await browser.newContext({ ...opts, storageState: rootAuthFile });
    return { context, page: await context.newPage() };
  }
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await signIn(page, who ?? ROOT());
  return { context, page };
}

/** The login form, as global setup drives it. */
async function signIn(page, { email, password }) {
  await page.goto(`${base()}/web/login`, { waitUntil: 'domcontentloaded' });
  const internal = page.locator('[data-test="login-as-internal-user"]');
  const field = page.locator('[data-test="login-user-id-field"]');
  await Promise.race([
    internal.first().waitFor({ state: 'visible', timeout: 30_000 }),
    field.waitFor({ state: 'visible', timeout: 30_000 }),
  ]).catch(() => {});
  if (await internal.first().isVisible().catch(() => false)) await internal.first().click();
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill(email);
  await page.locator('[data-test="login-password-field"]').fill(password);
  await page.locator('[data-test="login-sign-in"]').click();
  await page.locator('[data-test="navbar-main-nav"]').waitFor({ state: 'visible', timeout: 60_000 });
}

// ---------- record helpers ----------

/** Deletes a record's created items (children first) and the record, as root. */
async function disposeRecord(request, org, record) {
  const items = (record.items ?? []).filter((it) => it.id && it.status === 'created');
  const order = { alert: 0, savedView: 0, dashboard: 1, folder: 2 };
  for (const it of [...items].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))) {
    if (it.kind === 'alert') await call(request, 'DELETE', `/api/v2/${org}/alerts/${it.id}`);
    else if (it.kind === 'savedView') await call(request, 'DELETE', `/api/${org}/savedviews/${it.id}`);
    else if (it.kind === 'dashboard') await call(request, 'DELETE', `/api/${org}/dashboards/${it.id}?folder=${it.folderId ?? 'default'}`);
    else if (it.kind === 'folder') {
      await call(request, 'DELETE', `/api/v2/${org}/folders/alerts/${it.id}`);
      await call(request, 'DELETE', `/api/v2/${org}/folders/dashboards/${it.id}`);
    }
  }
  await kvDelete(request, org, recordKey(record.packId, record.installId));
}

/** Waits for the pack's single record to reach `status` (the last write trails the UI). */
async function waitForRecord(request, org, packId, status = 'complete', timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let records = [];
  do {
    records = await packRecords(request, org, packId);
    if (records.length === 1 && records[0].status === status) return records[0];
    await new Promise((res) => setTimeout(res, 1500));
  } while (Date.now() < deadline);
  throw new Error(`${packId} record never reached ${status}: ${JSON.stringify(records.map((r) => r.status))}`);
}

/** Disposes every record of a pack in an org, returning them. */
async function disposePack(request, org, packId) {
  const records = await packRecords(request, org, packId);
  for (const r of records) await disposeRecord(request, org, r);
  return records;
}

module.exports = {
  newSession, signIn, disposeRecord, disposePack, waitForRecord,
  base, MEMBER_PASSWORD, ROOT, runTag, call, createOrg, randomUUID,
  hostRows, k8sRows, k8sEvents, plainLogs, metric, minuteSteps, ingestMetrics, ingestLogs, waitForStreams,
  createUser, createRole,
  recordKey, kvKeys, kvGet, kvPut, kvDelete, packRecords,
  dashboardIdOf, getAlert, getDashboard, getSavedView, listAlerts, listDashboards, itemStatuses,
  makeTracker, trackPackObjects,
};
