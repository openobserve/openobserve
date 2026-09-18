/**
 * Dashboard Print Layout Functional Tests
 *
 * Verifies the dashboard "print mode" view state:
 *  - button toggle + header-chrome hide/show + URL `print` param sync + `@page` inject/remove
 *  - deep-link `print=true` hydration on mount
 *  - single-table full-width branch (grid bypassed)
 *  - multi-panel grid reflow (`@page` size + straddling panel repositioning)
 *  - `@media print` CSS overrides apply only under print media
 *  - empty dashboard early-return and rapid-toggle idempotency
 *
 * Print mode is client-side only (Vuex state + URL query); no new API calls.
 */

import { test, expect, navigateToBase } from "../utils/enhanced-baseFixtures.js";
import testLogger from "../utils/test-logger.js";
import PageManager from "../../pages/page-manager.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupBarPanel,
  setupTablePanel,
} from "./utils/configPanelHelpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard print layout testcases", () => {
  // Track dashboard name per test for cleanup
  let currentDashboardName = null;

  test.beforeEach(async ({ page }, testInfo) => {
    currentDashboardName = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  test.afterEach(async ({ page }) => {
    if (currentDashboardName) {
      try {
        const pm = new PageManager(page);
        // Header/sidebar buttons are hidden while printing — exit first so
        // navigation and deletion can proceed.
        if (await pm.dashboardPrint.isPrintModeActive()) {
          await pm.dashboardPrint.exitPrintMode();
        }
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await deleteDashboard(page, currentDashboardName);
      } catch (e) {
        testLogger.warn("Cleanup failed (non-fatal):", { error: e.message });
      }
    }
  });

  test("should toggle print mode via the button and restore chrome on exit", { tag: ['@dashboard-print-layout', '@all', '@P0'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintToggle");
    currentDashboardName = dashboardName;

    await setupBarPanel(page, pm, dashboardName, "print-line-panel");
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Pre-state: no print-mode container, no print-page style, chrome visible
    await pm.dashboardPrint.assertPrintModeInactive(expect);
    await pm.dashboardPrint.assertPrintPageStyleAbsent(expect);

    // Enter print mode
    await pm.dashboardPrint.enterPrintMode();

    // Assert print mode is fully active
    await pm.dashboardPrint.assertPrintModeActive(expect);
    await pm.dashboardPrint.waitForPrintPageStyle();
    await pm.dashboardPrint.assertPrintPageStylePresent(expect);
    await pm.dashboardPrint.assertChromeHidden(expect);
    await pm.dashboardPrint.expectPrintParamInUrl(expect, "true");

    // Exit print mode
    await pm.dashboardPrint.exitPrintMode();

    // Assert everything is restored
    await pm.dashboardPrint.assertPrintModeInactive(expect);
    await pm.dashboardPrint.assertPrintPageStyleAbsent(expect);
    await pm.dashboardPrint.expectPrintParamInUrl(expect, "false");
    testLogger.info("Print mode toggle round-trip verified");
  });

  test("should render a single table panel full-width with the grid bypassed", { tag: ['@dashboard-print-layout', '@all', '@P1'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintTable");
    currentDashboardName = dashboardName;

    await setupTablePanel(page, pm, dashboardName, "print-table-panel");
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Pre-state: normal grid present
    await pm.dashboardPrint.assertGridStackPresent(expect);

    // Enter print mode → single-table full-width branch (no grid)
    await pm.dashboardPrint.enterPrintMode();

    await pm.dashboardPrint.assertGridStackAbsent(expect);
    await pm.dashboardPrint.expectSinglePanelContainer(expect);

    // Exit print mode → grid returns
    await pm.dashboardPrint.exitPrintMode();
    await pm.dashboardPrint.assertGridStackPresent(expect);
    testLogger.info("Single table panel full-width branch verified");
  });

  test("should hydrate print mode from a print=true deep link", { tag: ['@dashboard-print-layout', '@all', '@P1'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintDeepLink");
    currentDashboardName = dashboardName;

    await setupBarPanel(page, pm, dashboardName, "print-deeplink-panel");
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Navigate to the same dashboard with print=true (deep link)
    const url = new URL(page.url());
    url.searchParams.set("print", "true");
    await page.goto(url.toString());
    await page.waitForLoadState("domcontentloaded");
    await pm.dashboardPrint.waitForPanelsToRender();

    // Dashboard should mount already in print mode without clicking the button
    await pm.dashboardPrint.assertPrintModeActive(expect);
    await pm.dashboardPrint.waitForPrintPageStyle();
    await pm.dashboardPrint.assertPrintPageStylePresent(expect);
    await pm.dashboardPrint.assertChromeHidden(expect);
    testLogger.info("Deep-link print=true hydration verified");
  });

  test("should inject @page size and reposition straddling panels in multi-panel grid", { tag: ['@dashboard-print-layout', '@all', '@P1'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintReflow");
    currentDashboardName = dashboardName;

    // Panel 1
    await setupBarPanel(page, pm, dashboardName, "print-reflow-panel-1");
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Panel 2
    await pm.dashboardPanelActions.addNextPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await pm.dashboardPanelActions.addPanelName("print-reflow-panel-2");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Panel 3
    await pm.dashboardPanelActions.addNextPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await pm.dashboardPanelActions.addPanelName("print-reflow-panel-3");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Ensure all three grid items are laid out before entering print mode
    await pm.dashboardPrint.waitForGridItemCount(3);

    // Pre-state: grid present, no print-page style
    await pm.dashboardPrint.assertGridStackPresent(expect);
    await pm.dashboardPrint.assertPrintPageStyleAbsent(expect);

    // Enter print mode → preparePrintLayout runs
    await pm.dashboardPrint.enterPrintMode();
    await pm.dashboardPrint.waitForPrintPageStyle();

    // Assert @page rule injected and grid reflow applied
    await pm.dashboardPrint.assertPrintPageStylePresent(expect);
    const pageStyle = await pm.dashboardPrint.getPrintPageStyleText();
    expect(pageStyle).toContain("@page");
    expect(pageStyle).toContain("size:");

    const gridHeight = await pm.dashboardPrint.getGridStackInlineHeight();
    expect(gridHeight).toBeTruthy();
    expect(gridHeight).toContain("px");

    const overridden = await pm.dashboardPrint.getOverriddenTopCount();
    expect(overridden).toBeGreaterThan(0);

    // Exit print mode → layout restored
    await pm.dashboardPrint.exitPrintMode();
    await pm.dashboardPrint.assertPrintPageStyleAbsent(expect);

    const restored = await pm.dashboardPrint.getOverriddenTopCount();
    expect(restored).toBe(0);
    testLogger.info("Multi-panel print reflow + restore verified");
  });

  test("should apply print-media CSS overrides only under @media print", { tag: ['@dashboard-print-layout', '@all', '@P1'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintMedia");
    currentDashboardName = dashboardName;

    await setupBarPanel(page, pm, dashboardName, "print-media-panel");
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    await pm.dashboardPrint.enterPrintMode();
    await pm.dashboardPrint.waitForPrintPageStyle();

    // Emulate print media → @media print rule activates
    await page.emulateMedia({ media: "print" });
    await pm.dashboardPrint.expectPanelContentOverflow(expect, "hidden");

    // Emulate screen media → override is inert (back to default visible)
    await page.emulateMedia({ media: "screen" });
    await pm.dashboardPrint.expectPanelContentOverflow(expect, "visible");
    testLogger.info("Print-media CSS scoping verified");
  });

  test("should hide chrome but skip @page injection for an empty dashboard", { tag: ['@dashboard-print-layout', '@all', '@P2'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintEmpty");
    currentDashboardName = dashboardName;

    // Create a dashboard with no panels
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Confirm NoPanel placeholder
    await pm.dashboardPrint.expectNoPanel(expect);

    // Enter print mode
    await pm.dashboardPrint.enterPrintMode();

    // Chrome hides, but preparePrintLayout early-returns (no @page injected)
    await pm.dashboardPrint.assertPrintModeActive(expect);
    await pm.dashboardPrint.assertChromeHidden(expect);
    await pm.dashboardPrint.assertPrintPageStyleAbsent(expect);

    // Exit → chrome restored
    await pm.dashboardPrint.exitPrintMode();
    await pm.dashboardPrint.assertPrintModeInactive(expect);
    testLogger.info("Empty dashboard print-mode behavior verified");
  });

  test("should not accumulate #o2-print-page across rapid toggles", { tag: ['@dashboard-print-layout', '@all', '@P2'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName("PrintRapid");
    currentDashboardName = dashboardName;

    await setupBarPanel(page, pm, dashboardName, "print-rapid-panel");
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPrint.waitForPanelsToRender();

    // Rapid on → off → on → off
    for (let i = 0; i < 2; i++) {
      await pm.dashboardPrint.enterPrintMode();
      await pm.dashboardPrint.exitPrintMode();
    }

    // Final state clean: no print-page style, container detached
    await pm.dashboardPrint.assertPrintPageStyleAbsent(expect);
    await pm.dashboardPrint.assertPrintModeInactive(expect);
    testLogger.info("Rapid toggle idempotency verified");
  });
});
