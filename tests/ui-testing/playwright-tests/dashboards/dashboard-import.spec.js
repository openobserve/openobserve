import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage } from "./utils/dashCreation.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
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
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    // Locate the file input field and set the JSON file
    await dashboardImport.uploadDashboardFile(fileContentPath);

    await dashboardImport.clickImportButton();

    await waitForDashboardPage(page);

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
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    await dashboardImport.uploadDashboardFile(fileContentPath);

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
    await waitForDashboardPage(page);

    //  delete the dashboard
    await dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );
  });

  test("should import the dashbaord using URL import", async ({ page }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
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

    await expect(
      page.locator(".cm-content").filter({ hasText: '"dashboardId": "' })
    ).toBeVisible();

    await dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

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
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    await dashboardImport.uploadDashboardFile(fileContentPath);

    await page.getByText("close").click();

    await expect(page.getByLabel("cloud_uploadDrop your file")).toBeVisible();

    await dashboardImport.clickImportButton();

    await expect(page.getByText("Please Enter a JSON object")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Should display an error validation message when clicking the Import button if the 'Title' field is missing in the .json data.", async ({
    page,
  }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    // Locate the file input field and set the JSON file
    await dashboardImport.uploadDashboardFile(fileContentPath);

    //is used for setting the file to be imported

    await dashboardImport.clickImportButton();

    await expect(
      page.getByText("Title is required for dashboard ")
    ).toBeVisible();
  });

  test("Should display an error validation message if the 'Stream type' field is missing in the .json data when clicking the Import button.", async ({
    page,
  }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard2-import.json";

    // Locate the file input field and set the JSON file
    await dashboardImport.uploadDashboardFile(fileContentPath);

    await dashboardImport.clickImportButton();

    await expect(
      page.getByText("warning1 File(s) Failed to Import")
    ).toBeVisible();
    await expect(
      page.getByText(" JSON 1 : Request failed with status code 400")
    ).toBeVisible();
  });

  test("Should save the .json file in the correct folder when selecting a dashboard folder name and delete it", async ({
    page,
  }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    // Step 3: Set the JSON file for import
    const fileContentPath = "../test-data/dashboards-import.json";

    await dashboardImport.uploadDashboardFile(fileContentPath);

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

    await dashboardImport.clickImportButton();

    //  delete the dashboard

    await dashboardImport.deleteImportedDashboard(
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
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();

    await waitForDashboardPage(page);
    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath1 = "../test-data/dashboardV3-import.json";

    // Locate the file input field and set the JSON file
    await dashboardImport.uploadDashboardFile(fileContentPath1);

    await dashboardImport.clickImportButton();

    await waitForDashboardPage(page);
    await expect(
      page.getByRole("cell", { name: "AWS VPC Flow Log" }).first()
    ).toBeVisible();

    await dashboardImport.deleteImportedDashboard("01", "AWS VPC Flow Log");
  });

  test("Should import the Azure dashboard without errors", async ({ page }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboardAzure.json";

    // Locate the file input field and set the JSON file
    await dashboardImport.uploadDashboardFile(fileContentPath);

    await dashboardImport.clickImportButton();

    await waitForDashboardPage(page);
    await expect(
      page.getByRole("cell", { name: "Frontdoor" }).first()
    ).toBeVisible();

    await dashboardImport.deleteImportedDashboard("01", "Frontdoor");
  });

  test("should import the 'Azure Loadblance' dashboard using URL import", async ({
    page,
  }) => {
    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });
    const dashboardPage = new DashboardListPage(page);
    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page
    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    await page.locator('[data-test="tab-import_json_url"]').click();
    await page.getByLabel("Add your url").click();
    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Azure/Azure%20Loadblancer.dashboard.json"
      );

    await page.waitForTimeout(2000);

    await page.waitForSelector(".cm-content");
    await expect(
      page
        .locator(".cm-content")
        .locator(".cm-line")
        .filter({ hasText: '"dashboardId": "' })
        .nth(0)
    ).toBeVisible();

    //is used for setting the file to be importedad

    await dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

    await expect(
      page.getByRole("cell", { name: "Azure Loadblancer" }).first()
    ).toBeVisible();

    await dashboardImport.deleteImportedDashboard("01", "Azure Loadblancer");

    // Assert no error occurred
    expect(errorMessage).toBe("");
  });

  test("should import the 'Kubernetes _ Compute Resources _ Cluster' dashbaord using URL import", async ({
    page,
  }) => {
    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });

    const dashboardPage = new DashboardListPage(page);

    const dashboardImport = new DashboardImport(page);

    // Navigate to the dashboard page

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardImport.clickImportDashboard();

    await page.locator('[data-test="tab-import_json_url"]').click();

    await page.getByLabel("Add your url").click();
    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Kubernetes(kube-prometheus-stack)/Kubernetes%20_%20Compute%20Resources%20_%20Cluster.dashboard.json"
      );
    await page.waitForTimeout(1000);

    //is used for setting the file to be importedad
    await dashboardImport.clickImportButton();

    await waitForDashboardPage(page);

    await expect(
      page
        .getByRole("cell", { name: "Kubernetes / Compute Resources / Cluster" })
        .first()
    ).toBeVisible();

    await dashboardImport.deleteImportedDashboard(
      "01",
      "Kubernetes / Compute Resources / Cluster"
    );

    // Assert no error occurred
    expect(errorMessage).toBe("");
  });
});
