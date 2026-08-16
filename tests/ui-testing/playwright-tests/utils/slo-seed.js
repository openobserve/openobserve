/**
 * SLO seeding + ground-truth helpers.
 *
 * SLOs measure a rolling window of HISTORY, so they render "No data" against a
 * freshly-ingested stream no matter how much of it there is. Every SLO spec
 * therefore seeds BACKDATED rows before creating the SLO, and this module owns
 * that shape so the three specs cannot drift apart on it.
 *
 * Two server settings make or break the seed, and both fail quietly:
 *
 *   ZO_INGEST_ALLOWED_UPTO  Rows older than this many HOURS are dropped. The
 *                           default is 5, and the ingest response for a dropped
 *                           row is shaped exactly like a successful one — so an
 *                           unset value costs a whole suite of "No data"
 *                           timeouts with nothing in the artifacts to explain
 *                           them. assertBackdatedIngestWorks() converts that
 *                           into one fast, legible failure.
 *   ZO_SLO_MIN_COVERAGE     Coverage floor, default 0.9. A 7-day window needs
 *                           >= 6.3 days of data or the SLO freezes as no_data
 *                           and reports NULL rather than a percentage.
 */

const { expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

/** Seed span. 8 days against a 7-day window clears the 0.9 coverage floor. */
const SEED_DAYS = 8;
/** One point per minute — matches the finest slice the form offers. */
const SEED_INTERVAL_SECS = 60;

/** Latency baseline, and the value the bad patch rises to. */
const GOOD_LATENCY_MS = 120;
const BAD_LATENCY_MS = 800;
/** The threshold the specs compare against: between the two, so it separates. */
const LATENCY_THRESHOLD_MS = 500;

/** The deliberate bad patch: 3 hours, starting 2 days into the seed. */
const BAD_PATCH_START_DAY = 2;
const BAD_PATCH_HOURS = 3;

const SERVICES = ['checkout', 'search', 'payments'];

function baseUrl() {
  const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL || '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Build the seeded records.
 *
 * Deterministic on purpose — no randomness. A flaky SLI is indistinguishable
 * from a broken one, and the whole point of these specs is to tell those apart.
 *
 * @param {number} nowSecs Epoch seconds to treat as "now" (the seed's end).
 * @returns {Array<object>} records, oldest first
 */
function buildSeedRecords(nowSecs) {
  const records = [];
  const startSecs = nowSecs - SEED_DAYS * 86400;
  const badFrom = startSecs + BAD_PATCH_START_DAY * 86400;
  const badTo = badFrom + BAD_PATCH_HOURS * 3600;

  for (let ts = startSecs; ts < nowSecs; ts += SEED_INTERVAL_SECS) {
    const inBadPatch = ts >= badFrom && ts < badTo;
    // Index the minute so the service label cycles predictably rather than
    // randomly — group cardinality must be exactly 3 for the grouping tests.
    const minute = Math.floor((ts - startSecs) / SEED_INTERVAL_SECS);

    records.push({
      // OpenObserve reads _timestamp in MICROseconds.
      _timestamp: ts * 1_000_000,
      latency_ms: inBadPatch ? BAD_LATENCY_MS : GOOD_LATENCY_MS,
      // ~2% errors overall, concentrated in the patch so the count SLI and the
      // time-slice SLI point at the same incident.
      status_code: inBadPatch && minute % 2 === 0 ? 500 : 200,
      service: SERVICES[minute % SERVICES.length],
      job: 'e2e-slo',
    });
  }
  return records;
}

/**
 * How many slices the seed makes GOOD for `avg(latency_ms) <comparator> threshold`.
 *
 * The specs assert against a `_search` ground truth rather than this, but the
 * arithmetic is kept here so a seed change makes the expected shape obvious.
 */
function expectedGoodFraction() {
  const totalMinutes = (SEED_DAYS * 86400) / SEED_INTERVAL_SECS;
  const badMinutes = (BAD_PATCH_HOURS * 3600) / SEED_INTERVAL_SECS;
  return (totalMinutes - badMinutes) / totalMinutes;
}

/**
 * Ingest a batch, failing loudly on a non-2xx.
 *
 * Batched because eight days at one-minute granularity is ~11.5k records and a
 * single POST of that size is slower and harder to diagnose than ten of it.
 */
async function ingestBatch(page, streamName, records) {
  const org = getOrgIdentifier();
  const res = await page.request.post(
    `${baseUrl()}/api/${org}/${streamName}/_json`,
    { headers: getAuthHeaders(), data: records },
  );
  const status = res.status();
  if (status < 200 || status >= 300) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(
      `SLO seed ingest failed for "${streamName}": HTTP ${status} — ${body}`,
    );
  }
  return await res.json().catch(() => ({}));
}

/**
 * Prove backdated ingestion is actually accepted BEFORE seeding 11k rows.
 *
 * Writes one row a full day in the past, then reads it back. The read is the
 * whole point: the WRITE succeeds either way, so only a query can tell an
 * accepted row from a silently-dropped one.
 *
 * @throws with the remedy in the message, not just the symptom.
 */
async function assertBackdatedIngestWorks(page, streamName) {
  const org = getOrgIdentifier();
  const probeTs = Math.floor(Date.now() / 1000) - 86400;
  const marker = `probe_${probeTs}`;

  await ingestBatch(page, streamName, [
    { _timestamp: probeTs * 1_000_000, probe: marker, latency_ms: 1, status_code: 200 },
  ]);

  // Give the write a moment to become searchable before concluding it was
  // dropped — an empty result here is otherwise ambiguous.
  let hits = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await page.request.post(`${baseUrl()}/api/${org}/_search?type=logs`, {
      headers: getAuthHeaders(),
      data: {
        query: {
          sql: `SELECT COUNT(*) AS c FROM "${streamName}" WHERE probe = '${marker}'`,
          start_time: (probeTs - 3600) * 1_000_000,
          end_time: (probeTs + 3600) * 1_000_000,
          size: 1,
        },
      },
    });
    if (res.ok()) {
      const body = await res.json().catch(() => ({}));
      hits = Number(body?.hits?.[0]?.c ?? 0);
      if (hits > 0) break;
    }
    await page.waitForTimeout(2000);
  }

  if (hits === 0) {
    throw new Error(
      `Backdated ingestion is being rejected: a row written 24h in the past is not searchable in "${streamName}".\n` +
      `ZO_INGEST_ALLOWED_UPTO defaults to 5 HOURS and drops older rows while still returning a success-shaped response.\n` +
      `Set ZO_INGEST_ALLOWED_UPTO=240 (hours) on the server and restart it, then re-run.\n` +
      `Without this every SLO assertion in this suite fails as "No data".`,
    );
  }
  testLogger.info('Backdated ingestion verified', { streamName });
}

/**
 * Seed one stream with the full 8-day shape.
 *
 * @returns {Promise<{streamName: string, nowSecs: number, records: number}>}
 */
async function seedSloStream(page, streamName) {
  await assertBackdatedIngestWorks(page, streamName);

  const nowSecs = Math.floor(Date.now() / 1000);
  const records = buildSeedRecords(nowSecs);

  const BATCH = 2000;
  for (let i = 0; i < records.length; i += BATCH) {
    await ingestBatch(page, streamName, records.slice(i, i + BATCH));
  }

  testLogger.info('SLO stream seeded', {
    streamName,
    records: records.length,
    days: SEED_DAYS,
  });

  await waitForSeedSearchable(page, streamName, nowSecs, records.length);
  return { streamName, nowSecs, records: records.length };
}

/**
 * A minimal stream: enough rows, recent, for the stream picker to offer it and
 * for a definition to reference it.
 *
 * Deliberately NOT the 8-day shape. Tests that never assert an SLI — the whole
 * CRUD lifecycle — need a selectable stream and nothing more, and paying ~11.5k
 * records per test for that is both slow and a source of flake. Use
 * `seedSloStream` only where a measured SLI is actually asserted.
 */
async function seedMinimalStream(page, streamName, { records = 200 } = {}) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const rows = [];
  for (let i = 0; i < records; i++) {
    const ts = nowSecs - i * 60;
    rows.push({
      _timestamp: ts * 1_000_000,
      latency_ms: i % 20 === 0 ? BAD_LATENCY_MS : GOOD_LATENCY_MS,
      status_code: i % 50 === 0 ? 500 : 200,
      service: SERVICES[i % SERVICES.length],
      job: 'e2e-slo',
    });
  }
  await ingestBatch(page, streamName, rows);
  await waitForSeedSearchable(page, streamName, nowSecs, rows.length);
  testLogger.info('Minimal SLO stream seeded', { streamName, records: rows.length });
  return { streamName, nowSecs, records: rows.length };
}

