const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage } from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');
test.describe.configure({ mode: "parallel" });

test.describe("dashboard Import testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await navigateToBase(page);
    await ingestion(page);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });
  test("should import the dashboard", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    // Locate the file input field and set the JSON file
    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    await pm.dashboardImport.clickImportButton();

    await waitForDashboardPage(page);

    await expect(
      page.getByRole("cell", { name: "Cloudfront to OpenObserve" }).first()
    ).toBeVisible();

    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("Should auto-update the .json data at the correct location when the Dashboard title is added from the error validation dialog.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    await pm.dashboardImport.clickImportButton();

    // Assert that the error message is displayed

    await expect(page.getByText("Title is required for")).toBeVisible();

    await page.getByLabel("Dashboard Title").click();

    const title = "Cloudfront to OpenObserve";

    await page.getByLabel("Dashboard Title").fill(title);

    // Assert that the title is correctly displayed on the UI
    await expect(page.getByText(`"${title}"`)).toBeVisible();

    // Fetch the title from the JSON data - look for the line containing "title": in the JSON editor
    const jsonLine = await page
      .locator('.view-lines .view-line')
      .filter({ hasText: '"title":' })
      .first()
      .innerText();

    // Extract the title value from the JSON line (e.g., '"title": "Cloudfront to OpenObserve"')
    const titleMatch = jsonLine.match(/"title":\s*"([^"]+)"/);
    let jsonTitle = titleMatch ? titleMatch[1] : "";

    // Normalize both strings to handle any invisible characters or whitespace differences
    const normalizedJsonTitle = jsonTitle.trim().replace(/\s+/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
    const normalizedExpectedTitle = title.trim().replace(/\s+/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");

    expect(normalizedJsonTitle).toBe(normalizedExpectedTitle);
    await pm.dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

    //  delete the dashboard
    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("should import the dashbaord using URL import", async ({ page }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    await pm.dashboardImport.clickUrlImportTab();

    await page.getByLabel("Add your url").fill(
      "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/AWS%20Cloudfront%20Access%20Logs/Cloudfront_to_OpenObserve.dashboard.json"
    );

    await expect(
      page.locator(".view-lines").locator(".view-line").filter({ hasText: '"dashboardId": "' })
    ).toBeVisible();

    await pm.dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

    await expect(
      page.getByRole("cell", { name: "Cloudfront to OpenObserve" }).first()
    ).toBeVisible();

    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("Should cancel the file upload action when clicking the Cancel button in the 'Drop your file' dialog", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    const closeIcon = page.locator('.q-file .q-icon').filter({ hasText: 'close' });
    await closeIcon.waitFor({ state: 'visible', timeout: 5000 });
    await closeIcon.click();

    await expect(page.getByLabel("cloud_uploadDrop your file")).toBeVisible();

    await pm.dashboardImport.clickImportButton();

    await expect(page.getByText("Please Enter a JSON object")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Should display an error validation message when clicking the Import button if the 'Title' field is missing in the .json data.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    // Locate the file input field and set the JSON file
    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    //is used for setting the file to be imported

    await pm.dashboardImport.clickImportButton();

    await expect(
      page.getByText("Title is required for dashboard ")
    ).toBeVisible();
  });

  test("Should display an error validation message if the 'Stream type' field is missing in the .json data when clicking the Import button.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard2-import.json";

    // Locate the file input field and set the JSON file
    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    await pm.dashboardImport.clickImportButton();

    await expect(
      page.getByText("warning1 File(s) Failed to Import")
    ).toBeVisible();
    await expect(
      page.getByText(" JSON 1 : Request failed with status code 422")
    ).toBeVisible();
  });

  test("Should save the .json file in the correct folder when selecting a dashboard folder name and delete it", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    // Step 3: Set the JSON file for import
    const fileContentPath = "../test-data/dashboards-import.json";

    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    // Step 4: Create a unique folder via UI
    function generateUniqueFolderName(prefix = "u") {
      return `${prefix}_${Date.now()}`;
    }
    const folderName = generateUniqueFolderName();

    // Fill in the folder name in the input and save it
    await page.locator('[data-test="dashboard-folder-move-new-add"]').click();

    await page.locator('[data-test="dashboard-folder-add-name"]').click();
    await page
      .locator('[data-test="dashboard-folder-add-name"]')
      .fill(folderName);
    await page.locator('[data-test="dashboard-folder-add-save"]').click();

    await pm.dashboardImport.clickImportButton();

    //  delete the dashboard

    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );

    // Step 6: Find the folder card by folder name and click the More (3 dots) icon
    const folderCard = page.locator(`[data-test^="dashboard-folder-tab-"]`, {
      hasText: folderName,
    });

    // Hover over the folder card first
    await folderCard.hover();
    await folderCard.locator('[data-test="dashboard-more-icon"]').click();

    // Step 7: Click Delete Folder option
    await page.locator('[data-test="dashboard-delete-folder-icon"]').click();

    // Step 8: Confirm deletion in modal
    await page.locator('[data-test="confirm-button"]').click();

    //  Assert folder is deleted
    await expect(
      page.locator(`[data-test^="dashboard-folder-tab-"]`, {
        hasText: folderName,
      })
    ).toHaveCount(0);
  });

  test("Should import the Version 3 dashboard successfully", async ({
    page,
  }) => {
    //instantiate PageManager with the current page
    const pm = new PageManager(page);

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();

    await waitForDashboardPage(page);
    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath1 = "../test-data/dashboardV3-import.json";

    // Locate the file input field and set the JSON file
    await pm.dashboardImport.uploadDashboardFile(fileContentPath1);

    await pm.dashboardImport.clickImportButton();

    await waitForDashboardPage(page);
    await expect(
      page.getByRole("cell", { name: "AWS VPC Flow Log" }).first()
    ).toBeVisible();

    await pm.dashboardImport.deleteImportedDashboard("01", "AWS VPC Flow Log");
  });

  test("Should import the Azure dashboard without errors", async ({ page }) => {
    //instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboardAzure.json";

    // Locate the file input field and set the JSON file
    await pm.dashboardImport.uploadDashboardFile(fileContentPath);

    await pm.dashboardImport.clickImportButton();

    await waitForDashboardPage(page);
    await expect(
      page.getByRole("cell", { name: "Frontdoor" }).first()
    ).toBeVisible();

    await pm.dashboardImport.deleteImportedDashboard("01", "Frontdoor");
  });

  test("should import the 'Azure Loadblance' dashboard using URL import", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });

    // Navigate to the dashboard page
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    await pm.dashboardImport.clickUrlImportTab();
    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Azure/Azure%20Loadblancer.dashboard.json"
      );

    await page.waitForSelector(".view-lines", { state: "visible", timeout: 10000 });
    await expect(
      page
        .locator(".view-lines")
        .locator(".view-line")
        .filter({ hasText: '"dashboardId": "' })
        .nth(0)
    ).toBeVisible();

    //is used for setting the file to be imported

    await pm.dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

    await expect(
      page.getByRole("cell", { name: "Azure Loadblancer" }).first()
    ).toBeVisible({ timeout: 20000 });

    await pm.dashboardImport.deleteImportedDashboard("01", "Azure Loadblancer");

    // Assert no error occurred
    expect(errorMessage).toBe("");
  });

  test("should import the 'Kubernetes _ Compute Resources _ Cluster' dashboard using URL import", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });

    // Navigate to the dashboard page

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardImport.clickImportDashboard();

    await pm.dashboardImport.clickUrlImportTab();

    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Kubernetes(kube-prometheus-stack)/Kubernetes%20_%20Compute%20Resources%20_%20Cluster.dashboard.json"
      );

    // Wait for JSON content to load
    // await page.locator('.view-lines .view-line').first().waitFor({ state: "visible", timeout: 10000 });

    await page.waitForTimeout(5000);

    await pm.dashboardImport.clickImportButton();

    await waitForDashboardPage(page);

    await expect(
      page
        .locator('div[title="Kubernetes / Compute Resources / Cluster"]')
        .first()
    ).toBeVisible();

    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Kubernetes / Compute Resources / Cluster"
    );

    // Assert no error occurred
    expect(errorMessage).toBe("");
  });
});
