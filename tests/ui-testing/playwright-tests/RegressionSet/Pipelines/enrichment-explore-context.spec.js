const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { v4: uuidv4 } = require('uuid');

const CSV_FIXTURE = '../test-data/enrichment_info.csv';

// A column of enrichment_info.csv, so its presence proves the table's own schema loaded.
const TABLE_FIELD = 'country_code';

const uniqueName = (prefix) =>
  `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 10)}`;

test.describe("Enrichment table explore context regressions", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const createdTables = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async () => {
    while (createdTables.length) {
      const name = createdTables.pop();
      const result = await pm.enrichmentPage.bestEffortDeleteTable(name);
      if (!result.deleted) {
        testLogger.warn(`Left ${name} for the e2e_enrich_ sweep in cleanup.spec.js: ${result.reason}`);
      }
    }
  });

  test("exploring an enrichment table should load its own rows, not a stream-not-found error", {
    tag: ['@bug-7346', '@P1', '@regression', '@enrichmentRegression', '@pipelinesRegression']
  }, async () => {
    const tableName = uniqueName('e2e_enrich');
    createdTables.push(tableName);
    await pm.pipelinesPage.navigateToAddEnrichmentTable();
    await pm.enrichmentPage.uploadTableAndConfirmListed(tableName, CSV_FIXTURE);
    await pm.enrichmentPage.clickExploreButton(tableName);

    await pm.enrichmentPage.expectExploreScopedToTable(tableName);
    await pm.enrichmentPage.expectNoStreamNotFoundError();
    await pm.enrichmentPage.expectFieldListContains(TABLE_FIELD);
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info(`✓ PASSED: explore opened ${tableName} without a stream-not-found error (Bug #7346)`);
  });

  test("exploring an enrichment table should use the table's own time range, not a default period", {
    tag: ['@bug-6645', '@P2', '@regression', '@enrichmentRegression', '@pipelinesRegression']
  }, async () => {
    const tableName = uniqueName('e2e_enrich');
    createdTables.push(tableName);
    await pm.pipelinesPage.navigateToAddEnrichmentTable();
    await pm.enrichmentPage.uploadTableAndConfirmListed(tableName, CSV_FIXTURE);
    await pm.enrichmentPage.clickExploreButton(tableName);

    await pm.enrichmentPage.expectExploreScopedToTable(tableName);
    const { from, to } = await pm.enrichmentPage.expectExploreTimeRangeFromTableStats();

    // The table was uploaded seconds ago, so a window this narrow can only come from its stats.
    const windowMinutes = (to - from) / 60_000_000;
    expect(windowMinutes, `explore window was ${windowMinutes} minutes wide`).toBeLessThan(120);

    await pm.enrichmentPage.expectFieldListContains(TABLE_FIELD);

    testLogger.info(`✓ PASSED: explore used the table's stats window (${windowMinutes}m) (Bug #6645)`);
  });
});
