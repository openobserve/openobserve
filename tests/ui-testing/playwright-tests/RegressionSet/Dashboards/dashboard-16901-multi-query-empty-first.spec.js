const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
import PageManager from "../../../pages/page-manager.js";
import { ingestion } from "../../Dashboards/utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "../../Dashboards/utils/dashCreation.js";
import { generateDashboardName } from "../../Dashboards/utils/configPanelHelpers.js";
const testLogger = require("../../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

const STREAM = "e2e_automate";

const customSql = (stream, empty) =>
  `SELECT histogram(_timestamp, '1 minute') AS x_axis_1, count(_timestamp) AS y_axis_1 FROM "${stream}" ${
    empty ? "WHERE 1 = 0 " : ""
  }GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

async function buildTwoQueryBarPanel(page, pm, dashboardName, [firstEmpty, secondEmpty]) {
  const msql = pm.dashboardMultiSQL;
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.dashboardPanelActions.addPanelName("Multi Query Panel");
  await pm.chartTypeSelector.selectChartType("bar");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(STREAM);
  await pm.chartTypeSelector.setCustomSQL(customSql(STREAM, firstEmpty));
  await pm.chartTypeSelector.waitForCustomQueryAxes("x_axis_1", "y_axis_1");

  await msql.addQueryTab(1);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(STREAM);
  await pm.chartTypeSelector.setCustomSQL(customSql(STREAM, secondEmpty));
  await pm.chartTypeSelector.waitForCustomQueryAxes("x_axis_1", "y_axis_1");

  await msql.switchToQueryTab(0);
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender();
}

test.describe("Dashboard multi-query panel with an empty query", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page, STREAM);
  });

  test("@all @dashboards empty first query and non-empty second query still renders the chart", async ({ page }) => {
    const pm = new PageManager(page);
    const actions = pm.dashboardPanelActions;
    const dashboardName = generateDashboardName();

    await buildTwoQueryBarPanel(page, pm, dashboardName, [true, false]);

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

    await buildTwoQueryBarPanel(page, pm, dashboardName, [false, true]);

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

    await buildTwoQueryBarPanel(page, pm, dashboardName, [true, true]);

    await expect(actions.getNoDataLocator()).toBeVisible({ timeout: 15000 });

    await actions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
