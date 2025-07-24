import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import matchAllLogsData from "../../../test-data/match_all.json";
import PageManager from '../../pages/page-manager.js';

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }
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
  const streamName = "e2e_matchall";
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
    logsdata: matchAllLogsData
  });
  console.log(response);
}

test.describe("Match All Logs Queries testcases", () => {
  let pageManager;

  async function applyQueryButton(page) {
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForTimeout(3000)
    await pageManager.logsPage.selectStream("e2e_matchall"); 
    await applyQueryButton(page);
  });

  test("should match logs with simple level=info", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor("match_all('level=info')");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with quoted message", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'msg="test"\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with level and quoted message", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'level=info msg="test"\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with stopping collector runner message", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'level=info msg="stopping collector runner..."\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with field value test", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'field="value=test"\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with function parameters", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'func(param1="a=b", param2>5)\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with inequality conditions", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'status!=200 url=/api/v1/resource?path=test\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should match logs with multiple conditions", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'level!=debug count<=50 size>=1024\')')
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });
}); 