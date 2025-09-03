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
    await page.locator('[data-test="menu-link-\\/-item"]').click();
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill('e2e_stream1');
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-search-index-list-stream-toggle-e2e_stream1"] div').nth(2).click();
    await page.waitForTimeout(4000);

    await page.locator('[data-test="logs-all-fields-btn"]').click();

    //before we click on fn editor we need to turn on the function editor if is toggled off
    await page.locator('[data-test="logs-search-bar-show-query-toggle-btn"] div').first().click();
    await page.locator('#fnEditor').locator('.inputarea').click()
//   await page.locator('[data-test="log-search-index-list-stream-toggle-e2e_stream1"] div').nth(2).click({force:true});
    const cell = await page.getByRole('cell', { name: /Common Group Fields/ });

  // Extract the text content of the cell
    const cellText = await cell.textContent();

  // Verify that the text contains 'Common Group Fields'
  expect(cellText).toContain('Common Group Fields');
  
    await page.getByRole('cell', { name: /E2e_automate/ }).click();
    await page.getByRole('cell', { name: /E2e_stream1/  }).click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-h-btn"]').click();
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]').click();
  }
  

  test("should add a function and display it in streams", async ({ page }) => {
await multistreamselect(page);
await page.locator('#fnEditor').locator('.inputarea').fill('.a=2');
await page.waitForTimeout(1000);
    await applyQueryButton(page);
    await page
      .locator('[data-test="table-row-expand-menu"]')
      .first()
      .click({ force: true });
    await expect(page.locator("text=.a=2")).toBeVisible();
    await expect(
      page.locator('[data-test="logs-search-result-logs-table"]')
    ).toBeVisible();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
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
    await multistreamselect(page);
    await page.locator('[data-test="date-time-btn"]').click({ force: true });
    await page
      .locator('[data-test="menu-link-/streams-item"]')
      .click({ force: true });
    await page.waitForTimeout(1000);
    await page
      .locator('[data-test="menu-link-\\/streams-item"]')
      .click({ force: true });
    await page.getByPlaceholder("Search Stream").click();
    await page.getByPlaceholder("Search Stream").fill("e2e");
    await page.waitForTimeout(1000);
    await page
      .getByRole("button", { name: "Explore" })
      .first()
      .click({ force: true });
    await page.waitForTimeout(1000);
    await expect(page.url()).toContain("logs");
  });

    // This is flicky, sometimes we get first record from stream1 and sometimes from e2e_automate
  test.skip("should click on interesting fields icon and display query in editor", async ({
    page,
  }) => {
    await multistreamselect(page);
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("job");
    await page.waitForTimeout(2000);
    await page
      .locator(
        '[data-test="log-search-index-list-interesting-job-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-cy="search-bar-refresh-button"] > .q-btn__content')
        .click({
          force: true,
        });

    await page
        .locator('[data-test="log-table-column-0-source"]')
        .click({ force: true });
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
})
