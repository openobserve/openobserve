/**
 * Quick Mode Built-in Fields — End-to-End
 *
 * Proves the backend fix that keeps the four RUM identity fields —
 * `service`, `version`, `session_id`, `view_url` — in the result of a
 * `SELECT *` search even after quick mode trims a wide stream down to the
 * first `quick_mode_num_fields` (500) columns.
 *
 * Before the fix, `generate_quick_mode_fields` (src/search/src/sql/schema.rs)
 * kept only the first-N columns of a stream whose schema exceeds 500 fields,
 * and the flattened identity fields (which sort after the SDK's `context_*`
 * beacon fields) were silently dropped. The fix defines
 * `QUICK_MODEL_FIELDS = ["service","version","session_id","view_url"]`
 * (src/config/src/config.rs) and re-adds any of them the stream actually has
 * after the strategy trim. Because `quick_mode_force_enabled` defaults to
 * true, a plain `SELECT *` on `_rumdata` takes the trim + re-add path with no
 * UI toggle required — this spec asserts exactly that observable behavior, and
 * the same list is exposed to the frontend via `GET /api/{org}/config`
 * `default_quick_mode_fields` (asserted in the second test).
 *
 * The deterministic wide-event recipe comes from the Test Setup Contract
 * (docs/test_generator/ci/setup-contract.md): one RUM error event carrying the
 * four identity fields PLUS a `context` object with 600+ distinct keys whose
 * flattened names (`context_a_000` …) sort alphabetically before `service`,
 * so the "first" trim strategy keeps only the first 500 context fields and
 * ONLY the built-in re-add brings the identity fields back. Without that wide
 * event the assertion would pass trivially even with the fix reverted.
 *
 * Data cleanup: rows are written to the shared `_rumdata` stream, which has no
 * predicate-scoped delete — so this spec namespaces every row with a unique
 * per-run `service` (no collision with sourcemap-upload-pretty.spec.js or the
 * rum-*-dataflow.spec.js specs) and relies on stream retention / the opt-in
 * `ZO_RUM_PURGE_STREAM_DATA=true` purge in utils/global-teardown.js.
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080); the
 *     RUM ingest/search/config routes are part of the standard (OSS) router.
 *   - OSS default config: quick_mode_force_enabled=true, quick_mode_num_fields=500.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { rumTestContext, basicAuthHeader } = require('../utils/rum-env.js');
const { searchStream, waitForStreamRows } = require('../utils/rum-stream-verify.js');

// Validated env context (org-id allowlist, plain-HTTP guard, least-privilege
// account preference) — shared with every other RUM util via rum-env.js.
const { orgId: ORG, baseUrl: BASE, email, password } = rumTestContext();
const AUTH_HEADER = basicAuthHeader(email, password);

// Unique per run: the shared `_rumdata` stream has no predicate-scoped delete,
// so a unique service keeps this spec's rows filterable and collision-free.
const RUN_ID = Date.now();
const WIDE_SERVICE = `e2e-qmf-${RUN_ID}`;
const VERSION = '1.0.0-e2e';
const ENV = 'e2e';

// The four built-in identity fields the fix guarantees survive a wide-stream
// quick-mode `SELECT *` (flattened names: session.id -> session_id, view.url -> view_url).
const BUILTIN_FIELDS = ['service', 'version', 'session_id', 'view_url'];

// More than `quick_mode_num_fields` (500) context keys so the "first" trim
// strategy keeps only the first 500 `context_a_*` columns and drops the
// identity fields — making the re-add observable. 620 > 500 with margin.
const WIDE_CONTEXT_FIELD_COUNT = 620;
// A context key guaranteed beyond the first-500 cut: absent from the result
// when the trim engaged, present only if the schema never widened.
const TRIMMED_SENTINEL = `context_a_${WIDE_CONTEXT_FIELD_COUNT - 1}`;

/**
 * Build a deterministic wide RUM error event: the four identity fields plus a
 * `context` object with `WIDE_CONTEXT_FIELD_COUNT` keys whose flattened names
 * (`context_a_000` …) sort alphabetically before `service`.
 */
