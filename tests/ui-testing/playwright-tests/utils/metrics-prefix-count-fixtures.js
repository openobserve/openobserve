const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const testLogger = require('./test-logger.js');
const { ingestBase } = require('./ingest-url.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || 'default';

const MINUTE_MS = 60_000;
// More than the explorer's first page (INITIAL_PAGE_SIZE = 8), so the stale prefix is never in it.
const LIVE_COUNT = 10;
const STALE_SUFFIXES = ['a', 'b', 'c', 'd'];

let runSeq = 0;

/** Names for one run; the random part keeps a reused data dir from merging prefixes across runs. */
function newRun() {
  const tag = `${Date.now().toString(36)}${process.pid.toString(36)}${(++runSeq).toString(36)}`;
  // `zz` sorts the stale prefix after everything else, and the two-segment name makes it the facet id.
  const STALE_PREFIX = `zz17163${tag}_old`;
  const LIVE_PREFIX = `e2e17163${tag}_live`;
  return {
    TAG: tag,
    STALE_PREFIX,
    LIVE_PREFIX,
    stale: STALE_SUFFIXES.map((s) => `${STALE_PREFIX}_${s}`),
    live: Array.from({ length: LIVE_COUNT }, (_, i) => `${LIVE_PREFIX}_${i}`),
  };
}

const gauge = (name, ageMinutes) => ({
  name,
  gauge: {
    dataPoints: ageMinutes.map((age, i) => ({
      timeUnixNano: String(BigInt(Date.now() - age * MINUTE_MS) * 1_000_000n),
      asDouble: 10 + i,
      attributes: [{ key: 'host', value: { stringValue: 'e2e-17163' } }],
    })),
  },
});

async function postMetrics(metrics) {
  const res = await fetch(`${ingestBase(BASE)}/api/${ORG()}/v1/metrics`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resourceMetrics: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'e2e-17163' } }] },
        scopeMetrics: [{ scope: { name: 'e2e-17163' }, metrics }],
      }],
    }),
  });
  if (!res.ok) throw new Error(`POST /v1/metrics -> ${res.status}: ${await res.text()}`);
}

/** Stale metrics get points ~2h old only; live metrics get points in the last few minutes. */
async function ingestPrefixCountFixtures(run) {
  await postMetrics([
    ...run.stale.map((name) => gauge(name, [125, 122, 120])),
    ...run.live.map((name) => gauge(name, [4, 3, 2, 1])),
  ]);
  testLogger.info('Prefix-count fixtures ingested', { stale: run.stale.length, live: run.live.length });
}

/** Waits until every fixture stream is listed and a live metric answers a query, since ingestion is asynchronous. */
async function waitForPrefixCountFixtures(run, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const wanted = [...run.stale, ...run.live];
  const probe = encodeURIComponent(run.live[0]);
  while (Date.now() < deadline) {
    const list = await fetch(`${BASE}/api/${ORG()}/streams?type=metrics`, { headers: getAuthHeaders() })
      .then((r) => r.json())
      .catch(() => ({}));
    const names = new Set((list?.list ?? []).map((s) => s.name));
    const end = Date.now() * 1000;
    const query = await fetch(
      `${BASE}/api/${ORG()}/prometheus/api/v1/query_range?query=${probe}&start=${end - 900_000_000}&end=${end}&step=60s`,
      { headers: getAuthHeaders() },
    )
      .then((r) => r.json())
      .catch(() => null);
    if (wanted.every((n) => names.has(n)) && (query?.data?.result ?? []).length) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Deletes exactly the streams this run created. */
async function deletePrefixCountFixtures(run) {
  for (const name of [...run.stale, ...run.live]) {
    await fetch(`${BASE}/api/${ORG()}/streams/${name}?type=metrics&delete_all=true`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    }).catch(() => {});
  }
}

module.exports = {
  newRun,
  ingestPrefixCountFixtures,
  waitForPrefixCountFixtures,
  deletePrefixCountFixtures,
};
