const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

// Page size for the Destinations list is 20 (AlertsDestinationList.vue :page-size="20").
// Like TemplateList, AlertsDestinationList restores `currentPage` from the URL `page`
// query param on mount, so a stale deep link reproduces the bug directly. Covers the
// same OTable restorePage fix (#14745) as Dashboards/dashboardPagination.spec.js and
// Alerts/alertsPagination.spec.js.
const SINGLE_PAGE_COUNT = 2;
const MULTI_PAGE_COUNT = 25;

const uniqueSeed = () =>
  `e2e_dest_pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Alert Destinations Pagination Reset testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  let destinationNames = [];
  let templateName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    destinationNames = [];

    const seed = uniqueSeed();
    templateName = `${seed}_tmpl`;
    await pm.apiCleanup.createAlertTemplate(templateName);
  });

  test.afterEach(async () => {
    for (const name of destinationNames) {
      await pm.apiCleanup.deleteAlertDestination(name);
    }
    await pm.apiCleanup.deleteAlertTemplate(templateName);
  });

  test(
    "should clamp a stale deep-linked page to page 1 on a single-page destination list",
    { tag: ["@destinations-pagination-reset", "@all"] },
    async ({ page }) => {
      const seed = uniqueSeed();
      const seeded = await pm.apiCleanup.seedAlertDestinations(
        SINGLE_PAGE_COUNT,
        seed,
        templateName,
      );
      destinationNames = seeded.map((d) => d.name);

      // Compute a page guaranteed to be past the end, rather than a hardcoded number:
      // other specs/parallel tests share this org's destination list, so a fixed page
      // could accidentally land on a real page.
      const currentTotal = (await pm.apiCleanup.fetchDestinationsWithTemplateMapping()).destinations.length;
      const stalePage = Math.ceil(currentTotal / 20) + 10;

      testLogger.info("Deep-linking to destinations with a stale page", { stalePage });
      await pm.alertDestinationsPage.gotoDestinationsWithPageParam(stalePage);

      await pm.alertDestinationsPage.expectPaginationInfoToMatch(
        new RegExp(`Showing 1 - \\d+ of \\d+`),
      );
      await pm.alertDestinationsPage.expectAtLeastOneListRow();
      await pm.alertDestinationsPage.expectUrlHasPageParam("1");
      testLogger.info("Test completed");
    },
  );

  test(
    "should navigate to page 2 and show the remaining destinations",
    { tag: ["@destinations-pagination-reset", "@all"] },
    async ({ page }) => {
      const seed = uniqueSeed();
      const seeded = await pm.apiCleanup.seedAlertDestinations(
        MULTI_PAGE_COUNT,
        seed,
        templateName,
      );
      destinationNames = seeded.map((d) => d.name);

      testLogger.info("Navigating to destinations and going to page 2");
      await pm.alertDestinationsPage.navigateToDestinations();
      await pm.alertDestinationsPage.waitForDestinationListReady();

      await pm.alertDestinationsPage.clickNextPage();
      await pm.alertDestinationsPage.expectPaginationInfoToMatch(/Showing 21 - /);
      await pm.alertDestinationsPage.expectUrlHasPageParam("2");
      await pm.alertDestinationsPage.expectAtLeastOneListRow();
      testLogger.info("Test completed");
    },
  );
});
