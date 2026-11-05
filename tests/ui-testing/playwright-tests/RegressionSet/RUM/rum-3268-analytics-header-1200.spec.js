// Product Analytics header: the title stays whole and clear of the app picker at 1440, 1366, 1290, 1200 and 1000px viewports; below ~1300px the filters wrap into their own band.

const { test, expect } = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  seedBuilt,
  SessionBuilder,
  runAppId,
  HOUR_MS,
} = require("../../utils/rum-analytics-ingestion.js");

const TAGS = ["@bug-3268", "@P3", "@regression", "@rumRegression"];
const SUB_TABS = ["funnels", "paths"];
const WIDTHS = [1440, 1366, 1290, 1200, 1000];
const WIDE_FROM = 1300;

function buildViewSeed(appId, nowMs) {
  const session = new SessionBuilder(
    appId,
    `${appId}-s0`,
    nowMs - 2 * HOUR_MS,
    { user: "h0@e2e.test" },
  );
  session.view("https://shop.example.com/web/start");
  session.view("https://shop.example.com/web/product");
  return { rows: session.rows, facts: { appId } };
}

test.describe("Product Analytics header across widths", () => {
  test.describe.configure({ mode: "parallel" });
  test.use({ timezoneId: "UTC", viewport: { width: 1200, height: 800 } });
  let seed = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      seed = await seedBuilt(
        page,
        buildViewSeed(runAppId("pa-3268"), Date.now()),
      );
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  for (const width of WIDTHS)
    for (const subTab of SUB_TABS) {
      test(
        `the title is fully visible and clear of the app picker on ${subTab} at ${width}px`,
        { tag: TAGS },
        async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          const pa = new PageManager(page).rumProductAnalyticsPage;
          await pa.goto(subTab, { app: seed.appId, period: "7d" });
          const title = page.locator('[data-test="rum-analytics-title"]');
          const picker = page
            .locator(
              '[data-test="rum-analytics-app-select"], [data-test="rum-analytics-app-label"]',
            )
            .first();
          await expect(title).toBeVisible({ timeout: 30000 });
          await expect(picker).toBeVisible({ timeout: 30000 });
          await expect(title).toContainText(/Product analytics/i);

          const wide = width >= WIDE_FROM;
          await expect
            .poll(
              () =>
                page.evaluate((isWide) => {
                  const q = (sel) => document.querySelector(sel);
                  const rect = (el) => el.getBoundingClientRect();
                  const header = q(".app-page-header");
                  const title = q('[data-test="rum-analytics-title"]');
                  const picker = q(
                    '[data-test="rum-analytics-app-select"], [data-test="rum-analytics-app-label"]',
                  );
                  const tabs = q('[data-test^="rum-analytics-subtab-"]');
                  const host = q('[data-test="rum-analytics-filters"]');
                  if (!header || !title || !picker || !tabs || !host)
                    return ["missing element"];
                  const h = rect(header);
                  const t = rect(title);
                  const p = rect(picker);
                  const tabTop = rect(tabs).top;
                  const range = document.createRange();
                  range.selectNodeContents(title);
                  const bad = [];
                  if (t.width < range.getBoundingClientRect().width)
                    bad.push("title truncated");
                  if (
                    t.left < p.right &&
                    p.left < t.right &&
                    t.top < p.bottom &&
                    p.top < t.bottom
                  )
                    bad.push("title overlaps picker");
                  const inHeader = header.contains(host);
                  if (isWide) {
                    if (!inHeader) bad.push("filters not in header");
                    if (getComputedStyle(host).display !== "contents")
                      bad.push("filters wrapper is not display: contents");
                    if (p.bottom > h.bottom + 1 || p.top < h.top - 1)
                      bad.push("picker outside header");
                  } else {
                    if (inHeader) bad.push("filters still in header");
                    const hb = rect(host);
                    if (hb.top < h.bottom - 1)
                      bad.push("band above header bottom");
                    if (hb.bottom > tabTop + 1) bad.push("band covers tabs");
                    for (const c of host.children) {
                      if (rect(c).bottom > tabTop + 1)
                        bad.push("filter covers tabs");
                    }
                  }
                  for (const sel of [
                    '[data-test="rum-analytics-date-picker"]',
                    '[data-test="rum-analytics-refresh-btn"]',
                    '[data-test="rum-analytics-share-btn"]',
                  ]) {
                    const el = q(sel);
                    if (!el) continue;
                    const r = rect(el);
                    if (r.bottom > h.bottom + 1 || r.top < h.top - 1)
                      bad.push(`${sel} outside header`);
                  }
                  if (t.bottom > h.bottom + 1) bad.push("title outside header");
                  return bad;
                }, wide),
              { timeout: 15000 },
            )
            .toEqual([]);
        },
      );
    }
});
