import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { LogsPage } from '../../pages/logsPages/logsPage.js';

test.describe.configure({ mode: 'parallel' });
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

  test("should display quick mode toggle button", {
    tag: ['@quickModeLogs', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.expectQuickModeToggleVisible();
  });

  test.skip("should add timestamp to editor save this view and switch", {
    tag: ['@timestampViewLogs', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(3000);
    await logsPage.clickLogTableColumnSource();
    await logsPage.clickIncludeExcludeFieldButton();
    await logsPage.clickIncludeFieldButton();
    await logsPage.clickCloseDialog();
    await logsPage.clickSavedViewsButton();
    await logsPage.fillSavedViewName("e2etimestamp");
    await logsPage.clickSavedViewDialogSaveContent();
    await logsPage.clickSavedViewArrow();
    await logsPage.clickSavedViewByLabel(/timestamp/);
    await logsPage.waitForTimeout(3000);
    await logsPage.clickSavedViewsExpand();
    await logsPage.clickSavedViewSearchInput();
    await logsPage.fillSavedViewSearchInput('e2e');
    await logsPage.clickSavedViewByTitle('e2etimestamp');
    await logsPage.clickSavedViewsExpand();
    await logsPage.clickSavedViewSearchInput();
    await logsPage.clickSavedViewByTitle('e2etimestamp');
    await logsPage.clickDeleteButton();
    await logsPage.clickConfirmButton();
  });

  test("should redirect to logs after clicking on stream explorer via stream page", {
    tag: ['@streamExplorer', '@all', '@logs']
  }, async ({ page }) => {
    // Generate a random saved view name
    const randomSavedViewName = `streamslog${Math.random().toString(36).substring(2, 10)}`;
  
    // Interactions with the page
    await logsPage.clickRefreshButton();
    await logsPage.clickSavedViewsExpand();
    await logsPage.clickSaveViewButton();
    await logsPage.fillSavedViewName(randomSavedViewName); // Use the random name
    await logsPage.clickSavedViewDialogSave();
    await logsPage.waitForTimeout(5000);
    await logsPage.clickStreamsMenuItem();
    await logsPage.clickSearchStreamInput();
    await logsPage.fillSearchStreamInput('e2e');
    await logsPage.waitForTimeout(1000);
    await logsPage.clickExploreButton();
    await logsPage.waitForTimeout(5000);
    await logsPage.waitForSavedViewsButton();
    await logsPage.clickSavedViewsExpand();
    await logsPage.clickSavedViewSearchInput();
    await logsPage.fillSavedViewSearchInput(randomSavedViewName); // Use the random name here
    await logsPage.waitForTimeout(3000);
    await logsPage.waitForSavedViewText(randomSavedViewName);
    await logsPage.clickSavedViewByText(randomSavedViewName);
    await logsPage.clickSavedViewsExpand();
    await logsPage.clickSavedViewSearchInput();
    await logsPage.clickSavedViewByTitle(randomSavedViewName); // Use the random name here
  
    // Dynamic delete button selector using the random saved view name
    await logsPage.clickDeleteSavedViewButton(randomSavedViewName);
    await logsPage.clickConfirmButton(); // Confirm deletion
  });

  test("should reset the editor on clicking reset filter button", {
    tag: ['@resetFilters', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await logsPage.clickQueryEditorTextbox();
    await logsPage.typeInQueryEditor("match_all_raw_ignore_case('provide_credentials')");
    await logsPage.waitForSearchBarRefreshButton();
    await logsPage.clickRefreshButton();
    await logsPage.clickResetFiltersButton();
    await logsPage.waitForQueryEditorTextbox();
    await logsPage.expectQueryEditorEmpty();
  });

  test("should add invalid query and display error", {
    tag: ['@invalidQueryLogs', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.waitForTimeout(2000);
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor("kubernetes");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickSearchBarRefreshButton();
    await logsPage.expectErrorMessageVisible();
  });

  test("should not display error if match all case added in log query search", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickDateTimeButton();
    await logsPage.clickRelative15MinButton();

    await logsPage.expectQueryEditorVisible();
    await logsPage.clickQueryEditor();
    await logsPage.typeInQueryEditor("match_all('code')");

    await logsPage.expectSearchBarRefreshButtonVisible();
    await logsPage.clickSearchBarRefreshButton();

    await logsPage.expectLogTableColumnSourceVisible();
  });



  test("should change stream settings and click on search stream", {
    tag: ['@streamSettings', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickStreamsMenuItem();
    await logsPage.waitForTimeout(3000);
    await logsPage.clickStreamsSearchStreamInput();
    await logsPage.fillStreamsSearchStreamInput("e2e_automate");
    await logsPage.waitForTimeout(2000);
    await logsPage.clickStreamDetail();
    await logsPage.clickSchemaStreamIndexSelect();
    await logsPage.clickFullTextSearch();
    await logsPage.clickSchemaUpdateSettingsButton();
    await logsPage.waitForTimeout(3000);
    await logsPage.clickColAutoButton();
    await logsPage.waitForTimeout(3000);
    await logsPage.clickExploreTitle();
    await logsPage.expectLogTableColumnSourceVisible();
  });


  test("should display error if blank spaces added under stream name and clicked create stream ", {
    tag: ['@streamValidation', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickStreamsMenuItem();
    await logsPage.clickAddStreamButton();
    await logsPage.clickAddStreamNameInput();
    await logsPage.typeInQueryEditor("  ");
    await logsPage.clickSaveStreamButton();
    await logsPage.expectFieldRequiredVisible();
  });



  test("should display error if create stream is clicked without adding name", {
    tag: ['@streamValidation', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickStreamsMenuItem();
    await logsPage.clickAddStreamButton();
    await logsPage.waitForSaveStreamButton();
    await logsPage.scrollSaveStreamButtonIntoView();
    await logsPage.clickSaveStreamButton();
    await logsPage.expectFieldRequiredVisible();
  });

  test("should display enter count query", {
    tag: ['@countQuery', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.clickQueryEditorTextbox();
    await logsPage.typeInQueryEditor('SELECT COUNT(_timestamp) AS xyz, _timestamp FROM "e2e_automate"  Group by _timestamp ORDER BY _timestamp DESC');
    await logsPage.waitForTimeout(4000);
    await logsPage.clickSQLModeToggle();
    await logsPage.expectSearchBarRefreshButtonVisible();
    await logsPage.waitForTimeout(3000);
    await logsPage.clickRefreshButton();
    await logsPage.waitForTimeout(4000);
    await logsPage.expectErrorWhileFetchingNotVisible();
    await logsPage.clickBarChartCanvas();
  });

  test("should display values API text successfully and error to not be displayed", {
    tag: ['@valuesAPI', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.fillIndexFieldSearchInput('kubernetes_pod_name');
    await logsPage.clickExpandLabel('kubernetes_pod_name');
    await logsPage.expectErrorWhileFetchingFieldValuesNotVisible();
    await logsPage.clickText('ziox-ingester-');
    await logsPage.clickRefreshButton();
    await logsPage.clickCollapseLabel('kubernetes_pod_name');
    await logsPage.clickExpandLabel('kubernetes_pod_name');
    await logsPage.expectSubfieldAddButtonVisible('kubernetes_pod_name', 'ziox-ingester-');
    await logsPage.clickSubfieldAddButton('kubernetes_pod_name', 'ziox-ingester-');
  });

  test("should display results in selected time", {
    tag: ['@timeSelection', '@all', '@logs']
  }, async ({
    page,
  }) => {

    await logsPage.setDateTimeToToday();


  });

  test("should display results if stringmatch ignorecase lowercase added in log query search", {
    tag: ['@stringMatchIgnoreLowerCase', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.selectStream('e2e_automate');
    await logsPage.setDateTimeTo15Minutes();
    await logsPage.searchWithStringMatchIgnoreCase('ziox');
  });

  test("should display results if stringmatch ignorecase uppercase added in log query search", {
    tag: ['@stringMatchIgnoreUpperCase', '@all', '@logs'] 
  }, async ({ page }) => {
    await logsPage.selectStream('e2e_automate');
    await logsPage.setDateTimeTo15Minutes();
    await logsPage.searchWithStringMatchIgnoreCase('Ziox');
  });

  test("should trigger search results when pressing Cmd+Enter or Ctrl+Enter", {
    tag: ['@keyboardShortcuts', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.executeQueryWithKeyboardShortcutTest();
  });

  test("should execute query with keyboard shortcut (Cmd+Enter or Ctrl+Enter) after clicking elsewhere ", {
    tag: ['@keyboardShortcuts', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.executeQueryWithKeyboardShortcutAfterClickingElsewhere();
  });

  test("should execute different query with keyboard shortcut (Cmd+Enter or Ctrl+Enter)", {
    tag: ['@keyboardShortcuts', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.executeQueryWithKeyboardShortcutWithDifferentQuery();
  });

  test("should execute SQL query with keyboard shortcut (Cmd+Enter or Ctrl+Enter)", {
    tag: ['@keyboardShortcuts', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    await logsPage.executeQueryWithKeyboardShortcutWithSQLMode();
  });

  test("should verify logcount ordering in ascending and descending order", {
    tag: ['@logCountOrdering', '@all', '@logs']
  }, async ({ page }) => {
    // Verify descending order
    await logsPage.verifyLogCountOrderingDescending();
    
    // Verify ascending order
    await logsPage.verifyLogCountOrderingAscending();
  });
})