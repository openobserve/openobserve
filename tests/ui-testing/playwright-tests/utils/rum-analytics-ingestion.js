// Known _rumdata history per run app id; back-dated rows need the shard's ingest_allowed_upto of 1440 hours.

const crypto = require('crypto');
const testLogger = require('./test-logger.js');
const { rumTestContext } = require('./rum-env.js');

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Synthetic, never a real account: the constant-identity app's only usr_email.
const PLACEHOLDER_EMAIL = 'placeholder@e2e.test';

/** Page-key vectors: the raw view_url and the template the Pages list must render. */
const PAGE_KEY_VECTORS = [
  { url: 'https://cloud.example.com/web/cb#id_token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig', key: '/web/cb' },
  { url: 'https://app.example.com/#/orders/12345?tab=items', key: '/#/orders/:id' },
  { url: 'https://app.example.com/#!/signup', key: '/#/signup' },
  { url: 'https://app.example.com/users/ana%40example.com/edit', key: '/users/:id/edit' },
  { url: 'https://app.example.com/r/abc%2Bdef%2Fghi%3D0123456', key: '/r/:id' },
  { url: 'https://x.com/blog/top-10-open-source-monitoring-tools', key: '/blog/top-10-open-source-monitoring-tools' },
  { url: 'https://x.com/assets/logs_settings_6c3984ca0a.png', key: '/assets/:id' },
  { url: 'https://x.com/a/123/456/x', key: '/a/:id/:id/x' },
];

/** Click-key vectors: the raw action_target_name and the templated key. */
const CLICK_KEY_VECTORS = [
  { name: 'Contact ana@example.com', key: 'Contact :email' },
  { name: 'Order 12345678', key: 'Order :num' },
  { name: 'row-3fa85f64-5717-4562-b3fc-2c963f66afa6', key: 'row-:id' },
];

const FUNNEL = {
  a: 'https://shop.example.com/web/a',
  aKey: '/web/a',
  b: 'b-btn',
  c: 'https://shop.example.com/web/c',
  cKey: '/web/c',
};

