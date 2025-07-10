import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { LogsPage } from '../../pages/logsPages/logsPage.js';

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
  let logsPage;
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
    logsPage = new LogsPage(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await logsPage.selectStream("e2e_automate");
 
    await applyQueryButton(page);

    // Enable quick mode toggle if it's not already enabled
    const toggleButton = await logsPage.page.$('[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner');
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
    await logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await logsPage.clickSQLModeToggle();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectInterestingFieldInEditor("kubernetes_pod_id");
  });
  test("should display quick mode toggle button", {
    tag: ['@quickModeLogs', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.expectQuickModeToggleVisible();
  });

  test("should click on interesting fields icon in histogram mode and run query", {
    tag: ['@interestingFieldsHistogramModeLogs', '@histogram', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectInterestingFieldInTable("kubernetes_pod_id");
  });

  test("should display error on entering random text in histogram mode when quick mode is on", {
    tag: ['@errorHandlingHistogramModeLogs', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(2000);
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor("oooo");
    await logsPage.waitForTimeout(1000);
    await logsPage.waitForSearchBarRefreshButton();
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectErrorMessageVisible();
  });

  test("should display selected interestesing field and order by - as default in editor", {
    tag: ['@interestingFieldsSqlModeLogs', '@sqlMode', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await logsPage.clickSQLModeToggle();
    await logsPage.waitForQueryEditorTextbox();
    await logsPage.expectQueryEditorVisible();
  });

  test("should adding/removing interesting field removes it from editor and results too", {
    tag: ['@interestingFieldsCRUD', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.fillIndexFieldSearchInput("kubernetes_container_name");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("kubernetes_container_name");
    await logsPage.fillIndexFieldSearchInput("level");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("level");
    await logsPage.clickSQLModeToggle();
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.expectLogTableColumnSourceVisible();
    await logsPage.clickInterestingFieldButton("level");
    await logsPage.expectQueryEditorNotContainsText("level");
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.expectLogTableColumnSourceNotHaveText("source");
  });

  test("should display order by in sql mode by default even after page reload", {
    tag: ['@sqlModeOrderBy', '@sqlMode', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await logsPage.clickSQLModeToggle();
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.page.reload();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectQueryEditorContainsText('SELECT kubernetes_pod_id FROM "e2e_automate"');
  });

  test("should display results without adding timestamp in quick mode", {
    tag: ['@quickModeResults', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await logsPage.clickSQLModeToggle();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectExactTextVisible("source");
  });
});
