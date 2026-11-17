// Heatmaps on an org whose _sessionreplay stream has no view_id (older SDK replay) must show the older-SDK state, not a 400.

const { test, expect } = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { sqlOf } = require("../../../pages/rumPages/rumProductAnalyticsPage.js");
const {
  ensureRumStateOrg,
  seedBuilt,
  ensureSessionReplayStream,
  buildFunnelSessions,
  runAppId,
} = require("../../utils/rum-analytics-ingestion.js");

const TAGS = [
  "@rum",
  "@rumAnalytics",
  "@bug-3268",
  "@P3",
  "@all",
  "@regression",
  "@rumRegression",
];
const SEARCH_URL = /\/api\/[^/]+\/_search(_stream)?(\?|$)/;
const PAGE_URL = "https://shop.example.com/web/a";

test.describe("RUM Heatmaps without view_id in _sessionreplay", () => {
  test.describe.configure({ mode: "default" });
  test.use({ timezoneId: "UTC" });

  let org = null;
  let appId = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const { identifier } = await ensureRumStateOrg(page, "pa_hmnovid");
      const nowMs = Date.now();
      const seed = buildFunnelSessions(runAppId("pa-hmnovid"), nowMs, {
        replay: false,
      });
      const facts = await seedBuilt(page, seed, { nowMs, orgId: identifier });
      // The marker row carries no view_id, so the stream schema lacks the field.
      await ensureSessionReplayStream(page, facts.appId, nowMs, {
        orgId: identifier,
      });
      org = identifier;
      appId = facts.appId;
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test(
    "the page snapshot shows the no-replay state and sends no view_id query",
    {
      tag: TAGS,
    },
    async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const bad = [];
      const replaySql = [];
      page.on("response", (r) => {
        if (!SEARCH_URL.test(r.url())) return;
        const sql = sqlOf(r.request());
        if (/FROM "_sessionreplay"/.test(sql)) replaySql.push(sql);
        if (r.status() === 400) bad.push(sql.slice(0, 300));
      });

      await pa.goto(
        "heatmaps",
        { app: appId, period: "7d", page_url: PAGE_URL },
        { org },
      );

      const notice = page.locator('[data-test="rum-heatmap-snapshot-error"]');
      await expect(notice).toBeVisible({ timeout: 60000 });
      await expect(notice).toContainText("Page snapshots need a newer RUM SDK");
      await expect(notice).not.toContainText("Couldn't load the page snapshot");
      await pa.waitForNetworkQuiet();
      expect(
        replaySql.filter((s) => /view_id/.test(s)),
        "no _sessionreplay query references view_id",
      ).toEqual([]);
      expect(bad, bad.join("\n")).toEqual([]);
    },
  );
});
