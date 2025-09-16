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
        console.log(
          `Captured _values API with streaming: ${url} => Status: ${response.status()}`
        );
      }
    });

    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Enable streaming mode by setting use_streaming=true
    await pm.managementPage.setStreamingState(true);

    const panelName = pm.dashboardPanelActions.generateUniquePanelName(
      "panel-test-streaming"
    );

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
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

    await page.waitForTimeout(3000);

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select stream and add fields
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.dashboardTimeRefresh.setRelative("6", "w");

    // Perform custom value search in variable dropdown to trigger _values API calls with streaming
    const variableInput = page.getByLabel("variablename", {
      exact: true,
    });
    await variableInput.waitFor({ state: "visible", timeout: 10000 });
    await variableInput.click();

    // Type partial search terms to trigger multiple _values API calls with streaming enabled
    const searchTerms = ["zi", "zio", "ziox"];
    for (const term of searchTerms) {
      await variableInput.fill(term);
      await page.waitForTimeout(1500); // Allow API calls to complete with streaming
    }

    // Wait for final dropdown options to load
    await page.waitForTimeout(3000);

    // Try to select a value (if available)
    try {
      const option = page.getByRole("option").first();
      if (await option.isVisible()) {
        await option.click();
      }
    } catch (error) {
      console.log(
        "No options available for selection, continuing with test verification"
      );
    }

    // Wait for any remaining network activity to settle
    await page.waitForTimeout(3000);

    // Verify all _values API calls returned 200 status code with streaming enabled
    console.log(`\n📊 STREAMING API MONITORING RESULTS:`);
    console.log(
      `Total _values API calls captured with streaming: ${valuesResponses.length}`
    );

    // Assert that we captured at least one _values API call
    expect(valuesResponses.length).toBeGreaterThan(0);

    // Print summary of all captured APIs with streaming information
    console.log(`\n📋 CAPTURED STREAMING API CALLS SUMMARY:`);
    console.log("=".repeat(60));
    valuesResponses.forEach((res, index) => {
      const statusEmoji = res.status === 200 ? "✅" : "❌";
      const streamingEmoji = res.hasStreaming ? "🚀" : "📡";
      console.log(
        `${index + 1}. ${statusEmoji} ${streamingEmoji} Status: ${res.status}`
      );
      console.log(`   URL: ${res.url}`);
      console.log(`   Streaming enabled: ${res.hasStreaming}`);
      console.log(`   ${"-".repeat(80)}`);
    });

    // Assert all collected responses have 200 status
    let failedCalls = [];
    for (const res of valuesResponses) {
      console.log(
        `🔍 Verifying streaming API: ${res.url} => Status: ${res.status}`
      );
      if (res.status !== 200) {
        failedCalls.push(res);
      }
      expect(res.status).toBe(200);
    }

    // Verify that streaming parameters are present in API calls
    const streamingAwareCalls = valuesResponses.filter(
      (res) =>
        res.url.includes("_values_stream") ||
        res.url.includes("use_streaming") ||
        res.url.includes("streaming") ||
        res.url.includes("sql=") // Base64 encoded SQL parameter suggests streaming
    );
    console.log(`\n🚀 STREAMING VERIFICATION:`);
    console.log(
      `Calls with streaming indicators: ${streamingAwareCalls.length}`
    );
    console.log(
      `Calls with _values_stream endpoint: ${
        valuesResponses.filter((r) => r.url.includes("_values_stream")).length
      }`
    );

    console.log(`\n🎯 FINAL STREAMING RESULTS:`);
    console.log("=".repeat(60));
    console.log(`✅ Total API calls: ${valuesResponses.length}`);
    console.log(
      `✅ Successful calls (200): ${
        valuesResponses.filter((r) => r.status === 200).length
      }`
    );
    console.log(`❌ Failed calls: ${failedCalls.length}`);
    console.log(`🚀 Streaming-aware calls: ${streamingAwareCalls.length}`);
    console.log(
      `✅ All _values API calls with streaming returned 200 status code!`
    );
    console.log("=".repeat(60));

    // Add filter field and set value
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

    // Save panel and cleanup
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(
      randomDashboardName + "_streaming"
    );
    await pm.dashboardCreate.deleteDashboard(
      randomDashboardName + "_streaming"
    );

    // Disable streaming mode
    await pm.managementPage.setStreamingState(false);
  });
});
