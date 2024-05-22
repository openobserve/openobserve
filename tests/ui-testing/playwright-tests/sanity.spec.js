import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";

test.describe.configure({ mode: 'parallel' });
const folderName = `Folder ${Date.now()}`

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


const selectStreamAndStreamTypeForLogs = async (page,stream) => {await page.waitForTimeout(
  4000);await page.locator(
  '[data-test="log-search-index-list-select-stream"]').click({ force: true });await page.locator(
  "div.q-item").getByText(`${stream}`).first().click({ force: true });
};
test.describe("Sanity testcases", () => {
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

    // ("ingests logs via API", () => {
      const orgId = process.env["ORGNAME"];
      const streamName = "e2e_automate";
      const basicAuthCredentials = Buffer.from(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
      ).toString('base64');
    
      const headers = {
        "Authorization": `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      };
    
      // const logsdata = {}; // Fill this with your actual data
    
      // Making a POST request using fetch API
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
    //  });
    // const allorgs = page.waitForResponse("**/api/default/organizations**");
    // const functions = page.waitForResponse("**/api/default/functions**");
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page,logData.Stream);
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });
  
  test("should display quick mode toggle button", async ({ page }) => {
    await expect(
      page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"]')
    ).toBeVisible();
  });
  test("should click on interesting fields icon and display query in editor", async ({
    page,
  }) => {

    await page.waitForSelector('[data-test="logs-search-bar-quick-mode-toggle-btn"]');

    // Get the toggle button element
    const toggleButton = await page.$('[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner');
    
    // Evaluate the class attribute to determine if the toggle is in the off state
    const isSwitchedOff = await toggleButton.evaluate(node => node.classList.contains('q-toggle__inner--falsy'));
    
    // If the toggle is switched off, click on it to switch it on
    if (isSwitchedOff) {
        await toggleButton.click();
    }
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("_timestamp");
    await page.waitForTimeout(2000);
    await page
      .locator(".field-container")
      .locator(
        '[data-test="log-search-index-list-interesting-_timestamp-field-btn"]'
      )
      .last()
      .click({
        force: true,
      });
    await page.locator('[aria-label="SQL Mode"] > .q-toggle__inner').click();
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText(/_timestamp/)
        .first()
    ).toBeVisible();
  });

  test('should display result text and pagination', async ({ page }) => {
    await page.getByText('Showing 1 to 250').click();
    await page.getByText('fast_rewind12345fast_forward250arrow_drop_down').click();
  });

  test('should not display chart if histogram off and display again when toggle is on', async ({ page }) => {
    await page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]').click();
    await page.getByText('Showing 1').click();
    expect(await page.locator('[data-test="logs-search-result-bar-chart"]').isVisible()).toBe(false);
    await page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"] div').nth(2).click();
    await page.waitForTimeout(2000)
    await page.waitForSelector('[data-test="logs-search-result-bar-chart"]');
  })


test('should save search, favorite, click on saved search and then delete', async ({ page }) => {
  await page.locator('button').filter({ hasText: 'savesaved_search' }).click();
  await page.locator('[data-test="add-alert-name-input"]').click();
  await page.locator('[data-test="add-alert-name-input"]').fill('sanitytest');
  await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
  await page.locator('[data-test="logs-search-saved-views-btn"]').getByLabel('Expand').click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').fill('sanity');
  await page.getByText('sanitytest').click();
  await page.locator('[data-test="logs-search-saved-views-btn"]').getByLabel('Expand').click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').fill('sanity');
  await page.getByText('favorite_border').click();
  await page.getByText('Favorite Views').click();
  await page.getByRole('button', { name: 'cancel' }).click();
  await page.getByLabel('Collapse').click();
  await page.locator('[data-test="logs-search-saved-views-btn"]').getByLabel('Expand').click();
  await page.locator('[data-test="log-search-saved-view-favorite-list-fields-table"] div').filter({ hasText: 'Favorite Views' }).nth(1).click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').click();
  await page.locator('[data-test="log-search-saved-view-field-search-input"]').fill('san');
  await page.getByText('delete').click();
  await page.locator('[data-test="confirm-button"]').click();
});

test('should only display 5 result if limit 5 added', async ({ page }) => {
  await page.getByLabel('SQL Mode').locator('div').nth(2).click();
  await page.locator('[data-test="logs-search-bar-query-editor"]').getByRole('code').locator('div').filter({ hasText: 'SELECT * FROM "e2e_automate"' }).nth(4).click();
  await page.locator('[data-test="logs-search-bar-query-editor"]').getByLabel('Editor content;Press Alt+F1').fill('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
  await page.waitForTimeout(2000)
  await page.locator('[data-test="logs-search-bar-refresh-btn"]').click({force: true});
  await page.waitForTimeout(2000)
  await page.getByText('Showing 1 to 5 out of 5').click();
});

test('should create a function and then delete it', async ({ page }) => {
  await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  await page.locator('[data-test="logs-search-bar-function-dropdown"] button').filter({ hasText: 'save' }).click();
  await page.locator('#fnEditor > .monaco-editor > .overflow-guard > .monaco-scrollable-element > .lines-content > .view-lines > .view-line').click();
  await page.locator('#fnEditor').getByLabel('Editor content;Press Alt+F1').fill('.a=2');
  await page.locator('[data-test="logs-search-bar-function-dropdown"] button').filter({ hasText: 'save' }).click();
  await page.locator('[data-test="saved-function-name-input"]').click();
  await page.locator('[data-test="saved-function-name-input"]').fill('e2eautomatefunctions');
  await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
  await page.waitForTimeout(2000)
  // await page.locator('[data-test="menu-link-\\/functions-item"]').click();
  await page.locator('[data-test="menu-link-\\/pipeline-item"]').click(); 
  await page.getByPlaceholder('Search Function').click();
  await page.getByPlaceholder('Search Function').fill('e2eautomatefunctions');
  await page.getByRole('button', { name: 'Delete Function' }).click();
  await page.locator('[data-test="confirm-button"]').click();
});


test('should create functions via functions page and delete it', async ({ page }) => {
  // await page.locator('[data-test="menu-link-\\/functions-item"]').click();
 await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
  await page.getByRole('button', { name: 'Create new function' }).click();
  await page.getByLabel('Name').click();
  await page.getByLabel('Name').fill('sanitytest');
  await page.locator('.view-line').click();
  await page.getByLabel('Editor content;Press Alt+F1').fill('sanity=1');
  await page.getByText('sanity=').click();
  await page.getByLabel('Editor content;Press Alt+F1').press('ArrowLeft');
  await page.getByLabel('Editor content;Press Alt+F1').press('ArrowLeft');
  await page.getByLabel('Editor content;Press Alt+F1').press('ArrowLeft');
  await page.getByLabel('Editor content;Press Alt+F1').press('ArrowLeft');
  await page.getByLabel('Editor content;Press Alt+F1').fill('.sanity=1');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByPlaceholder('Search Function').click();
  await page.getByPlaceholder('Search Function').fill('sanity');
  await page.getByRole('button', { name: 'Delete Function' }).click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.getByText('Function deleted').click();
});

test('should create and delete dashboard', async ({ page }) => {
  await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
  await page.waitForTimeout(5000)
  await page.locator('[data-test="dashboard-add"]').click();
  await page.waitForTimeout(5000)
  await page.locator('[data-test="add-dashboard-name"]').click();

  await page.locator('[data-test="add-dashboard-name"]').fill('sanitytest');
  await page.locator('[data-test="dashboard-add-submit"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
  await page.waitForTimeout(3000)
  await page.locator('[data-test="index-dropdown-stream"]').click();
  await page.locator('[data-test="index-dropdown-stream"]').fill('e2e');
  await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
  await page.waitForTimeout(3000)
  await page.locator('[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-x-data"]').click();
  await page.locator('[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubectl_kubernetes_io_default_container"] [data-test="dashboard-add-y-data"]').click();
  await page.locator('[data-test="dashboard-apply"]').click();
  await page.locator('[data-test="date-time-btn"]').click();
  await page.locator('[data-test="date-time-relative-5-d-btn"]').click();
  await page.locator('[data-test="dashboard-apply"]').click();
  await page.locator('[data-test="chart-renderer"] canvas').click({
    position: {
      x: 753,
      y: 200
    }
  });
  await page.locator('[data-test="dashboard-panel-save"]').click();
  await page.locator('[data-test="dashboard-panel-name"]').click();
  await page.locator('[data-test="dashboard-panel-name"]').fill('sanitydash');
  await page.waitForTimeout(2000)
  await page.locator('[data-test="dashboard-panel-save"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="dashboard-edit-panel-sanitydash-dropdown"]').click();
  await page.locator('[data-test="dashboard-delete-panel"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.locator('#q-notify div').filter({ hasText: 'check_circlePanel deleted' }).nth(3).click();
});


const randomFolderName = `Folder${Math.floor(Math.random() * 1000)}`;
test('should create delete folder', async ({ page }) => {
 
  await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="dashboard-search"]').click();
  await page.click('[data-test="dashboard-new-folder-btn"]');
  await page.waitForTimeout(1000);
  await page.click('[data-test="dashboard-folder-add-name"]');
  await page.type('[data-test="dashboard-folder-add-name"]', randomFolderName);
  await page.click('[data-test="dashboard-folder-add-save"]');
  await page.getByText(randomFolderName).click();
  await page.waitForTimeout(5000);
  await page.locator(`[data-test^="dashboard-folder-tab"]:has-text("${randomFolderName}") [data-test="dashboard-delete-folder-icon"]`).click({ force: true });
   await page.waitForTimeout(100);
   await page.click('[data-test="confirm-button"]');


  await page.waitForTimeout(100);
  const notificationMessage = await page.$('.q-notification__message');
  if (notificationMessage) {
    const messageText = await notificationMessage.textContent();
    expect(messageText).toContain('Folder deleted successfully');
  } else {
    // Handle case when notification message is not found
  }
});


test('create template, destination and alert and then delete it', async ({ page }) => {
  
  await page.locator('[data-test="menu-link-\\/alerts-item"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alerts-page"] div').filter({ hasText: 'AlertsDestinationsTemplateskeyboard_arrow_upkeyboard_arrow_down' }).first().click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alert-alerts-tab"]').click({force:true});
  await page.locator('[data-test="alert-templates-tab"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alert-template-list-add-alert-btn"]').click({force:true})
  await page.waitForTimeout(100)
  await page.locator('[data-test="add-template-name-input"]').click();
  await page.waitForTimeout(100);
  await page.locator(
  '[data-test="add-template-name-input"]').fill("sanitytemplates");
 const jsonString = '{"text": "{alert_name} is active"}';
 await page.click(".view-line")
 await page.keyboard.type(jsonString);
  await page.locator(
  '[data-test="add-template-submit-btn"]').click({ force: true });await expect(page.locator(
  ".q-notification__message").getByText(/Template Saved Successfully/).first()).toBeVisible();
  await page.waitForTimeout(1000);
  await page.getByText('AlertsDestinationsTemplates').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alert-destinations-tab"]').click();
  await page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
  await page.locator('[data-test="add-destination-name-input"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="add-destination-name-input"]').fill('sanitydestinations');
  await page.locator('[data-test="add-destination-template-select"]').click();
  await page.getByText('sanitytemplate').click();
  await page.locator('[data-test="add-destination-url-input"]').click();
  await page.locator('[data-test="add-destination-url-input"]').fill('sanity');
  await page.locator('[data-test="add-destination-header--key-input"]').click();
  await page.locator('[data-test="add-destination-submit-btn"]').click();
  await page.locator('[data-test="alert-alerts-tab"]').click();
  await page.locator('[data-test="alert-list-add-alert-btn"]').click();
  await page.locator('[data-test="add-alert-name-input"]').getByLabel('Name *').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="add-alert-name-input"]').getByLabel('Name *').fill('sanityalerts');
  await page.locator('[data-test="add-alert-stream-type-select"]').getByText('arrow_drop_down').click();
  await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
  await page.getByLabel('Stream Name *').click();
  await page.getByLabel('Stream Name *').fill('e2e');
  await page.getByText('e2e_automate').click();
  await page.locator('[data-test="alert-conditions-delete-condition-btn"]').click();
  await page.locator('[data-test="add-alert-destination-select"]').getByLabel('arrow_drop_down').click();
  await page.locator('[data-test="add-alert-detination-sanitydestinations-select-item"]').click();
  await page.locator('[data-test="add-alert-submit-btn"]').click();
  await page.locator('[data-test="alert-list-search-input"]').click();
  await page.locator('[data-test="alert-list-search-input"]').fill('sani');
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alert-list-sanityalerts-delete-alert"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.locator('[data-test="alert-destinations-tab"]').click();
  await page.locator('[data-test="destination-list-search-input"]').click();
  await page.locator('[data-test="destination-list-search-input"]').fill('sani');
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alert-destination-list-sanitydestinations-delete-destination"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.locator('[data-test="alert-templates-tab"]').click();
  await page.locator('[data-test="template-list-search-input"]').click();
  await page.locator('[data-test="template-list-search-input"]').fill('sanit');
  await page.waitForTimeout(2000)
  await page.locator('[data-test="alert-template-list-sanitytemplates-delete-template"]').click();
  await page.locator('[data-test="confirm-button"]').click();
});

test('create stream and delete it', async ({ page }) => {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="log-stream-add-stream-btn"]').click();
  await page.getByLabel('Name *').click();
  await page.getByLabel('Name *').fill('sanitylogstream');
  await page.locator('[data-test="add-stream-type-input"]').getByText('arrow_drop_down').click();
  await page.getByRole('option', { name: 'Logs' }).click();
  await page.locator('[data-test="save-stream-btn"]').click();
  await page.waitForTimeout(2000)
  await page.getByText('Stream created successfully').click();
  await page.getByPlaceholder('Search Stream').click();
  await page.getByPlaceholder('Search Stream').fill('sanitylogstream');
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Ok' }).click();
});

test('should display pagination even after clicking result summary', async ({ page }) => {
  await page.waitForTimeout(2000)
  await page.locator('[data-test="log-table-column-0-\\@timestamp"]').click();
  await page.locator('[data-test="close-dialog"]').click();
  await page.getByText('fast_rewind12345fast_forward250arrow_drop_down').click();
})

test('should change settings successfully', async ({ page }) => {
  await page.waitForTimeout(2000)
  await page.locator('[data-test="menu-link-\\/settings\\/-item"]').click();
  await page.waitForTimeout(2000)
  await page.getByText('General SettingsScrape').click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Scrape Interval (In Seconds) *').fill('16');
  await page.locator('[data-test="dashboard-add-submit"]').click();
  await page.getByText('Organization settings updated').click();
})

test('should display results on click refresh stats', async ({ page }) => {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.locator('[data-test="log-stream-refresh-stats-btn"]').click();
  page.reload();
  await page.getByRole('cell', { name: '01', exact: true }).click();
  
})


})