/** Block until the seeded rows are queryable, so an SLO created next can see them. */
async function waitForSeedSearchable(page, streamName, nowSecs, expected) {
  const org = getOrgIdentifier();
  const from = (nowSecs - SEED_DAYS * 86400) * 1_000_000;
  const to = nowSecs * 1_000_000;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const res = await page.request.post(`${baseUrl()}/api/${org}/_search?type=logs`, {
      headers: getAuthHeaders(),
      data: {
        query: {
          sql: `SELECT COUNT(*) AS c FROM "${streamName}"`,
          start_time: from,
          end_time: to,
          size: 1,
        },
      },
    });
    if (res.ok()) {
      const body = await res.json().catch(() => ({}));
      const count = Number(body?.hits?.[0]?.c ?? 0);
      // 90% is enough to proceed: the coverage floor is what matters, and
      // demanding an exact count would stall on normal indexing lag.
      if (count >= expected * 0.9) {
        testLogger.info('Seed searchable', { streamName, count });
        return count;
      }
    }
    await page.waitForTimeout(3000);
  }
  throw new Error(
    `Seeded rows for "${streamName}" never became searchable within 120s.`,
  );
}

/**
 * Ground truth for a time-slice SLI, straight from the same data the backend reads.
 *
 * Buckets by `slice`, aggregates, then scores each bucket against the
 * comparator — the definition of a time-slice SLI. Computed rather than
 * hardcoded so a seed change cannot silently invalidate an assertion.
 *
 * @returns {Promise<{good: number, total: number, sli: number}>}
 */
