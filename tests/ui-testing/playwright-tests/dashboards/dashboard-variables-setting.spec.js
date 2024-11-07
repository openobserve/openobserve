import { test, expect } from "@playwright/test";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"], { waitUntil: "networkidle" });
  // await page.getByText('Login as internal user').click();
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);

  // wait for login api response
  const waitForLogin = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/login") && response.status() === 200
  );

  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();

  await waitForLogin;

  await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", {
    waitUntil: "networkidle",
  });
  await page
    .locator('[data-test="navbar-organizations-select"]')
    .getByText("arrow_drop_down")
    .click();
  await page.getByRole("option", { name: "default", exact: true }).click();
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const fetchResponse = await fetch(
    `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
    {
      method: "POST",
      headers: headers,
      body: JSON.stringify(logsdata),
    }
  );
  const response = await fetchResponse.json();
  console.log(response);
}

async function waitForDashboardPage(page) {
  const dashboardListApi = page.waitForResponse(
    (response) =>
      /\/api\/.+\/dashboards/.test(response.url()) && response.status() === 200
  );

  await page.waitForURL(process.env["ZO_BASE_URL"] + "/web/dashboards**");

  await page.waitForSelector(`text="Please wait while loading dashboards..."`, {
    state: "hidden",
  });
  await dashboardListApi;
  await page.waitForTimeout(500);
}

test.describe("dashboard variables setting", () => {
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
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    // just to make sure org is set
    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    await orgNavigation;
  });

  test("should try to open variables, click add variable, and without saving close it ", async ({ page, }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
  })

  test("should add query_values to dashboard and save it", async ({ page, }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.getByRole('option', { name: 'Query Values' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-name"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill('query_value_test');
    await page.locator('[data-test="dashboard-variable-label"]').click();
    await page.locator('[data-test="dashboard-variable-label"]').fill('namespace');
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="dashboard-variable-stream-select"]').click();
    await page.getByRole('option', { name: 'e2e_automate' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').fill('names');
    await page.getByText('kubernetes_namespace_name').click();
    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator('[data-test="dashboard-variable-query-value-selector"]').click();
  });

  test("should add max records size, check toggle of multi select, and save it", async ({ page, }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.getByRole('option', { name: 'Query Values' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-name"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill('query_value_test');
    await page.locator('[data-test="dashboard-variable-label"]').click();
    await page.locator('[data-test="dashboard-variable-label"]').fill('namespace');
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="dashboard-variable-stream-select"]').click();
    await page.getByRole('option', { name: 'e2e_automate' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').fill('names');
    await page.getByText('kubernetes_namespace_name').click();
    await page.locator('[data-test="dashboard-variable-max-record-size"]').click();
    await page.locator('[data-test="dashboard-variable-max-record-size"]').fill('2');
    await page.locator('[data-test="dashboard-query_values-show_multiple_values"] div').nth(2).click();
    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator('[data-test="dashboard-variable-query-value-selector"]').click();
  });

  test("should verify that by default select is working", async ({ page, }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.getByRole('option', { name: 'Query Values' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-name"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill('query_value_test');
    await page.locator('[data-test="dashboard-variable-label"]').click();
    await page.locator('[data-test="dashboard-variable-label"]').fill('namespace');
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="dashboard-variable-stream-select"]').click();
    await page.getByRole('option', { name: 'e2e_automate' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').fill('names');
    await page.getByText('kubernetes_namespace_name').click();
    await page.locator('[data-test="dashboard-variable-max-record-size"]').click();
    await page.locator('[data-test="dashboard-variable-max-record-size"]').fill('2');
    await page.locator('[data-test="dashboard-query_values-show_multiple_values"] div').nth(2).click();
    await page.locator('[data-test="dashboard-multi-select-default-value-toggle-first-value"]').click();
    await page.locator('[data-test="dashboard-multi-select-default-value-toggle-all-values"]').click();
    await page.locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]').click();
    await page.locator('[data-test="dashboard-add-custom-value-btn"]').click();
    await page.locator('[data-test="dashboard-variable-custom-value-0"]').click();
    await page.locator('[data-test="dashboard-variable-custom-value-0"]').fill('ingress-nginx');
    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator('[data-test="dashboard-variable-query-value-selector"]').click();
  })

  test("should verify that hide on dashboard is working", async ({ page, }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.getByRole('option', { name: 'Query Values' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-name"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill('query_value_test');
    await page.locator('[data-test="dashboard-variable-label"]').click();
    await page.locator('[data-test="dashboard-variable-label"]').fill('namespace');
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="dashboard-variable-stream-select"]').click();
    await page.getByRole('option', { name: 'e2e_automate' }).locator('span').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page.locator('[data-test="dashboard-variable-field-select"]').fill('names');
    await page.getByText('kubernetes_namespace_name').click();
    await page.locator('[data-test="dashboard-variable-hide_on_dashboard"] div').nth(2).click()
    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
  })
});

  