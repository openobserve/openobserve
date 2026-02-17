// Dashboard Copy Legends & Table Cell Copy - E2E Tests
// PR #9677: feat: dashboard copy legends and table cells
// Tests for Show Legends popup and table cell copy functionality

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
const testLogger = require("../utils/test-logger.js");

const randomDashboardName =
  "Dashboard_Legends_" + Math.random().toString(36).slice(2, 11);

test.describe("Dashboard Copy Legends and Table Cells", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ===== P0: SMOKE TESTS =====

  test(
    "should display Show Legends button on a line chart panel with data",
    { tag: ["@dashboardLegendsCopy", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing Show Legends button visibility on line chart");

      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("legends-test");

      // Navigate to dashboards and create a new dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(randomDashboardName);

      // Add a line chart panel with data
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply query and wait for chart to render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Hover over the chart renderer to reveal the toolbar
      // ChartRenderer.vue uses data-test="chart-renderer"
      await pm.dashboardLegendsCopy.chartRenderer.first().hover();
      await page.waitForTimeout(500);

      // Verify the Show Legends button is visible (icon: format_list_bulleted)
      const showLegendsBtn = pm.dashboardLegendsCopy.getShowLegendsButton();
      await expect(showLegendsBtn).toBeVisible({ timeout: 10000 });

      testLogger.info("Show Legends button is visible on line chart");

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, randomDashboardName);
    }
  );

  test(
    "should open Show Legends popup and display legends",
    { tag: ["@dashboardLegendsCopy", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing Show Legends popup opens and displays legends");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_LegendsPopup_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("legends-popup");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a line chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait for render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open the legends popup - hover over chart renderer to reveal toolbar
      await pm.dashboardLegendsCopy.chartRenderer.first().hover();
      await page.waitForTimeout(500);
      await pm.dashboardLegendsCopy.getShowLegendsButton().click();

      // Verify popup is visible
      await pm.dashboardLegendsCopy.waitForPopupVisible();
      await expect(pm.dashboardLegendsCopy.legendsPopup).toBeVisible();

      // Verify legends are displayed (at least one legend item)
      const legendCount = await pm.dashboardLegendsCopy.getLegendCount();
      expect(legendCount).toBeGreaterThan(0);
      testLogger.info(`Found ${legendCount} legends in popup`);

      // Verify the total legends text is shown
      const totalText = await pm.dashboardLegendsCopy.getTotalLegendsText();
      expect(totalText).toContain(`${legendCount}`);

      // Close the popup
      await pm.dashboardLegendsCopy.closePopup();

      testLogger.info("Show Legends popup test completed");

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  test(
    "should show copy button on table cell hover and copy the value",
    { tag: ["@dashboardLegendsCopy", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing table cell copy button on hover");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_TableCopy_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("table-copy");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a table chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait for table data
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify copy button appears on hover (uses page object to handle virtual scroll)
      const isCopyBtnVisible =
        await pm.dashboardLegendsCopy.isTableCellCopyButtonVisible(0, 0);
      expect(isCopyBtnVisible).toBeTruthy();

      // Click the copy button
      await pm.dashboardLegendsCopy.copyTableCell(0, 0);

      // Verify icon changes to "check" after copy
      const isCopied = await pm.dashboardLegendsCopy.isTableCellCopied(0, 0);
      expect(isCopied).toBeTruthy();

      testLogger.info("Table cell copy button test completed");

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  // ===== P1: FUNCTIONAL TESTS =====

  test(
    "should copy individual legend name to clipboard",
    { tag: ["@dashboardLegendsCopy", "@functional", "@P1"] },
    async ({ page, context }) => {
      testLogger.info("Testing individual legend copy");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_LegendCopy_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("legend-copy");

      // Grant clipboard permissions
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a line chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open legends popup - hover over chart renderer to reveal toolbar
      await pm.dashboardLegendsCopy.chartRenderer.first().hover();
      await page.waitForTimeout(500);
      await pm.dashboardLegendsCopy.getShowLegendsButton().click();
      await pm.dashboardLegendsCopy.waitForPopupVisible();

      // Get the first legend text
      const legendText = await pm.dashboardLegendsCopy.getLegendText(0);
      expect(legendText).toBeTruthy();
      testLogger.info(`First legend text: "${legendText}"`);

      // Copy the first legend
      await pm.dashboardLegendsCopy.copyLegend(0);

      // Verify the copy button changes to check icon
      const legendItem = pm.dashboardLegendsCopy.getLegendItem(0);
      const copyBtnIcon = legendItem.locator(".copy-btn .q-icon");
      await expect(copyBtnIcon).toHaveText(/check/, { timeout: 3000 });

      // Verify clipboard contains the legend text
      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText()
      );
      expect(clipboardText).toBe(legendText);

      testLogger.info("Individual legend copy verified");

      // Close popup, save panel to return to dashboard view, then cleanup
      await pm.dashboardLegendsCopy.closePopup();
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  test(
    "should copy all legends to clipboard",
    { tag: ["@dashboardLegendsCopy", "@functional", "@P1"] },
    async ({ page, context }) => {
      testLogger.info("Testing copy all legends");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_CopyAll_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("copy-all");

      await context.grantPermissions(["clipboard-read", "clipboard-write"]);

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a line chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open legends popup - hover over chart renderer to reveal toolbar
      await pm.dashboardLegendsCopy.chartRenderer.first().hover();
      await page.waitForTimeout(500);
      await pm.dashboardLegendsCopy.getShowLegendsButton().click();
      await pm.dashboardLegendsCopy.waitForPopupVisible();

      // Click "Copy all"
      await pm.dashboardLegendsCopy.clickCopyAll();

      // Verify "Copy all" button shows "Copied" state
      const isCopiedState =
        await pm.dashboardLegendsCopy.isCopyAllInCopiedState();
      expect(isCopiedState).toBeTruthy();

      // Verify the Copy All button shows "Copied" text
      await expect(pm.dashboardLegendsCopy.copyAllBtn).toContainText("Copied");

      testLogger.info("Copy all legends verified");

      // Close popup, save panel to return to dashboard view, then cleanup
      await pm.dashboardLegendsCopy.closePopup();
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  test(
    "should close Show Legends popup via close button",
    { tag: ["@dashboardLegendsCopy", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing Show Legends popup close");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_ClosePopup_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("close-popup");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a line chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open the legends popup - hover over chart renderer to reveal toolbar
      await pm.dashboardLegendsCopy.chartRenderer.first().hover();
      await page.waitForTimeout(500);
      await pm.dashboardLegendsCopy.getShowLegendsButton().click();
      await pm.dashboardLegendsCopy.waitForPopupVisible();

      // Close the popup
      await pm.dashboardLegendsCopy.closePopup();

      // Verify popup is no longer visible
      await expect(pm.dashboardLegendsCopy.legendsPopup).not.toBeVisible();

      testLogger.info("Legends popup close test completed");

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  test(
    "should hide Show Legends button for table chart type",
    { tag: ["@dashboardLegendsCopy", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info(
        "Testing Show Legends button is hidden for table chart type"
      );

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_NoLegends_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("no-legends");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a TABLE chart panel (legends button should NOT appear)
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait for table data
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Hover over the table area
      const tableArea = pm.dashboardLegendsCopy.dashboardTable.first();
      await tableArea.hover();
      await page.waitForTimeout(500);

      // Verify Show Legends button is NOT visible
      const showLegendsBtn = pm.dashboardLegendsCopy.getShowLegendsButton();
      await expect(showLegendsBtn).not.toBeVisible({ timeout: 3000 });

      testLogger.info(
        "Show Legends button correctly hidden for table chart type"
      );

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  test(
    "should show check icon after copying table cell and revert after 3 seconds",
    { tag: ["@dashboardLegendsCopy", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing table cell copy icon state transition");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_CellIcon_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("cell-icon");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a table chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait for table
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Copy a cell using page object (handles virtual scroll + absolute positioning)
      await pm.dashboardLegendsCopy.copyTableCell(0, 0);

      // Verify check icon is shown
      const isCopied = await pm.dashboardLegendsCopy.isTableCellCopied(0, 0);
      expect(isCopied).toBeTruthy();

      // Wait 3+ seconds for the icon to revert
      await page.waitForTimeout(3500);

      // Re-hover to see the button again using page object method
      await pm.dashboardLegendsCopy.ensureTableDataVisible();
      const cell = pm.dashboardLegendsCopy.getTableCell(0, 0);
      const box = await cell.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.waitForTimeout(500);

      // The copy button should now show "content_copy" icon again (not "check")
      const copyBtn = cell.locator('.copy-btn .q-icon');
      const isVisible = await copyBtn.isVisible();
      if (isVisible) {
        const iconText = await copyBtn.textContent();
        expect(iconText).toContain("content_copy");
      }

      testLogger.info("Table cell copy icon revert test completed");

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );

  // ===== P2: EDGE CASE TESTS =====

  test(
    "should not show copy button for empty table cell values",
    { tag: ["@dashboardLegendsCopy", "@edgeCase", "@P2"] },
    async ({ page }) => {
      testLogger.info("Testing copy button not shown for empty cells");

      const pm = new PageManager(page);
      const dashName =
        "Dashboard_EmptyCell_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("empty-cell");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashName);

      // Add a table chart panel
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Apply and wait for table
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Verify that non-empty cells DO have copy buttons (uses page object
      // to handle virtual scroll spacer rows and absolute positioning)
      const isCopyBtnVisible =
        await pm.dashboardLegendsCopy.isTableCellCopyButtonVisible(0, 0);
      expect(isCopyBtnVisible).toBeTruthy();

      testLogger.info("Empty cell copy button test completed");

      // Save panel to return to dashboard view, then cleanup
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);
    }
  );
});