async function timeSliceGroundTruth(page, {
  streamName,
  nowSecs,
  windowSecs,
  sliceIntervalSecs,
  comparator,
  threshold,
  aggregate = 'avg(latency_ms)',
}) {
  const org = getOrgIdentifier();
  const from = (nowSecs - windowSecs) * 1_000_000;
  const to = nowSecs * 1_000_000;

  const res = await page.request.post(`${baseUrl()}/api/${org}/_search?type=logs`, {
    headers: getAuthHeaders(),
    data: {
      query: {
        sql:
          `SELECT histogram(_timestamp, '${sliceIntervalSecs} second') AS slice, ` +
          `${aggregate} AS agg FROM "${streamName}" GROUP BY slice ORDER BY slice`,
        start_time: from,
        end_time: to,
        size: 10000,
      },
    },
  });

  if (!res.ok()) {
    throw new Error(`Ground-truth query failed: HTTP ${res.status()}`);
  }
  const body = await res.json();
  const rows = body?.hits ?? [];

  let good = 0;
  for (const row of rows) {
    const v = Number(row.agg);
    if (!Number.isFinite(v)) continue;
    if (compare(v, comparator, threshold)) good += 1;
  }
  const total = rows.length;
  return { good, total, sli: total ? (good / total) * 100 : 0 };
}

function compare(value, comparator, threshold) {
  switch (comparator) {
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    default: throw new Error(`Unknown comparator: ${comparator}`);
  }
}

/** Unique per worker so parallel specs never share a stream or an SLO name. */
function uniqueName(prefix, workerIndex = 0) {
  return `${prefix}_${workerIndex}_${Date.now()}`;
}

/**
 * Create an SLO through the API.
 *
 * Used for fixtures whose subject is NOT the create flow — reading a measured
 * SLI, listing, deleting. The create form has its own dedicated UI tests; going
 * through it for every fixture would make each spec re-test it and pay the
 * Monaco typing cost for nothing.
 *
 * @returns {Promise<{id: string, name: string}>}
 */
