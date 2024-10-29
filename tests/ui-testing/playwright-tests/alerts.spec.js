import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";
const uniqueText = `${new Date().valueOf()}`



// test.describe.configure({ mode: 'parallel' });
const { v4: uuidv4 } = require("uuid");

// Generate UUID
const uuid = uuidv4();

// Remove non-alphabetic characters from UUID
const alphaUuid = uuid.replace(/[^a-zA-Z]/g, "");

// Construct function name
const functionName = `automate${alphaUuid}`;

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
  // await page.getByText('Login as internal user').click();
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

const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(
    4000); await page.locator(
      '[data-test="log-search-index-list-select-stream"]').click({ force: true }); await page.locator(
        "div.q-item").getByText(`${stream}`).first().click({ force: true });
};
test.describe("Alerts testcases", () => {
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
      `${logData.alertUrl}alerts?org_identifier=${process.env["ORGNAME"]}`

    );

  });



  // test("should display Create template on destination page and clicking on it to navigate template page", async ({ page }) => {await page.waitForTimeout(
  //     2000);await page.locator(
  //     '[data-test="alert-destinations-tab"]').click({ force: true });await page.waitForTimeout(
  //     100);await expect(page.getByText(/Create Template/).first()).toBeVisible();await page.getByText(/Create Template/).first().click({
  //     force: true });await expect(page.getByText(/Add Template/).first()).toBeVisible();

  // });

  // test("should display Create template on alerts page and clicking on it to navigate template page", async ({ page }) => {await page.waitForTimeout(
  //   2000);await page.locator(
  //   '[data-test="alert-alerts-tab"]').click({ force: true });await page.waitForTimeout(
  //   100);await expect(page.getByText(/Create Template/).first()).toBeVisible();await page.getByText(/Create Template/).first().click({
  //   force: true });await expect(page.getByText(/Add Template/).first()).toBeVisible();

  // });

  test("should display error when body not added under templates", async ({ page }) => {
    await page.waitForTimeout(
      2000);
    await page.locator('[data-test="alert-templates-tab"]').click({ force: true });
    // await page.waitForTimeout(1000);
    await page.waitForSelector('[data-test="alert-template-list-add-alert-btn"]');
    await page.locator('[data-test="alert-template-list-add-alert-btn"]').click({ force: true });
    await page.waitForSelector('[data-test="add-template-name-input"]');
    await page.locator('[data-test="add-template-name-input"]').fill("test");
    await page.locator('[data-test="add-template-submit-btn"]').click({ force: true });
    await expect(page.locator(".q-notification__message").getByText(/Please fill required fields/).first()).toBeVisible();

  });
  test("should display error when body added but name left blank under templates", async ({ page }) => {
    await page.waitForTimeout(2000);
    await page.locator('[data-test="alert-templates-tab"]').click({ force: true });
    await page.waitForTimeout(1000);
    await page.waitForSelector('[data-test="alert-template-list-add-alert-btn"]')
    await page.locator('[data-test="alert-template-list-add-alert-btn"]').click({ force: true });
    await page.waitForTimeout(100);
    await page.waitForSelector(".view-line")
    await page.click(".view-line")
    await page.keyboard.type("oooo");
    await page.locator('[data-test="add-template-submit-btn"]').click({ force: true });
    await expect(page.locator(".q-notification__message").getByText(/Please fill required fields/).first()).toBeVisible();
  });

  test("should display error only blank spaces added under  template name", async ({ page }) => {
    await page.waitForTimeout(2000);
    await page.locator('[data-test="alert-templates-tab"]').click({ force: true });
    await page.waitForTimeout(1000);
    await page.waitForSelector('[data-test="alert-template-list-add-alert-btn"]');
    await page.locator('[data-test="alert-template-list-add-alert-btn"]').click({ force: true });
    await page.waitForTimeout(100);
    await page.click(".view-line")
    await page.keyboard.type("   ");
    await page.locator('[data-test="add-template-submit-btn"]').click({ force: true });
    await expect(page.locator(".q-notification__message").getByText(/Please fill required fields/).first()).toBeVisible();
  });

  


  test("should display error when valid JSON not entered under template body", async ({ page }) => {
    await page.waitForTimeout(
      2000);

    await page.waitForSelector('[data-test="alert-templates-tab"]');
    await page.locator('[data-test="alert-templates-tab"]').click({ force: true });
    await page.waitForTimeout(1000);
    // await page.route('**/*', route => {
    //   if (route.request().url().includes('alerts/templates')) {
    //     console.log('Alerts templates API request made.');
    //   }
    //   route.continue();
    // });
    // await page.locator('[data-test="alert-list-create-template-btn"]').click({ force: true })
    await page.waitForSelector('[data-test="alert-template-list-add-alert-btn"]');
    await page.locator('[data-test="alert-template-list-add-alert-btn"]').click({
      force: true
    });
    await page.waitForTimeout(1000); await page.locator(
      '[data-test="add-template-name-input"]').fill("test");
    await page.click(".view-line")
    await page.keyboard.type('test');
    await page.waitForTimeout(500);
    await page.locator(
      '[data-test="add-template-submit-btn"]').click({ force: true }); await expect(page.locator(
        ".q-notification__message").getByText(/Please enter valid JSON/).first()).toBeVisible();


  });

  test.skip("should click on add destination button and display error if user clicks directly on save", async ({ page }) => {
    await page.waitForTimeout(
      2000);
    await page.waitForSelector('[data-test="alert-destinations-tab"]');
    await page.locator(
      '[data-test="alert-destinations-tab"]').click({ force: true }); await page.waitForTimeout(
        100);
    await page.waitForSelector('[data-test="alert-destination-list-add-alert-btn"]');
    await page.locator(
      '[data-test="alert-destination-list-add-alert-btn"]').click({
        force: true
      }); await page.locator(

        '[data-test="add-destination-submit-btn"]').click({ force: true }); await expect(page.locator(
          ".q-notification__message").getByText(/Please fill required fields/).first()).toBeVisible();
  })


  test.skip("create clone template, destination and alert and then delete it", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/alerts-item"]').click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="alerts-page"] div')
        .filter({
            hasText:
                "AlertsDestinationsTemplateskeyboard_arrow_upkeyboard_arrow_down",
        })
        .first()
        .click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="alert-alerts-tab"]').click({ force: true });
    await page.locator('[data-test="alert-templates-tab"]').click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="alert-template-list-add-alert-btn"]')
        .click({ force: true });
    await page.waitForTimeout(100);
    await page.locator('[data-test="add-template-name-input"]').click();
    await page.waitForTimeout(100);
    await page
        .locator('[data-test="add-template-name-input"]')
        .fill("sanitytemplates");
    const jsonString = '{"text": "{alert_name} is active"}';
    await page.click(".view-line");
    await page.keyboard.type(jsonString);
    await page.waitForTimeout(500);
    await page
        .locator('[data-test="add-template-submit-btn"]')
        .click({ force: true });
    await expect(
        page
            .locator(".q-notification__message")
            .getByText(/Template Saved Successfully/)
            .first()
    ).toBeVisible();
    await page.waitForTimeout(1000);
    await page.getByText("AlertsDestinationsTemplates").click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="alert-destinations-tab"]').click();
    await page
        .locator('[data-test="alert-destination-list-add-alert-btn"]')
        .click();
    await page.locator('[data-test="add-destination-name-input"]').click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="add-destination-name-input"]')
        .fill("sanitydestinations");
    await page.locator('[data-test="add-destination-template-select"]').click();
    await page.getByText("sanitytemplates").click();
    await page.locator('[data-test="add-destination-url-input"]').click();
    await page
        .locator('[data-test="add-destination-url-input"]')
        .fill("sanity");
    await page
        .locator('[data-test="add-destination-header--key-input"]')
        .click();
    await page.locator('[data-test="add-destination-submit-btn"]').click();
    await page.locator('[data-test="alert-alerts-tab"]').click();
    await page.locator('[data-test="alert-list-add-alert-btn"]').click();
    await page
        .locator('[data-test="add-alert-name-input"]')
        .getByLabel("Name *")
        .click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="add-alert-name-input"]')
        .getByLabel("Name *")
        .fill("sanityalerts");
    await page.waitForTimeout(200);
    await page
        .locator('[data-test="add-alert-stream-type-select"]')
        .getByText("arrow_drop_down")
        .click();
    await page
        .getByRole("option", { name: "logs" })
        .locator("div")
        .nth(2)
        .click();
    await page.waitForResponse((response) => 
        response.url().includes("api/default/streams?type=logs") && response.status() === 200
    );

    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("e2e_automate");
    
    await page.getByText("e2e_automate").click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="alert-conditions-delete-condition-btn"]')
        .click();
    await page
        .locator('[data-test="add-alert-destination-select"]')
        .getByLabel("arrow_drop_down")
        .click();
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="add-alert-detination-sanitydestinations-select-item"] div')
        .filter({ hasText: 'sanitydestinations' })
        .first()
        .click({ force: true });
    await page.locator('[data-test="add-alert-submit-btn"]').click();
  
    // Clone the alert
    await page.locator('[data-test="alert-clone"]').click(); // Ensure this selector is correct
    await page.getByLabel('Alert Name').click();
    await page.getByLabel('Alert Name').fill('test-clone');
    await page.locator('[data-test="to-be-clone-alert-name"').click()
    await page.locator('[data-test="to-be-clone-alert-name"').fill('test-clone');
    await page.locator('[data-test="to-be-clone-stream-type"').click();
    
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="to-be-clone-stream-name"').click();
    await page.locator('[data-test="to-be-clone-stream-name"').fill('e2e_automate');
    await page.getByRole('option', { name: 'e2e_automate' }).click();
    await page.locator('[data-test="clone-alert-submit-btn"]').click();
    // await page.locator('.q-form > label:nth-child(2) > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    // await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    // await page.getByLabel('Stream Name').click();
    // await page.getByLabel('Stream Name').fill('e2e_automate');
    // await page.getByRole('option', { name: 'e2e_automate' }).click();
    // await page.locator('[data-test="add-alert-submit-btn"]').click();
  
    // Delete the cloned alert
    await page.getByRole('cell', { name: 'test-clone' }).click();
    await page.locator('[data-test="alert-list-test-clone-delete-alert"]').click(); // Adjust the selector if necessary
    await page.locator('[data-test="confirm-button"]').click();
  
    // Delete the original alert
    await page.locator('[data-test="alert-list-sanityalerts-delete-alert"]').click();
    await page.locator('[data-test="confirm-button"]').click();
  
    // Delete destination and template
    await page.locator('[data-test="alert-destinations-tab"]').click();
    await page.locator('[data-test="destination-list-search-input"]').click();
    await page
        .locator('[data-test="destination-list-search-input"]')
        .fill("sani");
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="alert-destination-list-sanitydestinations-delete-destination"]')
        .click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator('[data-test="alert-templates-tab"]').click();
    await page.locator('[data-test="template-list-search-input"]').click();
    await page
        .locator('[data-test="template-list-search-input"]')
        .fill("sanit");
    await page.waitForTimeout(2000);
    await page
        .locator('[data-test="alert-template-list-sanitytemplates-delete-template"]')
        .click();
    await page.locator('[data-test="confirm-button"]').click();
  });
  

});