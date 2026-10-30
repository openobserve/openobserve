const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

// Page size for the Templates list is 20 (TemplateList.vue :page-size="20"). Unlike
// Dashboards/AlertList, TemplateList restores `currentPage` from the URL `page` query
// param on mount, so a stale deep link reproduces the bug directly with no folder
// switch needed. Covers the same OTable restorePage fix (#14745) as
// Dashboards/dashboardPagination.spec.js and Alerts/alertsPagination.spec.js.
const SINGLE_PAGE_COUNT = 2;
const MULTI_PAGE_COUNT = 25;

const uniqueSeed = () =>
  `e2e_tmpl_pag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Alert Templates Pagination Reset testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  let templateNames = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    templateNames = [];
  });

  test.afterEach(async () => {
    for (const name of templateNames) {
      await pm.apiCleanup.deleteAlertTemplate(name);
    }
  });

  test(
    "should clamp a stale deep-linked page to page 1 on a single-page template list",
    { tag: ["@templates-pagination-reset", "@all"] },
    async ({ page }) => {
      const seed = uniqueSeed();
      const seeded = await pm.apiCleanup.seedAlertTemplates(SINGLE_PAGE_COUNT, seed);
      templateNames = seeded.map((t) => t.name);

      // Compute a page guaranteed to be past the end, rather than a hardcoded number:
      // other specs/parallel tests share this org's template list, so a fixed page
      // could accidentally land on a real page.
      const currentTotal = (await pm.apiCleanup.fetchAlertTemplates()).length;
      const stalePage = Math.ceil(currentTotal / 20) + 10;

      testLogger.info("Deep-linking to templates with a stale page", { stalePage });
      await pm.alertTemplatesPage.gotoTemplatesWithPageParam(stalePage);

      await pm.alertTemplatesPage.expectPaginationInfoToMatch(
        new RegExp(`Showing 1 - \\d+ of \\d+`),
      );
      await pm.alertTemplatesPage.expectAtLeastOneListRow();
      await pm.alertTemplatesPage.expectUrlHasPageParam("1");
      testLogger.info("Test completed");
    },
  );

  test(
    "should navigate to page 2 and show the remaining templates",
    { tag: ["@templates-pagination-reset", "@all"] },
    async ({ page }) => {
      const seed = uniqueSeed();
      const seeded = await pm.apiCleanup.seedAlertTemplates(MULTI_PAGE_COUNT, seed);
      templateNames = seeded.map((t) => t.name);

      testLogger.info("Navigating to templates and going to page 2");
      await pm.alertTemplatesPage.navigateToTemplates();
      await pm.alertTemplatesPage.waitForTemplateListReady();

      await pm.alertTemplatesPage.clickNextPage();
      await pm.alertTemplatesPage.expectPaginationInfoToMatch(/Showing 21 - /);
      await pm.alertTemplatesPage.expectUrlHasPageParam("2");
      await pm.alertTemplatesPage.expectAtLeastOneListRow();
      testLogger.info("Test completed");
    },
  );
});
