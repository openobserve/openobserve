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
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath);

    await page.getByRole("button", { name: "Import" }).click();

    await page.waitForTimeout(2000);

    await expect(
      page.getByRole("cell", { name: "Cloudfront to OpenObserve" }).first()
    ).toBeVisible();
    await page
      .getByRole("row", { name: "01 Cloudfront to OpenObserve" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();
  });
  test("should import the dashbaord using URL import", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();
    await page.locator('[data-test="tab-import_json_url"]').click();
    await page.getByLabel("Add your url").click();
    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/AWS%20Cloudfront%20Access%20Logs/Cloudfront_to_OpenObserve.dashboard.json"
      );

    await page.waitForTimeout(2000);

    await expect(
      page.getByRole("code").filter({ hasText: '"dashboardId": "' })
    ).toBeVisible();
  
    //is used for setting the file to be imported
    await page.getByRole("button", { name: "Import" }).click();

    await expect(
      page.getByRole("cell", { name: "Cloudfront to OpenObserve" }).first()
    ).toBeVisible();
    await page
      .getByRole("row", { name: "01 Cloudfront to OpenObserve" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();
  });

  test("Should cancel the file upload action when clicking the Cancel button in the 'Drop your file' dialog", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboards-import.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath);

    await page.getByText("close").click();
    await expect(page.getByLabel("cloud_uploadDrop your file")).toBeVisible();
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("Please Enter a JSON object")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Should display an error validation message when clicking the Import button if the 'Title' field is missing in the .json data.", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath);

    await page.getByRole("button", { name: "Import" }).click();

    await expect(
      page.getByText("Title is required for dashboard ")
    ).toBeVisible();
  });

  test("Should auto-update the .json data at the correct location when the Dashboard title is added from the error validation dialog.", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard1-import.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath);

    await page.getByRole("button", { name: "Import" }).click();

    // Assert that the error message is displayed

    await expect(page.getByText("Title is required for")).toBeVisible();

    await page.getByLabel("Dashboard Title").click();

    const title = "Cloudfront to OpenObserve";

    // Fill in the dashboard title
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

    await page.getByRole("button", { name: "Import" }).click();

    await page.waitForTimeout(2000);

    //  delete the dashboard
    await page
      .getByRole("row", { name: "01 Cloudfront to OpenObserve" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();
  });

  test("Should display an error validation message if the 'Stream type' field is missing in the .json data when clicking the Import button.", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboard2-import.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath);

    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByText('warning1 File(s) Failed to Import')).toBeVisible();
    await expect(
      page.getByText(
        " JSON 1 : Request failed with status code 400"
      )
    ).toBeVisible();
  });

  test("Should save the .json file in the correct folder when selecting a dashboard folder name and delete it", async ({
    page,
  }) => {
    // Step 1: Navigate to the dashboard page
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);

    // Step 2: Click the import dashboard button
    await page.locator('[data-test="dashboard-import"]').click();

    // Step 3: Set the JSON file for import
    const fileContentPath = "../test-data/dashboards-import.json";
    const inputFile = await page.locator('input[type="file"]');
    await inputFile.setInputFiles(fileContentPath);
    await page.waitForTimeout(2000); // Optional wait for file processing

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

    const importButton = page.getByRole("button", { name: "Import" });
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    //  delete the dashboard
    await page
      .getByRole("row", { name: "01 Cloudfront to OpenObserve" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();

    // Log folder name (for debug)
    console.log(`Created folder name: ${folderName}`);

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

    console.log(`Successfully deleted folder via UI: ${folderName}`);
  });

  test("Should import the Version 3 dashboard successfully", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath1 = "../test-data/dashboardV3-import.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath1);

    await page.getByRole("button", { name: "Import" }).click();

    await page.waitForTimeout(2000);

    await expect(
      page.getByRole("cell", { name: "AWS VPC Flow Log" }).first()
    ).toBeVisible();
    await page
      .getByRole("row", { name: "01 AWS VPC Flow Log" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();
  });
  test("Should import the Azure dashboard without errors", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();

    //file name to be used for import
    const fileContentPath = "../test-data/dashboardAzure.json";

    // Locate the file input field and set the JSON file
    const inputFile = await page.locator('input[type="file"]');
    //is used for setting the file to be imported
    await inputFile.setInputFiles(fileContentPath);

    await page.getByRole("button", { name: "Import" }).click();

    await page.waitForTimeout(2000);

    await expect(
      page.getByRole("cell", { name: "Frontdoor" }).first()
    ).toBeVisible();
    await page
      .getByRole("row", { name: "01 Frontdoor" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();
  });

  test("should import the 'Azure Loadblance' dashbaord using URL import", async ({
    page,
  }) => {
    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();
    await page.locator('[data-test="tab-import_json_url"]').click();
    await page.getByLabel("Add your url").click();
    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Azure/Azure%20Loadblancer.dashboard.json"
      );

    await page.waitForTimeout(2000);
    // await page.waitForSelector('.table-row'); // adjust selector as needed
    await expect(
      page
        .getByRole("code")
        .locator("div")
        .filter({ hasText: '"dashboardId": "' })
        .nth(4)
    ).toBeVisible();

    //is used for setting the file to be importedad
    await page.getByRole("button", { name: "Import" }).click();

    await expect(
      page.getByRole("cell", { name: "Azure Loadblancer" }).first()
    ).toBeVisible();
    await page
      .getByRole("row", { name: "01 Azure Loadblancer" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();

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
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-import"]').click();
    await page.locator('[data-test="tab-import_json_url"]').click();
    await page.getByLabel("Add your url").click();
    await page
      .getByLabel("Add your url")
      .fill(
        "https://raw.githubusercontent.com/openobserve/dashboards/refs/heads/main/Kubernetes(kube-prometheus-stack)/Kubernetes%20_%20Compute%20Resources%20_%20Cluster.dashboard.json"
      );

    await page.waitForTimeout(1000);
    //is used for setting the file to be importedad
    await page.getByRole("button", { name: "Import" }).click();
    await page.waitForTimeout(3000);

    await expect(
      page
        .getByRole("cell", { name: "Kubernetes / Compute Resources / Cluster" })
        .first()
    ).toBeVisible();
    await page
      .getByRole("row", { name: "01 Kubernetes / Compute Resources / Cluster" })
      .locator('[data-test="dashboard-delete"]')
      .click();
    await page.locator('[data-test="confirm-button"]').click();

    // Assert no error occurred
    expect(errorMessage).toBe("");
  });
});
