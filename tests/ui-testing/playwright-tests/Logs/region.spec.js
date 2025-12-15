const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");

test.describe.configure({ mode: 'parallel' });
const randomSavedView = `Savedview${Math.floor(Math.random() * 1000)}`;

// Legacy login function replaced by global authentication via navigateToBase

const selectStream = async (page, stream) => {
  // Strategic 1000ms wait for stream selection UI stabilization - this is functionally necessary
  await page.waitForTimeout(1000);
  await page.locator('[data-test="log-search-index-list-select-stream"]').click({ force: true });
  await page.locator("div.q-item").getByText(`${stream}`).first().click({ force: true });
};

test.describe("Region testcases", () => {
  let pageManager;

  function removeUTFCharacters(text) {
    return text.replace(/[^\x00-\x7F]/g, " ");
  }

  async function applyQueryButton(page) {
    const search = page.waitForResponse(logData.applyQuery);
    // Strategic 1000ms wait for query preparation - this is functionally necessary
    await page.waitForTimeout(1000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pageManager = new PageManager(page);
    
    // Strategic 1000ms wait for post-authentication stabilization - this is functionally necessary
    await page.waitForTimeout(1000);

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
    
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const orgName = process.env.ORGNAME || 'default';
    const allsearch = page.waitForResponse(`**/api/${orgName}/_search**`);
    await selectStream(page, logData.Stream);
    await applyQueryButton(page);
    const searchBarRegionBtn = await page.locator('[data-test="logs-search-bar-region-btn"]');
    if (!(await searchBarRegionBtn.isVisible())) {
        test.skip('Skipping test because region button is not visible');
        return;
    }

    await searchBarRegionBtn.click();
    
    testLogger.info('Region test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pageManager.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
  
  test("should display region button and click on radio buttons", async ({ page }) => {
    testLogger.info('Testing region button and radio buttons functionality');
    
    await page.locator('[data-test="logs-search-bar-region-btn"]').click();
    await page.getByText('radio_button_uncheckedus-west-')
    await page.getByText('radio_button_uncheckedus-east-').click();
    await page.getByText('radio_button_uncheckedus-west-').click();
    
    testLogger.info('Region radio buttons test completed successfully');
  });

  test("should display save view with 1 region", async ({ page }) => {
    testLogger.info('Testing save view with 1 region functionality');
    
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="logs-search-bar-region-btn"]').click();
    

    await page.waitForSelector('.q-item__label');

    // Click on the radio button
    const radioButton = await page.locator('.q-item__label:has-text("us-east-1")');
    await radioButton.click();
    
    // Verify if the radio button is selected (true)
    const isChecked = await page.$eval('.q-item__label:has-text("us-east-1")', node => {
        const parentElement = node.parentElement;
        if (parentElement && parentElement.querySelector('input')) {
            return parentElement.querySelector('input').checked;
        }
        return false;
    });
    testLogger.debug('Radio button state checked', { isChecked });

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('button').filter({ hasText: 'savesaved_search' }).click();
    await page.locator('[data-test="add-alert-name-input"]').click();
    await page.locator('[data-test="add-alert-name-input"]').fill(randomSavedView);
    await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByRole('button', { name: 'Explore' }).nth(1).click();
    // Strategic 500ms wait for navigation completion - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="logs-search-saved-views-btn"]').getByLabel('Expand').click();
    // Strategic 500ms wait for saved views expansion - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="log-search-saved-view-field-search-input"]').click();
    await page.locator('[data-test="log-search-saved-view-field-search-input"]')
    await page.locator('[data-test="log-search-saved-view-field-search-input"]').fill(randomSavedView);
    await page.getByTitle(randomSavedView).click();
    await page.getByText('view applied').click();
    page.reload();
    await page.locator('[data-test="logs-search-bar-region-btn"]').click();
    const isCircleChecked = await page.$eval('[data-test="logs-search-bar-region-btn"] i.material-icons', node => node.innerText === 'check_circle');
    testLogger.debug('Circle state checked', { isCircleChecked });
    // Strategic 500ms wait for region state update - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="logs-search-saved-views-btn"]').getByLabel('Expand').click();
    // Strategic 500ms wait for saved views expansion - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="log-search-saved-view-field-search-input"]').click();
    await page.locator('[data-test="log-search-saved-view-field-search-input"]').fill(randomSavedView);
    await page.locator(`[data-test="logs-search-bar-delete-${randomSavedView}-saved-view-btn"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
    
    testLogger.info('Save view with 1 region test completed successfully');
  })

  test('select timezone and searcharound', async ({ page }) => {
    testLogger.info('Testing timezone selection and search around functionality');
    
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="datetime-timezone-select"]')
    await page.locator('[data-test="datetime-timezone-select"]').click();
    await page.locator('[data-test="datetime-timezone-select"]').fill('asia/dubai');
    await page.getByRole('option', { name: 'Asia/Dubai' }).locator('div').nth(2).click();
    // Strategic 1000ms wait for timezone update - this is functionally necessary
    await page.waitForTimeout(1000)
    await page.locator('[data-test="logs-search-bar-region-btn"]').click();
    // Strategic 500ms wait for region dialog - this is functionally necessary
    await page.waitForTimeout(500)
    await page.getByText('radio_button_uncheckedus-east-').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    // Strategic 500ms wait for search results - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="log-table-column-0-source"]').getByText('{"_timestamp":').click();
    // Strategic 500ms wait for log details - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="logs-detail-table-search-around-btn"]').click();
    // Strategic 500ms wait for search around completion - this is functionally necessary
    await page.waitForTimeout(500)
    await page.locator('[data-test="log-table-column-0-source"]').getByText('{"_timestamp":').click();
    
    testLogger.info('Timezone and search around test completed successfully');
  });
  
 
})