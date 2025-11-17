const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { v4: uuidv4 } = require('uuid');

test.describe.configure({ mode: "parallel" });

test.describe("Enrichment data testcases", () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        
        // Additional setup for enrichment tests - ingestion and logs navigation
        await pm.ingestionPage.ingestion();
        
        // Navigate to logs page and select stream
        const logsUrl = `${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`;
        testLogger.navigation('Navigating to logs page', { url: logsUrl });

        try {
            testLogger.debug('Before page.goto', { url: logsUrl, isClosed: page.isClosed() });
            await page.goto(logsUrl);
            testLogger.debug('After page.goto', { url: page.url(), isClosed: page.isClosed() });

            testLogger.debug('Setting up waitForResponse');
            const searchPattern = `**/api/${process.env["ORGNAME"]}/_search**`;
            testLogger.debug('Waiting for search response', { pattern: searchPattern });
            const allsearch = page.waitForResponse(searchPattern, { timeout: 30000 });

            testLogger.debug('Before selectStream', { isClosed: page.isClosed() });
            await pm.logsPage.selectStream("e2e_automate");
            testLogger.debug('After selectStream', { isClosed: page.isClosed() });

            // Apply query to load data
            testLogger.debug('Before applyQuery', { isClosed: page.isClosed() });
            await pm.enrichmentPage.applyQuery();
            testLogger.debug('After applyQuery', { isClosed: page.isClosed() });

            testLogger.debug('Waiting for search response');
            await allsearch;
            testLogger.debug('Search response received');

            testLogger.info('Enrichment test setup completed');
        } catch (error) {
            testLogger.error('Enrichment test setup failed', {
                error: error.message,
                stack: error.stack,
                pageUrl: page.url(),
                isClosed: page.isClosed()
            });
            throw error;
        }
    });

    test("should upload an enrichment table under functions", async ({ page }) => {
        testLogger.info('Testing enrichment table upload functionality');
        
        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Generate a unique file name and replace hyphens with underscores
        let fileName = `enrichment_info_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        // Upload and explore enrichment table
        const fileContentPath = "../test-data/enrichment_info.csv";
        await pm.enrichmentPage.uploadAndExploreEnrichmentTable(fileContentPath, fileName);

        // Navigate back to pipeline and delete the uploaded table
        await pm.enrichmentPage.navigateToEnrichmentTable();
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);
        
        testLogger.info('Enrichment table upload test completed');
    });

    test("should upload an enrichment table under functions with VRL", async ({ page }) => {
        testLogger.info('Testing enrichment table upload with VRL functionality');
        
        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();

        // Generate a unique file name
        let fileName = `protocols_${uuidv4()}_csv`.replace(/-/g, "_");
        testLogger.debug('Generated File Name', { fileName });

        // Upload file with VRL processing using page object methods
        const fileContentPath = "../test-data/protocols.csv";
        await pm.enrichmentPage.uploadFileWithVRLQuery(fileContentPath, fileName);
        await pm.enrichmentPage.exploreWithVRLProcessing(fileName);

        // Navigate back and delete the uploaded table
        await pm.enrichmentPage.navigateToEnrichmentTable();
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);
        
        testLogger.info('Enrichment table VRL test completed');
    });

    test("should display error when CSV not added in enrichment table", async ({ page }) => {
        testLogger.info('Testing CSV validation error functionality');
        
        // Navigate to add enrichment table
        await pm.pipelinesPage.navigateToAddEnrichmentTable();
        
        // Test CSV validation error
        await pm.enrichmentPage.testCSVValidationError();
        
        testLogger.info('CSV validation error test completed');
    });

    test("should append an enrichment table under functions", async ({ page }) => {
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
        await pm.enrichmentPage.searchForEnrichmentTable(fileName);
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);
        
        testLogger.info('Enrichment table append test completed');
    });
});