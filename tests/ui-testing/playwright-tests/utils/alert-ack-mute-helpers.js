// Copyright 2026 OpenObserve Inc.


const path = require('path');
const fs = require('fs');
const { request } = require('@playwright/test');
const {
  urls, api, uniq, simpleAlert, multiAlert, createAlert, findAlertId, listAlerts,
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
    const item = await listItem(page, alert.name);
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

async function endMutes(page, names) {
  const items = await listAlerts(page);
  for (const item of items.filter((a) => names.includes(a.name) && a.active_downtime)) {
    await api(page, 'post', v2(`/alerts/${item.alert_id}/mute/${item.active_downtime.id}/cancel?folder=default`)).catch(() => {});
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
