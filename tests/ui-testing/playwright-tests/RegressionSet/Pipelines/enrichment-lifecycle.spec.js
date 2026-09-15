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
  test("creating and deleting an enrichment table should update the list without a refresh", {
    tag: ['@bug-2937', '@P2', '@regression', '@enrichmentRegression', '@pipelinesRegression']
  }, async () => {
    testLogger.info('Test: enrichment list reflects create/delete without reload (Bug #2937)');

    const tableName = uniqueTableName('e2e_2937');
    createdTables.push(tableName);

    await pm.pipelinesPage.navigateToAddEnrichmentTable();
    await pm.enrichmentPage.uploadEnrichmentFile(CSV_FIXTURE, tableName);
    await pm.enrichmentPage.waitForAddFormToClose();

    // No reload here on purpose: a reload would pass against the broken build too.
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

    // The symptom was rows vanishing, not the list row, so follow it into Explore.
    await pm.enrichmentPage.clickExploreButton(tableName);
    await page.waitForURL(/\/web\/logs/, { timeout: 20000 });
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info('✓ PASSED: duplicate name refused and data intact (Bug #2067)');
  });
});
