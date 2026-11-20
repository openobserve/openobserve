import { setupTestDashboard } from "./dashCreation.js";

const customSql = (stream, empty) =>
  `SELECT histogram(_timestamp, '1 minute') AS x_axis_1, count(_timestamp) AS y_axis_1 FROM "${stream}" ${
    empty ? "WHERE 1 = 0 " : ""
  }GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

export async function buildTwoQueryBarPanel(page, pm, dashboardName, stream, [firstEmpty, secondEmpty]) {
  const msql = pm.dashboardMultiSQL;
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.dashboardPanelActions.addPanelName("Multi Query Panel");
  await pm.chartTypeSelector.selectChartType("bar");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(stream);
  await pm.chartTypeSelector.setCustomSQL(customSql(stream, firstEmpty));
  await pm.chartTypeSelector.waitForCustomQueryAxes("x_axis_1", "y_axis_1");

  await msql.addQueryTab(1);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(stream);
  await pm.chartTypeSelector.setCustomSQL(customSql(stream, secondEmpty));
  await pm.chartTypeSelector.waitForCustomQueryAxes("x_axis_1", "y_axis_1");

  await msql.switchToQueryTab(0);
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender();
}
