import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";

test.describe.configure({ mode: 'parallel' });


async function login(page) {
      await page.goto(process.env["ZO_BASE_URL"]);
      console.log("ZO_BASE_URL", process.env["ZO_BASE_URL"]);
      await page.waitForTimeout(1000);
      await page
        .locator('[data-cy="login-user-id"]')
        .fill(process.env["ZO_ROOT_USER_EMAIL"]);
      //Enter Password
      await page
        .locator('[data-cy="login-password"]')
        .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
      await page.locator('[data-cy="login-sign-in"]').click();
      await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
}


const selectStreamAndStreamTypeForLogs = async (page,stream) => {await page.waitForTimeout(
  4000);await page.locator(
  '[data-test="log-search-index-list-select-stream"]').click({ force: true });await page.locator(
  "div.q-item").getByText(`${stream}`).first().click({ force: true });
};
test.describe("Logs Quickmode testcases", () => {
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
    // await search.hits.FIXME_should("be.an", "array");
  }
  // tebefore(async function () {
  //   // logData("log");
  //   // const data = page;
  //   // logData = data;

  //   console.log("--logData--", logData);
  // });
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(5000)

    // ("ingests logs via API", () => {
      const orgId = process.env["ORGNAME"];
      const streamName = "e2e_automate";
      const basicAuthCredentials = Buffer.from(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
      ).toString('base64');
    
      const headers = {
        "Authorization": `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      };
    
      // const logsdata = {}; // Fill this with your actual data
    
      // Making a POST request using fetch API
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
    
      console.log(response);
    //  });
    // const allorgs = page.waitForResponse("**/api/default/organizations**");
    // const functions = page.waitForResponse("**/api/default/functions**");
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page,logData.Stream);
    await applyQueryButton(page);
    await page.waitForSelector('[data-test="logs-search-bar-quick-mode-toggle-btn"]');
    // Get the toggle button element
    const toggleButton = await page.$('[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner');
    // Evaluate the class attribute to determine if the toggle is in the off state
    const isSwitchedOff = await toggleButton.evaluate(node => node.classList.contains('q-toggle__inner--falsy'));
    // If the toggle is switched off, click on it to switch it on
    if (isSwitchedOff) {
        await toggleButton.click();
    }
    // const streams = page.waitForResponse("**/api/default/streams**");
  });
  test("should click on interesting fields icon and display query in editor", async ({
    page,
  }) => {
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("_timestamp");
    await page.waitForTimeout(2000);
    await page
      .locator(".field-container")
      .locator(
        '[data-test="log-search-index-list-interesting-_timestamp-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.locator('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText(/_timestamp/)
        .first()
    ).toBeVisible();
  });
  test("should display quick mode toggle button", async ({ page }) => {
    await expect(
      page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"]')
    ).toBeVisible();
  });

  test("should click on interesting fields icon in histogram mode and run query", async ({
    page,
  }) => {
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("_timestamp");
    await page.waitForTimeout(2000);
    await page
      .locator(".field-container")
      .locator(
        '[data-test="log-search-index-list-interesting-_timestamp-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page
      .locator('[data-cy="search-bar-refresh-button"] > .q-btn__content')
      .click();
    await expect(
      page
        .locator('[data-test="log-table-column-0-source"]')
        .getByText(/_timestamp/)
        .first()
    ).toBeVisible();
  });

  test("should display error on entering random text in histogram mode when quick mode is on", async ({ page }) => {
    // Click on the Monaco Editor to focus it
    await page.click('[data-test="logs-search-bar-query-editor"]');
  
    // Type into the Monaco Editor
    await page.keyboard.type("oooo");
    await page.waitForTimeout(1000)
    await page.waitForSelector('[data-cy="search-bar-refresh-button"] > .q-btn__content', { visible: true, timeout: 5000 });
  
    // Click on the refresh button
    await page.click('[data-cy="search-bar-refresh-button"] > .q-btn__content',{ force: true });
  
    // Wait for the error message to appear and ensure it is visible
    await expect(page.locator('[data-test="logs-search-error-message"]').first()).toBeVisible({ timeout: 10000 });
  });

  test("should display selected interestesing field and order by - as default in editor", async ({
    page,
  }) => {
    await page
      .locator(".field-container")
      .locator(
        '[data-test="log-search-index-list-interesting-_timestamp-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.locator('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    await expect(
      page.locator('[data-test="logs-search-bar-query-editor"]').locator('text=_timestamp FROM "e2e_automate" ORDER BY _timestamp DESC')
    ).toBeVisible();
    
   
  });

  test("should adding/removing interesting field removes it from editor and results too", async ({
    page,
  }) => {
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("_timestamp");
    await page.waitForTimeout(2000);
    await page
      .locator(".field-container")
      .locator(
        '[data-test="log-search-index-list-interesting-_timestamp-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.locator('[data-cy="index-field-search-input"]').clear();
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("kubernetes_pod_id");
    await page.waitForTimeout(2000);
    await page
      .locator(
        '[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.locator('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    await page
      .locator('[data-cy="search-bar-refresh-button"] > .q-btn__content')
      .click({
        force: true,
      });
    await expect(
      page
        .locator('[data-test="log-table-column-0-source"]')
        .locator('text=kubernetes_pod_id')
    ).toBeVisible();
    await page
      .locator(
        '[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await expect(
      page.locator('[data-test="logs-search-bar-query-editor"]')
    ).not.toHaveText(/kubernetes_pod_id/);
    await page
      .locator('[data-cy="search-bar-refresh-button"] > .q-btn__content')
      .click();
    await expect(
      page.locator('[data-test="log-table-column-0-source"]')
    ).not.toHaveText(/kubernetes_pod_id/);
  });

  test("should display order by in sql mode by default even after page reload", async ({
    page,
  }) => {
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("_timestamp");
    await page.waitForTimeout(2000);
    await page
      .locator(".field-container")
      .locator(
        '[data-test="log-search-index-list-interesting-_timestamp-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.locator('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .locator(
          'text=SELECT _timestamp FROM "e2e_automate" ORDER BY _timestamp DESC'
        )
    ).toBeVisible();
  });
});
