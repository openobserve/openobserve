import { test, expect } from './baseFixtures.js';
import logData from "../cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import { toZonedTime } from "date-fns-tz";
import { LogsPage } from '../pages/logsPage.js';

test.describe.configure({ mode: "parallel" });
const folderName = `Folder ${Date.now()}`;
const dashboardName = `AutomatedDashboard${Date.now()}`;

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

async function applyQueryButton(page) {
  const search = page.waitForResponse(logData.applyQuery);
  await page.waitForTimeout(3000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  await expect.poll(async () => (await search).status()).toBe(200);
}

test.describe("Search partition testcases", () => {
  let logsPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await logsPage.selectStreamAndStreamTypeForLogs("e2e_automate"); 
    await applyQueryButton(page);
  });

  test("should verify search partition and search API calls for histogram query", async ({ page }) => {
    // Enter the histogram query
    const query = `SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_container_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;
    
    // Click on the query editor and type the query
    await page.locator('[data-test="logs-search-bar-query-editor"] > .monaco-editor').click();
    // await page.click('[data-test="logs-search-bar-query-editor"] > .monaco-editor');
    await page.keyboard.type(query);
    await page.waitForTimeout(2000);

    // Toggle histogram off
    await page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"] div').nth(2).click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click()

    // Wait for and capture the search partition response
    const searchPartitionPromise = page.waitForResponse(response => 
      response.url().includes('/api/default/_search_partition') && 
      response.request().method() === 'POST'
    );
   
    const searchPartitionResponse = await searchPartitionPromise;
    const searchPartitionData = await searchPartitionResponse.json();

    // Verify search partition response structure
    expect(searchPartitionData).toHaveProperty('partitions');
    expect(searchPartitionData).toHaveProperty('histogram_interval');
    expect(searchPartitionData).toHaveProperty('order_by', 'asc');

    // Wait for and capture all search API calls
    const searchCalls = [];
    page.on('response', async response => {
      if (response.url().includes('/api/default/_search') && 
          response.request().method() === 'POST') {
        const requestData = await response.request().postDataJSON();
        searchCalls.push({
          start_time: requestData.query.start_time,
          end_time: requestData.query.end_time,
          sql: requestData.query.sql
        });
      
      }
    });

    // Wait for all search calls to complete
    await page.waitForTimeout(2000);

    // Verify that the number of search calls matches the number of partitions
    expect(searchCalls.length).toBe(searchPartitionData.partitions.length);
    console.log('partition', searchPartitionData.partitions)
    // Verify each search call matches a partition
    for (const partition of searchPartitionData.partitions) {
      const matchingCall = searchCalls.find(call => 
        call.start_time === partition[0] && 
        call.end_time === partition[1]
      );
      expect(matchingCall).toBeTruthy();
      expect(matchingCall.sql).toContain('SELECT histogram(_timestamp');
    }

    // Verify histogram is still off
    const isHistogramOff = await page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]')
      .evaluate(el => el.getAttribute('aria-checked') === 'false');
    expect(isHistogramOff).toBeTruthy();
  });
});


