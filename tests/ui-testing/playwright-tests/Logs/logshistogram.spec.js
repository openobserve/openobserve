import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from '../../pages/page-manager.js';

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
  let pageManager;

  test.beforeEach(async ({ page }) => {
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(5000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await pageManager.logsPage.selectStream("e2e_automate"); 
  });

  test("Verify error handling and no results found with histogram", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Check if histogram is off and toggle it on if needed
    const isHistogramOn = await pageManager.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pageManager.logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await pageManager.logsPage.typeQuery("match_all('invalid')");
    await pageManager.logsPage.setDateTimeFilter();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.clickErrorMessage();
    await pageManager.logsPage.clickResetFilters();

    // Type SQL query and verify no results
    await pageManager.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickNoDataFound();
    await pageManager.logsPage.clickResultDetail();
  });

  test("Verify error handling with histogram toggle off and on", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Check if histogram is on and toggle it off
    const isHistogramOn = await pageManager.logsPage.isHistogramOn();
    if (isHistogramOn) {
      await pageManager.logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await pageManager.logsPage.typeQuery("match_all('invalid')");
    await pageManager.logsPage.setDateTimeFilter();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.clickErrorMessage();
    await pageManager.logsPage.clickResetFilters();

    // Toggle histogram back on
    await pageManager.logsPage.toggleHistogram();

    // Type SQL query and verify no results
    await pageManager.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickNoDataFound();
    await pageManager.logsPage.clickResultDetail();
  });

  test("Verify histogram toggle persistence after multiple queries", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Start with histogram on
    const isHistogramOn = await pageManager.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pageManager.logsPage.toggleHistogram();
    }

    // Run first query
    await pageManager.logsPage.typeQuery("SELECT * FROM 'e2e_automate' LIMIT 10");
    await pageManager.logsPage.setDateTimeFilter();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);

    // Toggle histogram off
    await pageManager.logsPage.toggleHistogram();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.enableSQLMode();

    // Run second query
    await pageManager.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);

    // Verify histogram stays off
    await pageManager.logsPage.verifyHistogramState();
  });

  test("Verify histogram toggle with empty query", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Start with histogram off
    const isHistogramOn = await pageManager.logsPage.isHistogramOn();
    if (isHistogramOn) {
      await pageManager.logsPage.toggleHistogram();
    }

    // Clear query and refresh
    await pageManager.logsPage.typeQuery("");
    await pageManager.logsPage.setDateTimeFilter();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);

    // Toggle histogram on
    await pageManager.logsPage.toggleHistogram();

    // Verify histogram state
    const isHistogramOnAfterToggle = await pageManager.logsPage.isHistogramOn();
    expect(isHistogramOnAfterToggle).toBeTruthy();
  });

  test("Verify histogram toggle with complex query", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    // Start with histogram on
    const isHistogramOn = await pageManager.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pageManager.logsPage.toggleHistogram();
    }

    // Run complex query
    await pageManager.logsPage.typeQuery("SELECT * FROM 'e2e_automate' WHERE timestamp > '2024-01-01' AND code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5");
    await pageManager.logsPage.setDateTimeFilter();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);

    // Toggle histogram off and verify
    await pageManager.logsPage.toggleHistogram();
    const isHistogramOff = await pageManager.logsPage.isHistogramOn();
    expect(!isHistogramOff).toBeTruthy();

    // Run another query and verify histogram stays off
    await pageManager.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefresh();
    await pageManager.logsPage.waitForTimeout(2000);

    const isHistogramStillOff = await pageManager.logsPage.isHistogramOn();
    expect(!isHistogramStillOff).toBeTruthy();
  });
}); 