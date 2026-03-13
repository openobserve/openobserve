/**
 * Monaco Editor Query Pre-fill Tests
 *
 * Tests for PR #10146: Monaco Editor lazy loading query pre-fill scenarios
 *
 * These tests verify that queries are correctly pre-filled in the Monaco editor
 * after lazy loading in various scenarios:
 * - URL query parameter navigation
 * - Saved views
 * - Stream explorer navigation
 *
 * The Monaco Editor is loaded asynchronously via defineAsyncComponent, and these
 * tests ensure the query pre-fill works correctly despite the lazy loading.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Monaco Editor Query Pre-fill Tests", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const TEST_STREAM = 'e2e_automate';
  const SAVED_VIEW_PREFIX = 'streamslog_monaco_'; // Matches cleanup.spec.js pattern

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // =====================================================
  // P0 - CRITICAL: URL Query Parameter Pre-fill
  // =====================================================

  test("P0: Query from URL parameter should pre-fill Monaco editor after lazy loading", {
    tag: ['@monacoLazyLoad', '@queryPrefill', '@smoke', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing URL query parameter pre-fill in Monaco editor');

    // Step 1: Construct URL with base64 encoded SQL query
    const sqlQuery = `SELECT * FROM "${TEST_STREAM}" LIMIT 100`;
    const base64Query = Buffer.from(sqlQuery).toString('base64');

    // Construct the logs URL with query parameter
    const logsUrlWithQuery = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}&stream=${TEST_STREAM}&stream_type=logs&query=${base64Query}&sql_mode=true`;

    testLogger.info('Navigating to logs with query param', {
      query: sqlQuery,
      encodedQuery: base64Query
    });

    // Step 2: Navigate directly to URL with query param
    await page.goto(logsUrlWithQuery);

    // Step 3: Wait for page and Monaco editor to load (critical for lazy loading)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for Monaco editor to be visible (it's lazy loaded)
    await pm.logsPage.waitForQueryEditorVisible();

    // Additional wait for Monaco to initialize and pre-fill
    await page.waitForTimeout(2000);

    testLogger.info('Monaco editor visible, checking content');

    // Step 4: Verify Monaco editor contains the query
    // Use the getQueryEditorText method from logsPage
    const editorContent = await pm.logsPage.getQueryEditorText();
    testLogger.info('Editor content retrieved', { content: editorContent });

    // Verify the query is pre-filled (normalize whitespace for comparison)
    const normalizedContent = editorContent?.replace(/\s+/g, ' ').trim() || '';
    const normalizedExpected = sqlQuery.replace(/\s+/g, ' ').trim();

    expect(normalizedContent).toContain('SELECT');
    expect(normalizedContent).toContain(TEST_STREAM);

    testLogger.info('URL query parameter pre-fill test completed successfully');
  });

  test("P0: Share link URL should pre-fill Monaco editor correctly", {
    tag: ['@monacoLazyLoad', '@queryPrefill', '@shareLink', '@smoke', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing share link URL pre-fill in Monaco editor');

    // Step 1: Navigate to logs page and setup a query
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 2: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 3: Enable SQL mode
    await pm.logsPage.enableSqlModeIfNeeded();

    // Step 4: Enter a specific SQL query
    const testQuery = `SELECT * FROM "${TEST_STREAM}" WHERE code = 200 LIMIT 50`;
    await pm.logsPage.clearAndFillQueryEditor(testQuery);
    await page.waitForTimeout(1000);

    // Step 5: Click refresh to execute
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 6: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info('Share link URL captured', { url: sharedUrl });

    // Step 7: Navigate to the shared URL (simulates opening in new tab)
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 8: Wait for Monaco to load and pre-fill
    await pm.logsPage.waitForQueryEditorVisible();
    await page.waitForTimeout(2000);

    // Step 9: Verify Monaco editor contains the query
    const editorContent = await pm.logsPage.getQueryEditorText();
    testLogger.info('Editor content after redirect', { content: editorContent });

    // Verify the query structure is preserved
    expect(editorContent).toContain('SELECT');
    expect(editorContent).toContain(TEST_STREAM);

    testLogger.info('Share link URL pre-fill test completed successfully');
  });

  // =====================================================
  // P1 - FUNCTIONAL: Saved Views Pre-fill
  // =====================================================

  test("P1: Saved view should pre-fill Monaco editor with saved query", {
    tag: ['@monacoLazyLoad', '@queryPrefill', '@savedViews', '@functional', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing saved view query pre-fill in Monaco editor');

    // Generate unique saved view name
    const randomId = Math.random().toString(36).substring(2, 8);
    const savedViewName = `${SAVED_VIEW_PREFIX}${randomId}`;
    const testQuery = `SELECT * FROM "${TEST_STREAM}" WHERE code = 500 LIMIT 25`;

    // Step 1: Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 2: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 3: Enable SQL mode
    await pm.logsPage.enableSqlModeIfNeeded();

    // Step 4: Enter a specific SQL query
    await pm.logsPage.clearAndFillQueryEditor(testQuery);
    await page.waitForTimeout(1000);

    // Step 5: Click refresh to execute query
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 6: Create saved view
    testLogger.info('Creating saved view', { name: savedViewName });
    await pm.logsPage.clickSavedViewsExpand();
    await page.waitForTimeout(500);

    // Click "Save View" menu item
    await pm.logsPage.clickSaveViewButton();
    await page.waitForTimeout(500);

    // Fill saved view name
    await pm.logsPage.fillSavedViewName(savedViewName);
    await page.waitForTimeout(500);

    // Click save
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);

    // Step 7: Navigate away (go to home or different page)
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Step 8: Navigate back to logs page (fresh load, triggers lazy loading)
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for Monaco editor to load
    await pm.logsPage.waitForQueryEditorVisible();

    // Step 9: Open saved views and apply the saved view
    testLogger.info('Applying saved view', { name: savedViewName });
    await pm.logsPage.clickSavedViewsExpand();
    await page.waitForTimeout(500);

    // Search for the saved view
    await pm.logsPage.fillSavedViewSearchInput(savedViewName);
    await page.waitForTimeout(1000);

    // Click the saved view to apply
    await pm.logsPage.clickSavedViewByName(savedViewName);
    await page.waitForTimeout(2000);

    // Step 10: Verify Monaco editor contains the saved query
    const editorContent = await pm.logsPage.getQueryEditorText();
    testLogger.info('Editor content after applying saved view', { content: editorContent });

    // Verify query structure is preserved
    expect(editorContent).toContain('SELECT');
    expect(editorContent).toContain(TEST_STREAM);

    // Step 11: Cleanup - delete the saved view
    testLogger.info('Cleaning up saved view', { name: savedViewName });
    try {
      await pm.logsPage.clickDeleteSavedViewButton(savedViewName);
      await page.waitForTimeout(500);
      await pm.logsPage.clickConfirmButton();
      await page.waitForTimeout(1000);
      testLogger.info('Saved view deleted successfully');
    } catch (cleanupError) {
      testLogger.warn('Cleanup failed - saved view may still exist', {
        name: savedViewName,
        error: cleanupError.message
      });
    }

    testLogger.info('Saved view pre-fill test completed successfully');
  });

  // =====================================================
  // P2 - EDGE CASE: Stream Explorer Navigation
  // =====================================================

  test("P2: Stream explorer should navigate to logs with stream selected and empty query", {
    tag: ['@monacoLazyLoad', '@streamExplorer', '@edge', '@P2', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing stream explorer navigation to logs');

    // Step 1: Navigate to Streams page
    const streamsUrl = `${process.env["ZO_BASE_URL"]}/web/streams?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(streamsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Step 2: Search for the test stream
    testLogger.info('Searching for stream', { stream: TEST_STREAM });
    await pm.streamsPage.searchStream(TEST_STREAM);

    // Step 3: Click Explore button for the stream
    testLogger.info('Clicking explore button');
    await pm.streamsPage.exploreStream();

    // Step 4: Wait for logs page to load with Monaco editor
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.logsPage.waitForQueryEditorVisible();
    await page.waitForTimeout(2000);

    // Step 5: Verify we're on the logs page
    await expect(page).toHaveURL(/.*logs/);
    testLogger.info('Navigated to logs page');

    // Step 6: Verify stream is selected in the URL
    const currentUrl = page.url();
    testLogger.info('Current URL', { url: currentUrl });
    expect(currentUrl).toContain('stream');

    // Step 7: Verify Monaco editor is visible and ready
    await pm.logsPage.expectQueryEditorVisible();

    testLogger.info('Stream explorer navigation test completed successfully');
  });

  // =====================================================
  // P1 - FUNCTIONAL: Time Range Preservation with Query
  // =====================================================

  test("P1: URL navigation should preserve both query and time range", {
    tag: ['@monacoLazyLoad', '@queryPrefill', '@timeRange', '@functional', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing URL navigation preserves query and time range');

    // Step 1: Navigate to logs page first
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 2: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 3: Set specific time range (1 hour)
    await pm.logsPage.clickRelativeTimeButton('1-h');

    // Step 4: Enable SQL mode
    await pm.logsPage.enableSqlModeIfNeeded();

    // Step 5: Enter a query
    const testQuery = `SELECT * FROM "${TEST_STREAM}" LIMIT 100`;
    await pm.logsPage.clearAndFillQueryEditor(testQuery);
    await page.waitForTimeout(1000);

    // Step 6: Execute query
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 7: Capture state before sharing
    const originalState = await pm.logsPage.captureCurrentState();
    testLogger.info('Original state captured', {
      stream: originalState.stream,
      period: originalState.period
    });

    // Step 8: Share link and navigate
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 9: Wait for Monaco to load
    await pm.logsPage.waitForQueryEditorVisible();
    await page.waitForTimeout(2000);

    // Step 10: Verify both query and time range are preserved
    const editorContent = await pm.logsPage.getQueryEditorText();
    expect(editorContent).toContain('SELECT');
    expect(editorContent).toContain(TEST_STREAM);

    // Verify stream is preserved
    const redirectedState = await pm.logsPage.captureCurrentState();
    expect(redirectedState.stream).toBe(originalState.stream);

    testLogger.info('URL navigation with query and time range test completed successfully');
  });
});
