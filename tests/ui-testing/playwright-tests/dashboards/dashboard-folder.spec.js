import { test as base, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage } from "./utils/dashCreation.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardFolder from "../../pages/dashboardPages/dashboard-folder.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import { DashboardPage } from "../../pages/dashboardPage.js";
import { AlertsPage } from "../../pages/alertsPages/alertsPage.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

// Extend Playwright test to grant clipboard permissions
export const test = base.extend({
  context: async ({ browser }, use) => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await use(context);
    await context.close();
  },
});

test.describe.configure({ mode: "parallel" });

test.describe("dashboard folder testcases", () => {
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

  test("Should create and delete a unique folder, and verify it's deleted" ,async ({
    page,
  }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardFolders = new DashboardFolder(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPageActions = new DashboardPage(page);
    const alertsPage = new AlertsPage(page);

    await dashboardPage.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Define folderName first
    const folderName = dashboardFolders.generateUniqueFolderName("t");

    // Create the folder
    await dashboardFolders.createFolder(folderName);
    // Search to confirm it exists
    await dashboardFolders.searchFolder(folderName);
    await alertsPage.verifyFolderCreated(folderName);
    await alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);

    await dashboardCreate.createDashboard(randomDashboardName);
    await page.waitForTimeout(1000);
    await dashboardPageActions.verifyShareDashboardLink(randomDashboardName);
    await page.waitForTimeout(1000);
    // Click on folder name in breadcrumbs to go back to folder view
    await page.getByText(folderName).click();
    await page.waitForTimeout(1000);
    await dashboardPageActions.deleteSearchedDashboard(randomDashboardName);

    // Delete folder
    await dashboardFolders.deleteFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toHaveCount(0);
  });

  test("should create and edit folder name and verify it's updated", async ({
    page,
  }) => {
    const dashboardPage = new DashboardListPage(page);
    const dashboardFolders = new DashboardFolder(page);

    // Navigate to dashboards
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
