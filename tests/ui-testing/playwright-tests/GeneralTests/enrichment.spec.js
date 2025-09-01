const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
import { PageManager } from '../../pages/page-manager.js';
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
        
        await page.goto(logsUrl);
        const allsearch = page.waitForResponse("**/api/default/_search**");
        await pm.logsPage.selectStream("e2e_automate");
        
        // Apply query to load data
        await pm.enrichmentPage.applyQuery();
        
        testLogger.info('Enrichment test setup completed');
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