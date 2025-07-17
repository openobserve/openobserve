import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: "parallel" });

async function setupTest(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  await page.waitForTimeout(4000);
}

async function ingestTestData(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const logsdata = {
    level: "info",
    job: "test",
    log: "test message",
    e2e: "1",
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

async function applyQuery(page) {
  const search = page.waitForResponse(logData.applyQuery);
  await page.waitForTimeout(3000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  await expect.poll(async () => (await search).status()).toBe(200);
}

test.describe("Search Partition Tests", () => {
  let pageManager;

  test.beforeEach(async ({ page }) => {
    await setupTest(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(5000);
    await ingestTestData(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pageManager.logsPage.selectStream("e2e_automate");
    await applyQuery(page);
  });

  test("should verify search partition and search API calls for histogram query", async ({ page }) => {
    const isStreamingEnabled = process.env["ZO_STREAMING_ENABLED"] === "true";
    const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_container_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;
    
    // Setup and execute query
    await pageManager.logsPage.executeHistogramQuery(histogramQuery);
    await pageManager.logsPage.toggleHistogramAndExecute();

    if (!isStreamingEnabled) {
      // Verify search partition response
      const searchPartitionData = await pageManager.logsPage.verifySearchPartitionResponse();
      const searchCalls = await pageManager.logsPage.captureSearchCalls();
      
      expect(searchCalls.length).toBe(searchPartitionData.partitions.length);

      // Verify each partition has a matching search call
      for (const partition of searchPartitionData.partitions) {
        const matchingCall = searchCalls.find(call => 
          call.start_time === partition[0] && 
          call.end_time === partition[1]
        );
        expect(matchingCall).toBeTruthy();
        expect(matchingCall.sql).toContain('SELECT histogram(_timestamp');
      }
    } else {
      await pageManager.logsPage.clickRunQueryButton();
      await pageManager.logsPage.verifyStreamingModeResponse();
    }

    // Verify histogram state
    await pageManager.logsPage.verifyHistogramState();
  });
});

