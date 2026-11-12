// Copyright 2026 OpenObserve Inc.

/**
 * Alerts — a query that joins a table of ANOTHER stream type (#15636)
 *
 * A logs alert joining an enrichment table could not be created at all: Run
 * Query in the alert editor sends `validate=true`, and field validation looked
 * every referenced table up under the ALERT's stream type. For a table of a
 * different type that resolves to an empty schema, so every enrichment column
 * came back as `unknown field '<col>'`, the result pane stayed empty and the
 * alert could not be saved.
 *
 * These two tests own the render surface. The server-side contract — all three
 * ways of naming an enrichment table, the controls that must still be rejected,
 * and the scheduled run that used to be skipped — lives in pytest, at
 * tests/api-testing/tests/alerts/test_cross_type_join.py.
 *
 * Both tests fail on a pre-fix build: the validating search answers 400 and the
 * output pane never mounts.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { waitForStreamListed } = require('../../utils/data-ingestion.js');
const {
  BASE, DEST, uniq, api, ingest, deleteStream,
  seedAlertFixturesOnce, findAlertId, getAlert, deleteAlertInFolder,
} = require('../../utils/alerts-api-helpers.js');

const RUN_ID = Date.now().toString(36).slice(-6);
const LOGS_STREAM = `e2e_15636_logs_${RUN_ID}`;
const ENRICH_TABLE = `e2e_15636_geo_${RUN_ID}`;

/** The shape from the bug report: a logs stream joined to an enrichment table. */
const JOIN_SQL =
  `SELECT a.ip, b.country FROM "${LOGS_STREAM}" a `
  + `JOIN "enrichment_tables"."${ENRICH_TABLE}" b ON a.ip = b.ip`;

/** Rows carrying the join key, timestamped now so the editor's window covers them. */
function joinableRows() {
  return Array.from({ length: 30 }, (_, i) => ({
    _timestamp: Date.now() * 1000 - i * 1_000_000,
    ip: `10.0.0.${(i % 3) + 1}`,
    msg: `line ${i}`,
  }));
}

/**
 * Ingest with a bounded retry on a transient 503.
 *
 * The single-node env trips a memory circuit breaker (`503
 * MemoryCircuitBreakerError`) under concurrent load — an environment condition,
 * not a product failure, and the right response is to back off and retry.
 */
async function ingestWithRetry(page, stream, rows, { attempts = 5, baseDelayMs = 1500 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await ingest(page, stream, rows);
    if (res.status() === 200) return res;
    last = `${res.status()} ${(await res.text().catch(() => '')).slice(0, 160)}`;
    if (res.status() !== 503) return res;
    await page.waitForTimeout(baseDelayMs * attempt);
  }
  throw new Error(`ingest into ${stream} still 503 after ${attempts} attempts; last: ${last}`);
}

/**
 * Upload the lookup table. Multipart carries its own Content-Type, so the
 * JSON one getAuthHeaders() adds has to be left off or the upload is refused.
 */
