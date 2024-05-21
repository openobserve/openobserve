import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";

test.describe.configure({ mode: 'parallel' });
const streamName = `stream${Date.now()}`

async function login(page) {
      await page.goto(process.env["ZO_BASE_URL"]);
    // await page.getByText('Login as internal user').click();
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
  //     await page.waitForTimeout(4000);
  // await page.goto(process.env["ZO_BASE_URL"]);
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

const selectStreamAndStreamTypeForLogs = async (page,stream) => {await page.waitForTimeout(
  4000);await page.locator(
  '[data-test="log-search-index-list-select-stream"]').click({ force: true });await page.locator(
  "div.q-item").getByText(`${stream}`).first().click({ force: true });
};
test.describe("Schema testcases", () => {
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
    await page.waitForTimeout(5000)
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page,logData.Stream);
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });
 
  test('stream schema settings updated to be displayed under logs', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill('e2e_automate');
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.getByRole('cell', { name: 'kubernetes_annotations_kubectl_kubernetes_io_default_container' }).click();
    await page.getByRole('cell', { name: 'kubernetes_annotations_kubernetes_io_psp' }).click();
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(5000);
    await page.locator('button').filter({ hasText: 'close' }).click();
    await page.getByRole('button', { name: 'Explore' }).first().click();
    await page.locator('[data-test="log-table-column-0-\\@timestamp"] [data-test="table-row-expand-menu"]').click();
    await page.getByText('{ arrow_drop_down_all:{"code').click();
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill('e2e_automate');
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.locator('button').filter({ hasText: 'close' }).click();
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Explore' }).first().click();
    await page.locator('[data-test="log-table-column-0-\\@timestamp"] [data-test="table-row-expand-menu"]').click();
    await page.getByText('{ arrow_drop_down_timestamp:').click();
 
  })


  test('should display stream details on navigating from blank stream to stream with details', async ({ page }) => {
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
    await page.locator('#fnEditor > .monaco-editor > .overflow-guard > .monaco-scrollable-element > .lines-content > .view-lines > .view-line').click()
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill(streamName);
    await page.getByRole('option', { name: streamName }).locator('div').nth(2).click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill('e2e_automate');
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.waitForTimeout(4000);
    await page.waitForSelector('text=Loading...', { state: 'hidden' });
    await page.getByTitle('_timestamp').click();
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill(streamName);
    await page.locator('[data-test="log-stream-refresh-stats-btn"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Ok' }).click();
  });

  test('should details on navigating from blank stream to stream with details', async ({ page }) => {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.getByPlaceholder('Search Stream').click();
  await page.getByPlaceholder('Search Stream').fill('e2e_automate');
  await page.getByRole('button', { name: 'Stream Detail' }).first().click();
  await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
  await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
  await page.locator('[data-test="schema-add-field-button"]').click();
  await page.locator('[data-test="schema-update-settings-button"]').click();
  await page.locator('[data-test="add-stream-add-field-btn"]').click();
  await page.getByPlaceholder('Name *').click();
  await page.getByPlaceholder('Name *').fill('newtest');
  await page.locator('[data-test="schema-update-settings-button"]').click();
  await page.locator('[data-test="schema-stream-delete-newtest-field-fts-key-checkbox"]').click();
  await page.locator('[data-test="schema-add-field-button"]').click();
  await page.locator('[data-test="schema-update-settings-button"]').click();
  await page.getByRole('cell', { name: 'newtest' }).first().click();
  await page.locator('[data-test="schema-stream-delete-newtest-field-fts-key-checkbox"]').first().click();
  await page.locator('[data-test="schema-delete-button"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.waitForTimeout(2000);
  await page.locator('button').filter({ hasText: 'close' }).click()
  await page.waitForTimeout(1000);
  // await page.getByPlaceholder('Search Stream').click();
  // await page.getByPlaceholder('Search Stream').fill('e2e_automate');
  await page.getByRole('button', { name: 'Stream Detail' }).first().click();
  await page.locator('[data-test="tab-schemaFields"]').click();
  await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
  await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
  // await page.locator('[data-test="schema-stream-delete-oooo-field-fts-key-checkbox"]').click();
  await page.locator('[data-test="schema-add-field-button"]').click();
  await page.locator('[data-test="schema-update-settings-button"]').click();

  })
})