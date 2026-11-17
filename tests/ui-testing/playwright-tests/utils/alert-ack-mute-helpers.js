// Copyright 2026 OpenObserve Inc.


const path = require('path');
const testLogger = require('./test-logger.js');
const fs = require('fs');
const { request } = require('@playwright/test');
const {
  urls, api, uniq, simpleAlert, multiAlert, createAlert, findAlertId, listAlerts, listAlertsInFolder,
  getAlertGroups, ingest, isFiringOutcome,
} = require('./alerts-api-helpers.js');

const MICROS = 1_000_000;
const PASSWORD = 'Complexpass#123';

function fastSingleAlert(name, stream) {
  const a = simpleAlert(name);
  a.stream_name = stream;
  Object.assign(a.trigger_condition, { frequency: 1, period: 1, threshold: 1, silence: 0 });
  return a;
}

function fastMultiAlert(name, stream) {
  const a = multiAlert(name);
  a.stream_name = stream;
  Object.assign(a.trigger_condition, { frequency: 1, period: 1, threshold: 1, silence: 0 });
  return a;
}

async function createFiringSingle(page, prefix, created, patch = {}) {
  const stream = uniq(`${prefix}_s`);
  const name = uniq(prefix);
  await ingest(page, stream, [{ i: 1 }, { i: 2 }, { i: 3 }]);
  const r = await createAlert(page, Object.assign(fastSingleAlert(name, stream), patch));
  if (r.status() !== 200) throw new Error(`create ${name}: ${r.status()} ${await r.text()}`);
  const id = await findAlertId(page, name);
  created.push(id);
  return { name, id, stream, feed: () => ingest(page, stream, [{ i: 1 }, { i: 2 }, { i: 3 }]) };
}

async function createFiringMulti(page, prefix, created, cities = ['bangalore', 'mumbai']) {
  const stream = uniq(`${prefix}_s`);
  const name = uniq(prefix);
  const feed = (only = cities) => ingest(page, stream, only.map((city) => ({ city, latency: 900 })));
  await feed();
  const r = await createAlert(page, fastMultiAlert(name, stream));
  if (r.status() !== 200) throw new Error(`create ${name}: ${r.status()} ${await r.text()}`);
  const id = await findAlertId(page, name);
  created.push(id);
  return { name, id, stream, feed };
}

async function listItem(page, name) {
  return (await listAlerts(page)).find((a) => a.name === name) || null;
}

async function waitFiring(page, alert, { timeoutMs = 240_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await alert.feed();
    const item = alert.folder
      ? (await listAlertsInFolder(page, alert.folder)).find((a) => a.name === alert.name) || null
      : await listItem(page, alert.name);
    if (item?.firing_started_at && isFiringOutcome(item.last_outcome)) return item;
    if (Date.now() > deadline) throw new Error(`${alert.name} never fired: ${JSON.stringify(item)}`);
    await page.waitForTimeout(5000);
  }
}

async function waitGroupsFiring(page, alert, cities, { timeoutMs = 240_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await alert.feed();
    const groups = await getAlertGroups(page, alert.id);
    const firing = (groups.list || []).filter((g) => isFiringOutcome(g.last_outcome) && g.firing_started_at);
    const named = (c) => firing.find((g) => (g.labels || []).some((l) => String(l.value) === c) || String(g.group_labels || '').includes(c));
    if (cities.every(named)) return { groups, byCity: Object.fromEntries(cities.map((c) => [c, named(c)])) };
    if (Date.now() > deadline) throw new Error(`${alert.name} groups never fired: ${JSON.stringify(groups.list)}`);
    await page.waitForTimeout(5000);
  }
}

const v2 = (p) => `${urls().v2}${p}`;

// A failed read throws, so an empty list or a missing row always means the read succeeded.
async function okJson(r, what) {
  if (!r.ok()) throw new Error(`${what}: ${r.status()} ${await r.text()}`);
  return r.json();
}

async function acks(page, alertId) {
  const r = await api(page, 'get', v2(`/alerts/${alertId}/acks?folder=default`));
  return (await okJson(r, `acks of ${alertId}`)).acks || [];
}

async function downtime(page, id) {
  const r = await api(page, 'get', v2(`/downtimes/${id}`));
  return okJson(r, `downtime ${id}`);
}

