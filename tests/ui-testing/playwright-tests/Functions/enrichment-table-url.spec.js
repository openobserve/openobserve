/**
 * Enrichment Table URL Feature E2E Tests
 *
 * Test Coverage:
 * - P0: Full lifecycle (create, search, explore logs, delete)
 * - P0: URL validation
 * - P1: Cancel form
 * - P2: Data source toggle
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { randomUUID } = require('crypto');

// Test data - using small protocols.csv (13 rows) for fast processing
const CSV_URL = 'https://raw.githubusercontent.com/openobserve/openobserve/main/tests/test-data/protocols.csv';
const INVALID_URL_NO_PROTOCOL = 'example.com/data.csv';

test.describe('Enrichment Table URL Feature Tests', () => {
    let pageManager;
    let enrichmentPage;
    let pipelinesPage;

    // Generate unique table names for each test to avoid conflicts in parallel runs
    const generateTableName = (prefix) => `${prefix}_${randomUUID().split('-')[0]}`;

    test.beforeEach(async ({ page }) => {
        testLogger.info('=== Starting test ===');

        // Initialize base navigation (login and home page)
        await navigateToBase(page);

        pageManager = new PageManager(page);
        enrichmentPage = pageManager.enrichmentPage;
        pipelinesPage = pageManager.pipelinesPage;

        // Navigate to enrichment tables
        await enrichmentPage.navigateToEnrichmentTable();
        testLogger.info('Navigated to enrichment tables list');
    });

    test.afterEach(async ({ page }, testInfo) => {
        if (testInfo.status !== testInfo.expectedStatus) {
            testLogger.error(`Test "${testInfo.title}" failed`);
            await page.screenshot({
                path: `test-results/enrichment-url-${testInfo.title.replace(/\s+/g, '-')}-failure.png`,
                fullPage: true
            });
        }
        testLogger.info('=== Test completed ===');
    });

    // ============================================================================
    // P0 - CRITICAL PATH TESTS
    // ============================================================================

    test('@P0 @smoke Full lifecycle: create, explore logs, and delete enrichment table', async () => {
        const tableName = generateTableName('url_lifecycle');
        testLogger.info(`Test: Full lifecycle - ${tableName}`);

        // Step 1: Create enrichment table from URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        testLogger.info('Clicked Add Enrichment Table button');

        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Enrichment table created');

        // Step 2: Search and verify table appears in list
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table found in list');

        // Step 3: Explore logs - click explore button
        await enrichmentPage.clickExploreButton(tableName);
        testLogger.info('Clicked explore button');

        // Step 4: Wait for logs page and verify data
        await enrichmentPage.waitForLogsPageNavigation();
        testLogger.info('Navigated to logs page');

        await enrichmentPage.clickFirstLogRow();
        testLogger.info('Clicked on first log row');

        await enrichmentPage.verifyLogDetailPanelVisible();
        testLogger.info('Log detail panel is visible');

        // Step 5: Close dialog and navigate back to enrichment tables
        await enrichmentPage.closeAnyOpenDialogs();
        await enrichmentPage.navigateToEnrichmentTable();
        testLogger.info('Navigated back to enrichment tables');

        // Step 6: Search and delete the table
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);

        await enrichmentPage.clickDeleteButton(tableName);
        testLogger.info('Clicked delete button');

        await enrichmentPage.verifyDeleteConfirmationDialog();
        testLogger.info('Confirmation dialog verified');

        await enrichmentPage.clickDeleteOK();
        testLogger.info('Confirmed deletion');

        // Step 7: Verify table is removed
        await enrichmentPage.verifyTableRowHidden(tableName);
        testLogger.info('Table removed from list');
    });

    test('@P0 @smoke URL validation - invalid format (no protocol)', async () => {
        const tableName = generateTableName('invalid_url');
        testLogger.info(`Test: URL validation - invalid format - ${tableName}`);

        // Click "Add Enrichment Table" button
        await pipelinesPage.navigateToAddEnrichmentTable();

        // Attempt to save with invalid URL
        await enrichmentPage.attemptSaveWithInvalidUrl(tableName, INVALID_URL_NO_PROTOCOL);
        testLogger.info('Attempted to save with invalid URL');

        // Verify validation error message
        await enrichmentPage.verifyUrlValidationError('URL must start with http:// or https://');
        testLogger.info('Validation error message verified');
    });

    // ============================================================================
    // P1 - FUNCTIONAL TESTS
    // ============================================================================

    test('@P1 Cancel form without saving', async () => {
        const tableName = generateTableName('cancel_test');
        testLogger.info(`Test: Cancel form - ${tableName}`);

        // Click "Add Enrichment Table"
        await pipelinesPage.navigateToAddEnrichmentTable();

        // Fill in some fields
        await enrichmentPage.fillNameInput(tableName);
        await enrichmentPage.selectSourceOption('url');
        await enrichmentPage.fillUrlInput(CSV_URL);
        testLogger.info('Filled form fields');

        // Click Cancel
        await enrichmentPage.cancelEnrichmentTableForm();
        testLogger.info('Clicked Cancel');

        // Verify back on list page
        await enrichmentPage.verifyBackOnEnrichmentList();
        testLogger.info('Verified back on list page');

        // Search for table to verify it was NOT created
        await enrichmentPage.searchEnrichmentTableInList(tableName);

        // Verify table does NOT exist (no rows or "No data available" message)
        await enrichmentPage.verifyTableNotCreated(tableName);
        testLogger.info('Verified table was not created');
    });

    // ============================================================================
    // P2 - EDGE CASE TESTS
    // ============================================================================

    test('@P2 Data source selection toggle', async () => {
        const tableName = generateTableName('toggle_test');
        testLogger.info(`Test: Data source toggle - ${tableName}`);

        // Click "Add Enrichment Table"
        await pipelinesPage.navigateToAddEnrichmentTable();

        // Initially select "From URL"
        await enrichmentPage.selectSourceOption('url');
        testLogger.info('Selected "From URL"');

        // Verify URL input is visible
        await enrichmentPage.expectUrlInputVisible();
        testLogger.info('URL input visible');

        // Toggle to "Upload File"
        await enrichmentPage.selectSourceOption('file');
        testLogger.info('Toggled to "Upload File"');

        // Verify file input is visible
        await enrichmentPage.expectFileInputVisible();
        testLogger.info('File input visible');

        // Toggle back to "From URL"
        await enrichmentPage.selectSourceOption('url');
        testLogger.info('Toggled back to "From URL"');

        // Verify URL input is visible again
        await enrichmentPage.expectUrlInputVisible();
        testLogger.info('URL input visible again');

        // Cancel without saving
        await enrichmentPage.cancelEnrichmentTableForm();
    });
});
