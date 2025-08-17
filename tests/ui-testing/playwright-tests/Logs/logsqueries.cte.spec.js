import { test, expect } from "../baseFixtures";
import PageManager from "../../pages/page-manager.js";
import logData from "../../fixtures/log.json";
import cteQueriesData from "../../../test-data/cte_queries.json";
// (duplicate import removed)

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
  const streamName = "e2e_cte";
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
      logsdata: cteQueriesData
    });
    console.log('Ingestion response:', response);
    return response;
  } catch (error) {
    console.error('Ingestion failed:', error);
    throw error;
  }
}

test.describe("CTE Logs Queries testcases", () => {
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
    await pageManager.logsPage.selectStream("e2e_cte"); 
    await applyQueryButton(page);
  });

  test("should query with simple TotalCols CTE", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH TotalCols AS ( SELECT * FROM "e2e_cte" ) SELECT message FROM TotalCols');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with Cleaned CTE for container names", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Cleaned AS (SELECT message, kubernetes_container_name AS container, kubernetes_pod_name FROM "e2e_cte" WHERE kubernetes_container_name IS NOT NULL) SELECT container, kubernetes_pod_name, message FROM Cleaned');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with FilteredLogs CTE for org messages", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH FilteredLogs AS (SELECT * FROM "e2e_cte" WHERE str_match_ignore_case(message, \'org\')) SELECT message, kubernetes_pod_name FROM FilteredLogs');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with Counts CTE for pod log counts", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Counts AS (SELECT kubernetes_pod_name, COUNT(*) AS log_count FROM "e2e_cte" GROUP BY kubernetes_pod_name) SELECT * FROM Counts WHERE log_count > 1');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with Levels CTE for log level counts", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Levels AS (SELECT level, COUNT(*) as level_count FROM "e2e_cte" GROUP BY level) SELECT * FROM Levels ORDER BY level_count DESC');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with Normalized CTE for timeout messages", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Normalized AS (SELECT COALESCE(message, \'No message\') AS normalized_message FROM "e2e_cte") SELECT * FROM Normalized WHERE normalized_message LIKE \'%timeout%\'');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test.afterEach(async ({ page }) => {
    await pageManager.commonActions.flipStreaming();
  });
}); 