/** Monday 00:00 UTC of the current ISO week: retention cohorts line up with it in a UTC browser. */
function weekStartUtc(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function runAppId(prefix = 'pa-e2e') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

class SessionBuilder {
  constructor(appId, sessionId, startMs, { user = null, replay = false, browser = 'Chrome' } = {}) {
    this.appId = appId;
    this.sessionId = sessionId;
    this.t = startMs;
    this.user = user;
    this.replay = replay;
    this.browser = browser;
    this.rows = [];
    this.views = 0;
    this.actions = 0;
  }

  base(type) {
    this.t += 5000;
    const row = {
      _timestamp: this.t * 1000,
      date: this.t,
      type,
      application_id: this.appId,
      env: 'e2e',
      version: '1.0.0',
      service: 'pa-e2e',
      source: 'browser',
      session_id: this.sessionId,
      session_type: 'user',
      user_agent_user_agent_family: this.browser,
      user_agent_os_family: 'Mac OS X',
      user_agent_device_family: 'Mac',
      geo_info_country: 'India',
    };
    if (this.user) row.usr_email = this.user;
    if (this.replay) row.session_has_replay = true;
    return row;
  }

  view(url) {
    this.views += 1;
    const row = { ...this.base('view'), view_id: `${this.sessionId}-v${this.views}`, view_url: url, view_loading_type: 'route_change' };
    this.rows.push(row);
    this.rows.push({ ...row, _timestamp: row._timestamp + 1000, date: row.date + 1 });
    return this;
  }

  click(name, onUrl) {
    this.actions += 1;
    this.rows.push({
      ...this.base('action'),
      action_id: `${this.sessionId}-a${this.actions}`,
      action_type: 'click',
      action_target_name: name,
      view_url: onUrl || '',
    });
    return this;
  }

  error(message = 'TypeError: e2e') {
    this.rows.push({ ...this.base('error'), error_type: 'TypeError', error_message: message, error_source: 'source' });
    return this;
  }
}

function buildSeed(appId, nowMs = Date.now()) {
  const sessions = [];
  const at = (daysAgo, hour = 10) => nowMs - daysAgo * DAY_MS + (hour - 12) * HOUR_MS;
  const monday = weekStartUtc(nowMs);
  const weekDay = (daysFromMonday) => monday + daysFromMonday * DAY_MS + 10 * HOUR_MS;
  let n = 0;
  const session = (startMs, opts) => {
    n += 1;
    const s = new SessionBuilder(appId, `${appId}-s${String(n).padStart(3, '0')}`, startMs, opts);
    sessions.push(s);
    return s;
  };

    session(at(1, 9), { user: 'u1@e2e.test', replay: true }).view(FUNNEL.a).click(FUNNEL.b, FUNNEL.a).view(FUNNEL.c);
  session(at(1, 10), { user: 'u2@e2e.test' }).view(FUNNEL.a).click(FUNNEL.b, FUNNEL.a).error();
  session(at(1, 11), { user: 'u3@e2e.test', replay: true }).view(FUNNEL.a).view('https://shop.example.com/web/help');
  // B, A, B converts A → B; B then A does not.
  session(at(1, 12), { user: 'u4@e2e.test' }).click(FUNNEL.b, FUNNEL.c).view(FUNNEL.a).click(FUNNEL.b, FUNNEL.a);
  session(at(1, 13), { user: 'u5@e2e.test', browser: 'Firefox' }).click(FUNNEL.b, FUNNEL.c).view(FUNNEL.a);
  session(at(2, 9), { user: 'u6@e2e.test', browser: 'Firefox' }).view(FUNNEL.a).error().view('https://shop.example.com/web/help');

  // Page-key and click-key vectors; each session its own user, so no identity dominates.
  let k = 0;
  for (const v of PAGE_KEY_VECTORS) session(at(3, 9), { user: `k${(k += 1)}@e2e.test` }).view(v.url);
  for (const v of CLICK_KEY_VECTORS) {
    session(at(3, 10), { user: `k${(k += 1)}@e2e.test` }).view(FUNNEL.c).click(v.name, FUNNEL.c);
  }

  // r1's first row sits exactly on the first seeded Monday, so the weekly cohorts are fixed.
  const retentionFromMs = monday - 21 * DAY_MS;
  session(retentionFromMs - 5000, { user: 'r1@e2e.test' }).view('https://shop.example.com/web/home');
  const weeks = { 'r1@e2e.test': [-13, -6], 'r2@e2e.test': [-20, -6], 'r3@e2e.test': [-13] };
  for (const [user, days] of Object.entries(weeks)) {
    for (const d of days) session(weekDay(d), { user }).view('https://shop.example.com/web/home');
  }

  const rows = sessions.flatMap((s) => s.rows);
  return {
    rows,
    facts: {
      appId,
      sessions: sessions.length,
      funnel: { a: FUNNEL.aKey, b: FUNNEL.b, c: FUNNEL.cKey, counts: [6, 3, 1] },
      pageKeys: PAGE_KEY_VECTORS,
      clickKeys: CLICK_KEY_VECTORS,
      retentionUsers: Object.keys(weeks),
      retentionFromMs,
    },
  };
}

/** Views without users or click names: the Clicks-not-captured and Retention-unlock states. */
function buildViewsOnlySeed(appId, nowMs = Date.now()) {
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const s = new SessionBuilder(appId, `${appId}-s${i}`, nowMs - (i + 2) * HOUR_MS);
    s.view('https://shop.example.com/web/landing');
    rows.push(...s.rows);
  }
  return rows;
}

/** Every session carries one synthetic usr_email, the shape of a constant setUser call. */
function buildPlaceholderIdentitySeed(appId, nowMs = Date.now()) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const s = new SessionBuilder(appId, `${appId}-s${i}`, nowMs - (i + 2) * HOUR_MS, { user: PLACEHOLDER_EMAIL });
    s.view('https://shop.example.com/web/landing').view('https://shop.example.com/web/next');
    rows.push(...s.rows);
  }
  return rows;
}

/** Basic-auth API context for the run's org; every helper and spec here builds requests from it. */
function apiContext() {
  const { orgId, baseUrl, email, password } = rumTestContext();
  return {
    orgId,
    baseUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
  };
}

async function ingestJson(page, stream, rows) {
  const { orgId, baseUrl, headers } = apiContext();
  const res = await page.request.post(`${baseUrl}/api/${orgId}/${stream}/_json`, { headers, data: rows });
  const body = await res.text();
  if (!res.ok()) throw new Error(`${stream} ingest failed: ${res.status()} ${body}`);
  const parsed = JSON.parse(body);
  const status = parsed?.status?.[0];
  if (status && status.failed > 0) {
    throw new Error(`${stream} ingest dropped ${status.failed} rows: ${status.error || body}`);
  }
  return parsed;
}

