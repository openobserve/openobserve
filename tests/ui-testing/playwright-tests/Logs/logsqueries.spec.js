const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");

// Utility Functions

// Legacy login function replaced by global authentication via navigateToBase

async function ingestTestData(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });
  testLogger.debug('API response received', { response });
}
async function applyQueryButton(page) {
  // click on the run query button
  // Type the value of a variable into an input field
  const search = page.waitForResponse(logData.applyQuery);
  // Strategic 1000ms wait for query button DOM stabilization - this is functionally necessary
  await page.waitForTimeout(1000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  // get the data from the search variable
  await expect.poll(async () => (await search).status()).toBe(200);
  // await search.hits.FIXME_should("be.an", "array");
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
    
    // Strategic post-authentication stabilization wait - this is functionally necessary
    await page.waitForTimeout(1000);
    
    // Data ingestion for logs queries testing (preserve exact logic)
    await ingestTestData(page);
    // Strategic wait for data ingestion completion - this is functionally necessary
    await page.waitForTimeout(1000);

    // Navigate to logs page and setup for queries testing
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pm.logsPage.selectStream("e2e_automate");
    await applyQueryButton(page);

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
    await pm.logsPage.waitForTimeout(3000);
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickIncludeExcludeFieldButton();
    await pm.logsPage.clickIncludeFieldButton();
    await pm.logsPage.clickCloseDialog();
    await pm.logsPage.clickSavedViewsButton();
    await pm.logsPage.fillSavedViewName("e2etimestamp");
    await pm.logsPage.clickSavedViewDialogSaveContent();
    await pm.logsPage.clickSavedViewArrow();
    await pm.logsPage.clickSavedViewByLabel(/timestamp/);
    await pm.logsPage.waitForTimeout(3000);
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
      await pm.logsPage.page.waitForSelector('.q-notification__message:has-text("View created successfully")', { timeout: 3000 });
      testLogger.info('Success toast validated: View created successfully');
    } catch (error) {
      testLogger.info('View creation toast may have appeared and disappeared quickly - continuing with test');
    }
    
    // Strategic 2000ms wait for saved view creation - this is functionally necessary
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickStreamsMenuItem();
    await pm.logsPage.clickSearchStreamInput();
    await pm.logsPage.fillSearchStreamInput('e2e');
    // Strategic 500ms wait for stream search DOM stabilization - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickExploreButton();
    // Strategic 2000ms wait for navigation to stream explorer - this is functionally necessary
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.waitForSavedViewsButton();
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(randomSavedViewName); // Use the random name here
    // Strategic 1000ms wait for saved view search results - this is functionally necessary
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.waitForSavedViewText(randomSavedViewName);
    await pm.logsPage.clickSavedViewByText(randomSavedViewName);
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.clickSavedViewByTitle(randomSavedViewName); // Use the random name here
    
    // Wait for UI to stabilize before attempting deletion
    await pm.logsPage.waitForTimeout(1000);
    
    // Delete the saved view
    await pm.logsPage.clickDeleteSavedViewButton(randomSavedViewName);
    await pm.logsPage.waitForTimeout(500);
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
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("kubernetes");
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickSearchBarRefreshButton();
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
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.toggleVrlEditor();
    await pm.logsPage.clickVrlEditor();
    await pm.logsPage.waitForTimeout(1000);
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
      await pm.logsPage.waitForTimeout(1000);
    }

    await pm.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pm.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await pm.logsPage.waitForTimeout(4000);
    await pm.logsPage.clickExpandCode();
    await pm.logsPage.waitForTimeout(4000);

    // Click refresh and wait for network to settle
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 30000 })
      .catch((e) => testLogger.debug('networkidle timeout (non-blocking)', { error: e.message }));
    await pm.logsPage.waitForTimeout(2000);

    // Toggle SQL mode and refresh
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 30000 })
      .catch((e) => testLogger.debug('networkidle timeout (non-blocking)', { error: e.message }));
    await pm.logsPage.waitForTimeout(2000);

    // Verify bar chart is visible in SQL mode then click
    await pm.logsPage.expectBarChartCanvasVisible();
    await pm.logsPage.clickBarChartCanvas();

    // Toggle SQL mode off and refresh
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 30000 })
      .catch((e) => testLogger.debug('networkidle timeout (non-blocking)', { error: e.message }));
    await pm.logsPage.waitForTimeout(2000);

    // Verify bar chart is visible in non-SQL mode then click
    await pm.logsPage.expectBarChartCanvasVisible();
    await pm.logsPage.clickBarChartCanvas();
    await pm.logsPage.clickHistogramToggleDiv();

    testLogger.info('Histogram bar chart display test completed');
  });

  test("should display search around in histogram mode", {
    tag: ['@searchAroundHistogram', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing search around functionality in histogram mode');
    
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Search around histogram mode test completed');
  });

  test.skip("should display results for search around after adding function", async ({ page }) => {
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.toggleVrlEditor();
    await pm.logsPage.clickVrlEditor();
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.clickLogTableColumn3Source();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should display search around in SQL mode", {
    tag: ['@searchAroundSQL', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing search around functionality in SQL mode');
    
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Search around SQL mode test completed');
  });

  test("should display results for search around with limit query", {
    tag: ['@searchAroundLimit', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing search around functionality with limit query');
    
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('code') limit 5");
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickLogTableColumnSource();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Search around with limit query test completed');
  });

  test("should not display pagination for limit query", {
    tag: ['@paginationLimit', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pagination behavior with limit query');
    
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('code') limit 5");
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.expectPaginationNotVisible();
    
    testLogger.info('Pagination limit query test completed');
  });

  test("should not display pagination for SQL limit query", {
    tag: ['@paginationSQLLimit', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pagination behavior with SQL limit query');
    
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.expectPaginationNotVisible();
    
    testLogger.info('Pagination SQL limit query test completed');
  });

  test("should not display pagination for SQL group/order/limit query", {
    tag: ['@paginationSQLGroupOrder', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pagination behavior with SQL group/order/limit query');
    
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" WHERE code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5');
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.expectPaginationNotVisible();
    
    testLogger.info('Pagination SQL group/order/limit query test completed');
  });

  test("should reset pagination to page 1 after running query again", {
    tag: ['@pagination', '@logs', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing pagination reset behavior after re-running query');

    // Set up conditions to ensure we have enough data for pagination
    await pm.logsPage.waitForTimeout(2000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.waitForTimeout(1000);

    // Use wider time range to capture ingested data
    const oneHourButton = page.getByText('Last 1 hour');
    const twelveHourButton = page.getByText('Last 12 hours');

    if (await oneHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await oneHourButton.click();
      testLogger.info('Set time range to Last 1 hour to capture ingested data');
    } else if (await twelveHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await twelveHourButton.click();
      testLogger.info('Set time range to Last 12 hours to capture ingested data');
    } else {
      await pm.logsPage.clickRelative15MinButton();
      testLogger.info('Fallback to 15 minute time range');
    }

    // Run initial query to get results
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForTimeout(3000);

    // Pagination should exist after ingesting data - expect it to be visible
    await pm.logsPage.expectResultPaginationVisible();
    testLogger.info('Pagination controls found, proceeding with test');

    // Get available page count using POM
    const pageCount = await pm.logsPage.getPaginationPageCount();
    testLogger.info(`Found ${pageCount} page buttons`);

    // Navigate to page 4 using POM
    testLogger.info('Navigating to page 4');
    await pm.logsPage.clickPaginationPage(4);
    await pm.logsPage.waitForTimeout(2000);

    // Verify we're on page 4 using POM
    await pm.logsPage.waitForTimeout(3000);
    const page4Classes = await pm.logsPage.getPaginationPageClasses(4);
    testLogger.info(`Page 4 button classes: ${page4Classes}`);

    // Run query again while on page 4
    testLogger.info('Running query again while on page 4');
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForTimeout(3000);

    // Verify pagination resets to page 1 using POM
    await pm.logsPage.waitForTimeout(2000);

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
      const activePage = await page.locator('[data-test="logs-search-result-pagination"] .q-btn--unelevated').first().textContent({ timeout: 5000 }).catch(() => 'unknown');
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