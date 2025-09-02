const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");

// Legacy login function replaced by global authentication via navigateToBase

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  
  try {
    const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
      const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(logsdata)
      });
      if (!fetchResponse.ok) {
        throw new Error(`HTTP error! status: ${fetchResponse.status}`);
      }
      return await fetchResponse.json();
    }, {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      logsdata: logsdata
    });
    console.log('Ingestion response:', response);
    return response;
  } catch (error) {
    console.error('Ingestion failed:', error);
    throw error;
  }
}

test.describe("Logs Table Field Management", () => {
  let pageManager;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(500);
    await ingestion(page);
    await page.waitForTimeout(500);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForTimeout(1000);
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    
    // Switch off quick mode before starting the test
    // Check if quick mode is on and turn it off
    const quickModeToggle = page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"]');
    const isQuickModeOn = await quickModeToggle.getAttribute('aria-pressed');
    
    if (isQuickModeOn === 'true') {
      await pageManager.logsPage.clickQuickModeToggle();
      await page.waitForTimeout(500);
      testLogger.info('Quick mode turned off');
    } else {
      testLogger.info('Quick mode already off');
    }
    
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await page.waitForTimeout(2000);
    
    testLogger.info('Field management test setup completed');
  });

  test("should add and remove field from table", {
    tag: ['@logsTable', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing add and remove field from logs table');
    
    const fieldName = "kubernetes_container_name";
    
    // Search for field using POM method
    await pageManager.logsPage.fillIndexFieldSearchInput(fieldName);
    await page.waitForTimeout(500);
    
    // Add field to table using POM methods
    await pageManager.logsPage.hoverOnFieldExpandButton(fieldName);
    await pageManager.logsPage.clickAddFieldToTableButton(fieldName);
    
    // Verify field appears in table using POM method
    await pageManager.logsPage.expectFieldInTableHeader(fieldName);
    
    // Remove field from table using POM methods
    await pageManager.logsPage.hoverOnFieldExpandButton(fieldName);
    await pageManager.logsPage.clickRemoveFieldFromTableButton(fieldName);
    
    // Verify field is removed using POM method
    await pageManager.logsPage.expectFieldNotInTableHeader(fieldName);
    
    testLogger.info('Add and remove field test completed successfully');
  });

  test("should persist added field after page refresh", {
    tag: ['@logsTable', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing field persistence after page refresh');
    
    const fieldName = "kubernetes_container_name";
    
    // Search for field using POM method
    await pageManager.logsPage.fillIndexFieldSearchInput(fieldName);
    await page.waitForTimeout(500);
    
    // Add field to table using POM methods
    await pageManager.logsPage.hoverOnFieldExpandButton(fieldName);
    await pageManager.logsPage.clickAddFieldToTableButton(fieldName);
    
    // Verify field appears in table
    await pageManager.logsPage.expectFieldInTableHeader(fieldName);
    testLogger.info('Field added to table successfully');
    
    // Refresh the page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    testLogger.info('Page refreshed');
    
    // Verify field is still visible in table after refresh
    await pageManager.logsPage.expectFieldInTableHeader(fieldName);
    testLogger.info('Field persistence after page refresh verified successfully');
  });

  test.afterEach(async ({ page }) => {
    try {
      await pageManager.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
});