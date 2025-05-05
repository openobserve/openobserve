import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDashboardPage } from "../utils/dashCreation.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardFolder from "../../pages/dashboardPages/dashboard-folder.js";

// Refactored test cases using POM

test.describe.configure({ mode: "parallel" });

test.describe("dashboard folder testcases", () => {
  let dashboardPage;
  let dashboardFolders;

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

    dashboardPage = new DashboardListPage(page);
    dashboardFolders = new DashboardFolder(page);
  });

  test("should create and delete a unique folder, and verify it's deleted", async ({
    page,
  }) => {
    await dashboardPage.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Define folderName first
    const folderName = dashboardFolders.generateUniqueFolderName("t");

    // Create the folder
    await dashboardFolders.createFolder(folderName);

    // Search to confirm it exists
    await dashboardFolders.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();

    // Delete folder
    await dashboardFolders.deleteFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toHaveCount(0);
  });

  test("should create and edit folder name and verify it's updated", async ({
    page,
  }) => {
    await dashboardPage.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Define folderName first
    const folderName = dashboardFolders.generateUniqueFolderName("t");

    // Create the folder
    await dashboardFolders.createFolder(folderName);

    // Search to confirm it exists
    await dashboardFolders.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();

    const updatedName = folderName + "_updated";
    await dashboardFolders.editFolderName(folderName, updatedName);
    await dashboardFolders.searchFolder(updatedName);
    await expect(page.locator(`text=${updatedName}`)).toBeVisible();

    await dashboardFolders.deleteFolder(updatedName);
    await expect(page.locator(`text=${folderName}`)).toHaveCount(0);
  });
});
