import { test, expect } from "./baseFixtures.js";
import logData from "../cypress/fixtures/log.json";
import { LogsPage } from '../pages/logsPage.js';
import logsdata from "../../test-data/logs_data.json";
import { LogsQueryPage } from '../pages/logsQueryPage.js';

test.describe.configure({ mode: 'parallel' });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }

  await page.locator('[data-cy="login-user-id"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page.locator('[data-cy="login-password"]').fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
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

test.describe("Logs Queries testcases", () => {
  let logsPage;
  let logsQueryPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(5000);
    await ingestion(page);
    await page.waitForTimeout(2000);
    logsPage = new LogsPage(page);
    logsQueryPage = new LogsQueryPage(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await logsPage.selectStreamAndStreamTypeForLogs("e2e_automate"); 
  });

  test("Verify error handling and no results found with histogram", async ({ page }) => {
    // Check if histogram is off and toggle it on if needed
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    const isHistogramOn = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
    if (!isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await logsQueryPage.typeQuery("match_all('invalid')");
    await logsQueryPage.setDateTimeFilter();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.clickErrorMessage();
    await logsQueryPage.clickResetFilters();

    // Type SQL query and verify no results
    await logsQueryPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickNoDataFound();
    await logsQueryPage.clickResultDetail();
  });

  test("Verify error handling with histogram toggle off and on", async ({ page }) => {
    // Check if histogram is on and toggle it off
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    const isHistogramOn = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
    if (isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await logsQueryPage.typeQuery("match_all('invalid')");
    await logsQueryPage.setDateTimeFilter();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.clickErrorMessage();
    await logsQueryPage.clickResetFilters();

    // Toggle histogram back on
    await logsPage.toggleHistogram();

    // Type SQL query and verify no results
    await logsQueryPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickNoDataFound();
    await logsQueryPage.clickResultDetail();
  });

  test("Verify histogram toggle persistence after multiple queries", async ({ page }) => {
    // Start with histogram on
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    const isHistogramOn = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
    if (!isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Run first query
    await logsQueryPage.typeQuery("SELECT * FROM 'e2e_automate' LIMIT 10");
    await logsQueryPage.setDateTimeFilter();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);

    // Toggle histogram off
    await logsPage.toggleHistogram();

    // Run second query
    await logsQueryPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);

    // Verify histogram stays off
    const isHistogramStillOff = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'false');
    expect(isHistogramStillOff).toBeTruthy();
  });

  test("Verify histogram toggle with empty query", async ({ page }) => {
    // Start with histogram off
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    const isHistogramOn = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
    if (isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Clear query and refresh
    await logsQueryPage.typeQuery("");
    await logsQueryPage.setDateTimeFilter();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);

    // Toggle histogram on
    await logsPage.toggleHistogram();

    // Verify histogram state
    const isHistogramOnAfterToggle = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
    expect(isHistogramOnAfterToggle).toBeTruthy();
  });

  test("Verify histogram toggle with complex query", async ({ page }) => {
    // Start with histogram on
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    const isHistogramOn = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'true');
    if (!isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Run complex query
    await logsQueryPage.typeQuery("SELECT * FROM 'e2e_automate' WHERE timestamp > '2024-01-01' AND code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5");
    await logsQueryPage.setDateTimeFilter();
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);

    // Toggle histogram off and verify
    await logsPage.toggleHistogram();
    const isHistogramOff = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'false');
    expect(isHistogramOff).toBeTruthy();

    // Run another query and verify histogram stays off
    await logsQueryPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    await logsQueryPage.waitForTimeout(2000);
    await logsQueryPage.clickRefresh();
    await logsQueryPage.waitForTimeout(2000);

    const isHistogramStillOff = await histogramToggle.evaluate(el => el.getAttribute('aria-checked') === 'false');
    expect(isHistogramStillOff).toBeTruthy();
  });
}); 