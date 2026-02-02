const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { v4: uuidv4 } = require('uuid');

test.describe.configure({ mode: "parallel" });

test.describe("Enrichment data testcases", () => {
    let pm;

    // Helper function for tests that need logs data setup
    async function setupLogsData(page, pm) {
        await pm.ingestionPage.ingestion();

        const logsUrl = `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`;
        testLogger.navigation('Navigating to logs page', { url: logsUrl });

        try {
            await page.goto(logsUrl);
            const searchPattern = `**/api/${process.env["ORGNAME"]}/_search**`;
            const allsearch = page.waitForResponse(searchPattern, { timeout: 30000 });
            await pm.logsPage.selectStream("e2e_automate");
            await pm.enrichmentPage.applyQuery();
            await allsearch;
            testLogger.info('Logs data setup completed');
        } catch (error) {
            testLogger.error('Logs data setup failed', {
                error: error.message,
                pageUrl: page.url()
            });
            throw error;
        }
    }

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
    });

    test("should upload an enrichment table under functions", {
        tag: ['@enrichment', '@upload', '@explore', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing enrichment table upload functionality');

        // Setup logs data for exploration
        await setupLogsData(page, pm);

        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Generate a unique file name and replace hyphens with underscores
        let fileName = `enrichment_info_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        // Upload and explore enrichment table
        const fileContentPath = "../test-data/enrichment_info.csv";
        await pm.enrichmentPage.uploadAndExploreEnrichmentTable(fileContentPath, fileName);

        // Clean up - delete the uploaded table
        await pm.enrichmentPage.navigateToEnrichmentTable();
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);

        testLogger.info('Enrichment table upload test completed');
    });

    test("should upload an enrichment table under functions with VRL", {
        tag: ['@enrichment', '@upload', '@vrl', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing enrichment table upload with VRL functionality');

        // Setup logs data for exploration
        await setupLogsData(page, pm);

        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Generate a unique file name
        let fileName = `protocols_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        // Upload file with VRL processing using page object methods
        const fileContentPath = "../test-data/protocols.csv";
        await pm.enrichmentPage.uploadFileWithVRLQuery(fileContentPath, fileName);
        await pm.enrichmentPage.exploreWithVRLProcessing(fileName);

        // Clean up - delete the uploaded table
        await pm.enrichmentPage.navigateToEnrichmentTable();
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);

        testLogger.info('Enrichment table VRL test completed');
    });

    test("should display error when CSV not added in enrichment table", {
        tag: ['@enrichment', '@validation', '@csvRequired', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing CSV validation error functionality');

        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Test CSV validation error
        await pm.enrichmentPage.testCSVValidationError();

        testLogger.info('CSV validation error test completed');
    });

    test("should display error when name field is empty in enrichment table", {
        tag: ['@enrichment', '@validation', '@nameRequired', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing name field validation error functionality');

        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Test name validation error - upload CSV without entering name
        const fileContentPath = "../test-data/enrichment_info.csv";
        await pm.enrichmentPage.attemptSaveWithoutName(fileContentPath);

        testLogger.info('Name field validation error test completed');
    });

    test("should append an enrichment table under functions", {
        tag: ['@enrichment', '@append', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing enrichment table append functionality');

        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Generate a unique file name and replace hyphens with underscores
        let fileName = `append_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        // Upload file and test append functionality using page object methods
        const fileContentPath = "../test-data/append.csv";
        await pm.enrichmentPage.uploadFileForAppendTest(fileContentPath, fileName);
        await pm.enrichmentPage.exploreAndVerifyInitialData();
        await pm.enrichmentPage.navigateAndAppendData(fileName, fileContentPath);
        await pm.enrichmentPage.verifyAppendedData(fileName);

        // Clean up - delete the enrichment table
        await pm.enrichmentPage.navigateToEnrichmentTable();
        await pm.enrichmentPage.searchEnrichmentTableInList(fileName);
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);

        testLogger.info('Enrichment table append test completed');
    });

    test("should cancel enrichment table creation and return to list", {
        tag: ['@enrichment', '@cancel', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cancel button functionality');

        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Click cancel without entering any data
        await pm.enrichmentPage.clickCancelButton();

        // Verify we're back on enrichment tables list
        await pm.enrichmentPage.verifyBackOnEnrichmentList();

        testLogger.info('Cancel button test completed');
    });

    test("should search and filter enrichment tables", {
        tag: ['@enrichment', '@search', '@filter', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing search/filter functionality');

        // Create a table to search for
        await pm.pipelinesPage.navigateToAddEnrichmentTable();
        let fileName = `search_test_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        const fileContentPath = "../test-data/enrichment_info.csv";
        await pm.enrichmentPage.uploadEnrichmentFile(fileContentPath, fileName);

        // After upload, we're already on the enrichment tables list
        // Search for the table
        await pm.enrichmentPage.searchEnrichmentTableInList(fileName);

        // Verify table is visible in filtered results
        await pm.enrichmentPage.verifyTableVisibleInList(fileName);

        // Clean up - delete without explicit navigation (already on list)
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);

        testLogger.info('Search/filter test completed');
    });

    test("should open edit mode with disabled name field", {
        tag: ['@enrichment', '@edit', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing edit workflow functionality');

        // Create a table first
        await pm.pipelinesPage.navigateToAddEnrichmentTable();
        let fileName = `edit_test_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        const fileContentPath = "../test-data/enrichment_info.csv";
        await pm.enrichmentPage.uploadEnrichmentFile(fileContentPath, fileName);

        // After upload, we're already on the enrichment tables list
        // Search for the table
        await pm.enrichmentPage.searchEnrichmentTableInList(fileName);

        // Click edit button
        await pm.enrichmentPage.clickEditButton(fileName);

        // Verify we're in update mode
        await pm.enrichmentPage.verifyUpdateMode();

        // Verify name field is disabled
        await pm.enrichmentPage.verifyNameFieldDisabled();

        // Cancel - returns to list
        await pm.enrichmentPage.clickCancelButton();

        // Clean up - delete without explicit navigation (already on list after cancel)
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);

        testLogger.info('Edit workflow test completed');
    });

    test("should show delete confirmation dialog with cancel", {
        tag: ['@enrichment', '@delete', '@confirmation', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing delete confirmation dialog');

        // Create a table first
        await pm.pipelinesPage.navigateToAddEnrichmentTable();
        let fileName = `delete_test_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        const fileContentPath = "../test-data/enrichment_info.csv";
        await pm.enrichmentPage.uploadEnrichmentFile(fileContentPath, fileName);

        // After upload, we're already on the enrichment tables list
        // Search for the table
        await pm.enrichmentPage.searchEnrichmentTableInList(fileName);

        // Click delete button
        await pm.enrichmentPage.clickDeleteButton(fileName);

        // Verify confirmation dialog appears
        await pm.enrichmentPage.verifyDeleteConfirmationDialog();

        // Click Cancel - table should still exist
        await pm.enrichmentPage.clickDeleteCancel();

        // Verify table still visible
        await pm.enrichmentPage.verifyTableVisibleInList(fileName);

        // Clean up - actually delete it (already on list)
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);

        testLogger.info('Delete confirmation dialog test completed');
    });
});