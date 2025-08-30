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

  // ========== ADVANCED CTE PATTERNS ==========

  test("should query with string manipulation CTEs", {
    tag: ['@cteLogs', '@string', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH StringOps AS (SELECT UPPER(level) as upper_level, LENGTH(message) as msg_length, SUBSTRING(message, 1, 50) as short_msg, kubernetes_container_name FROM "e2e_cte") SELECT upper_level, msg_length, short_msg FROM StringOps WHERE msg_length > 20');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with NULL handling variations", {
    tag: ['@cteLogs', '@null', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH NullHandling AS (SELECT COALESCE(kubernetes_container_name, \'unknown\') as container, COALESCE(kubernetes_pod_name, \'no-pod\') as pod, NULLIF(message, \'\') as clean_message FROM "e2e_cte") SELECT container, pod, COALESCE(clean_message, \'empty message\') as final_message FROM NullHandling');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with LEFT JOIN between CTEs", {
    tag: ['@cteLogs', '@join', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH ContainerLogs AS (SELECT kubernetes_container_name as container, COUNT(*) as container_count FROM "e2e_cte" GROUP BY kubernetes_container_name), PodLogs AS (SELECT kubernetes_pod_name as pod, COUNT(*) as pod_count FROM "e2e_cte" GROUP BY kubernetes_pod_name) SELECT c.container, c.container_count, p.pod, p.pod_count FROM ContainerLogs c LEFT JOIN PodLogs p ON c.container = p.pod');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with multiple independent CTEs", {
    tag: ['@cteLogs', '@advanced', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH ErrorLogs AS (SELECT * FROM "e2e_cte" WHERE level = \'error\'), InfoLogs AS (SELECT * FROM "e2e_cte" WHERE level = \'info\'), Combined AS (SELECT \'error\' as type, COUNT(*) as count FROM ErrorLogs UNION SELECT \'info\' as type, COUNT(*) as count FROM InfoLogs) SELECT * FROM Combined');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with CTE containing UNION operations", {
    tag: ['@cteLogs', '@union', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH UnionLogs AS (SELECT message, level, \'current\' as source FROM "e2e_cte" WHERE level = \'error\' UNION ALL SELECT message, level, \'archived\' as source FROM "e2e_cte" WHERE level = \'warn\') SELECT * FROM UnionLogs ORDER BY level');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query for error rate analysis with CTEs", {
    tag: ['@cteLogs', '@usecase', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH ErrorAnalysis AS (SELECT kubernetes_container_name, level, COUNT(*) as count FROM "e2e_cte" GROUP BY kubernetes_container_name, level), TotalLogs AS (SELECT kubernetes_container_name, SUM(count) as total FROM ErrorAnalysis GROUP BY kubernetes_container_name) SELECT e.kubernetes_container_name, e.level, e.count, t.total, ROUND((e.count * 100.0 / t.total), 2) as percentage FROM ErrorAnalysis e JOIN TotalLogs t ON e.kubernetes_container_name = t.kubernetes_container_name WHERE e.level IN (\'error\', \'warn\') ORDER BY percentage DESC');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should query with complex container info and host summary CTE", {
    tag: ['@cteLogs', '@complex', '@logs']
  }, async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.waitForTimeout(1000);

    const complexQuery = 'WITH container_info AS (SELECT _timestamp, kubernetes_container_name, kubernetes_pod_name, kubernetes_labels_app FROM (SELECT _timestamp, kubernetes_container_name, kubernetes_pod_name, kubernetes_labels_app FROM (SELECT * FROM "e2e_cte" WHERE kubernetes_pod_name IS NOT NULL) base_data) filtered_data), host_summary AS (SELECT kubernetes_pod_name, COUNT(*) as container_count, MAX(_timestamp) as latest_timestamp FROM "e2e_cte" GROUP BY kubernetes_pod_name) SELECT c._timestamp, c.kubernetes_container_name, c.kubernetes_pod_name, c.kubernetes_labels_app, h.container_count, h.latest_timestamp FROM container_info c JOIN host_summary h ON c.kubernetes_pod_name = h.kubernetes_pod_name ORDER BY c._timestamp DESC LIMIT 10';

    await pageManager.logsPage.executeComplexQueryWithValidation(complexQuery, 'LIMIT 10');
  });

  test.afterEach(async ({ page }) => {
    await pageManager.commonActions.flipStreaming();
  });
}); 