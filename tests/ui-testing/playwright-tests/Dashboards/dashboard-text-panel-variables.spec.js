const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import { generateDashboardName, discardAndCleanupTestDashboard } from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

const TAGS = ["@dashboard", "@dashboardTextPanelVariables", "@P1", "@all"];

const MARKDOWN_TIME_RANGE = "Range: ${start_time} to ${end_time}";

const HTML_URL_FORMATS = `<p id="pe">PE=\${variablename:percentencode}</p>
<p id="qp">QP=\${variablename:queryparam}</p>`;

test.describe("Dashboard text panels — variables", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  for (const chartType of ["html", "markdown"]) {
    test(`${chartType} editor: Add Variable button opens the variable drawer`, { tag: TAGS }, async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();
      await ingestion(page);

      await setupTestDashboard(page, pm, dashboardName);
      // VariablesValueSelector renders the Add Variable button only once the dashboard has a variable.
      await pm.dashboardSetting.openSetting();
      await pm.dashboardVariables.addDashboardVariable(
        "variablename",
        "logs",
        "e2e_automate",
        "kubernetes_container_name"
      );
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType(chartType);

      await expect(pm.dashboardVariables.addVariableBtn).toBeVisible();
      await pm.dashboardVariables.clickAddVariableBtn();
      await expect(pm.dashboardVariables.variableNameField).toBeVisible({ timeout: 10000 });

      await discardAndCleanupTestDashboard(page, dashboardName);
    });
  }

  test("markdown: ${start_time} and ${end_time} are replaced with the panel time range", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("markdown");
    await pm.chartTypeSelector.fillMarkdownEditor(MARKDOWN_TIME_RANGE);

    const renderer = pm.chartTypeSelector.markdownRenderer;
    await expect(renderer).toContainText(/Range: \d{13,16} to \d{13,16}/, { timeout: 15000 });
    await expect(renderer).not.toContainText("${start_time}");

    const [, start, end] = (await renderer.innerText()).match(/Range: (\d+) to (\d+)/);
    expect(Number(end)).toBeGreaterThan(Number(start));

    await pm.dashboardPanelActions.addPanelName("Markdown Time Range");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("html: percentencode and queryparam variable formats", { tag: TAGS }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
    await ingestion(page);

    await setupTestDashboard(page, pm, dashboardName);
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("html");
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.chartTypeSelector.fillHtmlEditor(HTML_URL_FORMATS);
    await pm.dashboardVariables.selectValueFromVariableDropDown("variablename", "controller");

    await expect(pm.chartTypeSelector.getHtmlRendererElement("#pe")).toHaveText("PE=controller", { timeout: 15000 });
    await expect(pm.chartTypeSelector.getHtmlRendererElement("#qp")).toHaveText("QP=var-variablename=controller");

    await pm.dashboardPanelActions.addPanelName("HTML URL Formats");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
