const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require('../utils/test-logger.js');
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model
test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should create, compare area type chart image and delete dashboard", async ({
    page,
  }, testInfo) => {
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    const dashboardName = generateDashboardName();

    // Navigate to the dashboard list page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select the stream and chart type
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.selectChartType("area");

    // Add a field to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );

    // Apply the changes
    await pm.dashboardPanelActions.waitForApplyVisible();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await waitForDateTimeButtonToBeEnabled(page);

    // waitForChartRendererVisible() only waits for the CONTAINER
    // ([data-test="chart-renderer"]); ECharts paints its <canvas> inside it
    // asynchronously, so wait for the canvas itself before capturing.
    await pm.dashboardPanelActions.waitForChartRendererVisible();
    await expect(
      pm.dashboardPanelActions.getChartRendererCanvasElement().first()
    ).toBeVisible({ timeout: 20000 });
    await expect(pm.dashboardPanelActions.getNoDataLocator()).not.toBeVisible();

    // Nothing diffs the captured PNG - takeChartRendererScreenshot is just
    // locator.screenshot({path}) - so without this the test passed on a blank
    // canvas and wrote an empty image. Assert the area chart actually painted
    // pixels, which is stable, unlike a pixel-diff against live alpha data that
    // changes every run.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const canvas = document.querySelector(
              '[data-test="chart-renderer"] canvas'
            );
            if (!canvas) return false;
            const ctx = canvas.getContext("2d");
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] > 0) return true;
            }
            return false;
          }),
        { timeout: 20000 }
      )
      .toBe(true);

    // Write the capture into this test's own output dir. It used to overwrite a
    // GIT-TRACKED file, so every run left `areachart-screenshot.png` modified in
    // the working tree, and parallel shards raced each other writing it. Nothing
    // reads the committed copy - it is a write-only artifact.
    await pm.dashboardPanelActions.takeChartRendererScreenshot(
      testInfo.outputPath("areachart-screenshot.png")
    );

    // Save the panel
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.waitForDefaultFolderTabVisible();
    await deleteDashboard(page, dashboardName);
  });
});
