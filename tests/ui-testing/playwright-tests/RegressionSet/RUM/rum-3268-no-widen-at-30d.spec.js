// Product Analytics empty state offers "Show the past 30 days" only when the range is shorter than 30 days.

const { test, expect } = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  runAppId,
  seedViewsOnlyApp,
} = require("../../utils/rum-analytics-ingestion.js");

const TAGS = ["@bug-3268", "@P3", "@regression", "@rumRegression"];

test.describe("Product Analytics widen-range action", () => {
  test.use({ timezoneId: "UTC" });
  const emptyAppId = runAppId("pa-3268-empty");

  // Another app's rows give the org a _rumdata schema, so the empty app shows the empty overview, not onboarding.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await seedViewsOnlyApp(page, { appId: runAppId("pa-3268-other") });
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test(
    "the empty overview has no widen button at the past 30 days",
    { tag: TAGS },
    async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.goto("overview", { app: emptyAppId, period: "30d" });
      await expect(pa.overviewEmpty).toBeVisible({ timeout: 30000 });
      await expect(pa.widenRangeBtn).toHaveCount(0);
    },
  );

  test(
    "the empty overview still offers the widen button at the past 1 day",
    { tag: TAGS },
    async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.goto("overview", { app: emptyAppId, period: "1d" });
      await expect(pa.overviewEmpty).toBeVisible({ timeout: 30000 });
      await expect(pa.widenRangeBtn).toBeVisible();
    },
  );
});
