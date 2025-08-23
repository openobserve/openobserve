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

        // Set the file to be uploaded
        const fileContentPath = "../test-data/protocols.csv";
        const inputFile = await page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);

        // Enter the file name
        await page.fill(".q-input > .q-field__inner > .q-field__control", fileName);

        // Click on 'Save'
        await page.getByText("Save").click({ force: true });
        await page.waitForLoadState('networkidle');

        // Search for the uploaded file name
        await page.getByPlaceholder("Search Enrichment Table").fill(fileName);
        await page.waitForLoadState('networkidle');

        // Verify the file name in the enrichment table
        await pm.enrichmentPage.verifyFileInTable(fileName);

        // Explore the file with VRL query
        await page.getByRole("button", { name: "Explore" }).waitFor({ state: 'visible' });
        await page.getByRole("button", { name: "Explore" }).click();
        await page.waitForLoadState('networkidle');
        
        // Wait for logs page to load completely
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000); // Additional wait for VRL editor initialization
        
        // Fill VRL query using page object method
        await pm.enrichmentPage.fillVRLQuery(fileName);

        // Apply the query
        await pm.enrichmentPage.applyQuery();

        // Verify that no warning is shown for query execution
        await pm.enrichmentPage.verifyNoQueryWarning();

        // Expand the first row and verify protocol keyword
        await pm.enrichmentPage.expandFirstLogRow();
        await pm.enrichmentPage.clickProtocolKeyword();

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

        // First upload step
        const fileContentPath = "../test-data/append.csv";
        const inputFile = await page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);

        // Enter the file name
        await page.fill(".q-input > .q-field__inner > .q-field__control", fileName);

        // Click on 'Save'
        await page.getByText("Save").click({ force: true });
        await page.waitForLoadState('networkidle');
        
        // Search and explore the uploaded table
        await page.getByPlaceholder("Search Enrichment Table").fill(fileName);
        await page.waitForLoadState('networkidle');

        await page.getByRole("button", { name: "Explore" }).click();
        await page.locator('[data-test="date-time-btn"]').click();
        await expect(page.getByRole('cell', { name: 'Start time' })).toBeVisible();
        await page.locator('[data-test="log-table-column-0-_timestamp"]').click();
        await page.locator('[data-test="close-dialog"]').click();
        await page.waitForLoadState('networkidle');

        // Navigate to append data to the existing enrichment table
        await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
        await page.locator('[data-test="function-enrichment-table-tab"]').click();
        await page.getByPlaceholder("Search Enrichment Table").fill(fileName);
        await page.getByRole("button", { name: "Enrichment Tables" }).click();

        // Select the append toggle
        await page.getByLabel("Append data to existing").locator("div").first().click();

        // Upload the CSV again for appending
        await inputFile.setInputFiles(fileContentPath);
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: 'Save' }).click();
        await page.waitForLoadState('networkidle');
        
        // Verify appended data
        await page.getByPlaceholder("Search Enrichment Table").fill(fileName);
        await page.waitForLoadState('networkidle');
        await page.getByRole("button", { name: "Explore" }).click();

        // Verify row count increased
        const showingText = page.getByText('Showing 1 to 2 out of 2');
        await expect(showingText).toBeVisible();

        // Clean up - delete the enrichment table
        await pm.enrichmentPage.navigateToEnrichmentTable();
        await page.getByPlaceholder("Search Enrichment Table").fill(fileName);
        await pm.pipelinesPage.deleteEnrichmentTableByName(fileName);
        
        testLogger.info('Enrichment table append test completed');
    });
});