async function createEnrichmentTable(page, name) {
  const csv = 'ip,country,city\n10.0.0.1,India,Bengaluru\n10.0.0.2,USA,Austin\n10.0.0.3,Germany,Berlin';
  const upload = () => page.request.post(
    `${BASE}/api/${getOrgIdentifier()}/enrichment_tables/${name}?append=false`,
    {
      headers: { Authorization: getAuthHeaders().Authorization },
      multipart: { file: { name: 'lookup.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } },
    },
  );
  let res = await upload();
  for (let attempt = 1; attempt <= 4 && res.status() === 503; attempt++) {
    await page.waitForTimeout(1500 * attempt);
    res = await upload();
  }
  expect(res.status(), `enrichment table ${name} must be created`).toBe(200);
}

/**
 * Poll the NON-validating join until it returns rows.
 *
 * An enrichment table is queryable a moment after its CSV is written, not
 * instantly — validating before it loads returns the bug's own 400, so without
 * this the editor test could flake into a false regression. The non-validating
 * join returns rows regardless of the fix, so it is a fix-independent signal.
 */
async function waitJoinReady(page, { timeoutMs = 90000, pollMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const body = {
    query: {
      sql: JOIN_SQL,
      start_time: Date.now() * 1000 - 3600 * 1_000_000,
      end_time: Date.now() * 1000,
      from: 0,
      size: 1,
    },
  };
  for (;;) {
    const res = await api(page, 'post', `${BASE}/api/${getOrgIdentifier()}/_search?type=logs`, body);
    if (res.status() === 200 && (await res.json().catch(() => ({})))?.hits?.length) return;
    if (Date.now() >= deadline) throw new Error('cross-type join not queryable before the UI test (setup problem)');
    await page.waitForTimeout(pollMs);
  }
}

test.describe('Alerts — a join across stream types (#15636)', {
  tag: ['@alerts', '@regression', '@alertsRegression', '@alertsCrossTypeJoin'],
}, () => {
  // Serial: both tests share one stream + lookup table, and afterAll deletes them.
  test.describe.configure({ mode: 'serial' });

  let pm;
  let createdAlertName = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await seedAlertFixturesOnce(page);
    const ingested = await ingestWithRetry(page, LOGS_STREAM, joinableRows());
    expect(ingested.status(), `ingest into ${LOGS_STREAM} must succeed`).toBe(200);
    await createEnrichmentTable(page, ENRICH_TABLE);
    // The wizard picks the stream out of the streams list, which lags a first
    // write — without this the dropdown option simply is not there yet.
    const listed = await waitForStreamListed(page, LOGS_STREAM, 'logs');
    expect(listed, `${LOGS_STREAM} must be listed before the wizard opens`).toBe(true);
    await waitJoinReady(page);
    await context.close();
    testLogger.info('Seeded cross-type join fixtures', { LOGS_STREAM, ENRICH_TABLE });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await navigateToBase(page);
    await pm.alertsPage.navigateToAlertsPage();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    // Only what this run created, alert first — a scheduled alert left pointing
    // at a deleted stream is retried by the scheduler forever.
    if (createdAlertName) {
      const id = await findAlertId(page, createdAlertName).catch(() => null);
      await deleteAlertInFolder(page, id, 'default');
    }
    await api(page, 'delete', `${BASE}/api/${getOrgIdentifier()}/streams/${ENRICH_TABLE}?type=enrichment_tables`)
      .catch(() => {});
    await deleteStream(page, LOGS_STREAM, 'logs').catch(() => {});
    await context.close();
  });

  test('Run Query validates a logs-to-enrichment-table join and renders its rows', {
    tag: ['@bug-15636', '@P1'],
  }, async () => {
    await pm.alertsPage.setupScheduledAlertWizardToStep2(LOGS_STREAM, uniq('e2e_15636_editor'));

    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickViewEditorButton();
    await pm.alertsPage.typeSqlInEditor(JOIN_SQL);
    const status = await pm.alertsPage.runQueryAndGetValidationStatus();

    expect(status, 'field validation must accept the enrichment-table join (#15636)').toBe(200);
    await pm.alertsPage.expectSqlOutputRendered();
    testLogger.info('Editor accepted the cross-type join', { status });
  });

  test('a scheduled alert on that join saves from the wizard', {
    tag: ['@bug-15636', '@P1'],
  }, async ({ page }) => {
    createdAlertName = await pm.alertsPage.createScheduledAlertWithSQL(
      LOGS_STREAM, DEST, `15636_${RUN_ID}`, JOIN_SQL,
    );

    // createScheduledAlertWithSQL already syncs on the save response; this re-reads
    // the list so the alert is asserted present after the wizard has closed.
    await pm.alertsPage.verifyAlertCreated(createdAlertName);

    const stored = await getAlert(page, await findAlertId(page, createdAlertName));
    expect(stored?.query_condition?.sql, 'the stored alert must carry the join SQL').toBe(JOIN_SQL);
    testLogger.info('Saved a scheduled alert on a cross-type join', { createdAlertName });
  });
});
