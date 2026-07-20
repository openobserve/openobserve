// RUM stream verification helper
// --------------------------------------------------------------------------
// Queries the OpenObserve search API to assert that RUM SDK beacons actually
// landed in the destination streams (_rumdata / _rumlog / _sessionreplay).
// This is the "source of truth" verification layer for the RUM E2E specs.

const testLogger = require('./test-logger.js');
const { rumTestContext, basicAuthHeader } = require('./rum-env.js');

const ctx = rumTestContext;
const authHeader = basicAuthHeader;

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

/**
 * Purge OLD data from the shared RUM streams (_rumdata / _rumlog /
 * _sessionreplay) on a long-lived test instance, to bound the accumulation
 * from repeated dataflow runs.
 *
 * WHY "old data" and not "this run's data": OpenObserve exposes NO row-level
 * or predicate-scoped delete — the only stream-data delete API is
 * `DELETE /streams/{stream}/data_by_time_range`, which takes hour-aligned
 * start/end timestamps and removes EVERYTHING in that window regardless of
 * `service` (verified: it 400s on a non-hour-aligned end, returns an async
 * job id, and has no filter param). So the dataflow specs cannot delete just
 * their own rows. This helper instead deletes data strictly OLDER than
 * `olderThanHours`, which:
 *   - never touches the run that just finished, and
 *   - never touches a concurrently-running shard on the same instance,
 * while still clearing junk left by PAST runs. It is therefore safe to run
 * from global teardown after all tests complete.
 *
 * It is OPT-IN (`ZO_RUM_PURGE_STREAM_DATA=true`) and default-off because on a
 * genuinely shared instance a time-range delete would also remove any
 * non-test RUM data older than the cutoff.
 *
 * @param {import('@playwright/test').APIRequestContext} requestCtx
 * @param {object} [opts]
 * @param {number} [opts.olderThanHours=24]
 * @param {string[]} [opts.streams]
 * @returns {Promise<Array<{stream:string,status?:number,jobId?:string,error?:string}>>}
 */
async function purgeOldRumStreamData(
  requestCtx,
  { olderThanHours = 24, streams = ['_rumdata', '_rumlog', '_sessionreplay'] } = {},
) {
  const { orgId, baseUrl, email, password } = ctx();
  const HOUR_MS = 3600 * 1000;
  // Floor the cutoff to the top of the hour — the API rejects any end
  // timestamp that is not aligned to a zero minute/second.
  const cutoffMs = Math.floor((Date.now() - olderThanHours * HOUR_MS) / HOUR_MS) * HOUR_MS;
  const endMicros = cutoffMs * 1000;
  const results = [];
  for (const stream of streams) {
    try {
      const res = await requestCtx.delete(
        `${baseUrl}/api/${orgId}/streams/${stream}/data_by_time_range?type=logs&start=1&end=${endMicros}`,
        { headers: { Authorization: authHeader(email, password) } },
      );
      const body = await res.json().catch(() => ({}));
      results.push({ stream, status: res.status(), jobId: body?.id });
    } catch (e) {
      results.push({ stream, error: e.message });
    }
  }
  testLogger.info('Purged old RUM stream data', { olderThanHours, results });
  return results;
}

module.exports = { searchStream, waitForStreamRows, purgeOldRumStreamData };
