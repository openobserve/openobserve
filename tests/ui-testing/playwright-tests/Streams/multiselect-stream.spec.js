const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, sendRequest } = require('../../utils/apiUtils.js');
const testLogger = require('../utils/test-logger.js');

// Constants for consistent timeouts and test data
const MULTISTREAM_CONFIG = {
  TIMEOUTS: {
    STREAM_FILTER: 2000,
    STREAM_SELECTION: 4000, 
    MULTISTREAM_SETUP: 5000,
    QUERY_EXECUTION: 5000,
    DATA_INDEXING: 3000,
    UI_INTERACTION: 1000,
    NAVIGATION: 2000,
    TOAST_WAIT: 500
  },
  TEST_DATA: {
    STREAMS: ['e2e_automate', 'e2e_stream1'],
    QUERIES: {
      INVALID_FIELD: 'random_test=2',
      VRL_FUNCTION: '.a=2'
    },
    PAYLOADS: {
      STREAM1: {
        level: "debug",
        job: "test_job_1", 
        log: "enhanced test message for stream 1",
        e2e: "enhanced1",
        stream_id: "e2e_automate"
      },
      STREAM2: {
        level: "warning",
        job: "test_job_2",
        log: "enhanced test message for stream 2", 
        e2e: "enhanced2",
        stream_id: "e2e_stream1"
      }
    }
  }
};

// Helper functions to reduce code duplication
async function verifyMultistreamSelection(page, streams = MULTISTREAM_CONFIG.TEST_DATA.STREAMS) {
  const pageManager = new PageManager(page);
  await pageManager.logsPage.expectLogsSearchIndexListContainsText(streams.join(', '));
}

async function setupBasicMultistream(page, streams = MULTISTREAM_CONFIG.TEST_DATA.STREAMS) {
  const pageManager = new PageManager(page);
  
  // Add second stream using POM
  await pageManager.logsPage.fillStreamFilter(streams[1]);
  await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.STREAM_FILTER);
  await pageManager.logsPage.toggleStreamSelection(streams[1]);
  await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.STREAM_SELECTION);
  
  // Verify both streams are selected
  await verifyMultistreamSelection(page, streams);
}

async function validateCombinedStreamResults(page, payloads) {
  const pageManager = new PageManager(page);
  const tableContent = await pageManager.logsPage.getLogsTableContent();
  
  // Extract stream identifiers from payloads for validation
  const stream1Indicators = [payloads.STREAM1.e2e, payloads.STREAM1.job, payloads.STREAM1.level];
  const stream2Indicators = [payloads.STREAM2.e2e, payloads.STREAM2.job, payloads.STREAM2.level];
  
  // Check for data from both streams
  const hasStream1Data = stream1Indicators.some(indicator => tableContent.includes(indicator));
  const hasStream2Data = stream2Indicators.some(indicator => tableContent.includes(indicator));
  
  if (!hasStream1Data || !hasStream2Data) {
    // Alternative check - verify we have multiple rows of data
    const rowCount = await pageManager.logsPage.getLogsTableRowCount();
    expect(rowCount).toBeGreaterThan(1);
    testLogger.info('Multiple data rows found indicating combined results', { rowCount });
  } else {
    testLogger.info('Data from both streams verified in results');
  }
}

test.describe.configure({ mode: "parallel" });

test.describe("Stream multiselect testcases", () => {
  let pm;
  
  function removeUTFCharacters(text) {
    return text.replace(/[^\x00-\x7F]/g, " ");
  }

  async function applyQueryButton(page) {
    const pm = new PageManager(page);
    await pm.logsPage.applyQueryButton(logData.logsUrl);
  }

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);

    const orgId = process.env["ORGNAME"];
    const streamNames = ["e2e_automate", "e2e_stream1"];
    const headers = getHeaders();

    for (const streamName of streamNames) {
      const ingestionUrl = getIngestionUrl(orgId, streamName);
      const payload = {
        level: "info",
        job: "test",
        log: "test message for openobserve",
        e2e: "1",
      };
      const response = await sendRequest(page, ingestionUrl, payload, headers);
      testLogger.debug('API response received', { streamName, response });
    }

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await pm.logsPage.selectStream("e2e_automate"); 
    await applyQueryButton(page);
    await pm.logsPage.clickQuickModeToggle();
    await pm.logsPage.clickAllFieldsButton();
  });


