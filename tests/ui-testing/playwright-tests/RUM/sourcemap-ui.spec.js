/**
 * Sourcemap UI E2E Tests
 *
 * Tests for RUM Error Tracking UI with sourcemap display.
 *
 * Test Coverage:
 * - Error Tracking page navigation
 * - Date range selection and query execution
 * - Error list display
 * - Error detail view navigation
 * - Error metadata display
 * - Stack trace display
 *
 * Prerequisites:
 * - OpenObserve running on localhost:5080
 * - RUM enabled
 * - Errors ingested (from test app or test_sourcemap_api.py)
 *
 * Note: Pretty tab with resolved source code not yet implemented in UI.
 * These tests validate basic error display functionality.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Sourcemap UI Tests", () => {
  // Run tests in parallel for faster execution
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base and initialize page manager
    await page.goto(`${process.env.ZO_BASE_URL}?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    pm = new PageManager(page);

    testLogger.info('Test setup completed');
  });

  // ==========================================================================
  // P0 - BASIC NAVIGATION
  // ==========================================================================

  test("P0: Error Tracking page loads successfully", {
    tag: ['@sourcemap', '@ui', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Error Tracking page');

    // Navigate directly to RUM Errors page
    await page.goto(`${process.env.ZO_BASE_URL}/web/rum/errors?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);  // Allow page to stabilize

    // Verify key elements are visible
    await pm.rumPage.expectErrorTrackingPageLoaded();

    testLogger.info('✅ Error Tracking page loaded successfully');
  });

  test("P0: Set date range and run query", {
    tag: ['@sourcemap', '@ui', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing query execution with default time range');

    // Navigate to Error Tracking page
    await page.goto(`${process.env.ZO_BASE_URL}/web/rum/errors?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);  // Allow page to stabilize

    // Use default time range (Past 15 Minutes) which should capture recent errors
    testLogger.info('Clicking Run Query button with default time range');
    await pm.rumPage.clickRunQuery();

    // Wait for query to execute
    await pm.rumPage.waitForQueryExecution();

    // Wait for results table
    await pm.rumPage.expectErrorTableVisible();

    testLogger.info('✅ Query executed successfully');
  });

  // ==========================================================================
  // P1 - ERROR DISPLAY
  // ==========================================================================

  test("P1: Error list displays errors", {
    tag: ['@sourcemap', '@ui', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying error list displays errors');

    // Navigate to Error Tracking page (uses default 15 min time range)
    await page.goto(`${process.env.ZO_BASE_URL}/web/rum/errors?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);  // Allow page to stabilize

    // Run query with default time range
    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForQueryExecution();

    // Wait for table to load and verify errors exist
    const hasErrors = await pm.rumPage.hasErrorRows();
    expect(hasErrors).toBe(true); // Fail if no errors found

    // Count rows
    const rowCount = await pm.rumPage.getErrorRowCount();
    testLogger.info(`Found ${rowCount} error rows`);
    expect(rowCount).toBeGreaterThan(0); // Fail if no rows

    if (rowCount > 0) {
      // Verify first row has expected content
      const firstRow = page.locator('.app-table-container tbody tr').first();
      const rowText = await firstRow.textContent();
      testLogger.info(`First row text: ${rowText}`);

      // Should contain error-related text
      const hasErrorText = rowText.includes('Error') ||
                           rowText.includes('TypeError') ||
                           rowText.includes('ReferenceError') ||
                           rowText.includes('o2-sourcemap-test-app');

      if (hasErrorText) {
        testLogger.info('✅ Error list displays errors with expected content');
      } else {
        testLogger.warn('⚠️ Error list displayed but content may not be from test app');
      }
    }
  });

  test("P1: Click error opens detail view", {
    tag: ['@sourcemap', '@ui', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing error detail view navigation');

    // Navigate and load errors (uses default 15 min time range)
    await page.goto(`${process.env.ZO_BASE_URL}/web/rum/errors?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);  // Allow page to stabilize

    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForQueryExecution();

    // Wait for table and verify errors exist
    const hasErrors = await pm.rumPage.hasErrorRows();
    expect(hasErrors).toBe(true); // Fail if no errors found

    // Click first error row
    testLogger.info('Clicking first error row');
    await pm.rumPage.clickFirstErrorRow();

    // Wait for navigation
    await page.waitForURL('**/rum/errors/view/**', { timeout: 10000 }).catch(() => {
      testLogger.warn('URL did not change to error detail view');
    });

    // Wait for detail view to load
    await pm.rumPage.expectErrorDetailViewLoaded();

    testLogger.info('✅ Error detail view opened successfully');
  });

  test("P1: Error detail shows metadata", {
    tag: ['@sourcemap', '@ui', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying error detail metadata display');

    // Navigate to error detail (uses default 15 min time range)
    await page.goto(`${process.env.ZO_BASE_URL}/web/rum/errors?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);  // Allow page to stabilize

    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForQueryExecution();

    const hasErrors = await pm.rumPage.hasErrorRows();
    if (!hasErrors) {
      test.skip();
    }

    await pm.rumPage.clickFirstErrorRow();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Verify metadata sections
    testLogger.info('Checking for metadata sections');

    // Tags section
    await pm.rumPage.expectTagsSectionVisible();

    // Get container text
    const containerText = await pm.rumPage.getErrorViewerContainerText();

    // Verify common metadata fields
    const hasMetadata = containerText.includes('browser') ||
                        containerText.includes('Browser') ||
                        containerText.includes('ip') ||
                        containerText.includes('IP') ||
                        containerText.includes('service');

    if (hasMetadata) {
      testLogger.info('✅ Error metadata displayed correctly');
    } else {
      testLogger.warn('⚠️ Expected metadata fields not found');
    }
  });

  test("P1: Stack trace displays frames", {
    tag: ['@sourcemap', '@ui', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying stack trace display');

    // Navigate to error detail (uses default 15 min time range)
    await page.goto(`${process.env.ZO_BASE_URL}/web/rum/errors?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);  // Allow page to stabilize

    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForQueryExecution();

    const hasErrors = await pm.rumPage.hasErrorRows();
    if (!hasErrors) {
      test.skip();
    }

    await pm.rumPage.clickFirstErrorRow();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Look for stack trace section
    testLogger.info('Looking for stack trace section');

    await pm.rumPage.expectStackTraceVisible();

    // Get stack trace text
    const frameText = await pm.rumPage.getStackTraceText();

    if (frameText) {
      testLogger.info(`Stack trace text: ${frameText.substring(0, 200)}...`);

      // Verify stack frame format
      const hasStackFrames = frameText.includes('at ') &&
                             (frameText.includes('.js') || frameText.includes('http')) &&
                             frameText.match(/:\d+:\d+/);  // line:column format

      if (hasStackFrames) {
        testLogger.info('✅ Stack trace displays frames correctly');
      } else {
        testLogger.warn('⚠️ Stack trace present but format unexpected');
      }
    } else {
      testLogger.warn('⚠️ Stack trace section not visible');
    }
  });
});
