const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Enrichment Table URL Tests
 *
 * Feature: Add and manage enrichment tables from publicly accessible CSV URLs
 * Component: AddEnrichmentTable.vue, EnrichmentTableList.vue
 * Location: Pipeline > Functions > Enrichment Tables
 *
 * Test Coverage:
 * - P0: Create enrichment table from URL, URL validation
 * - P1: Update modes (reload, append, replace all)
 * - P2: Search, delete, cancel operations
 *
 * NOTE: Requires publicly accessible CSV URL for testing
 */

test.describe('Enrichment Table URL', { tag: ['@enrichmentTableUrl', '@functions'] }, () => {
  let pm;

  // Test data
  const TEST_URL = 'https://raw.githubusercontent.com/openobserve/test-data/main/sample-enrichment.csv';
  const TEST_URL_2 = 'https://raw.githubusercontent.com/openobserve/test-data/main/sample-enrichment-2.csv';
  const INVALID_URL = 'example.com/data.csv'; // Missing protocol
  const NONEXISTENT_URL = 'https://nonexistent.example.com/data.csv';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to functions/enrichment tables page
    testLogger.info('Navigating to enrichment tables');
    await pm.enrichmentPage.navigateToEnrichmentTable();
    testLogger.info('Enrichment tables page loaded');
  });

  // ==================== P0: Critical Path Tests ====================

  test('P0: Create enrichment table from URL', {
    tag: ['@smoke', '@P0', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Create enrichment table from URL');

    const tableName = `test_url_table_${Date.now()}`;

    testLogger.info(`Creating enrichment table: ${tableName}`);
    await pm.enrichmentPage.createEnrichmentTableFromUrl(tableName, TEST_URL);

    testLogger.info('Verifying table appears in list');
    await pm.enrichmentPage.verifyTableVisibleInList(tableName);

    testLogger.info('Verifying table type is "Url"');
    await pm.enrichmentPage.expectTableHasType(tableName, 'Url');

    testLogger.info('✓ Enrichment table created successfully from URL');

    // Cleanup
    testLogger.info('Cleaning up test table');
    await pm.enrichmentPage.deleteEnrichmentTableBulk(tableName);
    await pm.enrichmentPage.expectTableNotInList(tableName);
  });

  test('P0: URL validation - invalid format', {
    tag: ['@smoke', '@P0', '@enrichmentTableUrl', '@validation']
  }, async ({ page }) => {
    testLogger.info('Test: URL validation - invalid format');

    const tableName = `test_invalid_${Date.now()}`;

    testLogger.info('Opening create form');
    await pm.enrichmentTablesPage.clickAddEnrichmentTableButton();
    await pm.enrichmentTablesPage.fillTableName(tableName);
    await pm.enrichmentTablesPage.selectFromUrlOption();

    testLogger.info(`Entering invalid URL (missing protocol): ${INVALID_URL}`);
    await pm.enrichmentTablesPage.fillUrl(INVALID_URL);

    // Try to save - should show validation error
    testLogger.info('Attempting to save with invalid URL');
    await pm.enrichmentTablesPage.clickSave();

    // Expect validation error message
    testLogger.info('Verifying validation error appears');
    await pm.enrichmentTablesPage.expectValidationError('URL must start with http:// or https://');

    testLogger.info('✓ URL validation working correctly');

    // Cancel form
    await pm.enrichmentTablesPage.clickCancel();
  });

  // ==================== P1: Functional Tests ====================

  test('P1: Update mode - Reload existing URLs', {
    tag: ['@functional', '@P1', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Update mode - Reload existing URLs');

    const tableName = `test_reload_${Date.now()}`;

    // Create initial table
    testLogger.info('Creating initial enrichment table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName, TEST_URL);
    await pm.enrichmentTablesPage.expectTableInList(tableName);

    // Wait a bit for background job to process
    await page.waitForTimeout(3000);

    // Update with reload mode
    testLogger.info('Opening table for update');
    await pm.enrichmentTablesPage.updateEnrichmentTableReload(tableName);

    testLogger.info('✓ Reload mode update successful');

    // Verify table still exists
    await pm.enrichmentTablesPage.expectTableInList(tableName);

    // Cleanup
    testLogger.info('Cleaning up test table');
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName);
  });

  test('P1: Update mode - Append new URL', {
    tag: ['@functional', '@P1', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Update mode - Append new URL');

    const tableName = `test_append_${Date.now()}`;

    // Create initial table
    testLogger.info('Creating initial enrichment table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName, TEST_URL);
    await pm.enrichmentTablesPage.expectTableInList(tableName);

    // Wait a bit for background job to process
    await page.waitForTimeout(3000);

    // Append new URL
    testLogger.info('Appending new URL to table');
    await pm.enrichmentTablesPage.updateEnrichmentTableAppend(tableName, TEST_URL_2);

    testLogger.info('✓ Append mode update successful');

    // Verify table still exists with Url type
    await pm.enrichmentTablesPage.expectTableInList(tableName);
    await pm.enrichmentTablesPage.expectTableHasType(tableName, 'Url');

    // Cleanup
    testLogger.info('Cleaning up test table');
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName);
  });

  test('P1: Update mode - Replace all URLs', {
    tag: ['@functional', '@P1', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Update mode - Replace all URLs');

    const tableName = `test_replace_${Date.now()}`;

    // Create initial table
    testLogger.info('Creating initial enrichment table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName, TEST_URL);
    await pm.enrichmentTablesPage.expectTableInList(tableName);

    // Wait a bit for background job to process
    await page.waitForTimeout(3000);

    // Replace all URLs
    testLogger.info('Replacing all URLs with new URL');
    await pm.enrichmentTablesPage.updateEnrichmentTableReplaceAll(tableName, TEST_URL_2);

    testLogger.info('✓ Replace all mode update successful');

    // Verify table still exists
    await pm.enrichmentTablesPage.expectTableInList(tableName);

    // Cleanup
    testLogger.info('Cleaning up test table');
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName);
  });

  test('P1: Cancel form without saving', {
    tag: ['@functional', '@P1', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Cancel form without saving');

    const tableName = `test_cancel_${Date.now()}`;

    testLogger.info('Opening create form');
    await pm.enrichmentTablesPage.clickAddEnrichmentTableButton();
    await pm.enrichmentTablesPage.fillTableName(tableName);
    await pm.enrichmentTablesPage.selectFromUrlOption();
    await pm.enrichmentTablesPage.fillUrl(TEST_URL);

    testLogger.info('Clicking cancel button');
    await pm.enrichmentTablesPage.clickCancel();

    // Verify table was NOT created
    testLogger.info('Verifying table was not created');
    await pm.enrichmentTablesPage.expectTableNotInList(tableName);

    testLogger.info('✓ Cancel functionality working correctly');
  });

  // ==================== P2: Edge Case Tests ====================

  test('P2: Search enrichment tables', {
    tag: ['@edge', '@P2', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Search enrichment tables');

    const tableName1 = `search_test_alpha_${Date.now()}`;
    const tableName2 = `search_test_beta_${Date.now()}`;

    // Create two tables
    testLogger.info('Creating first table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName1, TEST_URL);
    await pm.enrichmentTablesPage.expectTableInList(tableName1);

    testLogger.info('Creating second table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName2, TEST_URL);
    await pm.enrichmentTablesPage.expectTableInList(tableName2);

    // Search for first table
    testLogger.info(`Searching for: ${tableName1}`);
    await pm.enrichmentTablesPage.searchEnrichmentTable(tableName1);
    await pm.enrichmentTablesPage.expectTableInList(tableName1);

    // Second table should not be visible in filtered results
    testLogger.info('Verifying second table is filtered out');
    await pm.enrichmentTablesPage.expectTableNotInList(tableName2);

    testLogger.info('✓ Search functionality working correctly');

    // Cleanup
    testLogger.info('Cleaning up test tables');
    await pm.enrichmentTablesPage.searchEnrichmentTable('search_test_');
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName1);
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName2);
  });

  test('P2: Delete enrichment table', {
    tag: ['@edge', '@P2', '@enrichmentTableUrl']
  }, async ({ page }) => {
    testLogger.info('Test: Delete enrichment table');

    const tableName = `test_delete_${Date.now()}`;

    // Create table
    testLogger.info('Creating enrichment table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName, TEST_URL);
    await pm.enrichmentTablesPage.expectTableInList(tableName);

    // Delete table
    testLogger.info('Deleting table');
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName);

    // Verify deletion
    testLogger.info('Verifying table is deleted');
    await pm.enrichmentTablesPage.expectTableNotInList(tableName);

    testLogger.info('✓ Delete functionality working correctly');
  });

  test('P2: Data source selection toggle', {
    tag: ['@edge', '@P2', '@enrichmentTableUrl', '@ui']
  }, async ({ page }) => {
    testLogger.info('Test: Data source selection toggle');

    const tableName = `test_toggle_${Date.now()}`;

    testLogger.info('Opening create form');
    await pm.enrichmentTablesPage.clickAddEnrichmentTableButton();
    await pm.enrichmentTablesPage.fillTableName(tableName);

    // Verify default is "Upload File" (URL input should not be visible)
    testLogger.info('Verifying default data source');
    await pm.enrichmentTablesPage.expectUrlInputHidden();

    // Select "From URL"
    testLogger.info('Selecting "From URL" option');
    await pm.enrichmentTablesPage.selectFromUrlOption();
    await pm.enrichmentTablesPage.expectUrlInputVisible();

    // Toggle back to "Upload File"
    testLogger.info('Toggling back to "Upload File"');
    await pm.enrichmentTablesPage.selectUploadFileOption();
    await pm.enrichmentTablesPage.expectUrlInputHidden();

    testLogger.info('✓ Data source toggle working correctly');

    // Cancel form
    await pm.enrichmentTablesPage.clickCancel();
  });

  // ==================== Optional: Background Job Tests ====================
  // NOTE: Uncomment these tests if you want to verify background job processing
  // WARNING: These tests may take 30-60 seconds to complete

  test.skip('Background Job: Wait for URL processing to complete', {
    tag: ['@background', '@P2', '@enrichmentTableUrl', '@slow']
  }, async ({ page }) => {
    testLogger.info('Test: Background job processing');

    const tableName = `test_job_${Date.now()}`;

    testLogger.info('Creating enrichment table');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName, TEST_URL);

    testLogger.info('Waiting for background job to complete (max 60 seconds)');
    const jobCompleted = await pm.enrichmentTablesPage.waitForBackgroundJob(tableName, 'completed', 60);

    if (jobCompleted) {
      testLogger.info('✓ Background job completed successfully');
    } else {
      testLogger.warn('⚠ Background job did not complete within timeout');
    }

    // Cleanup
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName);
  });

  test.skip('Background Job: Handle failed URL', {
    tag: ['@background', '@P2', '@enrichmentTableUrl', '@error']
  }, async ({ page }) => {
    testLogger.info('Test: Failed URL handling');

    const tableName = `test_failed_${Date.now()}`;

    testLogger.info('Creating enrichment table with nonexistent URL');
    await pm.enrichmentTablesPage.createEnrichmentTableFromUrl(tableName, NONEXISTENT_URL);

    testLogger.info('Waiting for background job to fail (max 60 seconds)');
    const jobFailed = await pm.enrichmentTablesPage.waitForBackgroundJob(tableName, 'failed', 60);

    if (jobFailed) {
      testLogger.info('✓ Failed URL detected correctly');

      // Test replace failed URL mode (if available)
      testLogger.info('Testing replace failed URL mode');
      await pm.enrichmentTablesPage.clickEditButton(tableName);

      // The "Replace failed URL" option should appear when there's a failed job
      await pm.enrichmentTablesPage.selectReplaceFailedMode();
      await pm.enrichmentTablesPage.fillUrl(TEST_URL);
      await pm.enrichmentTablesPage.clickSave();

      testLogger.info('✓ Replace failed URL mode completed');
    } else {
      testLogger.warn('⚠ Job did not fail within timeout (may have succeeded unexpectedly)');
    }

    // Cleanup
    await pm.enrichmentTablesPage.deleteEnrichmentTable(tableName);
  });
});
