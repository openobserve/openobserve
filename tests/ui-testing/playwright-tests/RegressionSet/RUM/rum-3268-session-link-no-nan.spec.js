const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  SessionBuilder,
  runAppId,
  seedBuilt,
} = require("../../utils/rum-analytics-ingestion.js");

const TAGS = ["@bug-3268", "@P2", "@regression", "@rumRegression"];
const HEATMAP_BTN = '[data-test="rum-app-sessions-view-heatmap-btn"]';
const DURATION = '[data-test="session-viewer-duration"]';

test.describe("RUM Sessions list links carry a real time range", () => {
  test.describe.configure({ mode: "default" });
  const appId = runAppId("pa-3268-nan");

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const nowMs = Date.now();
      const session = new SessionBuilder(
        appId,
        `${appId}-s1`,
        nowMs - 20 * 60 * 1000,
        { user: "nan@e2e.test" },
      );
      session
        .view("https://shop.example.com/web/a")
        .wait(60000)
        .click("buy", "https://shop.example.com/web/a");
      session.rows.forEach((row) => {
        row.service = appId;
      });
      await seedBuilt(
        page,
        { rows: session.rows, facts: { appId } },
        { nowMs },
      );
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test(
    "opening a session without replay puts finite start_time and end_time in the URL and keeps its duration on reload",
    {
      tag: TAGS,
    },
    async ({ page }) => {
      const pm = new PageManager(page);
      const sessions = pm.rumSessionsPage;

      await sessions.gotoSessionsList({ service: appId, period: "1d" });
      await sessions.expectSessionsTableVisible();
      await sessions.waitForSessionRowsPresent();

      const noReplayRow = sessions.tableRow
        .filter({ hasNot: page.locator(HEATMAP_BTN) })
        .first();
      await expect(noReplayRow).toBeVisible();

      await noReplayRow.click();
      await expect(page).toHaveURL(/\/rum\/sessions\/view\//, {
        timeout: 15000,
      });

      const url = page.url();
      testLogger.info("Session viewer URL", { url });
      expect(url).not.toContain("NaN");
      const query = new URL(url).searchParams;
      for (const key of ["start_time", "end_time"]) {
        expect(
          Number.isFinite(Number(query.get(key))),
          `${key} must be a finite number`,
        ).toBe(true);
        expect(
          Number(query.get(key)),
          `${key} must be a real timestamp`,
        ).toBeGreaterThan(0);
      }
      expect(Number(query.get("end_time"))).toBeGreaterThanOrEqual(
        Number(query.get("start_time")),
      );

      await page.reload();
      await expect(page.locator(DURATION)).toBeVisible({ timeout: 30000 });
    },
  );
});
