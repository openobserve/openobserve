// databaseMonitoringPlans.spec.js
//
// EXECUTION PLANS MUST REACH THE SCREEN, not merely the stream.
//
// The receivers (mysqlreceiver, postgresqlreceiver, sqlserverreceiver) run
// EXPLAIN themselves and ship the plan as an attribute on `db.server.top_query`.
// That is three hops from a reader seeing it: the receiver must emit it, the
// backend must KEEP it (SQL Server's was dropped for want of one entry in a
// lookup list), and the detail page must RENDER it. A test that stops at the
// stream proves only the first two.
//
// Engine-agnostic and volume-agnostic by construction: the fingerprint under
// test is DISCOVERED from the org's own data, never hardcoded, so this suite
// says something true on whichever org ORGNAME points at rather than passing
// vacuously on one and fabricating failures on another.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/** Ask the stream for a statement this org actually holds a plan for. */
async function planBearingQuery(page, { periodSeconds = 3600 } = {}) {
  const org = process.env['ORGNAME'] || 'default';
  const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  const now = Date.now() * 1000;
  const res = await page.request.post(
    `${baseUrl}/api/${org}/_search?type=logs`,
    {
      data: {
        query: {
          sql:
            "SELECT * FROM dbm_server WHERE o2_dbm_plan IS NOT NULL LIMIT 5",
          start_time: now - periodSeconds * 1_000_000,
          end_time: now,
          from: 0,
          size: 5,
        },
      },
    },
  );
  if (!res.ok()) return null;
  const body = await res.json().catch(() => null);
  const hits = body?.hits ?? [];
  if (!hits.length) return null;
  return {
    fingerprint: hits[0].o2_dbm_fingerprint,
    engine: hits[0].o2_dbm_engine,
    planHash: hits[0].o2_dbm_plan_hash,
    planSource: hits[0].o2_dbm_plan_source,
    plan: hits[0].o2_dbm_plan,
    count: hits.length,
  };
}

test.describe('Database Monitoring — execution plans', () => {
  let pm;
  let dbm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    dbm = pm.databaseMonitoringPage;
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P0: a query the database planned renders its plan on the detail page', {
    tag: ['@dbm', '@infra', '@P0', '@plans', '@all'],
  }, async ({ page }) => {
    const found = await planBearingQuery(page);
    test.skip(!found?.fingerprint, 'this org holds no execution plans in this window');
    testLogger.info(
      `plan-bearing query: engine=${found.engine} fp=${found.fingerprint} ` +
        `hash=${String(found.planHash).slice(0, 12)} source=${found.planSource}`,
    );

    // `?tab=plans` is REQUIRED, not cosmetic: the detail page's panels use
    // `OTabPanel`, which defaults to `v-if` rather than `v-show`, so the plans
    // section does not exist in the DOM at all while the Overview tab is
    // active. Landing on the default tab and asserting on the section is a
    // test bug that reads exactly like a missing feature.
    await dbm.openQueryDetailTab(found.fingerprint, 'plans', { system: found.engine });

    // The plans SECTION must exist. Its absence means the page did not even
    // offer the reader a place to look, which is a different and worse failure
    // than an empty one.
    const section = page.locator('[data-test="dbm-detail-plans"]');
    await expect(
      section,
      'the detail page rendered no plans section for a query that HAS a plan',
    ).toBeVisible({ timeout: 30000 });

    // THE INVARIANT. A plan is stored for this statement, so the section must
    // show one — not the "no plans captured" state that a reader would take as
    // "this engine cannot do plans".
    const planCards = page.locator('[data-test^="dbm-detail-plan-"]');
    await expect
      .poll(async () => planCards.count(), { timeout: 30000 })
      .toBeGreaterThan(0);

    const rendered = await section.innerText();
    testLogger.info(`plans section (first 160): ${rendered.replace(/\s+/g, ' ').slice(0, 160)}`);
    expect(
      rendered.trim().length,
      'the plans section rendered but carried no text',
    ).toBeGreaterThan(0);
  });

  test('P1: the rendered plan is the engine\'s own, not a placeholder', {
    tag: ['@dbm', '@infra', '@P1', '@plans', '@all'],
  }, async ({ page }) => {
    const found = await planBearingQuery(page);
    test.skip(!found?.fingerprint, 'this org holds no execution plans in this window');

    await dbm.openQueryDetailTab(found.fingerprint, 'plans', { system: found.engine });
    const section = page.locator('[data-test="dbm-detail-plans"]');
    await expect(section).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    const rendered = (await section.innerText()).toLowerCase();

    // A plan document has recognisable structure per engine. Asserting on the
    // ENGINE'S OWN vocabulary rather than a fixed string keeps this honest
    // across Postgres (JSON "Node Type"), MySQL (JSON "query_block") and SQL
    // Server (XML ShowPlanXML) — all three of which reach this page.
    const markers = {
      postgresql: ['node type', 'plan', 'cost'],
      mysql: ['query_block', 'cost', 'table'],
      mariadb: ['query_block', 'cost', 'table'],
      mssql: ['showplan', 'stmt', 'plan'],
    };
    const expected = markers[found.engine] ?? ['plan'];
    const hit = expected.some((m) => rendered.includes(m));
    expect(
      hit,
      `the plans section for ${found.engine} shows none of ${JSON.stringify(expected)} — ` +
        `rendered: ${rendered.slice(0, 200)}`,
    ).toBeTruthy();
  });
});
