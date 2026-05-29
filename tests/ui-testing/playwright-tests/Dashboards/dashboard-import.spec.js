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
    testLogger.info("running before each");
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

    await pm.dashboardImport.expectImportedDashboardVisible(
      "Cloudfront to OpenObserve"
    );

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

    await expect(pm.dashboardImport.importErrorTitleMessage).toBeVisible();

    await pm.dashboardImport.clickDashboardTitleInput();

    const title = "Cloudfront to OpenObserve";

    await pm.dashboardImport.fillDashboardTitleInput(title);

    // Fetch the title from the JSON data via the Monaco editor container.
    // The PO reads the editor text via page.evaluate over the editor host id.
    await pm.dashboardImport.waitForEditorContains(`"title": "${title}"`);
    const jsonTitle = await pm.dashboardImport.readImportedJsonTitle();

    // Normalize both strings to handle any invisible characters or whitespace differences
    const normalizedJsonTitle = jsonTitle.trim().replace(/\s+/g, " ").replace(/[​-‍﻿]/g, "");
    const normalizedExpectedTitle = title.trim().replace(/\s+/g, " ").replace(/[​-‍﻿]/g, "");

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

    await pm.dashboardImport.fillUrlImport(
      "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/AWS%20Cloudfront%20Access%20Logs/Cloudfront_to_OpenObserve.dashboard.json"
    );

    await pm.dashboardImport.waitForEditorContains(
      '"dashboardId":',
      "url"
    );

    await pm.dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

    await pm.dashboardImport.expectImportedDashboardVisible(
      "Cloudfront to OpenObserve"
    );

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

    await pm.dashboardImport.removeUploadedFile(0);

    await pm.dashboardImport.expectFileChipAbsent(0);

    await pm.dashboardImport.clickImportButton();

    await expect(pm.dashboardImport.toastErrorMessage).toContainText(
      "Please Enter a JSON object"
    );

    await pm.dashboardImport.clickCancelButton();
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

    await expect(pm.dashboardImport.importErrorTitleMessage).toContainText(
      "Title is required for dashboard"
    );
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

    await pm.dashboardImport.expectFileRejectedWithToast(
      "File(s) Failed to Import",
      "Request failed with status code 422"
    );
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
    await pm.dashboardImport.openCreateFolderDrawerFromMove();
    await pm.dashboardImport.fillNewFolderName(folderName);
    await pm.dashboardImport.confirmFolderMoveDrawer();

    await pm.dashboardImport.clickImportButton();

    //  delete the dashboard

    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Cloudfront to OpenObserve"
    );

    // Step 6: Delete the folder we created via the folder tab actions
    await pm.dashboardImport.deleteFolderByName(folderName);

    //  Assert folder is deleted
    await pm.dashboardImport.expectFolderAbsent(folderName);
  });

  test("Should import the Version 3 dashboard successfully", async ({
    page,
  }) => {
    //instantiate PageManager with the current page
    const pm = new PageManager(page);

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);
    await pm.dashboardImport.clickImportDashboard();

    //file name to be used for import
    const fileContentPath1 = "../test-data/dashboardV3-import.json";

    // Locate the file input field and set the JSON file
    await pm.dashboardImport.uploadDashboardFile(fileContentPath1);

    await pm.dashboardImport.clickImportButton();

    await waitForDashboardPage(page);
    await pm.dashboardImport.expectImportedDashboardVisible("AWS VPC Flow Log");

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
    await pm.dashboardImport.expectImportedDashboardVisible("Frontdoor");

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
    await pm.dashboardImport.fillUrlImport(
      "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Azure/Azure%20Loadblancer.dashboard.json"
    );

    await pm.dashboardImport.waitForEditorContains(
      '"dashboardId":',
      "url"
    );

    //is used for setting the file to be imported

    await pm.dashboardImport.clickImportButton();
    await waitForDashboardPage(page);

    await pm.dashboardImport.expectImportedDashboardVisible(
      "Azure Loadblancer",
      20000
    );

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

    await pm.dashboardImport.fillUrlImport(
      "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Kubernetes(kube-prometheus-stack)/Kubernetes%20_%20Compute%20Resources%20_%20Cluster.dashboard.json"
    );

    // Wait for JSON content to load in the URL editor
    await pm.dashboardImport.waitForEditorContains('"dashboardId":', "url");

    await pm.dashboardImport.clickImportButton();

    await waitForDashboardPage(page);

    await pm.dashboardImport.expectImportedDashboardVisible(
      "Kubernetes / Compute Resources / Cluster"
    );

    await pm.dashboardImport.deleteImportedDashboard(
      "01",
      "Kubernetes / Compute Resources / Cluster"
    );

    // Assert no error occurred
    expect(errorMessage).toBe("");
  });
});
