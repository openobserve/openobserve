import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { LogsPage } from '../../pages/logsPages/logsPage.js';

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
  let logsPage;
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
    logsPage = new LogsPage(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await logsPage.selectStream("e2e_automate"); 
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });

  test("should click run query after SQL toggle on but without any query", {
    tag: ['@sqlQueryLogs', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.waitForTimeout(3000);
    await logsPage.clickRefreshButton();
    await logsPage.clickSQLModeToggle();
    await logsPage.clickQueryEditor();
    await logsPage.selectAllText();
    await logsPage.pressBackspace();
    await logsPage.waitForTimeout(3000);
    await logsPage.clickRefreshButton();
    await logsPage.expectSQLQueryMissingError();
  });

  test("should be able to enter valid text in VRL and run query", {
    tag: ['@vrlQueryLogs', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative6WeeksButton();
    await applyQueryButton(page);

    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await applyQueryButton(page);
    await logsPage.expectWarningElementHidden();
  
    await logsPage.clickTableRowExpandMenu();
    await logsPage.expectTextVisible(".a=2");
    await logsPage.expectLogsTableVisible();
    await logsPage.clickRefreshButton();
  });

  test("should hide and display again after clicking the arrow", {
    tag: ['@hideAndDisplayLogs', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative6WeeksButton();
    await logsPage.clickShowQueryToggle();
    await logsPage.clickFieldListCollapseButton();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickFieldListCollapseButton();
    await logsPage.expectIndexFieldSearchInputVisible();
  });

  test("should verify if special characters allowed in saved views name", {
    tag: ['@savedViewsSpecialCharacters', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative6WeeksButton();
    await logsPage.clickShowQueryToggle();
    await logsPage.clickSavedViewsButton();
    await logsPage.fillSavedViewName("e2e@@@@@");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickSavedViewDialogSave();
    await logsPage.expectNotificationMessage("Please provide valid view name");
  });

  test("should display error when user directly clicks on OK without adding name", {
    tag: ['@savedViewsValidation', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickRefreshButton();
    await logsPage.clickSavedViewsExpand();
    await logsPage.clickSaveViewButton();
    await logsPage.clickSavedViewDialogSave();
  });

  test("should display the details of logs results on graph", {
    tag: ['@logsResultsGraph', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative6WeeksButton();
    await applyQueryButton(page);
    await logsPage.waitForTimeout(5000);
    await logsPage.expectSearchListVisible();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickLogTableColumnSource();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickCloseDialogForce();
    await logsPage.expectSearchListVisible();
  });

  test("should click on live mode on button and select 5 sec, switch off, and then click run query", {
    tag: ['@liveMode', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await page.route("**/logData.ValueQuery", (route) => route.continue());
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative6WeeksButton();
    await logsPage.clickLiveModeButton();
    await logsPage.clickLiveMode5Sec();
    await logsPage.expectNotificationMessage("Live mode is enabled");
    await logsPage.clickLiveModeButton();
    await logsPage.clickLiveMode5Sec();
    await applyQueryButton(page);
  });

  test("should click on VRL toggle and display the field, then disable toggle and make the VRL field disappear", {
    tag: ['@vrlToggle', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.expectVrlFieldVisible();
    await logsPage.clickVrlToggle();
    await logsPage.expectFnEditorNotVisible();
  });

  test("should switch from past 6 weeks to past 6 days on date-time UI", {
    tag: ['@dateTimeUI', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative6WeeksButton();
    await logsPage.expectTextVisible("Past 6 Weeks");
    await applyQueryButton(page);
    await logsPage.clickDateTimeButton();
    await logsPage.clickPast6DaysButton();
    await logsPage.expectTextVisible("Past 6 Days");
    await applyQueryButton(page);
  });
  
  test("should display SQL query on switching between Menu options & navigating to Logs again", {
    tag: ['@sqlQueryPersistence', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickSQLModeToggle();
    const expectedQuery = 'SELECT * FROM "e2e_automate"';
    const text = await logsPage.getQueryEditorText();
    await expect(text.replace(/\s/g, "")).toContain(expectedQuery.replace(/\s/g, ""));
    await logsPage.clickMenuLinkMetricsItem();
    await logsPage.clickMenuLinkLogsItem();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectQueryEditorContainsSelectFrom();
  });
  test("should display ingested logs - search logs, navigate on another tab, revisit logs page", {
    tag: ['@ingestedLogsPersistence', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await applyQueryButton(page);
    await logsPage.clickMenuLinkTracesItem();
    await logsPage.waitForTimeout(100);
    await logsPage.clickMenuLinkLogsItem();
    await logsPage.waitForTimeout(5000);
    await logsPage.expectBarChartVisible();
  });

  test.skip("should redirect to logs after clicking on stream explorer via stream page", {
    tag: ['@streamExplorer', '@all', '@logs']
  }, async ({
    page,
  }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickMenuLinkStreamsItem();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickMenuLinkStreamsItem();
    await logsPage.clickSearchStreamInput();
    await logsPage.fillSearchStreamInput("e2e");
    await logsPage.waitForTimeout(1000);
    await logsPage.clickExploreButton();
    await logsPage.expectUrlContainsLogs();
  });

  test('should display error when save function is clicked without any VRL function', {
    tag: ['@functionValidation', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickFunctionDropdownSave();
    await logsPage.expectWarningNoFunctionDefinition();
  });

  test('should create a function and then delete it', {
    tag: ['@functionCRUD', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickRefreshButton();
    await logsPage.clickFunctionDropdownSave();
    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickFunctionDropdownSave();
    await logsPage.clickSavedFunctionNameInput();
    const randomString = logsPage.generateRandomString();
    const functionName = 'e2efunction_' + randomString;
    await logsPage.fillSavedFunctionNameInput(functionName);
    await logsPage.clickSavedViewDialogSave();
    await logsPage.clickMenuLinkPipelineItem();
    await logsPage.clickTabRealtime();
    await logsPage.clickFunctionStreamTab();
    await logsPage.clickSearchFunctionInput();
    await logsPage.fillSearchFunctionInput(randomString);
    await logsPage.clickDeleteFunctionButton();
    await logsPage.clickConfirmButton();
  });

  test('should display click save directly while creating a function', {
    tag: ['@functionSaveValidation', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickFunctionDropdownSave();
    await logsPage.clickSavedViewDialogSave();
    await logsPage.expectFunctionNameNotValid();
  });

  test('should display error on adding only blank spaces under function name', {
    tag: ['@functionNameValidation', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickFunctionDropdownSave();
    await logsPage.fillSavedFunctionNameInput(' ');
    await logsPage.clickSavedViewDialogSave();
    await logsPage.expectFunctionNameNotValid();
  });


  test('should display error on adding invalid characters under function name', {
    tag: ['@functionNameValidation', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickFunctionDropdownSave();
    await logsPage.fillSavedFunctionNameInput('e2e@@@');
    await logsPage.clickSavedViewDialogSave();
    await logsPage.expectFunctionNameNotValid();
  });

  test('should display added function on switching between tabs and again navigate to log', {
    tag: ['@functionPersistence', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickRefreshButton();
    await logsPage.clickMenuLinkMetricsItem();
    await logsPage.clickMenuLinkLogsItem();
    await logsPage.clickMenuLinkLogsItem();
    await logsPage.expectPageContainsText(".a=2");
  });

  test('should display bar chart when histogram toggle is on', {
    tag: ['@histogramBarChart', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickLogSearchIndexListFieldSearchInput();
    await logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await logsPage.waitForTimeout(4000);
    await logsPage.clickExpandCode();
    await logsPage.waitForTimeout(4000);
    await logsPage.clickRefreshButton();
    await logsPage.clickSQLModeToggle();
    await logsPage.clickRefreshButton();
    await logsPage.clickBarChartCanvas();
    await logsPage.clickSQLModeToggle();
    await logsPage.clickRefreshButton();
    await logsPage.clickBarChartCanvas();
    await logsPage.clickHistogramToggleDiv();
  });

  test('should display search around in histogram mode', {
    tag: ['@searchAroundHistogram', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickLogTableColumnSource();
    await logsPage.clickLogsDetailTableSearchAroundBtn();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectLogTableColumnSourceVisible();
  });


  test.skip('should display results for search around after adding function', async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickVrlEditor();
    await logsPage.waitForTimeout(1000);
    await logsPage.clickRefreshButton();
    await logsPage.clickLogTableColumn3Source();
    await logsPage.clickLogsDetailTableSearchAroundBtn();
    await logsPage.waitForTimeout(1000);
    await logsPage.expectLogTableColumnSourceVisible();
  });

  test('should display search around in SQL mode', {
    tag: ['@searchAroundSQL', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(1000);
    await logsPage.clickSQLModeToggle();
    await logsPage.clickLogTableColumnSource();
    await logsPage.clickLogsDetailTableSearchAroundBtn();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectLogTableColumnSourceVisible();
  });

  test("should display results for search around with limit query", {
    tag: ['@searchAroundLimit', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(2000);
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor("match_all('code') limit 5");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickSQLModeToggle();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickLogTableColumnSource();
    await logsPage.clickLogsDetailTableSearchAroundBtn();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectLogTableColumnSourceVisible();
  });

  test("should not display pagination for limit query", {
    tag: ['@paginationLimit', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(2000);
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor("match_all('code') limit 5");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickSQLModeToggle();
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefreshButton();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectPaginationNotVisible();
  });

  test("should not display pagination for SQL limit query", {
    tag: ['@paginationSQLLimit', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(2000);
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefreshButton();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectPaginationNotVisible();
  });

  test("should not display pagination for SQL group/order/limit query", {
    tag: ['@paginationSQLGroupOrder', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(2000);
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor('SELECT * FROM "e2e_automate" WHERE code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5');
    await logsPage.waitForTimeout(2000);
    await logsPage.clickRefreshButton();
    await logsPage.waitForTimeout(2000);
    await logsPage.expectPaginationNotVisible();
  });
});
