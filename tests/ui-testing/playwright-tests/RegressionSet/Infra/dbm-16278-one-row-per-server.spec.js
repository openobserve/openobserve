// Database Monitoring > Databases lists one row per server, however many schemas it holds, and the Schema filter narrows within it (#16278).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const MULTI = 'pg-main.e2e16278.internal:5432';
const SINGLE = 'pg-reports.e2e16278.internal:5432';

function totals(instance, namespace, calls) {
  return {
    db_system: 'postgresql',
    db_instance: instance,
    db_namespace: namespace,
    statements: 4,
    calls,
    errors: 0,
    total_time_ns: calls * 2000000,
    p50_ns: 1500000,
    p95_ns: 4000000,
    p99_ns: 6000000,
    max_ns: 9000000,
    traces: calls,
    calling_services: ['e2e-16278-api'],
    qps: calls / 3600,
  };
}

// The endpoint answers at (system, instance, namespace) grain, so one server with three schemas comes back as three hits.
const HITS = [
  totals(MULTI, 'orders', 300),
  totals(MULTI, 'billing', 200),
  totals(MULTI, 'auth', 100),
  totals(SINGLE, 'reports', 50),
];

test.describe('Database Monitoring: one Databases row per server (#16278)', () => {
  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a server with three schemas is one row that counts them, and the Schema filter keeps only its server', {
    tag: ['@bug-16278', '@P2', '@regression', '@infraRegression'],
  }, async ({ page }) => {
    const dbm = new PageManager(page).databaseMonitoringPage;
    await dbm.serveDatabasesHits(HITS);

    await dbm.navigate('overview');
    await dbm.expectDatabasesRowCount(2);
    expect(await dbm.databasesRowsFor(MULTI), 'the three-schema server must be one row').toBe(1);
    await dbm.expectSchemaCountText(/\b3\b/);

    await dbm.navigate('overview', { query: { namespace: 'billing' } });
    await dbm.expectDatabasesRowCount(1);
    expect(await dbm.databasesRowsFor(MULTI), 'the billing schema lives on the multi-schema server').toBe(1);
    expect(await dbm.databasesRowsFor(SINGLE), 'a server without the billing schema drops out').toBe(0);
  });
});
