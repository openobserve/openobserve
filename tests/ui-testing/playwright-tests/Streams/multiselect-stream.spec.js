const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, sendRequest } = require('../../utils/apiUtils.js');
const testLogger = require('../utils/test-logger.js');

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
    
    // Navigate to logs via home
    await pageManager.logsPage.navigateToHome();
    await pageManager.logsPage.navigateToLogs();
    await page.waitForTimeout(2000);
    
    // Add second stream
    await pageManager.logsPage.fillStreamFilter('e2e_stream1');
    await page.waitForTimeout(2000);
    await pageManager.logsPage.toggleStreamSelection('e2e_stream1');
    await page.waitForTimeout(4000);

    // Click all fields and enable function editor
    await pageManager.logsPage.clickAllFields();
    await pageManager.logsPage.toggleQueryMode();
    await pageManager.logsPage.clickMonacoEditor();
    
    // Verify Common Group Fields are present
    const cell = await pageManager.logsPage.getCellByName(/Common Group Fields/);
    const cellText = await cell.textContent();
    expect(cellText).toContain('Common Group Fields');
  
    // Select both streams
    await pageManager.logsPage.clickCellByName(/E2e_automate/);
    await pageManager.logsPage.clickCellByName(/E2e_stream1/);
    
    // Apply query and set time range
    await pageManager.logsPage.applyQuery();
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.selectRelative6Hours();
    await pageManager.logsPage.clickTimestampColumnMenu();
  }
  

  test("should add a function and display it in streams", async ({ page }) => {
    const pageManager = new PageManager(page);
    await multistreamselect(page);
    
    // Fill monaco editor with function
    await pageManager.logsPage.fillMonacoEditor('.a=2');
    await page.waitForTimeout(1000);
    
    await applyQueryButton(page);
    await pageManager.logsPage.clickTableExpandMenu();
    
    // Verify function is applied
    await expect(page.locator("text=.a=2")).toBeVisible();
    await expect(page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible();
    await pageManager.logsPage.applyQuery();
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

  test("should redirect to logs after clicking on stream explorer via stream page", async ({
    page,
  }) => {
    const pageManager = new PageManager(page);
    await multistreamselect(page);
    
    // Navigate to streams page
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.navigateToStreams();
    await page.waitForTimeout(1000);
    await pageManager.logsPage.navigateToStreamsAlternate();
    
    // Search for stream and explore
    await pageManager.logsPage.searchStream("e2e");
    await page.waitForTimeout(1000);
    await pageManager.logsPage.clickExploreButton();
    await page.waitForTimeout(1000);
    
    await expect(page.url()).toContain("logs");
  });

    // This is flicky, sometimes we get first record from stream1 and sometimes from e2e_automate
  test.skip("should click on interesting fields icon and display query in editor", async ({
    page,
  }) => {
    const pageManager = new PageManager(page);
    await multistreamselect(page);
    
    // Search and click interesting field
    await pageManager.logsPage.fillIndexFieldSearch("job");
    await page.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("job");
    
    // Toggle SQL mode and refresh
    await pageManager.logsPage.toggleSqlMode();
    await page.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    
    // Click on source column
    await pageManager.logsPage.clickLogTableColumnSource();
    await expect(page.locator('text=arrow_drop_downjob:test').first()).toBeVisible();
  });

  test("should display results in selected time when multiple stream selected", async ({
    page,
  }) => {
    const pageManager = new PageManager(page);
    await multistreamselect(page);
    await pageManager.logsPage.setDateTimeToToday(); 
    await expect(page.locator('[data-test="logs-search-index-list"]')).toContainText('e2e_automate, e2e_stream1');
  });

  test("should not show error when histogram toggle is on with multiple streams @multi-histogram @multistream @regression", async ({
    page,
  }) => {
    const pageManager = new PageManager(page);
    
    // Select multiple streams using POM
    await pageManager.logsPage.navigateToLogs();
    await page.waitForTimeout(2000);
    
    // Select first stream
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.applyQuery();
    
    // Select additional stream
    await pageManager.logsPage.fillStreamFilter("e2e_stream1");
    await page.waitForTimeout(2000);
    await pageManager.logsPage.toggleStreamSelection("e2e_stream1");
    await page.waitForTimeout(4000);
    
    // Click All Fields and enable function editor
    await pageManager.logsPage.clickAllFields();
    await pageManager.logsPage.toggleQueryMode();
    await pageManager.logsPage.clickMonacoEditor();
    
    // Enable histogram using POM - ensure it's actually enabled
    await pageManager.logsPage.clickHistogramToggle();
    await pageManager.logsPage.clickHistogramToggle(); // Double click to ensure ON state
    
    await pageManager.logsPage.applyQuery();
    await page.waitForTimeout(3000);
    
    // Verify no histogram error is displayed
    await expect(page.getByText('Error while fetching')).not.toBeVisible();
  });
})