const postRows = (page, rows) => ingestJson(page, '_rumdata', rows);

async function waitForStream(page, stream) {
  const { orgId, baseUrl, headers } = apiContext();
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const res = await page.request.get(`${baseUrl}/api/${orgId}/streams/${stream}/schema?type=logs`, { headers });
    if (res.ok()) return;
    await page.waitForTimeout(2000);
  }
  throw new Error(`Stream ${stream} did not appear within 90s`);
}

/** The Sessions list renders only once a _sessionreplay stream exists; the stream then stays, so the org keeps its Sessions tab. */
async function ensureSessionReplayStream(page, appId, nowMs = Date.now()) {
  await ingestJson(page, '_sessionreplay', [{
    _timestamp: nowMs * 1000,
    session_id: `${appId}-replay-marker`,
    application_id: appId,
    start: nowMs,
    end: nowMs,
    user_agent_user_agent_family: 'Chrome',
    user_agent_os_family: 'Mac OS X',
    user_agent_device_family: 'Other',
    ip: '127.0.0.1',
    source: 'browser',
    segment: '',
  }]);
  await waitForStream(page, '_sessionreplay');
}

/** Ingests the seed and waits until search sees every row, since search lags the WAL flush. */
async function seedRumAnalytics(page, { appId = runAppId(), nowMs = Date.now() } = {}) {
  const seed = buildSeed(appId, nowMs);
  await postRows(page, seed.rows);
  testLogger.info('Seeded RUM analytics rows', { appId, rows: seed.rows.length });
  await waitForRows(page, appId, seed.rows.length, nowMs);
  return seed.facts;
}

async function seedViewsOnlyApp(page, { appId, nowMs = Date.now() }) {
  const rows = buildViewsOnlySeed(appId, nowMs);
  await postRows(page, rows);
  await waitForRows(page, appId, rows.length, nowMs);
  return { appId, sessions: 3 };
}

async function seedPlaceholderIdentityApp(page, { appId, nowMs = Date.now() }) {
  const rows = buildPlaceholderIdentitySeed(appId, nowMs);
  await postRows(page, rows);
  await waitForRows(page, appId, rows.length, nowMs);
  return { appId, email: PLACEHOLDER_EMAIL };
}

/** One click on a page whose key outgrows the 1,024-character key limit (F46). */
async function seedLongPageApp(page, { appId, nowMs = Date.now() }) {
  const url = `https://shop.example.com/web/${'q'.repeat(1100)}`;
  const rows = [];
  for (let i = 0; i < 2; i++) {
    const s = new SessionBuilder(appId, `${appId}-s${i}`, nowMs - (i + 2) * HOUR_MS);
    s.view(url).click('long-btn', url);
    rows.push(...s.rows);
  }
  await postRows(page, rows);
  await waitForRows(page, appId, rows.length, nowMs);
  return { appId, pageKey: `/web/${'q'.repeat(1100)}` };
}

async function waitForRows(page, appId, expected, nowMs) {
  const { orgId, baseUrl, headers } = apiContext();
  const deadline = Date.now() + 90000;
  const sql = `SELECT COUNT(*) AS n FROM "_rumdata" WHERE application_id = '${appId}'`;
  while (Date.now() < deadline) {
    const res = await page.request.post(`${baseUrl}/api/${orgId}/_search?type=logs`, {
      headers,
      data: { query: { sql, start_time: (nowMs - 30 * DAY_MS) * 1000, end_time: (nowMs + HOUR_MS) * 1000, from: 0, size: 1 } },
    });
    if (res.ok()) {
      const hits = (await res.json()).hits || [];
      if (Number(hits[0]?.n) >= expected) return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`Seeded rows for ${appId} were not searchable within 90s`);
}

module.exports = {
  apiContext,
  ensureSessionReplayStream,
  seedRumAnalytics,
  seedViewsOnlyApp,
  seedPlaceholderIdentityApp,
  seedLongPageApp,
  buildSeed,
  runAppId,
  weekStartUtc,
  PAGE_KEY_VECTORS,
  CLICK_KEY_VECTORS,
  DAY_MS,
  HOUR_MS,
};