async function createSloViaApi(page, definition) {
  const org = getOrgIdentifier();
  const res = await page.request.post(`${baseUrl()}/api/${org}/slos`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: definition,
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(
      `SLO create failed: HTTP ${res.status()} — ${body}\nPayload: ${JSON.stringify(definition)}`,
    );
  }
  const body = await res.json().catch(() => ({}));
  const id = body?.id ?? body?.data?.id;
  if (!id) throw new Error(`SLO created but no id returned: ${JSON.stringify(body)}`);
  testLogger.info('SLO created via API', { id, name: definition.name });
  return { id, name: definition.name };
}

/**
 * Drop empty values, mirroring `pruned()` in AddSlo.vue.
 *
 * An empty `scope` is not "no scope" to the validator — it is an empty
 * predicate, and it is rejected. Absent is what "all rows" looks like.
 */
function pruned(o) {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );
}

/**
 * A time-slice SLO definition over the seeded stream.
 *
 * `SliConfig::TimeSlice` is a struct variant, so its fields sit DIRECTLY under
 * `config` — unlike a count SLI, whose `CountSource` is adjacently tagged and
 * needs a `{source: {mode, query}}` wrapper. Getting this wrong yields a 422
 * whose message names only the missing field. Mirrors `wireConfig()` in
 * AddSlo.vue; that function is the authority if these ever disagree.
 */
function timeSliceDefinition({
  name,
  stream,
  comparator,
  threshold = LATENCY_THRESHOLD_MS,
  aggregate = 'avg(latency_ms)',
  target = 99,
  windowSecs = 604800,
  sliceIntervalSecs = 300,
  streamType = 'logs',
  scope = '',
}) {
  return {
    name,
    description: 'e2e time-slice SLO',
    sli_type: 'time_slice',
    config: {
      ...pruned({
        stream,
        stream_type: streamType,
        query: aggregate,
        comparator,
        threshold,
        scope,
      }),
      // The API never infers the language; every time-slice definition declares it.
      query_language: 'sql',
    },
    group_by: null,
    groups_estimate: null,
    window_secs: windowSecs,
    slice_interval_secs: sliceIntervalSecs,
    target,
    tags: ['e2e'],
    enabled: true,
  };
}

/**
 * A count SLO definition over the seeded stream.
 *
 * `CountSource` is adjacently tagged, hence the `source: {mode, query}` wrapper.
 */
function countDefinition({
  name,
  stream,
  goodExpr = 'status_code < 500',
  target = 99,
  windowSecs = 604800,
  sliceIntervalSecs = 300,
  streamType = 'logs',
  scope = '',
}) {
  return {
    name,
    description: 'e2e count SLO',
    sli_type: 'count',
    config: {
      source: {
        mode: 'single_query',
        query: pruned({
          stream,
          stream_type: streamType,
          scope,
          good_expr: goodExpr,
        }),
      },
    },
    group_by: null,
    groups_estimate: null,
    window_secs: windowSecs,
    slice_interval_secs: sliceIntervalSecs,
    target,
    tags: ['e2e'],
    enabled: true,
  };
}

/**
 * Block until the backend has MEASURED an SLO, polling the API.
 *
 * A new SLO is filled by the backfill job, which walks the window backwards one
 * chunk (ZO_SLO_BACKFILL_CHUNK_SECS, default 1 day) at a time. Measured against
 * this local build that is roughly **40 s per day-chunk**, so a 7-day window
 * needs ~5 minutes — and backfill concurrency defaults to 1, so two SLOs fill
 * one after the other rather than together.
 *
 * Polls the API rather than reloading the SLO detail page: a full UI reload per
 * attempt costs seconds and tells us nothing the status object does not, and it
 * keeps the page object free of readiness logic.
 *
 * @returns {Promise<object>} the measured status
 */
