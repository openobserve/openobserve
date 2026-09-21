const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, addSimplePanel } from "./utils/dashCreation.js";
import { cleanupDashboard } from "./utils/panelTimeSetup.js";
const { safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");

test.describe.configure({ mode: "parallel" });

// Proving a refetch did NOT happen needs a window to watch after the cached paint.
const SETTLE_MS = 4000;

// The panel must visibly age before the reload, so a reset clock is distinguishable from a preserved one.
const AGE_BEFORE_RELOAD_MS = 8000;

// Dashboard panels go out over /_search_stream, /_search_multi_stream and /_search_partition.
const isPanelSearch = (url) => url.includes("/_search");

const lastRefreshedAt = (page) => page.locator('[data-test="panel-last-refreshed-at"]').first();

const cachedDataDiffersWarning = (page) =>
  page.locator('[data-test="panel-is-cached-data-differ-with-current-time-range-warning"]');

// RelativeTime renders the exact lastTriggeredAt into title=, giving ms precision the "11s ago" text lacks.
async function readLastRefreshed(page) {
  const container = lastRefreshedAt(page);
  const text = (await container.innerText()).trim();
  const exact = await container.locator("span[title]").last().getAttribute("title");
  return { text, exact };
}

// The label only re-renders on a 60s interval, so it reads "now" until then; after a
// reload it is recomputed at mount and is the user-visible proof the clock was not reset.
function parseAgeSeconds(relativeText) {
  // Intl narrow style emits "13s ago" / "5m ago", not the long "13 seconds ago".
  const match = relativeText.match(/(\d+)\s*(sec|min|hour|day|s|m|h|d)\b/i);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit.startsWith("d")) return value * 86400;
  if (unit.startsWith("h")) return value * 3600;
  if (unit.startsWith("m")) return value * 60;
  return value;
}

async function countPanelSearches(page, action) {
  const seen = [];
  const onRequest = (request) => {
    if (isPanelSearch(request.url())) seen.push(request.url());
  };

  page.on("request", onRequest);
  try {
    await action();
  } finally {
    page.off("request", onRequest);
  }

  testLogger.info("Panel search requests observed", { count: seen.length, urls: seen.slice(0, 3) });
  return seen;
}

async function waitForPanelPainted(page) {
  await lastRefreshedAt(page).waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator('[data-test="chart-renderer"]')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await safeWaitForNetworkIdle(page, { timeout: 5000 });
}

async function createDashboardWithGlobalTimePanel(page, pm, dashboardName, panelName) {
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);
  await page
    .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    .waitFor({ state: "visible", timeout: 10000 });

  await addSimplePanel(pm, panelName);
  await waitForPanelPainted(page);

  // The cache entry is written only once the load completes; an incomplete entry is never restored.
  await page.waitForTimeout(SETTLE_MS);
}

