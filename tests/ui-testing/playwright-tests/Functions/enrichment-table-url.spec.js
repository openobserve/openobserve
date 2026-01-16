/**
 * Enrichment Table URL Feature E2E Tests
 *
 * Test Coverage:
 * - P0: Critical path (create, validation, list visibility)
 * - P1: Functional tests (search, delete, cancel)
 * - P2: Edge cases (toggle source, nonexistent URL)
 *
 * Known Limitation: URL background job processing takes >240s on pentest environment
 * Tests that require waiting for job completion are marked with .skip()
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const { expect } = require('@playwright/test');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { randomUUID } = require('crypto');

// Test data - using small protocols.csv (13 rows) for fast processing
const CSV_URL = 'https://raw.githubusercontent.com/openobserve/openobserve/main/tests/test-data/protocols.csv';
const INVALID_URL_NO_PROTOCOL = 'example.com/data.csv';
const NONEXISTENT_URL = 'https://nonexistent-domain-12345.com/data.csv';

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

    test.skip('@P1 Update mode - Reload existing URLs', async () => {
        // SKIP REASON: Background job processing takes >240s on pentest
        const tableName = generateTableName('reload_test');
        testLogger.info(`Test: Update mode - Reload - ${tableName}`);

        // Create initial table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);

        // Wait for job to complete
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);
        if (status !== 'completed') {
            test.skip(true, `URL job did not complete (status: ${status})`);
        }

        // Click edit button
        await enrichmentPage.clickEditButton(tableName);
        await enrichmentPage.verifyUpdateMode();

        // Select reload mode
        await enrichmentPage.selectUpdateMode('reload');

        // Save
        await enrichmentPage.saveUpdateMode();

        testLogger.info('Reload mode test completed');
    });

    test.skip('@P1 Update mode - Append new URL', async () => {
        // SKIP REASON: Background job processing takes >240s on pentest
        const tableName = generateTableName('append_test');
        testLogger.info(`Test: Update mode - Append - ${tableName}`);

        // Create initial table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);

        // Wait for job to complete
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);
        if (status !== 'completed') {
            test.skip(true, `URL job did not complete (status: ${status})`);
        }

        // Click edit button
        await enrichmentPage.clickEditButton(tableName);

        // Select append mode
        await enrichmentPage.selectUpdateMode('append');

        // Fill new URL
        await enrichmentPage.fillUrlInput(CSV_URL);

        // Save
        await enrichmentPage.saveUpdateMode();

        testLogger.info('Append mode test completed');
    });

    test.skip('@P1 Update mode - Replace all URLs', async () => {
        // SKIP REASON: Background job processing takes >240s on pentest
        const tableName = generateTableName('replace_test');
        testLogger.info(`Test: Update mode - Replace - ${tableName}`);

        // Create initial table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);

        // Wait for job to complete
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);
        if (status !== 'completed') {
            test.skip(true, `URL job did not complete (status: ${status})`);
        }

        // Click edit button
        await enrichmentPage.clickEditButton(tableName);

        // Select replace mode
        await enrichmentPage.selectUpdateMode('replace');

        // Fill new URL
        await enrichmentPage.fillUrlInput(CSV_URL);

        // Save
        await enrichmentPage.saveUpdateMode();

        testLogger.info('Replace mode test completed');
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

    test.skip('@P1 Search enrichment tables', async () => {
        // SKIP REASON: Requires background job completion to have searchable tables
        const tableName = generateTableName('search_test');
        testLogger.info(`Test: Search enrichment tables - ${tableName}`);

        // Create table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);

        // Wait for job to complete
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);
        if (status !== 'completed') {
            test.skip(true, `URL job did not complete (status: ${status})`);
        }

        // Search for table
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        testLogger.info('Searched for table');

        // Verify table is visible in filtered results
        await enrichmentPage.verifyTableVisibleInList(tableName);
        testLogger.info('Table found in search results');
    });

    test.skip('@P1 Delete enrichment table', async () => {
        // SKIP REASON: Requires background job completion
        const tableName = generateTableName('delete_test');
        testLogger.info(`Test: Delete enrichment table - ${tableName}`);

        // Create table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);

        // Wait for job to complete
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);
        if (status !== 'completed') {
            test.skip(true, `URL job did not complete (status: ${status})`);
        }

        // Search for table
        await enrichmentPage.searchEnrichmentTableInList(tableName);

        // Click delete button
        await enrichmentPage.clickDeleteButton(tableName);
        testLogger.info('Clicked delete button');

        // Verify confirmation dialog
        await enrichmentPage.verifyDeleteConfirmationDialog();
        testLogger.info('Confirmation dialog verified');

        // Click OK to delete
        await enrichmentPage.clickDeleteOK();
        testLogger.info('Confirmed deletion');

        // Verify table is removed from list
        await enrichmentPage.verifyTableRowHidden(tableName);
        testLogger.info('Table removed from list');
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

    test.skip('@P2 URL validation - nonexistent URL', async () => {
        // SKIP REASON: Requires waiting for background job to fail (>240s timeout)
        const tableName = generateTableName('nonexistent_url');
        testLogger.info(`Test: Nonexistent URL - ${tableName}`);

        // Create table with nonexistent URL
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, NONEXISTENT_URL);

        // Wait for job to fail
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);

        // Verify job failed
        expect(status).toBe('failed');
        testLogger.info('URL job failed as expected');

        // Verify failed status icon
        await enrichmentPage.verifyUrlJobStatus(tableName, 'failed');
        testLogger.info('Failed status icon verified');
    });

    test.skip('@P2 Explore enrichment data in logs', async () => {
        // SKIP REASON: Requires background job completion (>240s)
        const tableName = generateTableName('explore_test');
        testLogger.info(`Test: Explore enrichment data - ${tableName}`);

        // Create table
        await pipelinesPage.navigateToAddEnrichmentTable();
        await enrichmentPage.createEnrichmentTableFromUrl(tableName, CSV_URL);

        // Wait for job to complete
        const status = await enrichmentPage.waitForUrlJobComplete(tableName, 240000);
        if (status !== 'completed') {
            test.skip(true, `URL job did not complete (status: ${status})`);
        }

        // Verify explore button is visible
        await enrichmentPage.searchEnrichmentTableInList(tableName);
        await enrichmentPage.verifyTableVisibleInList(tableName);
        testLogger.info('Explore button verified for completed table');

        // Click explore button
        await enrichmentPage.exploreEnrichmentTable();
        testLogger.info('Clicked explore button');

        // Verify navigation to logs page
        await enrichmentPage.page.waitForURL(/.*logs.*/);
        testLogger.info('Navigated to logs page');
    });

    test('@P1 Explore enrichment table and view log details', async ({ page }) => {
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
        const exploreBtn = page.locator(`[data-test="${tableName}-explore-btn"]`);
        await exploreBtn.waitFor({ state: 'visible', timeout: 30000 });
        await exploreBtn.click();
        testLogger.info('Clicked explore button');

        // Wait for navigation to logs page
        await page.waitForURL(/.*logs.*stream_type=enrichment_tables.*/);
        await page.waitForLoadState('networkidle');
        testLogger.info('Navigated to logs page');

        // Wait for log table to load and click on first row
        const firstLogRow = page.locator('[data-test="log-table-column-0-_timestamp"]').first();
        await firstLogRow.waitFor({ state: 'visible', timeout: 30000 });
        await firstLogRow.click();
        testLogger.info('Clicked on first log row');

        // Verify log detail panel expands (check for expanded row content)
        const logDetailPanel = page.locator('.log-detail-container, [data-test="log-detail-json-content"], .q-expansion-item--expanded');
        await expect(logDetailPanel.first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Log detail panel is visible');
    });
});
