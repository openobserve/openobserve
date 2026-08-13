import { test, expect, navigateToBase } from "../utils/enhanced-baseFixtures.js";
import testLogger from "../utils/test-logger.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

/**
 * Build the /dashboards/view deep-link URL with full control over the `tab`
 * query param: omitted when `tab` is undefined (missing-tab case), set to an
 * empty string when `tab === ""` (empty-tab edge case), otherwise the raw id.
 */
const buildDashboardViewUrl = ({ dashboardId, folderId, tab }) => {
  const params = new URLSearchParams({
    org_identifier: process.env["ORGNAME"],
    dashboard: dashboardId,
    folder: folderId,
  });
  if (tab !== undefined) {
    params.set("tab", tab);
  }
  return `${process.env["ZO_BASE_URL"]}/web/dashboards/view?${params.toString()}`;
};

/**
 * Create a uniquely-named dashboard, add a second tab, switch to it, and
 * return the ids needed to build deep links (dashboardId, folderId, secondTabId).
 */
async function createDashboardWithTwoTabs(pm, page, dashboardName) {
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.createDashboard(dashboardName);
  await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

  const urlObj = new URL(page.url());
  const dashboardId = urlObj.searchParams.get("dashboard");
  const folderId = urlObj.searchParams.get("folder") ?? "default";

  const newTabName =
    pm.dashboardSetting.generateUniqueTabnewName("deeplink-tab");
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.addTabSetting(newTabName);
  await pm.dashboardSetting.saveTabSetting();
  await pm.dashboardSetting.closeSettingDashboard();

  // Switch to the new tab so the URL's `tab` param carries its random id.
  await pm.dashboardCreate.waitForTabStripVisible();
  await pm.dashboardShareExport.clickTabByName(newTabName);
  await page.waitForURL(/[?&]tab=\d+/, { timeout: 15000 });
  const secondTabId = new URL(page.url()).searchParams.get("tab");

  return { dashboardId, folderId, secondTabId };
}

test.describe("dashboard deep-link default tab resolution testcases", () => {
  test.describe.configure({ mode: "parallel" });

  const generateDashboardName = (prefix = "DeeplinkDash") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  let pm;
  let currentDashboardName = null;

  test.beforeEach(async ({ page }, testInfo) => {
    currentDashboardName = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info("Test setup completed");
  });

  test.afterEach(async ({ page }) => {
    if (currentDashboardName) {
      try {
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, currentDashboardName);
      } catch (e) {
        testLogger.warn("Cleanup failed (non-fatal):", { error: e.message });
      }
    }
  });

  test(
    "should activate the matching tab when deep-linking to a valid non-default tab",
    { tag: ["@dashboards", "@dashboard-deeplink-tab", "@P0", "@all"] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a second tab");
      const randomDashboardName = generateDashboardName();
      currentDashboardName = randomDashboardName;
      const { dashboardId, folderId, secondTabId } =
        await createDashboardWithTwoTabs(pm, page, randomDashboardName);

      testLogger.info("Deep-linking to the valid second tab", { secondTabId });
      await page.goto(
        buildDashboardViewUrl({ dashboardId, folderId, tab: secondTabId }),
        { waitUntil: "domcontentloaded" }
      );

      await pm.dashboardCreate.waitForTabStripVisible();
      await pm.dashboardCreate.expectTabActive(secondTabId);
      await expect(page).toHaveURL(
        new RegExp(`[?&]tab=${secondTabId}`),
        { timeout: 15000 }
      );
      testLogger.info("Test completed");
    }
  );

  test(
    "should fall back to the default tab and normalize the URL when deep-linking without a tab param",
    { tag: ["@dashboards", "@dashboard-deeplink-tab", "@P0", "@all"] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a second tab");
      const randomDashboardName = generateDashboardName();
      currentDashboardName = randomDashboardName;
      const { dashboardId, folderId } = await createDashboardWithTwoTabs(
        pm,
        page,
        randomDashboardName
      );

      testLogger.info("Deep-linking without a tab param");
      await page.goto(buildDashboardViewUrl({ dashboardId, folderId }), {
        waitUntil: "domcontentloaded",
      });

      await pm.dashboardCreate.waitForTabStripVisible();
      await pm.dashboardCreate.expectTabActive("default");
      await expect(page).toHaveURL(/[?&]tab=default/, { timeout: 15000 });
      testLogger.info("Test completed");
    }
  );

  test(
    "should fall back to the default tab and normalize the URL when deep-linking with an invalid tab param",
    { tag: ["@dashboards", "@dashboard-deeplink-tab", "@P1", "@all"] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a second tab");
      const randomDashboardName = generateDashboardName();
      currentDashboardName = randomDashboardName;
      const { dashboardId, folderId } = await createDashboardWithTwoTabs(
        pm,
        page,
        randomDashboardName
      );

      testLogger.info("Deep-linking with a nonexistent tab id");
      await page.goto(
        buildDashboardViewUrl({ dashboardId, folderId, tab: "999999" }),
        { waitUntil: "domcontentloaded" }
      );

      await pm.dashboardCreate.waitForTabStripVisible();
      await pm.dashboardCreate.expectTabActive("default");
      await expect(page).toHaveURL(/[?&]tab=default/, { timeout: 15000 });
      await expect(page).not.toHaveURL(/tab=999999/);
      testLogger.info("Test completed");
    }
  );

  test(
    "should resolve a tab when clicking add panel from a tab-less deep link (null-safety regression)",
    { tag: ["@dashboards", "@dashboard-deeplink-tab", "@P1", "@all"] },
    async ({ page }) => {
      testLogger.info("Creating an empty dashboard");
      const randomDashboardName = generateDashboardName();
      currentDashboardName = randomDashboardName;

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(randomDashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

      const urlObj = new URL(page.url());
      const dashboardId = urlObj.searchParams.get("dashboard");
      const folderId = urlObj.searchParams.get("folder") ?? "default";

      testLogger.info("Deep-linking without a tab param");
      await page.goto(buildDashboardViewUrl({ dashboardId, folderId }), {
        waitUntil: "domcontentloaded",
      });

      await pm.dashboardCreate.waitForTabStripVisible();
      await pm.dashboardCreate.addPanel();

      await expect(page).toHaveURL(/add_panel/, { timeout: 15000 });
      await expect(page).toHaveURL(/[?&]tab=default/, { timeout: 15000 });
      testLogger.info("Test completed");
    }
  );

  test(
    "should fall back to the default tab when deep-linking with an empty tab param",
    { tag: ["@dashboards", "@dashboard-deeplink-tab", "@P2", "@all"] },
    async ({ page }) => {
      testLogger.info("Creating dashboard with a second tab");
      const randomDashboardName = generateDashboardName();
      currentDashboardName = randomDashboardName;
      const { dashboardId, folderId } = await createDashboardWithTwoTabs(
        pm,
        page,
        randomDashboardName
      );

      testLogger.info("Deep-linking with an empty tab param");
      await page.goto(
        buildDashboardViewUrl({ dashboardId, folderId, tab: "" }),
        { waitUntil: "domcontentloaded" }
      );

      await pm.dashboardCreate.waitForTabStripVisible();
      await pm.dashboardCreate.expectTabActive("default");
      await expect(page).toHaveURL(/[?&]tab=default/, { timeout: 15000 });
      testLogger.info("Test completed");
    }
  );
});
