import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: 'parallel' });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
}
 
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
}



test.describe("Logs Quickmode testcases", () => {
  let pageManager;
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
    // await search.hits.FIXME_should("be.an", "array");
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await pageManager.logsPage.selectStream("e2e_automate");
 
    await applyQueryButton(page);

    // Enable quick mode toggle if it's not already enabled
    const toggleButton = await pageManager.logsPage.page.$('[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner');
    // Evaluate the class attribute to determine if the toggle is in the off state
    const isSwitchedOff = await toggleButton.evaluate(node => node.classList.contains('q-toggle__inner--falsy'));
    if (isSwitchedOff) {
      await toggleButton.click();
    }
  });
  test("should click on interesting fields icon and display query in editor", {
    tag: ['@interestingFieldsLogs', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await pageManager.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectInterestingFieldInEditor("kubernetes_pod_id");
  });
  test("should display quick mode toggle button", {
    tag: ['@quickModeLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.expectQuickModeToggleVisible();
  });

  test("should click on interesting fields icon in histogram mode and run query", {
    tag: ['@interestingFieldsHistogramModeLogs', '@histogram', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await pageManager.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectInterestingFieldInTable("kubernetes_pod_id");
  });

  test("should display error on entering random text in histogram mode when quick mode is on", {
    tag: ['@errorHandlingHistogramModeLogs', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor("oooo");
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.waitForSearchBarRefreshButton();
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectErrorMessageVisible();
  });

  test("should display selected interestesing field and order by - as default in editor", {
    tag: ['@interestingFieldsSqlModeLogs', '@sqlMode', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await pageManager.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.waitForQueryEditorTextbox();
    await pageManager.logsPage.expectQueryEditorVisible();
  });

  test("should adding/removing interesting field removes it from editor and results too", {
    tag: ['@interestingFieldsCRUD', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.fillIndexFieldSearchInput("kubernetes_container_name");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("kubernetes_container_name");
    await pageManager.logsPage.fillIndexFieldSearchInput("level");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("level");
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    await pageManager.logsPage.clickInterestingFieldButton("level");
    await pageManager.logsPage.expectQueryEditorNotContainsText("level");
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceNotHaveText("source");
  });

  test("should display order by in sql mode by default even after page reload", {
    tag: ['@sqlModeOrderBy', '@sqlMode', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await pageManager.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.page.reload();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectQueryEditorContainsText('SELECT kubernetes_pod_id FROM "e2e_automate"');
  });

  test("should display results without adding timestamp in quick mode", {
    tag: ['@quickModeResults', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await pageManager.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectExactTextVisible("source");
  });
});
