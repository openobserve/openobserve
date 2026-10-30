/**
 * Labelled Refresh & Cancel Query Buttons
 *
 * The dashboard refresh actions were icon-only; this change adds a visible text
 * label ("Refresh") next to the icon on desktop viewports. The companion Cancel
 * button is enterprise-gated (config.isEnterprise == "true"), which is "false"
 * in the OSS E2E build, so the labelled Refresh path is the only reachable
 * behavior here; the labelled Cancel behaviors are parked as test.fixme
 * placeholders rather than absence assertions.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import {
  createLoadedDashboardWithPanel,
  cleanupTestDashboard,
} from "./utils/dashCreation.js";

test.describe("Labelled Refresh & Cancel Query Buttons testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    testLogger.info("Test setup completed");
  });

  test(
    "dashboard header Refresh button shows a visible Refresh label",
    { tag: ['@refresh-cancel-buttons', '@all', '@dashboards', '@P0'] },
    async ({ page }) => {
      testLogger.info("Creating a dashboard with one loaded panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Header");

      await pm.dashboardVariablesScoped.expectDashboardRefreshLabel();

      await cleanupTestDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "panel full-screen ViewPanel Refresh button shows a visible Refresh label",
    { tag: ['@refresh-cancel-buttons', '@all', '@dashboards', '@P0'] },
    async ({ page }) => {
      testLogger.info("Creating a dashboard with one loaded panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "ViewPanel");

      await pm.dashboardAutoRun.openFirstPanelFullscreen();
      await pm.dashboardAutoRun.expectViewPanelOpen();
      await pm.dashboardAutoRun.expectViewPanelRefreshLabel();
      await pm.dashboardAutoRun.closeViewPanel();

      await cleanupTestDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "dashboard Refresh returns to enabled and labelled after a manual refresh",
    { tag: ['@refresh-cancel-buttons', '@all', '@dashboards', '@P1'] },
    async ({ page }) => {
      testLogger.info("Creating a dashboard with one loaded panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Refresh");

      const requestUrl =
        await pm.dashboardVariablesScoped.clickDashboardRefreshAndWaitForSearch();
      expect(
        requestUrl.searchParams.get("clear_cache"),
        "standard Refresh must NOT bypass the cache (clear_cache absent)"
      ).toBeNull();

      await pm.dashboardVariablesScoped.waitForPanelIdle("Panel1");
      await pm.dashboardVariablesScoped.expectDashboardRefreshLabel();

      await cleanupTestDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "Refresh options caret coexists with the labelled Refresh button",
    { tag: ['@refresh-cancel-buttons', '@all', '@dashboards', '@P1'] },
    async ({ page }) => {
      testLogger.info("Creating a dashboard with one loaded panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Options");

      await pm.dashboardVariablesScoped.expectDashboardRefreshLabel();

      await pm.dashboardVariablesScoped.openDashboardRefreshOptions();
      const item = pm.dashboardVariablesScoped.getRefreshWithoutCacheMenuItem();
      await expect(item, "Refresh Cache & Reload must be visible").toBeVisible();
      await expect(item).toBeEnabled();

      await page.keyboard.press("Escape");
      await expect(item).toBeHidden();

      await cleanupTestDashboard(page, pm, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test.fixme(
    'Dashboard Cancel button shows "Cancel" label — not wired: enterprise-gated (ViewDashboard.vue:123 config.isEnterprise == "true" && arePanelsLoading)',
    { tag: ['@refresh-cancel-buttons', '@all', '@dashboards'] },
    async ({ page }) => {
      testLogger.info("Creating a dashboard with one loaded panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "Cancel");

      await pm.dashboardAutoRun.expectDashboardCancelLabel();

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test.fixme(
    'ViewPanel Cancel button shows "Cancel" label — not wired: enterprise-gated (ViewPanel.vue:938-941 isCancelShown)',
    { tag: ['@refresh-cancel-buttons', '@all', '@dashboards'] },
    async ({ page }) => {
      testLogger.info("Creating a dashboard with one loaded panel");
      const dashboardName = await createLoadedDashboardWithPanel(page, pm, "ViewCancel");

      await pm.dashboardAutoRun.openFirstPanelFullscreen();
      await pm.dashboardAutoRun.expectViewPanelCancelLabel();
      await pm.dashboardAutoRun.closeViewPanel();

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
