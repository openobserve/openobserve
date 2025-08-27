import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";

test.describe.configure({ mode: 'parallel' });
const streamName = `stream${Date.now()}`;

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
}
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page.locator('label').filter({ hasText: 'Password *' }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}

async function ingestion(page, testStreamName) {
  const orgId = "automationtesting";
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
    streamName: testStreamName,
    logsdata: logsdata
  });
  console.log(response);
}

test.describe("Schema testcases", () => {
  let pageManager;
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
  }

  // Each test handles its own setup with unique streams

  test('stream schema settings updated to be displayed under logs', async ({ page }) => {
    const testStreamName = "test1";
    
    // Setup for this test
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(1000);
    await ingestion(page, testStreamName);
    await page.waitForTimeout(2000);

    await page.goto(`${logData.logsUrl}?org_identifier=automationtesting`);
    const allsearch = page.waitForResponse("**/api/automationtesting/_search**");
    await pageManager.logsPage.selectStream(testStreamName); 
    await applyQueryButton(page);
    
    // Start of actual test
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill(testStreamName);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.getByRole('cell', { name: 'kubernetes_annotations_kubectl_kubernetes_io_default_container' }).click();
    await page.getByRole('cell', { name: 'kubernetes_annotations_kubernetes_io_psp' }).click();
    await page.waitForTimeout(1000);
    await ingestion(page, testStreamName);
    await page.waitForTimeout(2000);
    await page.getByRole('button').filter({ hasText: 'close' }).click();
    await page.getByRole('button', { name: 'Explore' }).first().click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-tab"]').click();
    // await page.locator('[data-test="date-time-relative-15-m-btn"]').click();
    await page.waitForTimeout(2000);
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]').click();
    await page.waitForTimeout(1000);

    await page.locator('[data-test="logs-user-defined-fields-btn"]').click();
    await page.locator('[data-test="log-search-index-list-interesting-_all-field-btn"]').last().click({force: true});

    await applyQueryButton(page);
     await page.getByText(/^arrow_drop_down_all:.*$/).click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').fill('_timestamp');
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_timestamp').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').fill('_all');
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_all')
    await page.locator('[data-test="logs-all-fields-btn"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_all')
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').fill('_timestamp');
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_timestamp').click();

    await page.waitForSelector('[data-test="log-expand-detail-key-_all"]', { state: 'visible' });
    await page.locator('[data-test="logs-search-bar-query-editor"]').locator('.cm-content').click();
    await page.keyboard.type("str_match(_all, \'test\')");
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(2000);
    const errorMessage = page.locator('[data-test="logs-search-error-message"]');
    await expect(errorMessage).not.toBeVisible();
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill(testStreamName);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.getByRole('button').filter({ hasText: 'close' }).click();
    await page.waitForTimeout(1000);
    await ingestion(page, testStreamName);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Explore' }).first().click();
    await page.waitForTimeout(3000);
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-tab"]').click();
    // await page.locator('[data-test="date-time-relative-15-m-btn"]').click();
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]').click();
    await page.getByText('arrow_drop_down_timestamp:').click();
  });

  test('should display stream details on navigating from blank stream to stream with details', async ({ page }) => {
    const testStreamName = "test2";
    
    // Setup for this test
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(1000);
    await ingestion(page, testStreamName);
    await page.waitForTimeout(2000);

    await page.goto(`${logData.logsUrl}?org_identifier=automationtesting`);
    await pageManager.logsPage.selectStream(testStreamName); 
    await applyQueryButton(page);
    
    // Start of actual test
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.locator('[data-test="log-stream-add-stream-btn"]').click();
    await page.getByLabel('Name *').click();
    await page.getByLabel('Name *').fill(streamName);
    await page.locator('.q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="save-stream-btn"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="menu-link-\\/-item"]').click();
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
    //before we click on fn editor we need to turn on the function editor if is toggled off
    await page.locator('[data-test="logs-search-bar-show-query-toggle-btn"] div').first().click();
    await page.locator('#fnEditor').getByRole('textbox').click()
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill(streamName);
    await page.getByText(streamName).click();
    // await page.getByRole('option', { name: streamName }).locator('div').nth(2).click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill(testStreamName);
    // await page.getByRole('option', { name: testStreamName }).locator('div').nth(2).click();
    await page.getByText(testStreamName).click();
    await page.waitForTimeout(4000);
    await page.waitForSelector('text=Loading...', { state: 'hidden' });
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_timestamp').click()
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill(streamName);
    await page.waitForTimeout(1000);
    await page.locator('[data-test="log-stream-refresh-stats-btn"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Ok' }).click();
  });

  test('should add a new field and delete it from schema', async ({ page }) => {
    const testStreamName = "test3";
    
    // Setup for this test
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(1000);
    await ingestion(page, testStreamName);
    await page.waitForTimeout(2000);

    await page.goto(`${logData.logsUrl}?org_identifier=automationtesting`);
    await pageManager.logsPage.selectStream(testStreamName); 
    await applyQueryButton(page);
    
    // Start of actual test
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill(testStreamName);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-allFields"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.locator('[data-test="schema-add-fields-title"]').click();
    
    await page.getByPlaceholder('Name *').click();
    await page.getByPlaceholder('Name *').fill('newtest');
    await page.getByPlaceholder('Data Type *').click();
    const dataTypeOptions = [
      () => page.getByRole('option', { name: 'Float64' }).locator('span').click(),
      () => page.getByRole('option', { name: 'Int64', exact: true }).locator('span').click(),
      () => page.getByRole('option', { name: 'Boolean' }).click()
    ];
    const randomOption = dataTypeOptions[Math.floor(Math.random() * dataTypeOptions.length)];
    await randomOption();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.locator('[data-test="schema-field-search-input"]').fill('newtest');
    await page.waitForTimeout(1000);
    await page.locator('[data-test="schema-stream-delete-newtest-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    
    await page.getByRole('cell', { name: 'newtest' }).first().click();
    await page.locator('[data-test="schema-stream-delete-newtest-field-fts-key-checkbox"]').first().click();
    await page.locator('[data-test="schema-delete-button"]').click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.waitForTimeout(2000);
    await page.locator('button').filter({ hasText: 'close' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
  });
})