async function waitForSloMeasured(page, sloId, { timeout = 600_000, pollMs = 5000 } = {}) {
  const org = getOrgIdentifier();
  const deadline = Date.now() + timeout;
  let last = null;

  while (Date.now() < deadline) {
    const res = await page.request.get(`${baseUrl()}/api/${org}/slos/${sloId}`, {
      headers: getAuthHeaders(),
    });
    if (res.ok()) {
      const body = await res.json().catch(() => ({}));
      const status = body?.status ?? null;
      last = status;
      // `sli` stays null while frozen — coverage below the floor. It becoming a
      // number IS the definition of measured.
      if (status && status.no_data === false && status.sli !== null) {
        testLogger.info('SLO measured', {
          sloId, sli: status.sli, coverage: status.coverage,
        });
        return status;
      }
    }
    await page.waitForTimeout(pollMs);
  }

  throw new Error(
    `SLO ${sloId} never produced a measured SLI within ${timeout}ms.\n` +
    `Last status: ${JSON.stringify(last)}\n` +
    `Coverage climbs ~1 day-chunk per 40s, so a 7-day window needs ~5 min; if coverage is\n` +
    `stuck rather than rising, the cause is the seed (ZO_INGEST_ALLOWED_UPTO, default 5h)\n` +
    `or the scheduler not running backfill — not this timeout.`,
  );
}

/**
 * Create a notification template + destination for burn-rate alerts.
 *
 * An SLO alert cannot be saved without one: the form rejects a submit with
 * "Alert destination or workflows is required". The destination points at this
 * instance's OWN ingest endpoint so delivery is self-contained and needs no
 * external service — the same trick `alerts-api-helpers.seedAlertFixtures` uses.
 *
 * @returns {Promise<string>} the destination name, to pick in the form
 */
async function seedNotificationDestination(page, baseName) {
  const org = getOrgIdentifier();
  const v1 = `${baseUrl()}/api/${org}`;
  const template = `${baseName}_tmpl`;
  const destination = `${baseName}_dest`;

  const post = (url, data) => page.request.post(url, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data,
  });

  const tmplRes = await post(`${v1}/alerts/templates`, {
    name: template,
    body: '{"text":"{alert_name} {alert_level}"}',
    type: 'http',
    title: '',
  });
  if (!tmplRes.ok() && tmplRes.status() !== 409) {
    throw new Error(
      `Could not create alert template "${template}": HTTP ${tmplRes.status()} — ` +
      `${await tmplRes.text().catch(() => '')}`,
    );
  }

  const destRes = await post(`${v1}/alerts/destinations`, {
    name: destination,
    url: `${v1}/${baseName}_sink/_json`,
    method: 'post',
    template,
    type: 'http',
    headers: getAuthHeaders(),
  });
  if (!destRes.ok() && destRes.status() !== 409) {
    throw new Error(
      `Could not create alert destination "${destination}": HTTP ${destRes.status()} — ` +
      `${await destRes.text().catch(() => '')}`,
    );
  }

  testLogger.info('Notification destination seeded', { destination });
  return destination;
}

/** Delete an SLO by id, tolerating an already-gone one. */
async function deleteSloById(page, sloId) {
  const org = getOrgIdentifier();
  try {
    await page.request.delete(`${baseUrl()}/api/${org}/slos/${sloId}`, {
      headers: getAuthHeaders(),
    });
  } catch (e) {
    testLogger.debug('SLO cleanup failed (non-fatal)', { sloId, error: e.message });
  }
}

/** Delete every SLO whose name carries the e2e prefix. */
async function deleteSlosByPrefix(page, prefix) {
  const org = getOrgIdentifier();
  try {
    const res = await page.request.get(`${baseUrl()}/api/${org}/slos`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok()) return;
    const body = await res.json().catch(() => ({}));
    for (const slo of body?.list ?? []) {
      if (typeof slo?.name === 'string' && slo.name.startsWith(prefix)) {
        await deleteSloById(page, slo.id);
      }
    }
  } catch (e) {
    testLogger.debug('SLO prefix cleanup failed (non-fatal)', { prefix, error: e.message });
  }
}

module.exports = {
  SEED_DAYS,
  SEED_INTERVAL_SECS,
  GOOD_LATENCY_MS,
  BAD_LATENCY_MS,
  LATENCY_THRESHOLD_MS,
  BAD_PATCH_HOURS,
  SERVICES,
  buildSeedRecords,
  expectedGoodFraction,
  assertBackdatedIngestWorks,
  seedSloStream,
  seedMinimalStream,
  waitForSeedSearchable,
  timeSliceGroundTruth,
  uniqueName,
  createSloViaApi,
  waitForSloMeasured,
  seedNotificationDestination,
  timeSliceDefinition,
  countDefinition,
  deleteSloById,
  deleteSlosByPrefix,
};
