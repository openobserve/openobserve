const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";

const STREAM_NAME = "e2e_automate";
// ECharts stamps `viewBox="0 0 <w> <h>"` with real (possibly fractional) pixel
// dimensions, so permit optional decimals rather than a bare `\d+`.
const PRINT_VIEWBOX_RE = /^0 0 \d+(\.\d+)? \d+(\.\d+)?$/;

test.describe("Dashboard Chart Print SVG Scaling", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    testLogger.info("Test setup completed");
  });

  function uniqueDashboardName(prefix) {
    return `${prefix}_${Math.random().toString(36).substring(2, 11)}`;
  }

  async function openDashboardsAndCreate(page, dashboardName) {
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);
  }

  async function applyWithTimeRange(page) {
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("4", "w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
  }

  // A metric panel must render data (not "No Data") before asserting its viewBox:
  // applySvgPrintViewBox guards `w > 0 && h > 0`, so an empty SVG never gets one.
  async function assertMetricRenders(page) {
    await expect(
      pm.dashboardPanelActions.getChartRendererCanvas()
    ).toBeVisible({ timeout: 15000 });

    const noDataElement = pm.dashboardPanelActions.getNoDataLocator();
    const stillEmpty = async () => {
      if ((await noDataElement.count()) === 0) return false;
      const text =
        (await noDataElement.first().textContent().catch(() => "")) || "";
      return text.trim() === "No Data";
    };

    // Re-apply the query if the panel is still showing "No Data" (a finished
    // render that never re-queries on its own — only a fresh Apply changes it).
    for (let attempt = 1; attempt <= 4 && (await stillEmpty()); attempt++) {
      testLogger.info(
        `Metric panel still empty — re-applying query (attempt ${attempt})`
      );
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await page.waitForTimeout(3000);
    }

    const noDataText = await noDataElement
      .textContent({ timeout: 5000 })
      .catch(() => "");
    expect(noDataText.trim()).not.toBe("No Data");
  }

  async function configureMetricPanel(page) {
    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("metric-print")
    );
    await pm.chartTypeSelector.selectChartType("metric");
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await applyWithTimeRange(page);
    await assertMetricRenders(page);
  }

  async function configureLinePanel(page) {
    await pm.dashboardPanelActions.addPanelName(
      pm.dashboardPanelActions.generateUniquePanelName("line-print")
    );
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await applyWithTimeRange(page);
    await expect(
      pm.dashboardPanelActions.getChartRendererCanvasElement().first()
    ).toBeVisible({ timeout: 20000 });
  }

  // Click the toolbar toggle and confirm print mode actually took effect (the
  // URL gains ?print=true) before asserting the downstream viewBox change.
  async function enterPrintMode(page) {
    await pm.dashboardPanelActions.enterPrintMode();
    await expect(page).toHaveURL(/print=true/, { timeout: 15000 });
  }

  async function cleanup(page, dashboardName) {
    if (/print=true/.test(page.url())) {
      await pm.dashboardPanelActions.exitPrintMode();
    }
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("Test cleanup complete");
  }

  test(
    "should add a print viewBox to a metric panel SVG when print mode is enabled",
    { tag: ["@dashboard-chart-print-svg", "@all", "@P0"] },
    async ({ page }) => {
      testLogger.info(
        "Verifying metric SVG gains a print viewBox after toggling print mode"
      );

      const dashboardName = uniqueDashboardName("PrintSvgMetric");
      await openDashboardsAndCreate(page, dashboardName);
      await pm.dashboardCreate.addPanel();
      await configureMetricPanel(page);
      await pm.dashboardPanelActions.savePanel();

      const svg = pm.dashboardPanelActions.getChartRendererSvg().first();
      await expect(svg).toBeVisible({ timeout: 15000 });
      expect(await svg.getAttribute("viewBox")).toBeNull();

      await enterPrintMode(page);

      await expect
        .poll(async () => svg.getAttribute("viewBox"), { timeout: 30000 })
        .toMatch(PRINT_VIEWBOX_RE);

      testLogger.info("Metric SVG gained a print viewBox");
      await cleanup(page, dashboardName);
    }
  );

  test(
    "should apply a print viewBox when the dashboard loads directly with ?print=true",
    { tag: ["@dashboard-chart-print-svg", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info(
        "Verifying metric SVG gains a viewBox on mount via ?print=true"
      );

      const dashboardName = uniqueDashboardName("PrintSvgUrl");
      await openDashboardsAndCreate(page, dashboardName);
      await pm.dashboardCreate.addPanel();
      await configureMetricPanel(page);
      await pm.dashboardPanelActions.savePanel();

      const viewUrl = new URL(page.url());
      viewUrl.searchParams.set("print", "true");
      await page.goto(viewUrl.toString(), { waitUntil: "domcontentloaded" });
      await pm.dashboardPanelActions.waitForChartToRender();

      const svg = pm.dashboardPanelActions.getChartRendererSvg().first();
      await expect(svg).toBeVisible({ timeout: 20000 });
      await expect
        .poll(async () => svg.getAttribute("viewBox"), { timeout: 30000 })
        .toMatch(PRINT_VIEWBOX_RE);

      testLogger.info("Metric SVG gained a viewBox on mount via ?print=true");
      await cleanup(page, dashboardName);
    }
  );

  test(
    "should keep a non-metric panel on canvas and never add an SVG viewBox in print mode",
    { tag: ["@dashboard-chart-print-svg", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info(
        "Verifying a line (canvas) panel never receives an SVG viewBox in print mode"
      );

      const dashboardName = uniqueDashboardName("PrintSvgLine");
      await openDashboardsAndCreate(page, dashboardName);
      await pm.dashboardCreate.addPanel();
      await configureLinePanel(page);
      await pm.dashboardPanelActions.savePanel();

      await expect(
        pm.dashboardPanelActions.getChartRendererCanvasElement().first()
      ).toBeVisible({ timeout: 20000 });
      await expect(
        pm.dashboardPanelActions.getChartRendererSvg()
      ).toHaveCount(0, { timeout: 15000 });

      await enterPrintMode(page);

      await expect(
        pm.dashboardPanelActions.getChartRendererCanvasElement().first()
      ).toBeVisible({ timeout: 20000 });
      await expect(
        pm.dashboardPanelActions.getChartRendererSvg()
      ).toHaveCount(0, { timeout: 15000 });

      testLogger.info("Line panel stayed on canvas with no SVG viewBox");
      await cleanup(page, dashboardName);
    }
  );

  test(
    "should give each of multiple metric panels its own print viewBox",
    { tag: ["@dashboard-chart-print-svg", "@all", "@P2"] },
    async ({ page }) => {
      testLogger.info(
        "Verifying every metric panel receives its own viewBox in print mode"
      );

      const dashboardName = uniqueDashboardName("PrintSvgMulti");
      await openDashboardsAndCreate(page, dashboardName);

      await pm.dashboardCreate.addPanel();
      await configureMetricPanel(page);
      await pm.dashboardPanelActions.savePanel();

      await pm.dashboardCreate.addPanelToExistingDashboard();
      await configureMetricPanel(page);
      await pm.dashboardPanelActions.savePanel();

      await enterPrintMode(page);

      const svgs = pm.dashboardPanelActions.getChartRendererSvg();
      await expect(svgs).toHaveCount(2, { timeout: 20000 });
      await expect
        .poll(async () => svgs.nth(0).getAttribute("viewBox"), {
          timeout: 30000,
        })
        .toMatch(PRINT_VIEWBOX_RE);
      await expect
        .poll(async () => svgs.nth(1).getAttribute("viewBox"), {
          timeout: 30000,
        })
        .toMatch(PRINT_VIEWBOX_RE);

      testLogger.info("Each metric panel received its own print viewBox");
      await cleanup(page, dashboardName);
    }
  );
});
