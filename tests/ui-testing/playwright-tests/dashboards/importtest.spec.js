import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import importdata from "../../../test-data/dashboards-import.json";
import importdata1 from "../../../test-data/dashboard1-import.json";
import importdata2 from "../../../test-data/dashboard2-import.json";
import importdata3 from "../../../test-data/dashboardV3-import.json";
import importdata4 from "../../../test-data/dashboardAzure.json";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import { waitForDashboardPage } from "../utils/dashCreation";

import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";
import DashboardImport from "../../pages/dashboardPages/dashboard.import.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard Import testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("should import the dashbaord", async ({ page }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardImport = new DashboardImport(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    // Locate the file input field and set the JSON file
    // const inputFile = await page.locator('input[type="file"]');
    await dashboardImport.inputFiles1(fileContentPath);

    //is used for setting the file to be imported
    // await inputFile.setInputFiles(fileContentPath);

    await dashboardImport.clickImportButton();

    await page.waitForTimeout(2000);

    await expect(
      page.getByRole("cell", { name: "Cloudfront to OpenObserve" }).first()
    ).toBeVisible();

    await dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("Should auto-update the .json data at the correct location when the Dashboard title is added from the error validation dialog.", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardImport = new DashboardImport(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    // Locate the file input field and set the JSON file
    // const inputFile = await page.locator('input[type="file"]');

    //is used for setting the file to be imported
    // await inputFile.setInputFiles(fileContentPath);

    await dashboardImport.inputFiles1(fileContentPath);

    await dashboardImport.clickImportButton();

    // Assert that the error message is displayed

    await expect(page.getByText("Title is required for")).toBeVisible();

    await page.getByLabel("Dashboard Title").click();

    const title = "Cloudfront to OpenObserve";

    await page.getByLabel("Dashboard Title").fill(title);

    // Assert that the title is correctly displayed on the UI
    await expect(page.getByText(`"${title}"`)).toBeVisible();

    // Fetch the title from the JSON data
    let jsonTitle = await page
      .getByText("Cloudfront to OpenObserve")
      .innerText();

    // need to remove double quote, before comparing
    jsonTitle = jsonTitle?.substring?.(1, jsonTitle?.length - 1);

    // Normalize: Trim spaces, remove newlines, and replace multiple spaces with a single space
    const normalizedJsonTitle = jsonTitle.trim().replace(/\s+/g, " ");

    expect(normalizedJsonTitle).toBe(title);
    await dashboardImport.clickImportButton();
    // await waitForDashboardPage(page);
    // await page.waitForTimeout(2000);

    //  delete the dashboard
    await dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("should import the dashbaord using URL import", async ({ page }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardImport = new DashboardImport(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    await page.locator('[data-test="tab-import_json_url"]').click();

    await page.getByLabel("Add your url").click();

    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/AWS%20Cloudfront%20Access%20Logs/Cloudfront_to_OpenObserve.dashboard.json"
      );

    // await page.waitForTimeout(2000);

    await expect(
      page.getByRole("code").filter({ hasText: '"dashboardId": "' })
    ).toBeVisible();

    await dashboardImport.clickImportButton();

    await expect(
      page.getByRole("cell", { name: "Cloudfront to OpenObserve" }).first()
    ).toBeVisible();

    await dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("Should cancel the file upload action when clicking the Cancel button in the 'Drop your file' dialog", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardImport = new DashboardImport(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    // // Locate the file input field and set the JSON file
    // const inputFile = await page.locator('input[type="file"]');

    // //is used for setting the file to be imported
    // await inputFile.setInputFiles(fileContentPath);

    await dashboardImport.inputFiles1(fileContentPath);

    await page.getByText("close").click();

    await expect(page.getByLabel("cloud_uploadDrop your file")).toBeVisible();

    await dashboardImport.clickImportButton();

    await expect(page.getByText("Please Enter a JSON object")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Should display an error validation message when clicking the Import button if the 'Title' field is missing in the .json data.", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardImport = new DashboardImport(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    // Locate the file input field and set the JSON file
    await dashboardImport.inputFiles1(fileContentPath);

    //is used for setting the file to be imported
    // await inputFile.setInputFiles(fileContentPath);

    await dashboardImport.clickImportButton();

    await expect(
      page.getByText("Title is required for dashboard ")
    ).toBeVisible();
  });
});
