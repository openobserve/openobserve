import { test as base, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage } from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

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
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("Should create and delete a unique folder, and verify it's deleted", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Define folderName first
    const folderName = pm.dashboardFolder.generateUniqueFolderName("t");

    // Create the folder
    await pm.dashboardFolder.createFolder(folderName);
    // Search to confirm it exists
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.alertsPage.verifyFolderCreated(folderName);
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);

    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await page.waitForTimeout(1000);
    await pm.dashboardPage.verifyShareDashboardLink(randomDashboardName);
    await page.waitForTimeout(1000);
    // Click on folder name in breadcrumbs to go back to folder view
    await page.getByText(folderName).click();
    await page.waitForTimeout(1000);
    await pm.dashboardPage.deleteSearchedDashboard(randomDashboardName);

    // Delete folder
    await pm.dashboardFolder.deleteFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toHaveCount(0);
  });

  test("should create and edit folder name and verify it's updated", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Define folderName first
    const folderName = pm.dashboardFolder.generateUniqueFolderName("t");

    // Create the folder
    await pm.dashboardFolder.createFolder(folderName);

    // Search to confirm it exists
    await pm.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();

    const updatedName = folderName + "_updated";
    await pm.dashboardFolder.editFolderName(folderName, updatedName);
    await pm.dashboardFolder.searchFolder(updatedName);
    await expect(page.locator(`text=${updatedName}`)).toBeVisible();

    await pm.dashboardFolder.deleteFolder(updatedName);
    await expect(page.locator(`text=${folderName}`)).toHaveCount(0);
  });
});
