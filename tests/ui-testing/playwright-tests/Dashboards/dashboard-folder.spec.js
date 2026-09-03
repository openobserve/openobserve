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

// Generated per test: the tests run in parallel, and a module-scope name is also
// reused across CI retries (they share the worker), so a run that dies between
// createDashboard and delete leaves same-named strays that deleteDashboard's
// `.first()` then resolves ambiguously.
const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

test.describe.configure({ mode: "parallel" });

test.describe("dashboard folder testcases", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("Should create and delete a unique folder, and verify it's deleted", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Define folderName first
    const folderName = pm.dashboardFolder.generateUniqueFolderName("t");

    // Create the folder
    await pm.dashboardFolder.createFolder(folderName);
    // Search to confirm it exists
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.openFolderByName(folderName);

    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardPage.verifyShareDashboardLink(dashboardName);
    // Click the back button to return to the folder dashboard list.
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardPage.deleteSearchedDashboard(dashboardName);

    // Delete folder
    await pm.dashboardFolder.deleteFolder(folderName);
    await pm.dashboardFolder.verifyFolderNotPresent(folderName);
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
    await pm.dashboardFolder.verifyFolderVisible(folderName);

    const updatedName = folderName + "_updated";
    await pm.dashboardFolder.editFolderName(folderName, updatedName);
    await pm.dashboardFolder.searchFolder(updatedName);
    await pm.dashboardFolder.verifyFolderVisible(updatedName);

    await pm.dashboardFolder.deleteFolder(updatedName);
    await pm.dashboardFolder.searchFolder(updatedName);
    await pm.dashboardFolder.verifyFolderNotPresent(updatedName);
    // The pre-rename name must be gone too - it stopped existing at the rename,
    // which is why asserting only this one could never fail the delete.
    await pm.dashboardFolder.verifyFolderNotPresent(folderName);
  });
});
