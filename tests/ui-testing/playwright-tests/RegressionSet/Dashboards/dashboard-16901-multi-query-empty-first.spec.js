const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
import PageManager from "../../../pages/page-manager.js";
import { ingestion } from "../../Dashboards/utils/dashIngestion.js";
import { cleanupTestDashboard } from "../../Dashboards/utils/dashCreation.js";
import { buildTwoQueryBarPanel } from "../../Dashboards/utils/multiQueryPanel.js";
import { generateDashboardName } from "../../Dashboards/utils/configPanelHelpers.js";
const testLogger = require("../../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

const STREAM = "e2e_automate";
test.describe("Dashboard multi-query panel with an empty query", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page, STREAM);
  });

  test("@all @dashboards empty first query and non-empty second query still renders the chart", async ({ page }) => {
    const pm = new PageManager(page);
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await buildTwoQueryBarPanel(page, pm, dashboardName, STREAM, [true, false]);

    await expect(actions.getNoDataLocator()).toBeHidden();
    await actions.verifyChartHasData(expect);
    await page.waitForLoadState("networkidle");
    await expect(actions.getNoDataLocator()).toBeHidden();
    await actions.verifyChartHasData(expect);
    testLogger.info("Chart stayed rendered with empty first query");

    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("@all @dashboards non-empty first query and empty second query renders the chart", async ({ page }) => {
    const pm = new PageManager(page);
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await buildTwoQueryBarPanel(page, pm, dashboardName, STREAM, [false, true]);

    await expect(actions.getNoDataLocator()).toBeHidden();
    await actions.verifyChartHasData(expect);
    await page.waitForLoadState("networkidle");
    await expect(actions.getNoDataLocator()).toBeHidden();

    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("@all @dashboards both queries empty shows No Data", async ({ page }) => {
    const pm = new PageManager(page);
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await buildTwoQueryBarPanel(page, pm, dashboardName, STREAM, [true, true]);

    await expect(actions.getNoDataLocator()).toBeVisible({ timeout: 15000 });

    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
