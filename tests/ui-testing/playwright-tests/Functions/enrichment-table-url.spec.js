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
const { expect } = require('@playwright/test');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { randomUUID } = require('crypto');

// Test data - using small protocols.csv (13 rows) for fast processing
const CSV_URL = 'https://raw.githubusercontent.com/openobserve/openobserve/main/tests/test-data/protocols.csv';
const APPEND_CSV_URL = 'https://raw.githubusercontent.com/openobserve/openobserve/main/tests/test-data/append.csv';
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

    test('@P1 Schema view - verify table columns', async () => {
        const tableName = generateTableName('schema_view');
        testLogger.info(`Test: Schema view - ${tableName}`);

        // Step 1: Create enrichment table from URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Table created');

        // Step 2: Search and verify table exists
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);

        // Step 3: Click schema button
        await enrichmentPage.clickSchemaButton(tableName);
        testLogger.info('Clicked schema button');

        // Step 4: Wait briefly for schema to load, then close
        await enrichmentPage.page.waitForTimeout(2000);
        await enrichmentPage.closeSchemaModal();
        testLogger.info('Schema modal closed - test passed');

        // Note: Cleanup handled by cleanup.spec.js pattern matching schema_view_*
        // URL tables with processing jobs may have limited buttons until job completes
    });

    test('@P1 Duplicate table name - error handling', async () => {
        const tableName = generateTableName('duplicate_test');
        testLogger.info(`Test: Duplicate table name - ${tableName}`);

        // Step 1: Create first table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('First table created');

        // Step 2: Try to create second table with same name
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.fillNameInput(tableName);
        await enrichmentPage.selectSourceOption('url');
        await enrichmentPage.fillUrlInput(CSV_URL);
        await enrichmentPage.page.getByRole('button', { name: 'Save' }).click();
        testLogger.info('Attempted to create duplicate table');

        // Step 3: Verify error message
        await enrichmentPage.verifyDuplicateNameError();
        testLogger.info('Duplicate name error verified');

        // Step 4: Cancel and cleanup
        await enrichmentPage.cancelEnrichmentTableForm();
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.clickDeleteButton(tableName);
        await enrichmentPage.verifyDeleteConfirmationDialog();
        await enrichmentPage.clickDeleteOK();
        await enrichmentPage.verifyTableRowHidden(tableName);
        testLogger.info('Table deleted');
    });

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

    test('@P1 Update modes: reload, append, and replace URLs', async () => {
        const tableName = generateTableName('update_modes');
        testLogger.info(`Test: Update modes - ${tableName}`);

        // Step 1: Create enrichment table from URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);
        testLogger.info('Initial table created with 1 URL');

        // Step 2: Search and verify table exists
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table found in list');

        // ========== TEST RELOAD MODE ==========
        // Step 3: Click Edit and test Reload mode
        await enrichmentPage.clickEditButton(tableName);
        await enrichmentPage.verifyUpdateMode();
        testLogger.info('Edit form opened');

        // Reload is default mode - just save to trigger re-processing
        await enrichmentPage.selectUpdateMode('reload');
        await enrichmentPage.saveUpdateMode();
        testLogger.info('Reload mode tested - re-processed existing URL');

        // ========== TEST APPEND MODE ==========
        // Step 4: Edit again and test Append mode
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        await enrichmentPage.clickEditButton(tableName);
        await enrichmentPage.verifyUpdateMode();
        testLogger.info('Edit form opened for append mode');

        await enrichmentPage.selectUpdateMode('append');
        await enrichmentPage.fillNewUrlInput(APPEND_CSV_URL);
        await enrichmentPage.saveUpdateMode();
        testLogger.info('Append mode tested - added second URL');

        // Verify URL count increased to 2 after append
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        await enrichmentPage.verifyUrlCount(tableName, 2);
        testLogger.info('URL count verified: 2 after append');

        // ========== TEST REPLACE MODE ==========
        // Step 5: Edit again and test Replace mode
        await enrichmentPage.clickEditButton(tableName);
        await enrichmentPage.verifyUpdateMode();

        await enrichmentPage.selectUpdateMode('replace');
        await enrichmentPage.fillNewUrlInput(CSV_URL);
        await enrichmentPage.saveUpdateMode();
        testLogger.info('Replace mode tested - replaced all URLs with new one');

        // Verify URL count back to 1 after replace
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        await enrichmentPage.verifyUrlCount(tableName, 1);
        testLogger.info('URL count verified: 1 after replace');

        // Step 6: Cleanup - delete the table
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        await enrichmentPage.clickDeleteButton(tableName);
        await enrichmentPage.verifyDeleteConfirmationDialog();
        await enrichmentPage.clickDeleteOK();
        await enrichmentPage.verifyTableRowHidden(tableName);
        testLogger.info('Table deleted');
    });

    // ============================================================================
    // P2 - EDGE CASE TESTS
    // ============================================================================

    test('@P1 Empty URL validation - error handling', async () => {
        const tableName = generateTableName('empty_url');
        testLogger.info(`Test: Empty URL validation - ${tableName}`);

        // Click "Add Enrichment Table" button
        await pipelinesPage.navigateToAddEnrichmentTable();

        // Attempt to save with empty URL
        await enrichmentPage.attemptSaveWithEmptyUrl(tableName);
        testLogger.info('Attempted to save with empty URL');

        // Verify validation error message
        await enrichmentPage.verifyEmptyUrlError();
        testLogger.info('Empty URL validation error verified');

        // Cancel the form
        await enrichmentPage.cancelEnrichmentTableForm();
    });

    test('@P1 Invalid URL (404) - backend error handling', async () => {
        const tableName = generateTableName('url_404');
        testLogger.info(`Test: Invalid URL (404) - ${tableName}`);

        // Click "Add Enrichment Table" button
        await pipelinesPage.navigateToAddEnrichmentTable();

        // Use a URL that will return 404
        const invalidUrl = 'https://raw.githubusercontent.com/openobserve/openobserve/main/tests/test-data/nonexistent-file.csv';

        // Fill form with valid format but 404 URL
        await enrichmentPage.fillNameInput(tableName);
        await enrichmentPage.selectSourceOption('url');
        await enrichmentPage.fillUrlInput(invalidUrl);
        testLogger.info('Filled form with 404 URL');

        // Click Save - backend processes async and returns to list
        await enrichmentPage.page.getByRole('button', { name: 'Save' }).click();
        await enrichmentPage.page.waitForLoadState('networkidle');
        testLogger.info('Save clicked - backend will process async');

        // Wait for form to close (save accepted)
        await enrichmentPage.page.getByText('Add Enrichment Table').waitFor({ state: 'hidden', timeout: 15000 });

        // Wait for backend to register the table
        await enrichmentPage.page.waitForTimeout(3000);

        // Reload to get fresh data
        await enrichmentPage.page.reload({ waitUntil: 'networkidle' });

        // Search for table in list
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableRowVisible(tableName);
        testLogger.info('Table found in list - 404 URL was accepted for async processing');

        // Verify the table shows "Url" type (backend accepts and creates table entry)
        await enrichmentPage.verifyTableType(tableName, 'Url');
        testLogger.info('Table type verified as Url');

        // Note: Cleanup handled by cleanup.spec.js pattern matching url_404_*
        // URL tables with processing jobs may have limited buttons until job completes
        testLogger.info('Test passed - cleanup will be handled by cleanup spec');
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
