/**
 * Enrichment Table URL Feature E2E Tests
 *
 * Test Coverage:
 * - P0: Critical path (create, validation, list visibility)
 * - P1: Functional tests (cancel, delete, explore logs)
 * - P2: Edge cases (toggle source)
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

    test('@P0 @smoke Create enrichment table from URL', async () => {
        const tableName = generateTableName('url_table');
        testLogger.info(`Test: Create enrichment table from URL - ${tableName}`);

        // Click "Add Enrichment Table" button
        await pipelinesPage.navigateToAddEnrichmentTable();
        testLogger.info('Clicked Add Enrichment Table button');

        // Create table from URL
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Enrichment table creation submitted');

        // Verify table appears in list (basic check)
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table verified in list');
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

    test('@P0 @smoke Table appears in list after creation', async () => {
        const tableName = generateTableName('list_check');
        testLogger.info(`Test: Table appears in list - ${tableName}`);

        // Create table from URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Table created from URL');

        // Search and verify table is visible in the list
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        testLogger.info('Searched for table');

        // Verify table row exists (don't check for explore button yet as job is still processing)
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table verified visible in list');
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

    test('@P1 Delete enrichment table', async () => {
        const tableName = generateTableName('delete_test');
        testLogger.info(`Test: Delete enrichment table - ${tableName}`);

        // Create enrichment table from URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Enrichment table created');

        // Search for the table in list
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table found in list');

        // Click delete button (4th button in row: Explore, Schema, Edit, Delete)
        await enrichmentPage.clickDeleteButton(tableName);
        testLogger.info('Clicked delete button');

        // Verify confirmation dialog
        await enrichmentPage.verifyDeleteConfirmationDialog();
        testLogger.info('Confirmation dialog verified');

        // Click OK to confirm deletion
        await enrichmentPage.clickDeleteOK();
        testLogger.info('Confirmed deletion');

        // Verify table is removed from list
        await enrichmentPage.verifyTableRowHidden(tableName);
        testLogger.info('Table removed from list');
    });

    test('@P1 Explore enrichment table and view log details', async () => {
        const tableName = generateTableName('explore_log');
        testLogger.info(`Test: Explore and view log details - ${tableName}`);

        // Create enrichment table from URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Enrichment table created');

        // Search for the table in list
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table found in list');

        // Click explore button to navigate to logs
        await enrichmentPage.clickExploreButton(tableName);
        testLogger.info('Clicked explore button');

        // Wait for navigation to logs page
        await enrichmentPage.waitForLogsPageNavigation();
        testLogger.info('Navigated to logs page');

        // Click on first log row
        await enrichmentPage.clickFirstLogRow();
        testLogger.info('Clicked on first log row');

        // Verify log detail panel is visible
        await enrichmentPage.verifyLogDetailPanelVisible();
        testLogger.info('Log detail panel is visible');
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