test.describe("Dashboard Cache on Browser Refresh", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test("01-should keep the panel on cached data and not re-trigger it on browser refresh", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_CacheRefreshRel_${timestamp}`;

    await createDashboardWithGlobalTimePanel(
      page,
      pm,
      dashboardName,
      `Panel_CacheRefreshRel_${timestamp}`,
    );

    // The time picker is deliberately left untouched: the reported bug needs a plain
    // browser reload, and changing the range would force a refresh and mask it.
    await page.waitForTimeout(AGE_BEFORE_RELOAD_MS);
    const before = await readLastRefreshed(page);
    testLogger.info("Last refreshed before reload", before);
    expect(before.exact).toBeTruthy();

    // A relative range re-resolves "now" on every recompute; that drift must not
    // count as a range change and re-trigger a panel already holding cached data.
    const searches = await countPanelSearches(page, async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForPanelPainted(page);
      await page.waitForTimeout(SETTLE_MS);
    });

    const after = await readLastRefreshed(page);
    testLogger.info("Last refreshed after reload", after);

    expect(searches).toEqual([]);
    expect(after.exact).toBe(before.exact);
    expect(after.text).not.toMatch(/\bnow\b/i);
    expect(parseAgeSeconds(after.text)).toBeGreaterThanOrEqual(5);

    await cleanupDashboard(page, pm, dashboardName);
  });

  test("02-should keep the cached refresh time and raise no cached-data warning after browser refresh", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_CacheRefreshUI_${timestamp}`;

    await createDashboardWithGlobalTimePanel(
      page,
      pm,
      dashboardName,
      `Panel_CacheRefreshUI_${timestamp}`,
    );

    // No time-range change here either — the reload alone must not disturb the panel.
    await page.waitForTimeout(AGE_BEFORE_RELOAD_MS);

    const before = await readLastRefreshed(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForPanelPainted(page);
    await page.waitForTimeout(SETTLE_MS);

    // The reported symptom was a panel claiming a fresh refresh over hours-old cached data.
    await expect(lastRefreshedAt(page)).toBeVisible();
    await expect(cachedDataDiffersWarning(page)).toHaveCount(0);
    await expect(page.locator('[data-test="panel-error-data"]')).toHaveCount(0);

    const after = await readLastRefreshed(page);
    expect(after.exact).toBe(before.exact);

    await cleanupDashboard(page, pm, dashboardName);
  });

  test("03-should restore panels from cache without refetching on browser refresh (absolute range)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_CacheRefreshAbs_${timestamp}`;

    await createDashboardWithGlobalTimePanel(
      page,
      pm,
      dashboardName,
      `Panel_CacheRefreshAbs_${timestamp}`,
    );

    await pm.dashboardTimeRefresh.selectAbsolutetime("1", "1");
    await waitForPanelPainted(page);
    await page.waitForTimeout(SETTLE_MS);
    expect(page.url()).toContain("from=");

    await page.waitForTimeout(AGE_BEFORE_RELOAD_MS);
    const before = await readLastRefreshed(page);

    // An absolute range keeps the exact-timestamp comparison; the span heuristic must not have changed it.
    const searches = await countPanelSearches(page, async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForPanelPainted(page);
      await page.waitForTimeout(SETTLE_MS);
    });

    const after = await readLastRefreshed(page);
    testLogger.info("Last refreshed after reload", after);

    expect(searches).toEqual([]);
    expect(after.exact).toBe(before.exact);
    expect(after.text).not.toMatch(/\bnow\b/i);
    expect(parseAgeSeconds(after.text)).toBeGreaterThanOrEqual(5);

    await cleanupDashboard(page, pm, dashboardName);
  });

  test("04-should refetch when the dashboard is explicitly refreshed after a browser refresh", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_CacheForceRefresh_${timestamp}`;

    await createDashboardWithGlobalTimePanel(
      page,
      pm,
      dashboardName,
      `Panel_CacheForceRefresh_${timestamp}`,
    );

    // Same untouched-time reload as 01, then the user explicitly asks for fresh data.
    await page.waitForTimeout(AGE_BEFORE_RELOAD_MS);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForPanelPainted(page);
    await page.waitForTimeout(SETTLE_MS);

    const before = await readLastRefreshed(page);

    // Suppressing the drift-driven recompute must not also suppress a forced refresh.
    const searches = await countPanelSearches(page, async () => {
      await pm.dashboardTimeRefresh.refreshDashboard();
      await safeWaitForNetworkIdle(page, { timeout: 10000 });
      await page.waitForTimeout(SETTLE_MS);
    });

    const after = await readLastRefreshed(page);
    testLogger.info("Last refreshed after explicit refresh", after);

    expect(searches.length).toBeGreaterThan(0);
    expect(after.exact).not.toBe(before.exact);

    await cleanupDashboard(page, pm, dashboardName);
  });

  test("05-should refetch when the relative range span changes", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_CacheSpanChange_${timestamp}`;

    await createDashboardWithGlobalTimePanel(
      page,
      pm,
      dashboardName,
      `Panel_CacheSpanChange_${timestamp}`,
    );

    const before = await readLastRefreshed(page);

    // Comparing relative ranges by span still has to notice a real span change.
    const searches = await countPanelSearches(page, async () => {
      await pm.dashboardPanelTime.changeGlobalTime("2-d");
      await waitForPanelPainted(page);
      await page.waitForTimeout(SETTLE_MS);
    });

    const after = await readLastRefreshed(page);
    testLogger.info("Last refreshed after span change", after);
    expect(after.exact).not.toBe(before.exact);

    expect(searches.length).toBeGreaterThan(0);
    expect(page.url()).toContain("period=2d");

    await cleanupDashboard(page, pm, dashboardName);
  });
});
