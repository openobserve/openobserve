const { test, expect, navigateToBase } = require("../../utils/enhanced-baseFixtures.js");
const PageManager = require("../../../pages/page-manager.js");
import { ingestion } from "../../Dashboards/utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "../../Dashboards/utils/dashCreation.js";
const testLogger = require("../../utils/test-logger.js");

const GENERIC_MESSAGE = "There are some errors, please fix them and try again";

test.describe("Dashboard panel save names the failed check (#11283)", () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test("saving a named bar panel with no Y-axis field says the Y-axis is missing", {
    tag: ["@bug-11283", "@P1", "@regression", "@dashboardRegression"]
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_11283_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    try {
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      // A filled name rules out the blank-name case, which already reports on the field itself.
      await pm.dashboardPanelActions.addPanelName("Panel 11283");

      await pm.dashboardPanelActions.savePanel();
      const toast = await pm.dashboardPanelActions.getErrorToastText();
      testLogger.info(`Save error toast: ${toast}`);

      expect(toast, "Bug #11283: the toast must name the failed check").toContain("Add at least one field for the Y-Axis");
      expect(toast, "Bug #11283: the generic message names nothing").not.toContain(GENERIC_MESSAGE);
      expect(page.url(), "an invalid panel must not be saved").toContain("add_panel");

      await pm.dashboardPanelActions.discardPanel();
    } finally {
      await deleteDashboard(page, dashboardName).catch(() => {});
    }
  });
});
