import * as crypto from "crypto";
import { test, expect, navigateToBase } from "../utils/enhanced-baseFixtures.js";
import testLogger from "../utils/test-logger.js";
import PageManager from "../../pages/page-manager.js";
import { ingestion } from "./utils/dashIngestion.js";
import { setupTestDashboard, deleteDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupTablePanel,
} from "./utils/configPanelHelpers.js";

test.describe("Dashboard Print Layout testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  let apiDashboard = null;
  let uiDashboardName = null;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    apiDashboard = null;
    uiDashboardName = null;
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  test.afterEach(async ({ page }) => {
    if (apiDashboard) {
      await pm.apiCleanup
        .deleteDashboard(apiDashboard.dashboardId, apiDashboard.folderId)
        .catch(() => {});
      apiDashboard = null;
    }
    if (uiDashboardName) {
      try {
        await page.goto(
          `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`,
          { waitUntil: "domcontentloaded" }
        );
        await deleteDashboard(page, uiDashboardName);
      } catch (e) {
        testLogger.warn("UI dashboard cleanup failed (non-fatal)", { error: e.message });
      }
      uiDashboardName = null;
    }
  });

  test(
    "should enter print mode via the toolbar button and render the print layout",
    { tag: ["@dashboard-print-layout", "@all", "@P0"] },
    async ({ page }) => {
      const title = `PrintLayout_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithStackedPanels(title, 4);
      apiDashboard = { dashboardId, folderId };

      await pm.dashboardPrint.navigateToDashboardView(dashboardId, folderId);
      await pm.dashboardPrint.waitForPanelMounted();

      await pm.dashboardPrint.enterPrintMode();

      await expect(page).toHaveURL(/print=true/);
      await pm.dashboardPrint.expectPrintChromeApplied();
      await pm.dashboardPrint.expectPrintPageStyleInjected();

      const gridHeight = await pm.dashboardPrint.getGridStackInlineHeight();
      expect(gridHeight).not.toBe("");
      const overrideCount = await pm.dashboardPrint.getPanelTopOverrideCount();
      expect(overrideCount).toBeGreaterThan(0);

      testLogger.info("Print layout rendered", { gridHeight, overrideCount });
    }
  );

  test(
    "should exit print mode and clear the print layout",
    { tag: ["@dashboard-print-layout", "@all", "@P0"] },
    async ({ page }) => {
      const title = `PrintLayoutExit_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithStackedPanels(title, 4);
      apiDashboard = { dashboardId, folderId };

      await pm.dashboardPrint.navigateToDashboardView(dashboardId, folderId);
      await pm.dashboardPrint.waitForPanelMounted();
      await pm.dashboardPrint.enterPrintMode();

      await pm.dashboardPrint.exitPrintMode();

      await expect(page).not.toHaveURL(/print=true/);
      await pm.dashboardPrint.expectPrintPageStyleRemoved();
      await pm.dashboardPrint.expectPrintChromeCleared();

      const overrideCount = await pm.dashboardPrint.getPanelTopOverrideCount();
      expect(overrideCount).toBe(0);

      testLogger.info("Print layout cleared on exit");
    }
  );

  test(
    "should enter print mode via the ?print=true URL and persist across reload",
    { tag: ["@dashboard-print-layout", "@all", "@P1"] },
    async ({ page }) => {
      const title = `PrintLayoutUrl_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithStackedPanels(title, 4);
      apiDashboard = { dashboardId, folderId };

      await pm.dashboardPrint.navigateToDashboardView(dashboardId, folderId, true);
      await pm.dashboardPrint.waitForPrintLayout();
      await pm.dashboardPrint.expectPrintChromeApplied();
      await pm.dashboardPrint.expectPrintPageStyleInjected();

      await page.reload();
      await pm.dashboardPrint.waitForPrintLayout();
      await pm.dashboardPrint.expectPrintChromeApplied();

      testLogger.info("Print mode persisted across reload");
    }
  );

  test(
    "should render a single-table-panel dashboard full-width in print mode",
    { tag: ["@dashboard-print-layout", "@all", "@P1"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      uiDashboardName = dashboardName;

      await setupTablePanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.savePanel();

      await pm.dashboardPrint.clickPrintButton();
      await pm.dashboardPrint.waitForSingleTablePrintMode();

      await pm.dashboardPrint.expectGridStackAbsent();
      await pm.dashboardPrint.expectSingleTableFullWidth();
      await pm.dashboardPrint.expectPrintModeContainerVisible();

      testLogger.info("Single-table full-width print branch verified");
    }
  );

  test(
    "should show the print-capture readiness flag once panels finish loading",
    { tag: ["@dashboard-print-layout", "@all", "@P1"] },
    async ({ page }) => {
      const title = `PrintLayoutReady_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      const { dashboardId, folderId } = await pm.apiCleanup.createDashboardWithStackedPanels(title, 4);
      apiDashboard = { dashboardId, folderId };

      await pm.dashboardPrint.navigateToDashboardView(dashboardId, folderId);
      await pm.dashboardPrint.waitForPanelMounted();

      await pm.dashboardPrint.enterPrintMode();
      await pm.dashboardPrint.waitForCaptureReady();

      testLogger.info("Print-capture readiness flag appeared");
    }
  );

  test(
    "should inject no print page style for an empty dashboard in print mode",
    { tag: ["@dashboard-print-layout", "@all", "@P2"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      uiDashboardName = dashboardName;

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardPrint.clickPrintButton();
      await pm.dashboardPrint.expectPrintModeContainerVisible();

      await pm.dashboardPrint.expectPrintPageStyleRemoved();
      await pm.dashboardPrint.expectGridStackAbsent();
      await pm.dashboardPrint.expectEmptyStateRendered();
      await pm.dashboardPrint.expectEmptyStateAddPanelBtnHidden();

      testLogger.info("Empty dashboard in print mode verified");
    }
  );
});
