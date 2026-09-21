const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import { createDashboardWithMultiplePanels } from "./utils/panelTimeSetup.js";
const testLogger = require("../utils/test-logger.js");

test.describe("Dashboard Chart Zoom Brush & Panel Drag testcases", () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    // Fresh e2e_automate data every test so the chart has a non-empty time window.
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  // Build a saved single panel over e2e_automate and return to the dashboard view.
  async function buildSavedPanel(page, pm, dashboardName, panelName, chartType) {
    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType(chartType);
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions
      .waitForChartToRender()
      .catch((e) => testLogger.warn("waitForChartToRender:", e.message));
    await pm.dashboardPanelActions.savePanel();
  }

  test("TC-ZOOM-001: Dragging a brush on a time-series chart switches the dashboard to an absolute range", {
    tag: ["@dashboard-chart-zoom-brush", "@all", "@functional", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildSavedPanel(page, pm, dashboardName, "Zoom Line", "line");
    testLogger.info("Line chart panel saved on dashboard view");

    // Saved dashboard view: wait for the chart to mount and paint data.
    await pm.dashboardZoomDrag.waitForChartMounted();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Initial global time is relative: URL carries period= and no from=/to=.
    await expect
      .poll(
        () => {
          const url = page.url();
          return url.includes("period=") && !url.includes("from=") && !url.includes("to=");
        },
        { timeout: 15000 }
      )
      .toBe(true);

    // Register a re-query listener before brushing, so we can assert the
    // dashboard re-ran its panel queries after the zoom (not just the initial load).
    const searchResponsePromise = page
      .waitForResponse((r) => r.url().includes("/_search"), { timeout: 30000 })
      .catch(() => null);

    await pm.dashboardZoomDrag.brushChartCanvas();

    // Vue Router uses replaceState, so poll until the URL flips to absolute.
    await expect
      .poll(
        () => {
          const url = page.url();
          return url.includes("from=") && url.includes("to=") && !url.includes("period=");
        },
        { intervals: [100, 200, 500, 1000, 2000], timeout: 30000 }
      )
      .toBe(true);

    // The brush must have triggered a dashboard re-query.
    const searchResponse = await searchResponsePromise;
    expect(searchResponse).not.toBeNull();

    // The global picker now reflects an absolute range, not a relative "Last …" label.
    await expect(pm.dashboardZoomDrag.getGlobalPickerBtn()).not.toContainText(/last/i);

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-DRAG-001: Dragging a panel's header bar repositions it and saves the layout", {
    tag: ["@dashboard-chart-zoom-brush", "@all", "@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
      dashboardName,
      panels: [
        { panelName: "Drag Panel A", panelTimeEnabled: false },
        { panelName: "Drag Panel B", panelTimeEnabled: false },
      ],
    });
    const panelBId = panelIds[1];
    testLogger.info("Two panels created", { panelIds });

    await pm.dashboardZoomDrag.waitForPanelTile(panelBId);
    const before = await pm.dashboardZoomDrag.readPanelLayout(panelBId);
    testLogger.info("Pre-drag panel B layout", before);

    // Register the layout-save listener before dragging, so we can assert the
    // GridStack change handler persisted the new layout to the backend.
    const putResponsePromise = page
      .waitForResponse(
        (r) => r.request().method() === "PUT" && r.url().includes("/dashboards/"),
        { timeout: 30000 }
      )
      .catch(() => null);

    await pm.dashboardZoomDrag.dragPanelHeader(panelBId, { deltaX: -400, deltaY: 200 });

    const putResponse = await putResponsePromise;
    expect(putResponse).not.toBeNull();

    const after = await pm.dashboardZoomDrag.readPanelLayout(panelBId);
    testLogger.info("Post-drag panel B layout", after);
    expect(after.x !== before.x || after.y !== before.y).toBe(true);

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("TC-ZOOM-002: Dragging on a pie chart does not change the global time range", {
    tag: ["@dashboard-chart-zoom-brush", "@all", "@functional", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildSavedPanel(page, pm, dashboardName, "Pie No Zoom", "pie");
    testLogger.info("Pie chart panel saved on dashboard view");

    await pm.dashboardZoomDrag.waitForChartMounted();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Initial global time is relative.
    await expect
      .poll(
        () => {
          const url = page.url();
          return url.includes("period=") && !url.includes("from=") && !url.includes("to=");
        },
        { timeout: 15000 }
      )
      .toBe(true);

    // Same horizontal drag on the pie canvas — toolbox.show is false for pie,
    // so no dataZoom event fires and the global time range must stay relative.
    await pm.dashboardZoomDrag.brushChartCanvas();

    await expect
      .poll(
        () => {
          const url = page.url();
          return url.includes("period=") && !url.includes("from=") && !url.includes("to=");
        },
        { intervals: [100, 200, 500, 1000, 1000], timeout: 5000 }
      )
      .toBe(true);

    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
