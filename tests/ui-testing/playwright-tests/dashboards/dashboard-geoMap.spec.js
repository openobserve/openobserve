import { test, expect } from "../baseFixtures.js";
import { login } from "../utils/dashLogin.js";
import geoMapdata from "../../../test-data/geo_map.json";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../utils/dashCreation.js";


// ingestion.js

// Exported function to remove UTF characters
const removeUTFCharacters = (text) => {

    // console.log(text, "tex");
   // Remove UTF characters using regular expression
 return text.replace(/[^\x00-\x7F]/g, " ");
};

// Function to retrieve authentication token (to be implemented securely)
const getAuthToken = async () => {
 const basicAuthCredentials = Buffer.from(
   `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
 ).toString("base64");
 return `Basic ${basicAuthCredentials}`;
};

// page is passed here to access the page object (currently not used)
const ingestion = async (page, streamName = "geojson") => {
 if (!process.env["ORGNAME"] || !process.env["INGESTION_URL"]) {
   throw new Error("Required environment variables are not set");
 }

 const orgId = process.env["ORGNAME"];

 try {
   const headers = {
     "Content-Type": "application/json",
     Authorization: await getAuthToken(),
   };

   const fetchResponse = await fetch(
     `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
     {
       method: "POST",
       headers,
       body: JSON.stringify(geoMapdata),
     }
   );

   if (!fetchResponse.ok) {
     throw new Error(`HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`);
   }

   return await fetchResponse.json();
 } catch (error) {
   console.error("Ingestion failed:", error);
   throw error;
 }
};


const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    // const orgNavigation = page.goto(
    //   `${geoMapdata.geoMapdataUrl}?org_identifier=${process.env["ORGNAME"]}`
    // );


    // await orgNavigation;
  });




 test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("geojson");
    await page
      .getByRole("option", { name: "geojson", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("country");
    await page.getByText("country").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    // await page.waitForTimeout(3000);

    await page.locator('[data-test="dashboard-settings-close-btn"]').click();


    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();
    await button.click();

    await page.locator('[data-test="selected-chart-geomap-item"] img').click();
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .press("Control+a");
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .fill("geojson");

    await page
      .getByRole("option", { name: "geojson", exact: true })
      .click();

      await page.waitForTimeout(2000);
   await page.locator('[data-test="field-list-item-logs-geojson-lat"] [data-test="dashboard-add-latitude-data"]').click();

  await page.locator('[data-test="field-list-item-logs-geojson-lon"] [data-test="dashboard-add-longitude-data"]').click();

  await page.locator('[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-weight-data"]').click();

    // await page.locator('[data-test="dashboard-apply"]').click();


    const filterButton = page.locator(
      '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-filter-geomap-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForTimeout(3000);



    await page
    .locator('[data-test="dashboard-variable-query-value-selector"]').click();
    await page
    .locator('[data-test="dashboard-variable-query-value-selector"]').fill("china");
  
  const option = await page.getByRole("option", { name: "china" });
  await option.click();



  await page.locator('[data-test="dashboard-add-condition-label-0-country"]').click();
  await page.locator('[data-test="dashboard-add-condition-condition-0"]').click();
  await page.locator('[data-test="dashboard-add-condition-operator"]').click();
 

    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForTimeout(3000);

    await page.locator('#chart-map canvas').click({
      position: {
        x: 643,
        y: 69
      }
    });

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashboard_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });
});