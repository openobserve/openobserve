const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");

const ORG = process.env.ORGNAME || "default";
const SUFFIX = Date.now().toString(36);
const OUTER = `e2e_insub_a_${SUFFIX}`;
const INNER = `e2e_insub_b_${SUFFIX}`;

test.describe("Regression: IN (subquery) filter keeps the total to the matching rows (#16949)", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const seed = new PageManager(page);
      const now = Date.now() * 1000;
      await seed.logsPage.ingestLogs(
        ORG,
        OUTER,
        Array.from({ length: 60 }, (_, i) => ({
          _timestamp: now - i * 1e6,
          seq: i + 1,
        })),
      );
      await seed.logsPage.ingestLogs(
        ORG,
        INNER,
        Array.from({ length: 10 }, (_, i) => ({
          _timestamp: now - i * 1e6,
          seq: i,
        })),
      );
      await seed.logsPage.waitForStreamRowCount(ORG, OUTER, 60);
      await seed.logsPage.waitForStreamRowCount(ORG, INNER, 10);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const cleanup = new PageManager(page);
      for (const stream of [OUTER, INNER]) {
        await cleanup.logsPage
          .deleteStream(stream)
          .catch((e) => testLogger.warn(`cleanup ${stream}: ${e.message}`));
      }
    } finally {
      await page.close();
    }
  });

  test(
    "IN (SELECT ...) shows 3 of 3 events on one page, with no histogram over the unfiltered stream",
    {
      tag: ["@bug-16949", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      const histogramRequests = [];
      page.on("request", (req) => {
        if (
          req.url().includes("_search") &&
          req.url().includes("is_ui_histogram=true")
        )
          histogramRequests.push(req.url());
      });
      await pm.logsPage.selectStream(OUTER);
      await pm.logsPage.clearAndFillQueryEditor(
        `SELECT * FROM "${OUTER}" WHERE seq IN (SELECT seq FROM "${INNER}" WHERE seq < 4)`,
      );
      await pm.logsPage.clickRefreshButton();
      await pm.logsPage.expectResultsGridSettledWithRows();

      await expect
        .poll(async () => await pm.logsPage.getVisibleResultTitleText(), {
          timeout: 30000,
        })
        .toMatch(/^1 to 3 out of 3 events/);
      await pm.logsPage.expectLogsTableRowCount(3);
      await pm.logsPage.expectNoResultPage(2);
      expect(histogramRequests).toEqual([]);

      testLogger.info("IN (subquery) total and histogram verified (#16949)");
    },
  );
});
