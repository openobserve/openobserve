const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

// Page size for the Alerts list is 20. Folder A has more than one page and
// Folder B has a single page so "reset to page 1" and "clamp a stale page" are
// both observable and unambiguous. Mirrors Dashboards/dashboardPagination.spec.js,
// which covers the same OTable restorePage fix (#14745) for the Dashboards list.
const FOLDER_A_COUNT = 25;
const FOLDER_B_COUNT = 2;

// Unique per-test seed prefix. Tests run in parallel against a shared org, so
// every test seeds its own folders/alerts/streams and tears them down in afterEach.
const uniqueSeed = () =>
  `e2e_alert_pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Alerts Folder Switch Pagination Reset testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  let folderA;
  let folderB;
  let streamA;
  let streamB;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Seed per test: each test is fully independent under parallel workers.
    const seed = uniqueSeed();
    const prefixA = `${seed}_a`;
    const prefixB = `${seed}_b`;
    streamA = `${prefixA}_stream`;
    streamB = `${prefixB}_stream`;

    folderA = await pm.apiCleanup.createAlertFolder(`${seed}_A`);
    folderB = await pm.apiCleanup.createAlertFolder(`${seed}_B`);
    await pm.apiCleanup.seedAlertsInFolder(folderA.folderId, FOLDER_A_COUNT, prefixA);
    await pm.apiCleanup.seedAlertsInFolder(folderB.folderId, FOLDER_B_COUNT, prefixB);

    await pm.alertsPage.navigateToAlertsPage();
    testLogger.info("Test setup completed", {
      folderA: folderA.name,
      folderB: folderB.name,
    });
  });

  test.afterEach(async () => {
    // Delete seeded alerts first: the folder delete is rejected while it still
    // contains alerts.
    const alertsA = await pm.apiCleanup.fetchAlertsInFolder(folderA.folderId);
    for (const alert of alertsA) {
      await pm.apiCleanup.deleteAlert(alert.alert_id, folderA.folderId);
    }
    const alertsB = await pm.apiCleanup.fetchAlertsInFolder(folderB.folderId);
    for (const alert of alertsB) {
      await pm.apiCleanup.deleteAlert(alert.alert_id, folderB.folderId);
    }
    await pm.apiCleanup.deleteFolder(folderA.folderId);
    await pm.apiCleanup.deleteFolder(folderB.folderId);
    await pm.apiCleanup.deleteStream(streamA);
    await pm.apiCleanup.deleteStream(streamB);
  });

  test(
    "should reset the list to page 1 when switching folders",
    { tag: ["@alerts-pagination-reset", "@all"] },
    async ({ page }) => {
      testLogger.info("Opening folder A and navigating to page 2");
      await pm.alertsPage.navigateToFolder(folderA.name);
      await pm.alertsPage.expectPaginationInfoToMatch(/Showing 1 - 20 of 25/);

      await pm.alertsPage.clickNextPage();
      await pm.alertsPage.expectPaginationInfoToMatch(/Showing 21 - /);

      testLogger.info("Switching to folder B");
      await pm.alertsPage.navigateToFolder(folderB.name);
      await pm.alertsPage.expectPaginationInfoToMatch(/Showing 1 - 2 of 2/);
      testLogger.info("Test completed");
    },
  );

  test(
    "should clamp to page 1 and render rows when switching to a shorter single-page folder",
    { tag: ["@alerts-pagination-reset", "@all"] },
    async ({ page }) => {
      testLogger.info("Opening folder A and navigating to page 2");
      await pm.alertsPage.navigateToFolder(folderA.name);
      await pm.alertsPage.expectPaginationInfoToMatch(/Showing 1 - 20 of 25/);

      await pm.alertsPage.clickNextPage();
      await pm.alertsPage.expectPaginationInfoToMatch(/Showing 21 - /);

      testLogger.info("Switching to the shorter folder B");
      await pm.alertsPage.navigateToFolder(folderB.name);

      await pm.alertsPage.expectPaginationInfoToMatch(/Showing 1 - 2 of 2/);
      await pm.alertsPage.expectAtLeastOneListRow();
      testLogger.info("Test completed");
    },
  );
});
