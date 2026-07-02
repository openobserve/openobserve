// RUM stream verification helper
// --------------------------------------------------------------------------
// Queries the OpenObserve search API to assert that RUM SDK beacons actually
// landed in the destination streams (_rumdata / _rumlog / _sessionreplay).
// This is the "source of truth" verification layer for the RUM E2E specs.

const testLogger = require('./test-logger.js');

function ctx() {
  return {
    orgId: process.env['ORGNAME'] || 'default',
    baseUrl: process.env['ZO_BASE_URL'] || 'http://localhost:5080',
    email: process.env['ZO_ROOT_USER_EMAIL'],
    password: process.env['ZO_ROOT_USER_PASSWORD'],
  };
}

function authHeader(email, password) {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

/**
 * Run a SQL search against a stream and return the hits array.
 * @param {import('@playwright/test').Page} page
 * @param {object} p
 * @param {string} p.sql full SQL (e.g. `SELECT * FROM "_rumdata" WHERE service = 'x'`)
 * @param {number} [p.lookbackMinutes=30] window size ending "now"
 * @param {number} [p.size=50]
 * @returns {Promise<Array<object>>}
 */
async function searchStream(page, { sql, lookbackMinutes = 30, size = 50 }) {
  const { orgId, baseUrl, email, password } = ctx();
  const endMicros = Date.now() * 1000;
  const startMicros = endMicros - lookbackMinutes * 60 * 1000 * 1000;

  const res = await page.request.post(
    `${baseUrl}/api/${orgId}/_search?type=logs`,
    {
      headers: {
        Authorization: authHeader(email, password),
        'Content-Type': 'application/json',
      },
      data: {
        query: { sql, start_time: startMicros, end_time: endMicros, from: 0, size },
      },
    },
  );

  if (!res.ok()) {
    testLogger.warn('searchStream non-OK', { status: res.status(), sql });
    return [];
  }
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.hits) ? body.hits : [];
}

/**
 * Poll until a stream has at least `minRows` rows matching the query, or throw.
 * Uses Playwright's expect.poll-style retry via a manual loop so it can be
 * awaited inside any test without importing expect here.
 */
async function waitForStreamRows(
  page,
  { sql, minRows = 1, timeoutMs = 40000, intervalMs = 2500, lookbackMinutes = 30, size = 50 },
) {
  const deadline = Date.now() + timeoutMs;
  let hits = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    hits = await searchStream(page, { sql, lookbackMinutes, size });
    if (hits.length >= minRows) return hits;
    if (Date.now() > deadline) return hits; // let caller assert & report
    await page.waitForTimeout(intervalMs);
  }
}

module.exports = { searchStream, waitForStreamRows };
