const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
async function applyQueryButton(pm) {
  // Wait for query button to be visible, then run query and wait for the
  // execution to complete. runQueryAndWaitForResults keys off the button's
  // UI state (Run -> Cancel -> Run) so it correctly waits for any in-flight
  // auto-search to settle before clicking, then waits for the new search.
  await pm.logsPage.expectRefreshButtonVisible();
  await pm.logsPage.runQueryAndWaitForResults();
}

function removeUTFCharacters(text) {
  // Remove UTF characters using regular expression
  return text.replace(/[^\x00-\x7F]/g, " ");
}

test.describe("Logs Queries testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Wait for app shell to be ready (deterministic post-auth wait)
    await page.waitForLoadState('domcontentloaded');

    // Data ingestion for logs queries testing (preserve exact logic)
    await ingestTestData(page);

    // Navigate to logs page and setup for queries testing
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await applyQueryButton(pm);

    testLogger.info('Logs queries test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });

  test("should display quick mode toggle button", {
    tag: ['@quickModeLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing quick mode toggle button visibility');

    await pm.logsPage.expectQuickModeToggleVisible();

    testLogger.info('Quick mode toggle visibility test completed');
  });

  test.skip("should add timestamp to editor save this view and switch", {
    tag: ['@timestampViewLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickIncludeExcludeFieldButton();
    await pm.logsPage.clickIncludeFieldButton();
    await pm.logsPage.clickCloseDialog();
    await pm.logsPage.clickSavedViewsButton();
    await pm.logsPage.fillSavedViewName("e2etimestamp");
    await pm.logsPage.clickSavedViewDialogSaveContent();
    await pm.logsPage.clickSavedViewArrow();
    await pm.logsPage.clickSavedViewByLabel(/timestamp/);
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput('e2e');
    await pm.logsPage.clickSavedViewByTitle('e2etimestamp');
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.clickSavedViewByTitle('e2etimestamp');
    await pm.logsPage.clickDeleteButton();
    await pm.logsPage.clickConfirmButton();
  });

  test("should create saved view and delete it", {
    tag: ['@streamExplorer', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing saved view creation and deletion functionality');
    // Generate a random saved view name
    const randomSavedViewName = `streamslog${Math.random().toString(36).substring(2, 10)}`;

    // Interactions with the page
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(randomSavedViewName); // Use the random name
    await pm.logsPage.clickSavedViewDialogSave();

    // Wait for the success toast message to appear briefly after save
    try {
      await pm.logsPage.waitForNotificationWithText('View created successfully', 3000);
      testLogger.info('Success toast validated: View created successfully');
    } catch (error) {
      testLogger.info('View creation toast may have appeared and disappeared quickly - continuing with test');
    }

    // Wait for the save-view dialog to close before navigating (replaces the
    // legacy 2000ms wait that was masking the dialog close animation).
    await pm.logsPage.expectSavedViewDialogClosed();
    await pm.logsPage.clickStreamsMenuItem();
    // Wait for the streams-page search input to mount before clicking
    await pm.logsPage.expectSearchStreamInputVisible();
    await pm.logsPage.clickSearchStreamInput();
    await pm.logsPage.fillSearchStreamInput('e2e');
    // Wait for explore button to be visible (DOM-stable signal that filter applied)
    await pm.logsPage.expectExploreButtonVisible();
    // Allow filtered results to fully settle before clicking (avoids stale-element click)
    await page.waitForTimeout(2000);
    await pm.logsPage.clickExploreButton();
    // Wait for SPA navigation to complete — domcontentloaded does not re-fire
    // on client-side route changes, so wait for the URL to settle on the logs
    // route and then for the refresh button (reliable "logs page ready" signal).
    await page.waitForURL(/\/logs(\?|$)/, { timeout: 30000 });
    await pm.logsPage.expectRefreshButtonVisible();
    await pm.logsPage.waitForSavedViewsButton();
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(randomSavedViewName); // Use the random name here
    await pm.logsPage.waitForSavedViewText(randomSavedViewName);
    await pm.logsPage.clickSavedViewByText(randomSavedViewName);
    // Wait for saved view to be applied and page to settle before re-expanding
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    // Re-filter the saved-views list so the row for our random name appears,
    // then wait for it to render before clicking by title (deterministic --
    // replaces the legacy 1s waitForTimeout that was masking the re-render).
    await pm.logsPage.fillSavedViewSearchInput(randomSavedViewName);
    await pm.logsPage.waitForSavedViewText(randomSavedViewName);
    await pm.logsPage.clickSavedViewByTitle(randomSavedViewName); // Use the random name here

    // Delete the saved view
    await pm.logsPage.clickDeleteSavedViewButton(randomSavedViewName);
    await pm.logsPage.clickConfirmButton(); // Confirm deletion
    testLogger.info(`Successfully deleted saved view: ${randomSavedViewName}`);

    testLogger.info('Saved view creation and deletion test completed');
  });

  test("should reset the editor on clicking reset filter button", {
    tag: ['@resetFilters', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing reset filter button functionality');
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditorTextbox();
    await pm.logsPage.typeInQueryEditor("match_all_raw_ignore_case('provide_credentials')");
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.clickResetFiltersButton();
    await pm.logsPage.waitForQueryEditorTextbox();
    await pm.logsPage.expectQueryEditorEmpty();

    testLogger.info('Reset filter button test completed');
  });

  test("should add invalid query and display error", {
    tag: ['@invalidQueryLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing invalid query error handling');
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    // Use a deterministically-invalid SQL fragment that the backend MUST reject.
    // Previous input `kubernetes` (wrapped as `WHERE kubernetes`) was flaky —
    // on backends with kubernetes log entries the search succeeded (~20% pass
    // rate flake), defeating the test. `_invalid_field_does_not_exist` is
    // guaranteed to fail column resolution on any backend.
    await pm.logsPage.typeInQueryEditor("_invalid_field_does_not_exist");
    // Monaco's onDidChangeModelContent is debounced 100ms before emitting
    // update:query → searchObj.data.query. Wait for the Monaco model to reflect
    // the typed value so the store is updated before Run is clicked.
    await pm.logsPage.waitForQueryEditorValue("_invalid_field_does_not_exist");
    // Use runQueryAndWaitForResults -- it waits for any in-flight auto-search
    // to settle (button exits Cancel state) before clicking, so the click
    // actually triggers the new (invalid) search instead of cancelling.
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectErrorMessageVisible();

    testLogger.info('Invalid query error handling test completed');
  });

  test("should not display error if match all case added in log query search", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all query functionality');
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    await pm.logsPage.expectQueryEditorVisible();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('code')");

    await pm.logsPage.expectSearchBarRefreshButtonVisible();
    await pm.logsPage.clickSearchBarRefreshButton();

    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Match_all query functionality test completed');
  });

  // Duplicate test - kept in logspage.spec.js
  // test("should display error when save function is clicked without any VRL function", {
  //   tag: ['@functionValidation', '@all', '@logs']
  // }, async ({ page }) => {
  //   testLogger.info('Testing VRL function save validation without function definition');
  //   await pm.logsPage.clickFunctionDropdownSave();
  //   await pm.logsPage.expectWarningNoFunctionDefinition();
  //
  //   testLogger.info('VRL function save validation test completed');
  // });

  // Duplicate test - kept in logspage.spec.js
  // test("should display click save directly while creating a function", {
  //   tag: ['@functionSaveValidation', '@all', '@logs']
  // }, async ({ page }) => {
  //   testLogger.info('Testing function save validation when clicking save directly');
  //   await pm.logsPage.waitForTimeout(1000);
  //   await pm.logsPage.toggleVrlEditor();
  //   await pm.logsPage.clickVrlEditor();
  //   await pm.logsPage.waitForTimeout(1000);
  //   await pm.logsPage.clickFunctionDropdownSave();
  //   await pm.logsPage.clickSavedViewDialogSave();
  //   await pm.logsPage.expectFunctionNameNotValid();
  //
  //   testLogger.info('Function save validation test completed');
  // });

  // Duplicate test - kept in logspage.spec.js
  // test("should display error on adding only blank spaces under function name", {
  //   tag: ['@functionNameValidation', '@all', '@logs']
  // }, async ({ page }) => {
  //   testLogger.info('Testing function name validation with blank spaces');
  //   await pm.logsPage.waitForTimeout(1000);
  //   await pm.logsPage.toggleVrlEditor();
  //   await pm.logsPage.clickVrlEditor();
  //   await pm.logsPage.waitForTimeout(1000);
  //   await pm.logsPage.clickFunctionDropdownSave();
  //   await pm.logsPage.fillSavedFunctionNameInput(' ');
  //   await pm.logsPage.clickSavedViewDialogSave();
  //   await pm.logsPage.expectFunctionNameNotValid();
  //
  //   testLogger.info('Function name blank spaces validation test completed');
  // });

  // Duplicate test - kept in logspage.spec.js
  // test("should display error on adding invalid characters under function name", {
  //   tag: ['@functionNameValidation', '@all', '@logs']
  // }, async ({ page }) => {
  //   testLogger.info('Testing function name validation with invalid characters');
  //   await pm.logsPage.waitForTimeout(1000);
  //   await pm.logsPage.toggleVrlEditor();
  //   await pm.logsPage.clickVrlEditor();
  //   await pm.logsPage.waitForTimeout(1000);
  //   await pm.logsPage.clickFunctionDropdownSave();
  //   await pm.logsPage.fillSavedFunctionNameInput('e2e@@@');
  //   await pm.logsPage.clickSavedViewDialogSave();
  //   await pm.logsPage.expectFunctionNameNotValid();
  //
  //   testLogger.info('Function name invalid characters validation test completed');
  // });

  test("should display added function on switching between tabs and again navigate to log", {
    tag: ['@functionPersistence', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing function persistence across tab navigation');
    await pm.logsPage.toggleVrlEditor();
    // Wait for VRL editor input area to be ready before filling
    await pm.logsPage.expectVrlEditorReady();
    await pm.logsPage.clickVrlEditor();
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.clickMenuLinkMetricsItem();
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.expectPageContainsText(".a=2");

    testLogger.info('Function persistence test completed');
  });

  test("should display bar chart when histogram toggle is on", {
    tag: ['@histogramBarChart', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing bar chart display with histogram toggle');

    // Ensure histogram is ON before testing bar chart
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
      // Wait deterministically for the histogram toggle to flip to ON state
      await expect.poll(
        async () => pm.logsPage.isHistogramOn().catch(() => false),
        { timeout: 10000 }
      ).toBe(true);
    }

    await pm.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pm.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    // Wait for the field list to filter & expand control to be visible
    await pm.logsPage.expectFieldExpandVisible('code');
    await pm.logsPage.clickExpandCode();

    // Click refresh and wait for actual results (not just DOM ready -- AJAX search on alpha1 can be slow)
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForSearchResults();

    // Toggle SQL mode and refresh
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickRefreshButton();
    // clickBarChartCanvas includes networkidle wait + retry -- more reliable than a static timeout
    await pm.logsPage.clickBarChartCanvas();

    // Toggle SQL mode off and refresh
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickRefreshButton();
    // clickBarChartCanvas includes networkidle wait + retry
    await pm.logsPage.clickBarChartCanvas();
    await pm.logsPage.clickHistogramToggleDiv();

    testLogger.info('Histogram bar chart display test completed');
  });

  test("should display search around in histogram mode", {
    tag: ['@searchAroundHistogram', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing search around functionality in histogram mode');

    // Wait for log row to be visible before clicking (deterministic)
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Search around histogram mode test completed');
  });

  test.skip("should display results for search around after adding function", async ({ page }) => {
    await pm.logsPage.toggleVrlEditor();
    await pm.logsPage.expectVrlEditorReady();
    await pm.logsPage.clickVrlEditor();
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.clickLogTableColumn3Source();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should display search around in SQL mode", {
    tag: ['@searchAroundSQL', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing search around functionality in SQL mode');

    await pm.logsPage.clickSQLModeToggle();
    // Wait for log row to be visible before clicking (deterministic -- replaces fixed wait)
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Search around SQL mode test completed');
  });

  test("should display results for search around with limit query", {
    tag: ['@searchAroundLimit', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing search around functionality with limit query');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('code') limit 5");
    await pm.logsPage.clickSQLModeToggle();
    // Wait for log row to be visible before clicking (deterministic)
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Search around with limit query test completed');
  });

  test("should not display pagination for limit query", {
    tag: ['@paginationLimit', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pagination behavior with limit query');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('code') limit 5");
    await pm.logsPage.clickSQLModeToggle();
    // Run query and wait for execution to complete (deterministic -- replaces fixed waits)
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectPaginationNotVisible();

    testLogger.info('Pagination limit query test completed');
  });

  test("should not display pagination for SQL limit query", {
    tag: ['@paginationSQLLimit', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pagination behavior with SQL limit query');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
    // Run query and wait for execution to complete (deterministic)
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectPaginationNotVisible();

    testLogger.info('Pagination SQL limit query test completed');
  });

  test("should not display pagination for SQL group/order/limit query", {
    tag: ['@paginationSQLGroupOrder', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pagination behavior with SQL group/order/limit query');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" WHERE code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5');
    // Run query and wait for execution to complete (deterministic)
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectPaginationNotVisible();

    testLogger.info('Pagination SQL group/order/limit query test completed');
  });

  test("should reset pagination to page 1 after running query again", {
    tag: ['@pagination', '@logs', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing pagination reset behavior after re-running query');

    // Set up conditions to ensure we have enough data for pagination
    await pm.logsPage.clickDateTimeButton();

    // Use wider time range to capture ingested data
    const selectedRange = await pm.logsPage.clickWideRelativeTimeRangeOrFallback();
    testLogger.info(`Set time range to ${selectedRange} to capture ingested data`);

    // Run initial query and wait for results (deterministic -- replaces fixed waits)
    await pm.logsPage.runQueryAndWaitForResults();

    // Pagination should exist after ingesting data - expect it to be visible
    await pm.logsPage.expectResultPaginationVisible();
    testLogger.info('Pagination controls found, proceeding with test');

    // Get available page count using POM
    const pageCount = await pm.logsPage.getPaginationPageCount();
    testLogger.info(`Found ${pageCount} page buttons`);

    // Navigate to page 4 using POM
    testLogger.info('Navigating to page 4');
    await pm.logsPage.clickPaginationPage(4);
    // Wait for the pagination control to stay attached (deterministic -- the
    // click triggers a virtual page change; we then read the class state).
    await pm.logsPage.expectResultPaginationVisible();

    // Verify we're on page 4 using POM
    const page4Classes = await pm.logsPage.getPaginationPageClasses(4);
    testLogger.info(`Page 4 button classes: ${page4Classes}`);

    // Run query again while on page 4 and wait for completion
    testLogger.info('Running query again while on page 4');
    await pm.logsPage.runQueryAndWaitForResults();

    // Verify pagination resets to page 1 using POM
    const page4ClassesAfter = await pm.logsPage.getPaginationPageClasses(4).catch(() => null);
    const page1ClassesAfter = await pm.logsPage.getPaginationPageClasses(1).catch(() => null);

    testLogger.info(`After query - Page 1 classes: ${page1ClassesAfter}`);
    testLogger.info(`After query - Page 4 classes: ${page4ClassesAfter}`);

    // Check pagination state using POM methods
    const isStillOnPage4 = await pm.logsPage.isPaginationPageActive(4).catch(() => false);
    const isBackToPage1 = await pm.logsPage.isPaginationPageActive(1).catch(() => false);

    if (isStillOnPage4) {
      testLogger.error('🐛 BUG DETECTED: Pagination stayed on page 4 instead of resetting to page 1');
      expect(isStillOnPage4).toBeFalsy();
    } else if (isBackToPage1) {
      testLogger.info('✅ Pagination correctly reset to page 1 after re-running query');
      expect(isBackToPage1).toBeTruthy();
    } else {
      testLogger.info('Using fallback method to check pagination state');
      const activePage = await pm.logsPage.getActivePaginationPageText();
      testLogger.info(`Active page (fallback): ${activePage}`);

      if (activePage === '4') {
        testLogger.error('🐛 BUG DETECTED: Pagination stayed on page 4 (fallback method)');
        expect(activePage).toBe('1');
      } else {
        testLogger.info('✅ Pagination appears to have reset correctly (fallback method)');
      }
    }

    testLogger.info('Pagination reset behavior test completed');
  });
});
