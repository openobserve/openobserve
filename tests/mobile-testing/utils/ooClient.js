// OpenObserve Search API client — the "did the right data land?" layer.
// Queries the _rumdata stream with poll-and-retry to absorb ingestion lag.
const cfg = require('./config');

const authHeader = 'Basic ' + Buffer.from(`${cfg.OO_USER}:${cfg.OO_PASS}`).toString('base64');

/** Run one SQL query against _rumdata. times are epoch-ms; the API wants micros. */
// end_time gets a +5min buffer: a CI emulator/simulator clock can run slightly AHEAD of the runner,
// so RUM events land with future-ish timestamps that a `now` upper-bound would exclude (→ 0 rows).
async function search(sql, startMs, endMs = Date.now() + 5 * 60 * 1000, size = 200) {
  const res = await fetch(`${cfg.OO_URL}/api/${cfg.OO_ORG}/_search?type=logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({
      query: {
        sql,
        start_time: Math.floor(startMs * 1000),
        end_time: Math.floor(endMs * 1000),
        size,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`_search ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  return json.hits || [];
}

// A wrong token/org gives 401/403 that will NEVER self-heal — surface it immediately rather than
// retrying for the whole window and reporting it as "no rows". (404/400/5xx stay retryable: the
// _rumdata stream may simply not exist yet before the first upload.)
const isAuthError = (e) => /_search (401|403)\b/.test((e && e.message) || '');

/**
 * Poll a query until it returns at least `minHits` rows (or times out).
 * RUM ingestion is asynchronous, so we retry rather than assert instantly.
 */
async function pollSearch(sql, startMs, { minHits = 1, tries = 15, delayMs = 4000 } = {}) {
  let last = [];
  let lastErr = null;
  let gotResponse = false;
  for (let i = 0; i < tries; i++) {
    try {
      last = await search(sql, startMs);
      gotResponse = true;
      if (last.length >= minHits) return last;
    } catch (e) {
      lastErr = e;
      if (isAuthError(e)) throw e; // non-retryable — fail fast with the real cause
      // else transient (network drop / 429 / 5xx / stream-not-ready) — retry.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Every attempt errored (never a valid response) → surface the cause instead of a silent [].
  if (!gotResponse && lastErr) throw lastErr;
  return last;
}

/**
 * Poll until `predicate(rows)` is satisfied — for assertions that need a COMPLETE
 * set of events (which ingest incrementally), not just the first row to arrive.
 */
async function pollUntil(queryFn, predicate, { tries = 20, delayMs = 5000 } = {}) {
  let last = [];
  let lastErr = null;
  let gotResponse = false;
  for (let i = 0; i < tries; i++) {
    try {
      last = await queryFn();
      gotResponse = true;
      if (predicate(last)) return last;
    } catch (e) {
      lastErr = e;
      if (isAuthError(e)) throw e;
      // else transient — retry.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!gotResponse && lastErr) throw lastErr;
  return last;
}

const esc = (s) => String(s).replace(/'/g, "''");

/** Convenience builders scoped to a service + time window. */
const q = {
  bySql: pollSearch,
  resources: (service, startMs, opts) =>
    pollSearch(
      `SELECT session_id, resource_url, resource_method, resource_status_code, type, _timestamp ` +
        `FROM ${cfg.RUM_STREAM} WHERE service='${esc(service)}' AND type='resource' ORDER BY _timestamp DESC`,
      startMs,
      opts,
    ),
  errors: (service, startMs, opts) =>
    pollSearch(
      `SELECT session_id, error_message, error_source, error_is_crash, view_name, type, _timestamp ` +
        `FROM ${cfg.RUM_STREAM} WHERE service='${esc(service)}' AND type='error' ORDER BY _timestamp DESC`,
      startMs,
      opts,
    ),
  views: (service, startMs, opts) =>
    pollSearch(
      `SELECT session_id, view_name, type, _timestamp ` +
        `FROM ${cfg.RUM_STREAM} WHERE service='${esc(service)}' AND type='view' ORDER BY _timestamp DESC`,
      startMs,
      opts,
    ),
  // Poll until every name in `requiredNames` has appeared (views ingest incrementally).
  viewsUntil: (service, startMs, requiredNames, opts) =>
    pollUntil(
      () =>
        search(
          `SELECT view_name FROM ${cfg.RUM_STREAM} ` +
            `WHERE service='${esc(service)}' AND type='view'`,
          startMs,
        ),
      (rows) => {
        const names = new Set(rows.map((r) => r.view_name));
        return requiredNames.every((n) => names.has(n));
      },
      opts,
    ),
  sessionForService: async (service, startMs, opts) => {
    const rows = await pollSearch(
      `SELECT session_id, _timestamp FROM ${cfg.RUM_STREAM} ` +
        `WHERE service='${esc(service)}' ORDER BY _timestamp DESC`,
      startMs,
      opts,
    );
    return rows.length ? rows[0].session_id : null;
  },
};

module.exports = { search, pollSearch, pollUntil, q, cfg };