async function history(page, alertId) {
  const r = await api(page, 'get', v2(`/alerts/history?alert_id=${alertId}&size=100&sort_by=timestamp&sort_order=desc`));
  return (await okJson(r, `history of ${alertId}`)).hits || [];
}

/** Whether the server correlates firings into incidents (`incidents_enabled` in /config). */
async function incidentsEnabled(page) {
  const r = await api(page, 'get', `${urls().v1}/config`);
  return (await okJson(r, 'config')).incidents_enabled === true;
}

async function pollUntil(page, read, test, { timeoutMs = 120_000, everyMs = 4000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    if (onTick) await onTick();
    last = await read();
    if (test(last)) return last;
    if (Date.now() > deadline) return last;
    await page.waitForTimeout(everyMs);
  }
}

async function createUser(page, role) {
  const email = `ackmute_${role}_${Date.now().toString(36)}@example.com`;
  const r = await api(page, 'post', `${urls().v1}/users`, {
    email, password: PASSWORD, first_name: 'Ack', last_name: role, role, organization: urls().org,
  });
  if (!r.ok()) throw new Error(`create ${role} user: ${r.status()} ${await r.text()}`);
  const headers = {
    Authorization: `Basic ${Buffer.from(`${email}:${PASSWORD}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  return { email, headers };
}

async function deleteUser(page, email) {
  await api(page, 'delete', `${urls().v1}/users/${encodeURIComponent(email)}`).catch(() => {});
}

// Its own context, so the browser's session cookie does not make it root.
async function ackAs(page, user, alertId, body) {
  const ctx = await request.newContext({ extraHTTPHeaders: user.headers });
  try {
    const r = await ctx.post(v2(`/alerts/${alertId}/ack?folder=default`), { data: body });
    return { status: r.status(), body: await r.text() };
  } finally {
    await ctx.dispose();
  }
}

// Cleanup never fails the test, so a refused call is logged by path and status to make a leak traceable.
async function cleanupCall(page, method, p) {
  const r = await api(page, method, v2(p)).catch((e) => {
    // The thrown message carries Playwright's call log with the Authorization header, so only its first line is kept.
    testLogger.warn('alert mute cleanup: request failed', { method, path: p, reason: String(e?.message ?? e).split('\n')[0] });
    return null;
  });
  if (r && !r.ok()) testLogger.warn('alert mute cleanup: non-ok response', { method, path: p, status: r.status() });
  return r?.ok() ? r : null;
}

async function endMutes(page, names) {
  const items = (await listAlerts(page)).filter((a) => names.includes(a.name));
  for (const item of items.filter((a) => a.active_downtime)) {
    await cleanupCall(page, 'post', `/alerts/${item.alert_id}/mute/${item.active_downtime.id}/cancel?folder=default`);
  }
  const ids = items.map((a) => a.alert_id);
  const seen = new Set();
  for (const id of ids) {
    const r = await cleanupCall(page, 'get', `/downtimes?alert_id=${encodeURIComponent(id)}&page_size=500`);
    // alert_id also matches rows whose condition covers the alert, so only rows that name one of ours are deleted.
    const rows = r ? ((await r.json()).items ?? []) : [];
    // Ended quick mutes are kept, and enough of them push a new row off the Downtimes list's first page.
    for (const d of rows.filter((x) => (x.targets ?? []).some((t) => (t.ids ?? []).some((i) => ids.includes(i))))) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      await cleanupCall(page, 'delete', `/downtimes/${d.id}?folder=${encodeURIComponent(d.folder_id || 'default')}`);
    }
  }
}

const nowMicros = () => Date.now() * MICROS / 1000;

// Switches theme in place so an open menu or dialog survives the second shot.
async function shoot(page, name) {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const mode of ['light', 'dark']) {
    await page.evaluate((m) => {
      localStorage.setItem('theme', m);
      document.documentElement.classList.toggle('dark', m === 'dark');
      document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.dispatch('appTheme', m);
    }, mode);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, `${name}-${mode}.png`) });
  }
  await page.evaluate(() => {
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.toggle('dark', false);
    document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.dispatch('appTheme', 'light');
  });
}

module.exports = {
  MICROS, fastSingleAlert, fastMultiAlert, createFiringSingle, createFiringMulti,
  listItem, waitFiring, waitGroupsFiring, acks, downtime, history, incidentsEnabled, pollUntil,
  createUser, deleteUser, ackAs, endMutes, nowMicros, shoot,
};
