import { test, expect } from './baseFixtures.js';
import logData from "../cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import { LogsPage } from '../pages/logsPages/logsPage.js';

test.describe.configure({ mode: "parallel" });

// Helper functions
async function setupTest(page) {
  const logsPage = new LogsPage(page);
  await page.goto(process.env["ZO_BASE_URL"]);
  
  // Login
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }
  await page.waitForTimeout(1000);
  await page.locator('[data-cy="login-user-id"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page.locator('[data-cy="login-password"]').fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  await page.waitForTimeout(4000);
  
  return logsPage;
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
  
  await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
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
}

async function applyQuery(page) {
  const search = page.waitForResponse(logData.applyQuery);
  await page.waitForTimeout(3000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({ force: true });
  await expect.poll(async () => (await search).status()).toBe(200);
}

test.describe("Search Partition Tests", () => {
  let logsPage;

  test.beforeEach(async ({ page }) => {
    logsPage = await setupTest(page);
    console.log("[DEBUG] Login complete");
    await ingestTestData(page);
    console.log("[DEBUG] Ingestion complete");
    await page.waitForTimeout(2000);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    console.log("[DEBUG] Navigation to logs page complete");
    await logsPage.selectStream("e2e_automate"); 
    console.log("[DEBUG] Stream selected"); 
    await applyQuery(page);
    console.log("[DEBUG] Initial query applied");

    // Add network request/response logging
    page.on('request', request => {
      if (request.url().includes('/api/e2e_automate/_search') || request.url().includes('/api/default/_search_partition')) {
        console.log('[DEBUG] Request sent:', request.method(), request.url());
      }
    });
    page.on('response', response => {
      if (response.url().includes('/api/e2e_automate/_search') || response.url().includes('/api/default/_search_partition')) {
        console.log('[DEBUG] Response received:', response.status(), response.url());
      }
    });
  });

  test("should verify search partition and search API calls for histogram query", async ({ page }) => {
    const isStreamingEnabled = process.env["ZO_STREAMING_ENABLED"] === "true";
    const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_container_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;
    
    // Setup and execute query
    await logsPage.executeHistogramQuery(histogramQuery);
    console.log("[DEBUG] Histogram query executed");
    await logsPage.toggleHistogramAndExecute();
    console.log("[DEBUG] Histogram toggled and executed");

    if (!isStreamingEnabled) {
      // Verify search partition response using robust pattern
      console.log("[DEBUG] About to wait for /api/default/_search_partition and click Run Query");
      const partitionPromise = logsPage.verifySearchPartitionResponse();
      await logsPage.clickRunQueryButton();
      const searchPartitionData = await partitionPromise;
      console.log("[DEBUG] Partition response received");
      const searchCalls = await logsPage.captureSearchCalls();
      
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
      console.log("[DEBUG] About to click Run Query and wait for /api/e2e_automate/_search");
      await logsPage.clickRunQueryButton();
      await logsPage.verifyStreamingModeResponse("e2e_automate");
      console.log("[DEBUG] Streaming mode response received");
    }

    // Verify histogram state
    await logsPage.verifyHistogramState();
    console.log("[DEBUG] Histogram state verified");
  });
});

