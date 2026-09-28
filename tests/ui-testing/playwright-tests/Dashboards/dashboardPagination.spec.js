const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
const { waitForDashboardPage } = require("./utils/dashCreation.js");

// Page size for the Dashboards list is 20. Folder A has more than one page and
// Folder B has a single page so "reset to page 1" and "clamp a stale page" are
// both observable and unambiguous.
const FOLDER_A_COUNT = 25;
const FOLDER_B_COUNT = 2;

// Unique per-test seed prefix. Tests run in parallel against a shared org, so
// every test seeds its own folders/dashboards and tears them down in afterEach.
const uniqueSeed = () =>
  `e2e_pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Folder Switch Pagination Reset testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  let folderA;
  let folderB;
  let dashboardsA = [];
  let dashboardsB = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Seed per test: each test is fully independent under parallel workers.
    const seed = uniqueSeed();
    folderA = await pm.apiCleanup.createDashboardFolder(`${seed}_A`);
    folderB = await pm.apiCleanup.createDashboardFolder(`${seed}_B`);
    dashboardsA = await pm.apiCleanup.seedDashboardsInFolder(
      folderA.folderId,
      FOLDER_A_COUNT,
      `${seed}_a`,
    );
    dashboardsB = await pm.apiCleanup.seedDashboardsInFolder(
      folderB.folderId,
      FOLDER_B_COUNT,
      `${seed}_b`,
    );

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    testLogger.info("Test setup completed", {
      folderA: folderA.name,
      folderB: folderB.name,
    });
  });

  test.afterEach(async () => {
    // Delete seeded dashboards first: the folder delete is rejected while it
    // still contains dashboards.
    for (const dash of dashboardsA) {
      await pm.apiCleanup.deleteDashboard(dash.dashboardId, folderA.folderId);
    }
    for (const dash of dashboardsB) {
      await pm.apiCleanup.deleteDashboard(dash.dashboardId, folderB.folderId);
    }
    await pm.apiCleanup.deleteDashboardFolder(folderA.folderId);
    await pm.apiCleanup.deleteDashboardFolder(folderB.folderId);
  });

  test(
    "should reset the list to page 1 and strip the page query param when switching folders",
    { tag: ["@folder-pagination-reset", "@all"] },
    async ({ page }) => {
      testLogger.info("Opening folder A and navigating to page 2");
      await pm.dashboardFolder.openFolderByName(folderA.name);
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 1 - 20 of 25/);

      await pm.dashboardList.clickNextPage();
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 21 - /);
      await pm.dashboardList.expectUrlHasPageParam("2");

      testLogger.info("Switching to folder B");
      await pm.dashboardFolder.openFolderByName(folderB.name);
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 1 - 2 of 2/);
      await pm.dashboardList.expectUrlHasNoPageParam();
      testLogger.info("Test completed");
    },
  );

  test(
    "should preserve the current page when returning from a dashboard in the same folder",
    { tag: ["@folder-pagination-reset", "@all"] },
    async ({ page }) => {
      testLogger.info("Opening folder A and navigating to page 2");
      await pm.dashboardFolder.openFolderByName(folderA.name);
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 1 - 20 of 25/);

      await pm.dashboardList.clickNextPage();
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 21 - /);
      await pm.dashboardList.expectUrlHasPageParam("2");

      testLogger.info("Opening a dashboard from page 2");
      await pm.dashboardList.clickFirstDashboardNameCell();
      await page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });

      testLogger.info("Returning to the list");
      await pm.dashboardCreate.backToDashboardList();

      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 21 - /);
      await pm.dashboardList.expectUrlHasPageParam("2");
      testLogger.info("Test completed");
    },
  );

  test(
    "should clamp a stale deep-linked page to page 1 on a single-page folder",
    { tag: ["@folder-pagination-reset", "@all"] },
    async ({ page }) => {
      testLogger.info("Deep-linking to folder B with a stale page=5");
      const orgId = process.env["ORGNAME"];
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${orgId}&folder=${folderB.folderId}&page=5`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForDashboardPage(page);

      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 1 - 2 of 2/);
      await pm.dashboardList.expectUrlNotHasPageParam("5");
      testLogger.info("Test completed");
    },
  );

  test(
    "should clamp to page 1 and render rows when switching to a shorter single-page folder",
    { tag: ["@folder-pagination-reset", "@all"] },
    async ({ page }) => {
      testLogger.info("Opening folder A and navigating to page 2");
      await pm.dashboardFolder.openFolderByName(folderA.name);
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 1 - 20 of 25/);

      await pm.dashboardList.clickNextPage();
      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 21 - /);

      testLogger.info("Switching to the shorter folder B");
      await pm.dashboardFolder.openFolderByName(folderB.name);

      await pm.dashboardList.expectPaginationInfoToMatch(/Showing 1 - 2 of 2/);
      await pm.dashboardList.expectAtLeastOneRow();
      await pm.dashboardList.expectUrlHasNoPageParam();
      testLogger.info("Test completed");
    },
  );
});
