const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import { waitForDashboardPage } from "./utils/dashCreation.js";
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "serial" });

// Refactored test cases using Page Object Model

test.describe("dashboard streaming testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should verify the custom value search from variable dropdown with streaming enabled", async ({
    page,
  }) => {
    const valuesResponses = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/_values_stream")) {
        valuesResponses.push({
          url,
          status: response.status(),
          hasStreaming: url.includes("_values_stream"),
        });
      }
    });

    const pm = new PageManager(page);

    // Enable streaming mode by setting use_streaming=true
    await pm.managementPage.setStreamingState(true);

    const panelName = pm.dashboardPanelActions.generateUniquePanelName(
      "panel-test-streaming"
    );

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.createDashboard(
      randomDashboardName + "_streaming"
    );
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      true
    );

    // await page.waitForTimeout(3000);
    await page.waitForLoadState("networkidle");

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("6", "w");

    const variableInput = page.getByLabel("variablename", {
      exact: true,
    });
    await variableInput.waitFor({ state: "visible", timeout: 10000 });
    await variableInput.click();

    // Type partial search terms to trigger multiple _values API calls with streaming enabled
    const searchTerms = ["zi", "zio", "ziox"];
    for (const term of searchTerms) {
      await variableInput.fill(term);
      // await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");
    }
    // Select the final value
    const option = page.getByRole("option", { name: "ziox" });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();

    // Wait for any remaining network activity to settle
    await page.waitForLoadState("networkidle");

    expect(valuesResponses.length).toBeGreaterThan(0);

    for (const res of valuesResponses) {
      expect(res.status).toBe(200);
    }

    // Verify that streaming parameters are present in API calls
    const streamingAwareCalls = valuesResponses.filter(
      (res) =>
        res.url.includes("_values_stream") ||
        res.url.includes("use_streaming") ||
        res.url.includes("streaming") ||
        res.url.includes("sql=")
    );
    expect(streamingAwareCalls.length).toBeGreaterThan(0);

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );

    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "IN",
      "$variablename"
    );

    await pm.dashboardPanelActions.savePanel();

    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(
      randomDashboardName + "_streaming"
    );
    await pm.dashboardCreate.deleteDashboard(
      randomDashboardName + "_streaming"
    );

    await pm.managementPage.setStreamingState(false);
  });

  test("should add dashboard variable with filter configuration", async ({
    page,
  }) => {
    const valuesResponses = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/_values_stream")) {
        // console.log(`[VALUES API HIT ${valuesResponses.length + 1}] Status: ${response.status()}`);
        // console.log(`URL: ${url}`);
        valuesResponses.push({
          url,
          status: response.status(),
          hasStreaming: url.includes("_values_stream"),
        });
      }
    });

    const pm = new PageManager(page);

    // Enable streaming mode by setting use_streaming=true
    await pm.managementPage.setStreamingState(true);

    const panelName = pm.dashboardPanelActions.generateUniquePanelName(
      "panel-filter-test"
    );

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await pm.dashboardCreate.createDashboard(
      randomDashboardName + "_filter"
    );
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await pm.dashboardSetting.openSetting();

    // Add first variable without filter (existing behavior)
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Add second variable with filter configuration
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariables.addDashboardVariable(
      "variablename12",
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      false,

      //This is the filter configuration for the second variable we can add the filter values like below with the filter name, operator and value
      {
        filterName: "kubernetes_container_name",
        operator: "=",
        value: "$variablename"
      }
    );

     // Add second variable with filter configuration
     await pm.dashboardSetting.openSetting();
     await pm.dashboardVariables.addDashboardVariable(
       "variablename123",
       "logs",
       "e2e_automate",
       "kubernetes_pod_name",
       false,
 
       //This is the filter configuration for the second variable we can add the filter values like below with the filter name, operator and value
       {
         filterName: "kubernetes_namespace_name",
         operator: "=",
         value: "$variablename12"
       }
     );
  
    await page.waitForLoadState("networkidle");

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "filter"
    );
      // Add filter conditions
      await pm.dashboardFilter.addFilterCondition(
        0,
        "kubernetes_container_name",
        "",
        "=",
        "$variablename"
      );

    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("6", "w");
    await pm.dashboardPanelActions.waitForChartToRender();


    await pm.dashboardPanelActions.savePanel();

    //wait for variable to be visible.
    const namespaceVariable = page.getByLabel("variablename", { exact: true });
    await namespaceVariable.waitFor({ state: 'visible', timeout: 10000 });
    await expect(namespaceVariable).toBeVisible();

    // Clear the responses array to track only API calls after variable selection
    // This is the key point: we want to know how many values API calls happen when the variable value changes
    valuesResponses.length = 0;

    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Using a polling approach to wait until we receive exactly 3 API calls
    await page.waitForFunction(
      (expectedCount) => {
        // This function runs in browser context, so we can't access valuesResponses directly
        // We'll use a timeout-based approach instead
        return true;
      },
      3,
      { timeout: 50 }
    ).catch(() => {});

    // await page.waitForTimeout(3000);

    // Assert that exactly 3 values API calls are made (one for each dependent variable)
    expect(valuesResponses.length).toBe(3);

    for (const res of valuesResponses) {
      expect(res.status).toBe(200);
    }

    // Verify that streaming parameters are present in API calls
    const streamingAwareCalls = valuesResponses.filter(
      (res) =>
        res.url.includes("_values_stream") ||
        res.url.includes("use_streaming") ||
        res.url.includes("streaming") ||
        res.url.includes("sql=")
    );
    console.log(`[TEST 2] Streaming-aware API calls: ${streamingAwareCalls.length}`);
    expect(streamingAwareCalls.length).toBeGreaterThan(0);

  await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(
      randomDashboardName + "_filter"
    );
    await pm.dashboardCreate.deleteDashboard(
      randomDashboardName + "_filter"
    );
  });
});
