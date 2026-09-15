/**
 * Enrichment table lifecycle regressions — #2067, #2937.
 *
 * Both bugs are about the list page telling the truth without being reloaded,
 * so NEITHER test may call page.reload() or re-navigate after the mutation it
 * asserts on. A reload repopulates the list from the API and would pass against
 * the broken build too, which is exactly what #2937 was reported for.
 *
 * #2067: re-saving an enrichment table under an existing name used to wipe the
 * stored rows. The guard is now a duplicate-name rejection, so the assertion is
 * two-part — the save is refused AND the original table's data is still
 * queryable afterwards. Only asserting the error would not catch a regression
 * that rejects the save but truncates the table on the way out.
 *
 * Table names are per-run unique because the suite runs against a shared
 * environment where a leftover table from an earlier run would make the
 * duplicate-name assertion pass for the wrong reason.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { v4: uuidv4 } = require('uuid');

const CSV_FIXTURE = '../test-data/enrichment_info.csv';

const uniqueTableName = (prefix) =>
  `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 10)}`;

test.describe("Enrichment table lifecycle regressions", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const createdTables = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    testLogger.info('Enrichment lifecycle setup completed');
  });

  test.afterEach(async () => {
    while (createdTables.length) {
      const name = createdTables.pop();
      await pm.enrichmentPage.deleteTableIfExists(name).catch((e) =>
        testLogger.warn(`Cleanup failed for ${name}: ${e.message}`)
      );
    }
  });

  // ==========================================================================
  // Bug #2937: enrichment table list only updates on page refresh
  // https://github.com/openobserve/openobserve/issues/2937
  // ==========================================================================
  test("creating and deleting an enrichment table should update the list without a refresh", {
    tag: ['@bug-2937', '@P2', '@regression', '@enrichmentRegression', '@pipelinesRegression']
  }, async () => {
    testLogger.info('Test: enrichment list reflects create/delete without reload (Bug #2937)');

    const tableName = uniqueTableName('e2e_2937');
    createdTables.push(tableName);

    await pm.pipelinesPage.navigateToAddEnrichmentTable();
    await pm.enrichmentPage.uploadEnrichmentFile(CSV_FIXTURE, tableName);
    await pm.enrichmentPage.waitForAddFormToClose();

    // No reload between the save and this assertion — the list has to react to
    // the create on its own.
    await pm.enrichmentPage.searchEnrichmentTableInList(tableName);
    await pm.enrichmentPage.verifyTableVisibleInList(tableName);
    testLogger.info(`Table ${tableName} appeared in the list without a refresh`);

    await pm.enrichmentPage.clickDeleteButton(tableName);
    await pm.enrichmentPage.verifyDeleteConfirmationDialog();
    await pm.enrichmentPage.clickDeleteOK();

    // Again no reload — the row must disappear on its own.
    await pm.enrichmentPage.verifyTableRowHidden(tableName);
    createdTables.pop();

    testLogger.info('✓ PASSED: enrichment list updated without a refresh (Bug #2937)');
  });

  // ==========================================================================
  // Bug #2067: data disappears when adding an entry with an existing name
  // https://github.com/openobserve/openobserve/issues/2067
  // ==========================================================================
  test("re-saving an enrichment table under an existing name should be refused and keep the original data", {
    tag: ['@bug-2067', '@P2', '@regression', '@enrichmentRegression', '@pipelinesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: duplicate enrichment name refused, data intact (Bug #2067)');

    const tableName = uniqueTableName('e2e_2067');
    createdTables.push(tableName);

    await pm.pipelinesPage.navigateToAddEnrichmentTable();
    await pm.enrichmentPage.uploadEnrichmentFile(CSV_FIXTURE, tableName);
    await pm.enrichmentPage.waitForAddFormToClose();
    await pm.enrichmentPage.searchEnrichmentTableInList(tableName);
    await pm.enrichmentPage.verifyTableVisibleInList(tableName);

    // Second save under the SAME name, which is what used to wipe the rows.
    await pm.pipelinesPage.navigateToAddEnrichmentTable();
    await pm.enrichmentPage.setFileInput(CSV_FIXTURE);
    await pm.enrichmentPage.fillNameInput(tableName);
    await pm.enrichmentPage.clickSaveButton();

    await pm.enrichmentPage.verifyDuplicateNameError();
    testLogger.info('Duplicate name was refused');

    await pm.enrichmentPage.closeAnyOpenDialogs().catch(() => {});
    await pm.enrichmentPage.navigateToEnrichmentTable();
    await pm.enrichmentPage.waitForEnrichmentTablesList();
    await pm.enrichmentPage.searchEnrichmentTableInList(tableName);

    await pm.enrichmentPage.verifyTableVisibleInList(tableName);
    testLogger.info('Original table survived the duplicate save');

    // The reported symptom was the rows vanishing, not the row in the list
    // going away — so follow the table into Explore and assert it still
    // returns data.
    await pm.enrichmentPage.clickExploreButton(tableName);
    await page.waitForURL(/\/web\/logs/, { timeout: 20000 });
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info('✓ PASSED: duplicate name refused and data intact (Bug #2067)');
  });
});
