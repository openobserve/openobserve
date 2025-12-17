const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
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
    // await pm.managementPage.setStreamingState(true);

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
      true, // customValueSearc
      null, // filterConfig
      true  // showMultipleValues
    );

    // await page.waitForTimeout(3000);
    // await page.waitForLoadState("networkidle");

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");

    await pm.dashboardPanelActions.waitForChartToRender();


    const variableInput = page.getByLabel("variablename", {
      exact: true,
    });
    await variableInput.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the _values API call when clicking on the variable input
    const valuesApiPromise = page.waitForResponse(
      response => response.url().includes('_values') || response.url().includes('/values'),
      { timeout: 15000 }
    );

    await variableInput.click();

    // Wait for the API response to complete
    try {
      await valuesApiPromise;
      await page.waitForTimeout(500); // Additional wait for dropdown to render
    } catch (e) {
      console.log("Warning: _values API response not detected, continuing...");
    }

    // Type partial search terms to trigger multiple _values API calls with streaming enabled
    const searchTerms = ["zi", "zio", "ziox"];
    for (const term of searchTerms) {
      // Wait for the _values API call for each search term
      const valuesApiResponse = page.waitForResponse(
        response => response.url().includes('_values') || response.url().includes('/values'),
        { timeout: 15000 }
      );

      await variableInput.fill(term);

      // Wait for the API response to complete
      try {
        await valuesApiResponse;
        await page.waitForTimeout(300); // Wait for dropdown to update with new results
      } catch (e) {
        console.log(`Warning: _values API response not detected for term "${term}", continuing...`);
      }
    }
    // Select the final value
    const option = page.getByRole("option", { name: "ziox" });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();

    // Wait for any remaining network activity to settle
    // await page.waitForLoadState("networkidle");

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

    // await pm.managementPage.setStreamingState(false);
  });

  test("should add dashboard variable with filter configuration", async ({
    page,
  }) => {
    const valuesResponses = [];

    // Listen to responses (not requests) to get status codes
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/_values_stream")) {
        valuesResponses.push({
          url,
          status: response.status(),
          hasStreaming: url.includes("_values_stream"),
          timestamp: Date.now()
        });
      }
    });

    const pm = new PageManager(page);

    // Enable streaming mode by setting use_streaming=true
    // await pm.managementPage.setStreamingState(true);

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
  
    // await page.waitForLoadState("networkidle");

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
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.waitForChartToRender();


    await pm.dashboardPanelActions.savePanel();

    //wait for variable to be visible.
    const namespaceVariable = page.getByLabel("variablename", { exact: true });
    await namespaceVariable.waitFor({ state: 'visible', timeout: 10000 });
    await expect(namespaceVariable).toBeVisible();

    // Wait for all initial network activity to settle completely
    // await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Now capture the baseline count after everything has settled
    const noOfPreviousCalls = valuesResponses.length;

    // Helper function to wait for new API calls with better tracking
    const waitForMinimumNewCalls = async (minCalls, timeoutMs = 15000) => {
      const startCount = noOfPreviousCalls;
      const startTime = Date.now();
      let lastLoggedCount = 0;

      while (true) {
        const currentNewCalls = valuesResponses.length - startCount;
        const elapsed = Date.now() - startTime;

        // Log progress when new calls arrive
        if (currentNewCalls > lastLoggedCount) {
          lastLoggedCount = currentNewCalls;
        }

        // Success: we have enough calls and they've been stable for 500ms
        if (currentNewCalls >= minCalls) {
          await page.waitForTimeout(500); // Stability buffer
          const finalCount = valuesResponses.length - startCount;
          if (finalCount >= minCalls) {
            return finalCount;
          }
        }

        // Timeout: return what we have
        if (elapsed >= timeoutMs) {
          return currentNewCalls;
        }

        // Wait a bit before checking again
        await page.waitForTimeout(100);
      }
    };

    // Change the variable value - this should trigger dependent variable API calls
    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "ziox"
    );

    // Wait for at least 3 new API calls with proper tracking
    const newCallsCount = await waitForMinimumNewCalls(3, 15000);

    // Print details of new calls for debugging
    const newCalls = valuesResponses.slice(noOfPreviousCalls);
    newCalls.forEach((call, idx) => {
      const urlParts = call.url.split('/');
      const relevantPart = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
    });

    // Assert that at least 3 values API calls are made (for dependent variables)
    // Expected: variablename12 reload, variablename123 reload, and potentially panel data refresh
    expect(newCallsCount).toBeGreaterThanOrEqual(3)

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

  await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(
      randomDashboardName + "_filter"
    );
    await pm.dashboardCreate.deleteDashboard(
      randomDashboardName + "_filter"
    );
  });
});
