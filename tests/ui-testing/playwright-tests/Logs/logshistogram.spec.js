import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import { LogsPage } from '../../pages/logsPages/logsPage.js';
import logsdata from "../../../test-data/logs_data.json";

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

test.describe("Logs Histogram testcases", () => {
  let logsPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(5000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await logsPage.selectStream("e2e_automate"); 
  });

  test("Verify error handling and no results found with histogram", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Check if histogram is off and toggle it on if needed
    const isHistogramOn = await logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await logsPage.typeQuery("match_all('invalid')");
    await logsPage.setDateTimeFilter();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.clickErrorMessage();
    await logsPage.clickResetFilters();

    // Type SQL query and verify no results
    await logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickNoDataFound();
    await logsPage.clickResultDetail();
  });

  test("Verify error handling with histogram toggle off and on", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Check if histogram is on and toggle it off
    const isHistogramOn = await logsPage.isHistogramOn();
    if (isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await logsPage.typeQuery("match_all('invalid')");
    await logsPage.setDateTimeFilter();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.clickErrorMessage();
    await logsPage.clickResetFilters();

    // Toggle histogram back on
    await logsPage.toggleHistogram();

    // Type SQL query and verify no results
    await logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickNoDataFound();
    await logsPage.clickResultDetail();
  });

  test("Verify histogram toggle persistence after multiple queries", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Start with histogram on
    const isHistogramOn = await logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Run first query
    await logsPage.typeQuery("SELECT * FROM 'e2e_automate' LIMIT 10");
    await logsPage.setDateTimeFilter();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);

    // Toggle histogram off
    await logsPage.toggleHistogram();
    await logsPage.enableSQLMode();
    await logsPage.waitForTimeout(1000);
    await logsPage.enableSQLMode();

    // Run second query
    await logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);

    // Verify histogram stays off
    await logsPage.verifyHistogramState();
  });

  test("Verify histogram toggle with empty query", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Start with histogram off
    const isHistogramOn = await logsPage.isHistogramOn();
    if (isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Clear query and refresh
    await logsPage.typeQuery("");
    await logsPage.setDateTimeFilter();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);

    // Toggle histogram on
    await logsPage.toggleHistogram();

    // Verify histogram state
    const isHistogramOnAfterToggle = await logsPage.isHistogramOn();
    expect(isHistogramOnAfterToggle).toBeTruthy();
  });

  test("Verify histogram toggle with complex query", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Start with histogram on
    const isHistogramOn = await logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await logsPage.toggleHistogram();
    }

    // Run complex query
    await logsPage.typeQuery("SELECT * FROM 'e2e_automate' WHERE timestamp > '2024-01-01' AND code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5");
    await logsPage.setDateTimeFilter();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);

    // Toggle histogram off and verify
    await logsPage.toggleHistogram();
    const isHistogramOff = await logsPage.isHistogramOn();
    expect(!isHistogramOff).toBeTruthy();

    // Run another query and verify histogram stays off
    await logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefresh();
    await logsPage.waitForTimeout(2000);

    const isHistogramStillOff = await logsPage.isHistogramOn();
    expect(!isHistogramStillOff).toBeTruthy();
  });
}); 