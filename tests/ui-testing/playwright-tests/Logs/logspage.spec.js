import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from '../../pages/page-manager.js';

// Run in parallel; streaming may flip between tests as part of stress validation
test.describe.configure({ mode: "parallel" });

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

test.describe("Logs Page testcases", () => {
  let pageManager;
  let testIndex = 0;
  
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
    // await search.hits.FIXME_should("be.an", "array");
  }
  
  // tebefore(async function () {
  //   // logData("log");
  //   // const data = page;
  //   // logData = data;

  //   console.log("--logData--", logData);
  // });
  
  test.beforeEach(async ({ page }) => {
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await pageManager.logsPage.selectStream("e2e_automate"); 
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });

  // No per-test wrapper needed

  test("should click run query after SQL toggle on but without any query", {
    tag: ['@sqlQueryLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(3000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.selectAllText();
    await pageManager.logsPage.pressBackspace();
    await pageManager.logsPage.waitForTimeout(3000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.expectSQLQueryMissingError();
  });

  // (no afterEach streaming flip)

  test("should be able to enter valid text in VRL and run query", {
    tag: ['@vrlQueryLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative6WeeksButton();
    await applyQueryButton(page);

    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await applyQueryButton(page);
    await pageManager.logsPage.expectWarningElementHidden();
  
    await pageManager.logsPage.clickTableRowExpandMenu();
    await pageManager.logsPage.expectTextVisible(".a=2");
    await pageManager.logsPage.expectLogsTableVisible();
    await pageManager.logsPage.clickRefreshButton();
  });

  test("should hide and display again after clicking the arrow", {
    tag: ['@hideAndDisplayLogs', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative6WeeksButton();
    await pageManager.logsPage.clickShowQueryToggle();
    await pageManager.logsPage.clickFieldListCollapseButton();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickFieldListCollapseButton();
    await pageManager.logsPage.expectIndexFieldSearchInputVisible();
  });

  test("should verify if special characters allowed in saved views name", {
    tag: ['@savedViewsSpecialCharacters', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative6WeeksButton();
    await pageManager.logsPage.clickShowQueryToggle();
    await pageManager.logsPage.clickSavedViewsButton();
    await pageManager.logsPage.fillSavedViewName("e2e@@@@@");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSavedViewDialogSave();
    await pageManager.logsPage.expectNotificationMessage("Please provide valid view name");
  });

  test("should display error when user directly clicks on OK without adding name", {
    tag: ['@savedViewsValidation', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickSavedViewsExpand();
    await pageManager.logsPage.clickSaveViewButton();
    await pageManager.logsPage.clickSavedViewDialogSave();
  });

  test("should display the details of logs results on graph", {
    tag: ['@logsResultsGraph', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative6WeeksButton();
    await applyQueryButton(page);
    await pageManager.logsPage.waitForTimeout(5000);
    await pageManager.logsPage.expectSearchListVisible();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickLogTableColumnSource();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickCloseDialogForce();
    await pageManager.logsPage.expectSearchListVisible();
  });

  test("should click on live mode on button and select 5 sec, switch off, and then click run query", {
    tag: ['@liveMode', '@all', '@logs']
  }, async ({ page }) => {
    await page.route("**/logData.ValueQuery", (route) => route.continue());
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative6WeeksButton();
    await pageManager.logsPage.clickLiveModeButton();
    await pageManager.logsPage.clickLiveMode5Sec();
    await pageManager.logsPage.expectNotificationMessage("Live mode is enabled");
    await pageManager.logsPage.clickLiveModeButton();
    await pageManager.logsPage.clickLiveMode5Sec();
    await applyQueryButton(page);
  });

  test("should click on VRL toggle and display the field, then disable toggle and make the VRL field disappear", {
    tag: ['@vrlToggle', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.expectVrlFieldVisible();
    await pageManager.logsPage.clickVrlToggle();
    await pageManager.logsPage.expectFnEditorNotVisible();
  });

  test("should switch from past 6 weeks to past 6 days on date-time UI", {
    tag: ['@dateTimeUI', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative6WeeksButton();
    await pageManager.logsPage.expectTextVisible("Past 6 Weeks");
    await applyQueryButton(page);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickPast6DaysButton();
    await pageManager.logsPage.expectTextVisible("Past 6 Days");
    await applyQueryButton(page);
  });
  
  test("should display SQL query on switching between Menu options & navigating to Logs again", {
    tag: ['@sqlQueryPersistence', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickSQLModeToggle();
    const expectedQuery = 'SELECT * FROM "e2e_automate"';
    const text = await pageManager.logsPage.getQueryEditorText();
    await expect(text.replace(/\s/g, "")).toContain(expectedQuery.replace(/\s/g, ""));
    await pageManager.logsPage.clickMenuLinkMetricsItem();
    await pageManager.logsPage.clickMenuLinkLogsItem();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectQueryEditorContainsSelectFrom();
  });
  
  test("should display ingested logs - search logs, navigate on another tab, revisit logs page", {
    tag: ['@ingestedLogsPersistence', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await applyQueryButton(page);
    await pageManager.logsPage.clickMenuLinkTracesItem();
    await pageManager.logsPage.waitForTimeout(100);
    await pageManager.logsPage.clickMenuLinkLogsItem();
    await pageManager.logsPage.waitForTimeout(5000);
    await pageManager.logsPage.expectBarChartVisible();
  });

  test.skip("should redirect to logs after clicking on stream explorer via stream page", {
    tag: ['@streamExplorer', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickMenuLinkStreamsItem();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickMenuLinkStreamsItem();
    await pageManager.logsPage.clickSearchStreamInput();
    await pageManager.logsPage.fillSearchStreamInput("e2e");
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickExploreButton();
    await pageManager.logsPage.expectUrlContainsLogs();
  });

  test('should display error when save function is clicked without any VRL function', {
    tag: ['@functionValidation', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickFunctionDropdownSave();
    await pageManager.logsPage.expectWarningNoFunctionDefinition();
  });

  test('should create a function and then delete it', {
    tag: ['@functionCRUD', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickFunctionDropdownSave();
    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickFunctionDropdownSave();
    await pageManager.logsPage.clickSavedFunctionNameInput();
    const randomString = pageManager.logsPage.generateRandomString();
    const functionName = 'e2efunction_' + randomString;
    await pageManager.logsPage.fillSavedFunctionNameInput(functionName);
    await pageManager.logsPage.clickSavedViewDialogSave();
    await pageManager.logsPage.clickMenuLinkPipelineItem();
    await pageManager.logsPage.clickTabRealtime();
    await pageManager.logsPage.clickFunctionStreamTab();
    await pageManager.logsPage.clickSearchFunctionInput();
    await pageManager.logsPage.fillSearchFunctionInput(randomString);
    await pageManager.logsPage.clickDeleteFunctionButton();
    await pageManager.logsPage.clickConfirmButton();
  });

  test('should display click save directly while creating a function', {
    tag: ['@functionSaveValidation', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickFunctionDropdownSave();
    await pageManager.logsPage.clickSavedViewDialogSave();
    await pageManager.logsPage.expectFunctionNameNotValid();
  });

  test('should display error on adding only blank spaces under function name', {
    tag: ['@functionNameValidation', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickFunctionDropdownSave();
    await pageManager.logsPage.fillSavedFunctionNameInput(' ');
    await pageManager.logsPage.clickSavedViewDialogSave();
    await pageManager.logsPage.expectFunctionNameNotValid();
  });

  test('should display error on adding invalid characters under function name', {
    tag: ['@functionNameValidation', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickFunctionDropdownSave();
    await pageManager.logsPage.fillSavedFunctionNameInput('e2e@@@');
    await pageManager.logsPage.clickSavedViewDialogSave();
    await pageManager.logsPage.expectFunctionNameNotValid();
  });

  test('should display added function on switching between tabs and again navigate to log', {
    tag: ['@functionPersistence', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickMenuLinkMetricsItem();
    await pageManager.logsPage.clickMenuLinkLogsItem();
    await pageManager.logsPage.clickMenuLinkLogsItem();
    await pageManager.logsPage.expectPageContainsText(".a=2");
  });

  test('should display bar chart when histogram toggle is on', {
    tag: ['@histogramBarChart', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pageManager.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await pageManager.logsPage.waitForTimeout(4000);
    await pageManager.logsPage.clickExpandCode();
    await pageManager.logsPage.waitForTimeout(4000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickBarChartCanvas();
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickBarChartCanvas();
    await pageManager.logsPage.clickHistogramToggleDiv();
  });

  test('should display search around in histogram mode', {
    tag: ['@searchAroundHistogram', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickLogTableColumnSource();
    await pageManager.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test.skip('should display results for search around after adding function', async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickVrlEditor();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.clickLogTableColumn3Source();
    await pageManager.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test('should display search around in SQL mode', {
    tag: ['@searchAroundSQL', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(1000);
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.clickLogTableColumnSource();
    await pageManager.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should display results for search around with limit query", {
    tag: ['@searchAroundLimit', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor("match_all('code') limit 5");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickLogTableColumnSource();
    await pageManager.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
  });

  test("should not display pagination for limit query", {
    tag: ['@paginationLimit', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor("match_all('code') limit 5");
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickSQLModeToggle();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectPaginationNotVisible();
  });

  test("should not display pagination for SQL limit query", {
    tag: ['@paginationSQLLimit', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectPaginationNotVisible();
  });

  test("should not display pagination for SQL group/order/limit query", {
    tag: ['@paginationSQLGroupOrder', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" WHERE code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5');
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.clickRefreshButton();
    await pageManager.logsPage.waitForTimeout(2000);
    await pageManager.logsPage.expectPaginationNotVisible();
  });
});