function buildWideRumErrorEvent({ service, version }) {
  const context = {};
  for (let i = 0; i < WIDE_CONTEXT_FIELD_COUNT; i += 1) {
    context[`a_${String(i).padStart(3, '0')}`] = `v${i}`;
  }
  return {
    date: Date.now(),
    type: 'error',
    error_id: `${service}-wide`,
    error: {
      message: 'quick-mode built-in fields wide fixture',
      type: 'Error',
      stack: 'Error: quick-mode built-in fields wide fixture\n    at @ http://localhost:8089/assets/main.js:1:1',
      source: 'source',
      is_crash: false,
      resource: { url: 'http://localhost:8089/' },
    },
    service,
    version,
    env: ENV,
    session: { id: `${service}-session` },
    view: { id: `${service}-view`, referrer: '', url: 'http://localhost:8089/' },
    application: { id: 'e2e-quick-mode-fields' },
    context,
  };
}

/** Ingest events into `_rumdata` and wait until they are searchable. */
async function ingestEvents(page, service, events) {
  const res = await page.request.post(`${BASE}/api/${ORG}/_rumdata/_json`, {
    headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
    data: events,
  });
  expect(res.ok(), `ingestion into _rumdata should succeed (HTTP ${res.status()})`).toBe(true);

  const rows = await waitForStreamRows(page, {
    sql: `SELECT * FROM "_rumdata" WHERE service = '${service}' AND type = 'error'`,
    minRows: events.length,
    timeoutMs: 45000,
  });
  expect(rows.length, `ingested errors for ${service} should be searchable`).toBeGreaterThanOrEqual(
    events.length,
  );
}

test.describe('Quick Mode Built-in Fields', () => {
  // Each test is fully independent (its own unique service / no shared state),
  // so it parallelizes safely with the other RUM dataflow specs.
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('built-in fields survive a wide-stream quick-mode SELECT *', {
    tag: ['@rum', '@quickModeBuiltinFields', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Ingesting a deterministic wide RUM error event', { service: WIDE_SERVICE });
    await ingestEvents(page, WIDE_SERVICE, [buildWideRumErrorEvent({ service: WIDE_SERVICE, version: VERSION })]);

    const sql = `SELECT * FROM "_rumdata" WHERE service = '${WIDE_SERVICE}' AND type = 'error'`;

    // Gate on the schema actually being WIDE (the trim only engages above 500
    // fields): `context_a_000` is within the first-500 cut, so it appears once
    // the wide `context` object has flattened into the schema. Asserting the
    // identity fields before this would false-pass while the schema is still
    // short (the resolver sees a narrow schema and never trims).
    await expect
      .poll(async () => {
        const hits = await searchStream(page, { sql });
        if (hits.length === 0) return false;
        return Object.prototype.hasOwnProperty.call(hits[0], 'context_a_000');
      }, { timeout: 45000, intervals: [2000, 3000], message: 'wide _rumdata schema should hydrate (context_a_000 present)' })
      .toBe(true);

    const hits = await searchStream(page, { sql });
    expect(hits.length, 'at least one wide RUM error row should be searchable').toBeGreaterThanOrEqual(1);

    for (const hit of hits) {
      const keys = Object.keys(hit);
      // The trim must have engaged: the wide `context_*` tail is dropped.
      expect(keys, `wide context tail should be trimmed away (${TRIMMED_SENTINEL} absent)`).not.toContain(
        TRIMMED_SENTINEL,
      );
      // The built-in identity fields must survive the trim (re-added by the fix).
      for (const field of BUILTIN_FIELDS) {
        expect(keys, `flattened built-in field "${field}" should be re-added after the trim`).toContain(field);
        expect(hit[field], `"${field}" should be non-empty`).toBeTruthy();
      }
      expect(hit.service, 'service should be preserved verbatim').toBe(WIDE_SERVICE);
      expect(hit.version, 'version should be preserved verbatim').toBe(VERSION);
    }
    testLogger.info('Wide-stream quick-mode built-in fields verified', { service: WIDE_SERVICE, rows: hits.length });
  });

  test('config API exposes the built-in quick-mode fields', {
    tag: ['@rum', '@quickModeBuiltinFields', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Fetching /api/{org}/config');

    const res = await page.request.get(`${BASE}/api/${ORG}/config`, {
      headers: { Authorization: AUTH_HEADER },
    });
    expect(res.ok(), `GET /api/${ORG}/config should succeed (HTTP ${res.status()})`).toBe(true);

    const body = await res.json();
    const fields = body.default_quick_mode_fields;
    expect(Array.isArray(fields), 'default_quick_mode_fields should be an array').toBe(true);

    for (const field of BUILTIN_FIELDS) {
      expect(fields, `default_quick_mode_fields should include "${field}"`).toContain(field);
    }
    testLogger.info('Config API built-in quick-mode fields verified', { fields });
  });
});