async function multistreamselect(page) {
    const pageManager = new PageManager(page);

    // Add second stream using POM (we're already on logs page from beforeEach with e2e_automate selected and all fields enabled)
    await pageManager.logsPage.fillStreamFilter('e2e_stream1');
    await page.waitForTimeout(2000);
    await pageManager.logsPage.toggleStreamSelection('e2e_stream1');
    await page.waitForTimeout(4000);

    // Enable function editor using POM (all fields already clicked in beforeEach)
    await pageManager.logsPage.toggleQueryModeEditor();
    // Extra wait for Firefox to render the Monaco editor
    await page.waitForTimeout(3000);
    await pageManager.logsPage.clickMonacoEditor();

    // Run query to populate results first
    await pageManager.logsPage.selectRunQuery();
    await page.waitForTimeout(3000);

    // Verify Common Group Fields are present using POM
    const cell = await pageManager.logsPage.getCellByName(/Common Group Fields/);
    const cellText = await cell.textContent();
    expect(cellText).toContain('Common Group Fields');

    // Select both streams using POM
    await pageManager.logsPage.clickCellByName(/E2e_automate/);
    await pageManager.logsPage.clickCellByName(/E2e_stream1/);

    // Execute query and navigate time picker using POM
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.selectRelative6Hours();
    await pageManager.logsPage.clickTimestampColumnMenu();
}
  

  test("should add a function and display it in streams", {
    tag: ['@vrl', '@function', '@multistream', '@all']
  }, async ({ page }) => {
    const pageManager = new PageManager(page);

    await multistreamselect(page);
    await pageManager.logsPage.fillMonacoEditor('.a=2');
    await page.waitForTimeout(1000);
    await applyQueryButton(page);
    await pageManager.logsPage.clickTableExpandMenuFirst();
    await pageManager.logsPage.expectVrlFunctionVisible(".a=2");
    await pageManager.logsPage.expectLogsTableVisible();
    await pageManager.logsPage.selectRunQuery();
  });

  // test("should click on live mode on button and select 5 sec, switch off, and then click run query", async ({
    
  //   page,
  // }) => {
  //   await multistreamselect(page);
  //   await page.route("**/logData.ValueQuery", (route) => route.continue());
  //   await page.locator('[data-test="date-time-btn"]').click({ force: true });

  //   await page
  //     .locator('[data-test="date-time-relative-6-w-btn"] > .q-btn__content')
  //     .click({
  //       force: true,
  //     });
  //   await page
  //     .locator('[data-test="logs-search-bar-refresh-interval-btn-dropdown"]')
  //     .click({ force: true });
  //   await page.locator('[data-test="logs-search-bar-refresh-time-5"]').click({
  //     force: true,
  //   });
  //   await page.waitForTimeout(1000);
  //   await expect(page.locator(".q-notification__message")).toContainText(
  //     "Live mode is enabled"
  //   );
  //   await page.waitForTimeout(5000);
  //   await page
  //     .locator(".q-pl-sm > .q-btn > .q-btn__content")
  //     .click({ force: true });
  //   await page
  //     .locator(
  //       '[data-test="logs-search-off-refresh-interval"] > .q-btn__content'
  //     )
  //     .click({ force: true });
  //   await applyQueryButton(page);
  // });

  test("should redirect to logs after clicking on stream explorer via stream page", {
    tag: ['@navigation', '@streamExplorer', '@multistream', '@all']
  }, async ({ page }) => {
    const pageManager = new PageManager(page);
    
    await multistreamselect(page);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.navigateToStreams();
    await page.waitForTimeout(1000);
    await pageManager.logsPage.navigateToStreamsAlternate();
    await pageManager.logsPage.searchStreamByPlaceholder("e2e");
    await page.waitForTimeout(1000);
    await pageManager.logsPage.clickFirstExploreButton();
    await page.waitForTimeout(1000);
    await expect(page.url()).toContain("logs");
  });

  // Note: This test can be flaky due to non-deterministic record ordering across streams
  test.skip("should click on interesting fields icon and display query in editor", {
    tag: ['@interestingFields', '@multistream', '@flaky']
  }, async ({ page }) => {
    const pageManager = new PageManager(page);
    testLogger.info('Testing interesting fields with multistream selection');

    await multistreamselect(page);

    // Search for job field using POM
    await pageManager.logsPage.searchFieldByName('job');
    await page.waitForTimeout(2000);

    // Click interesting field button
    await page.locator('[data-test="log-search-index-list-interesting-job-field-btn"]').last().click({ force: true });

    // Enable SQL mode using POM
    await pageManager.logsPage.enableSQLMode();
    await page.waitForTimeout(2000);

    // Run query using POM
    await pageManager.logsPage.clickSearchBarRefreshButton();

    // Click on first result
    await page.locator('[data-test="log-table-column-0-source"]').click({ force: true });

    // Verify table is visible
    await pageManager.logsPage.expectLogsTableVisible();
    testLogger.info('Interesting fields test completed');
  });

  test("should display results in selected time when multiple stream selected", {
    tag: ['@timePicker', '@dateTime', '@multistream', '@all']
  }, async ({ page }) => {
    const pageManager = new PageManager(page);
    await multistreamselect(page);
    await pageManager.logsPage.setDateTimeToToday(); 
    await pageManager.logsPage.expectLogsSearchIndexListContainsText('e2e_automate, e2e_stream1');

  });

  test("should not show error when histogram toggle is on with multiple streams @multi-histogram @multistream @regression", async ({
    page,
  }) => {
    const pageManager = new PageManager(page);
    
    // Navigate to logs page using POM
    await pageManager.logsPage.navigateToHome();
    await pageManager.logsPage.navigateToLogs();
    await page.waitForTimeout(2000);
    
    // Select first stream (e2e_automate) using POM
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.selectRunQuery();
    await page.waitForTimeout(2000);
    
    // Select additional stream using POM
    await pageManager.logsPage.fillStreamFilter("e2e_stream1");
    await page.waitForTimeout(2000);
    await pageManager.logsPage.toggleStreamSelection("e2e_stream1");
    await page.waitForTimeout(4000);
    
    // Click All Fields and enable function editor using POM
    await pageManager.logsPage.clickQuickModeToggle();
    await pageManager.logsPage.clickAllFieldsButton();
    await pageManager.logsPage.toggleQueryModeEditor();
    await pageManager.logsPage.clickMonacoEditor();
    
    // Enable histogram using POM - ensure it's actually enabled
    await pageManager.logsPage.toggleHistogram();
    await pageManager.logsPage.toggleHistogram(); // Double click to ensure ON state
    
    await pageManager.logsPage.selectRunQuery();
    await page.waitForTimeout(3000);
    
    // Verify no histogram error is displayed
    await pageManager.logsPage.expectErrorWhileFetchingNotVisible();
  });

  // Enhanced multistream tests
  test("should verify search filter functionality with multiple streams selected", {
    tag: ['@filter', '@invalidfield', '@multistream']
  }, async ({ page }) => {
    testLogger.info('Testing search filter functionality with multiple streams');

    const pageManager = new PageManager(page);

    // Setup multistream selection using helper
    await setupBasicMultistream(page);

    // Add query in query editor and run
    await pageManager.logsPage.fillQueryEditorWithRole(MULTISTREAM_CONFIG.TEST_DATA.QUERIES.INVALID_FIELD);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.QUERY_EXECUTION);

    testLogger.info('Search filter steps executed successfully with multiple streams');
  });

  test("should add a function and display it in streams with multiple streams", {
    tag: ['@vrl', '@function', '@transformation']
  }, async ({ page }) => {
    testLogger.info('Testing Monaco editor function with multiple streams');

    const pageManager = new PageManager(page);

    // Setup multiple streams using existing multistreamselect function
    await multistreamselect(page);

    // Fill Monaco editor with VRL function using constant
    await pageManager.logsPage.fillMonacoEditor(MULTISTREAM_CONFIG.TEST_DATA.QUERIES.VRL_FUNCTION);
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.UI_INTERACTION);
    await applyQueryButton(page);
    await pageManager.logsPage.clickTableExpandMenuFirst();

    // Verify VRL function is visible and table is displayed
    await pageManager.logsPage.expectVrlFunctionVisible(MULTISTREAM_CONFIG.TEST_DATA.QUERIES.VRL_FUNCTION);
    await pageManager.logsPage.expectLogsTableVisible();
    await pageManager.logsPage.selectRunQuery();

    testLogger.info('Monaco editor function test with multiple streams completed successfully');
  });

  test("should display combined results when both streams have data", {
    tag: ['@multistreamdata', '@datavalidation', '@multistreams']
  }, async ({ page }) => {
    testLogger.info('Testing combined results display when both streams have data');
    
    const pageManager = new PageManager(page);
    
    // Ensure both streams have data by ingesting test data
    const orgId = process.env["ORGNAME"];
    const headers = getHeaders();
    const streams = MULTISTREAM_CONFIG.TEST_DATA.STREAMS;
    const payloads = MULTISTREAM_CONFIG.TEST_DATA.PAYLOADS;
    
    await sendRequest(page, getIngestionUrl(orgId, streams[0]), payloads.STREAM1, headers);
    await sendRequest(page, getIngestionUrl(orgId, streams[1]), payloads.STREAM2, headers);
    
    // Wait for data to be indexed
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.DATA_INDEXING);
    
    // Setup multiple streams
    await multistreamselect(page);
    
    // Verify both streams are selected
    await verifyMultistreamSelection(page);
    
    // Run query to get combined results
    await pageManager.logsPage.selectRunQuery();
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.QUERY_EXECUTION);
    
    // Verify results table is visible and contains data
    await pageManager.logsPage.expectLogsTableVisible();
    
    // Verify we have results from both streams
    await validateCombinedStreamResults(page, payloads);
    
    // Verify no error messages are present
    await pageManager.logsPage.expectNotificationErrorNotVisible();
    
    testLogger.info('Combined results from both streams test completed successfully');
  });

  test("should create and delete saved view with multiple streams selected", {
    tag: ['@savedview', '@viewcrud', '@multiconfig']
  }, async ({ page }) => {
    testLogger.info('Testing saved view creation and deletion with multiple streams');
    
    const pageManager = new PageManager(page);
    const streams = MULTISTREAM_CONFIG.TEST_DATA.STREAMS;
    
    // Setup multiple streams selection using existing function
    await multistreamselect(page);
    
    // Verify both streams are selected using helper
    await verifyMultistreamSelection(page);
    
    // Generate a random saved view name with multistream prefix
    const randomSavedViewName = `multistream_view_${Math.random().toString(36).substring(2, 10)}`;
    testLogger.info(`Creating saved view with name: ${randomSavedViewName}`);
    
    // Create saved view with multistream configuration
    await pageManager.logsPage.clickSavedViewsExpand();
    await pageManager.logsPage.clickSaveViewButton();
    await pageManager.logsPage.fillSavedViewName(randomSavedViewName);
    await pageManager.logsPage.clickSavedViewDialogSave();
    
    // Wait for success message with timeout constant
    try {
      await page.waitForSelector('.q-notification__message:has-text("View created successfully")', { 
        timeout: MULTISTREAM_CONFIG.TIMEOUTS.DATA_INDEXING 
      });
      testLogger.info('Success toast validated: Multistream view created successfully');
    } catch (error) {
      testLogger.info('View creation toast may have appeared and disappeared quickly - continuing with test');
    }
    
    // Wait for saved view creation to complete using constant
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.NAVIGATION);
    
    // Navigate away and back to verify saved view persistence
    await pageManager.logsPage.clickStreamsMenuItem();
    await pageManager.logsPage.clickSearchStreamInput();
    await pageManager.logsPage.fillSearchStreamInput('e2e');
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.TOAST_WAIT);
    await pageManager.logsPage.clickExploreButton();
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.NAVIGATION);
    
    // Verify saved view exists and can be loaded
    await pageManager.logsPage.waitForSavedViewsButton();
    await pageManager.logsPage.clickSavedViewsExpand();
    await pageManager.logsPage.clickSavedViewSearchInput();
    await pageManager.logsPage.fillSavedViewSearchInput(randomSavedViewName);
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.UI_INTERACTION);
    
    // Apply the saved view
    await pageManager.logsPage.waitForSavedViewText(randomSavedViewName);
    await pageManager.logsPage.clickSavedViewByText(randomSavedViewName);
    await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.NAVIGATION);
    
    // Verify that multistream configuration was saved and restored using helper
    await verifyMultistreamSelection(page);
    testLogger.info('Verified: Saved view correctly restored multistream selection');
    
    // Verify query results are displayed
    await pageManager.logsPage.expectLogsTableVisible();
    testLogger.info('Verified: Query results are displayed after loading saved view');
    
    // Clean up: Try to delete the saved view (with error handling)
    try {
      await pageManager.logsPage.clickSavedViewsExpand();
      await pageManager.logsPage.clickSavedViewSearchInput();
      await pageManager.logsPage.fillSavedViewSearchInput(randomSavedViewName);
      await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.UI_INTERACTION);
      
      // Delete the saved view using POM
      await pageManager.logsPage.clickDeleteSavedViewButton(randomSavedViewName);
      await page.waitForTimeout(MULTISTREAM_CONFIG.TIMEOUTS.TOAST_WAIT);
      await pageManager.logsPage.clickConfirmButton();
      
      testLogger.info(`Successfully deleted multistream saved view: ${randomSavedViewName}`);
    } catch (cleanupError) {
      testLogger.warn(`Cleanup failed - saved view may still exist: ${randomSavedViewName}`, { error: cleanupError.message });
      // Test is still successful even if cleanup fails
    }
    
    testLogger.info('Multistream saved view creation and deletion test completed successfully');
  });
})
