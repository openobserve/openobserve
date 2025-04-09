import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion, removeUTFCharacters } from "../utils/dashIngestion.js";  
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../utils/dashCreation.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardFolder from "../../pages/dashboardPages/dashboard-folder.js"

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

  export function generateUniqueFolderName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

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

test("should create and delete a unique folder, and verify it's deleted", async ({ page }) => {
  const dashboardPage = new DashboardListPage(page);
  const dashboardFolders = new DashboardFolder(page);

  await dashboardPage.menuItem('dashboards-item');
  await waitForDashboardPage(page);

  //  Define folderName first
  const folderName = dashboardFolders.generateUniqueFolderName("t");
  console.log(`Created folder name: ${folderName}`);

  // Create the folder
  await dashboardFolders.createFolder(folderName);

  // Search to confirm it exists
  await dashboardFolders.searchFolder(folderName);

  //  Delete folder
  await dashboardFolders.deleteFolder(folderName);
});

test("should create and Edit folder name and verify it's updated", async ({ page }) => {
  const dashboardPage = new DashboardListPage(page);
  const dashboardFolders = new DashboardFolder(page);


  await dashboardPage.menuItem('dashboards-item');
  await waitForDashboardPage(page);

  //  Define folderName first
  const folderName = dashboardFolders.generateUniqueFolderName("t");
  console.log(`Created folder name: ${folderName}`);

  // Create the folder
  await dashboardFolders.createFolder(folderName);

  // Search to confirm it exists
  await dashboardFolders.searchFolder(folderName);
  
  const updatedName = folderName + "_updated";
  await dashboardFolders.editFolderName(folderName, updatedName);
  await dashboardFolders.searchFolder(updatedName);
 await dashboardFolders.deleteFolder(updatedName);
});
});