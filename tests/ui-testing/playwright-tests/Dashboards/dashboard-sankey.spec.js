import { test, expect } from "../baseFixtures.js";
import { login } from "./utils/dashLogin.js";
import { ingestionForSankey } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require("../utils/test-logger.js");

const generateDashboardName = () =>
  "Sankey_" + Math.random().toString(36).substr(2, 9);

test.describe("Sankey chart testcases", () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await ingestionForSankey();
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
  });

  // P0: Select Sankey chart type and verify builder UI
  test(
    "should select Sankey chart type and display Source/Target/Value layout",
    { tag: ["@dashboards", "@sankey", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey chart type selection");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      // Select Sankey chart type
      await pm.chartTypeSelector.selectChartType("sankey");

      // Verify Sankey builder layout areas are visible
      await expect(
        page.locator('[data-test="dashboard-source-layout"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-test="dashboard-target-layout"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-test="dashboard-value-layout"]')
      ).toBeVisible();

      testLogger.info("Sankey chart builder layout verified");

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P0: Add Source, Target, Value fields and render Sankey chart
  test(
    "should add Source, Target, Value fields and render Sankey chart",
    { tag: ["@dashboards", "@sankey", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey chart field addition and rendering");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      // Select Sankey chart type
      await pm.chartTypeSelector.selectChartType("sankey");

      // Select stream
      await pm.chartTypeSelector.selectStream("sankey_data");

      // Add fields: Source, Target, Value
      await pm.chartTypeSelector.searchAndAddField("source", "source");
      await pm.chartTypeSelector.searchAndAddField("target", "target");
      await pm.chartTypeSelector.searchAndAddField("value", "sankeyvalue");

      // Apply query and wait for chart to render
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify Sankey chart is rendered and has data
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      testLogger.info("Sankey chart rendered with data successfully");

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P0: Save Sankey panel and verify persistence
  test(
    "should save Sankey panel and verify it persists on dashboard view",
    { tag: ["@dashboards", "@sankey", "@smoke", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey panel save and persistence");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      // Setup Sankey chart
      await pm.chartTypeSelector.selectChartType("sankey");
      await pm.chartTypeSelector.selectStream("sankey_data");

      await pm.chartTypeSelector.searchAndAddField("source", "source");
      await pm.chartTypeSelector.searchAndAddField("target", "target");
      await pm.chartTypeSelector.searchAndAddField("value", "sankeyvalue");

      // Apply and verify chart renders
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      // Name and save the panel
      await pm.dashboardPanelActions.addPanelName("sankey_test_panel");
      await pm.dashboardPanelActions.savePanel();

      // Verify we're back on dashboard view (panel was saved)
      await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });

      // Verify the saved panel renders on dashboard view
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      testLogger.info("Sankey panel saved and persists on dashboard view");

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P1: Remove a field and verify hint text reappears
  test(
    "should remove a Source field and show hint text",
    { tag: ["@dashboards", "@sankey", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey field removal");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      await pm.chartTypeSelector.selectChartType("sankey");
      await pm.chartTypeSelector.selectStream("sankey_data");

      // Add source field
      await pm.chartTypeSelector.searchAndAddField("source", "source");

      // Verify source field is shown in the builder
      const sourceLayout = page.locator(
        '[data-test="dashboard-source-layout"]'
      );
      await expect(
        sourceLayout.locator('[data-test^="dashboard-source-item-"]').first()
      ).toBeVisible({ timeout: 10000 });

      // Remove it using the remove button
      await sourceLayout
        .locator('[data-test$="-remove"]')
        .first()
        .click();

      // Verify hint text reappears (empty state)
      await expect(
        sourceLayout.locator(".text-caption")
      ).toBeVisible({ timeout: 10000 });

      testLogger.info("Source field removal verified");

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P1: Verify +S/+T/+V buttons become disabled after field is added
  test(
    "should disable +S button after Source field is added",
    { tag: ["@dashboards", "@sankey", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey field button disabled state");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      await pm.chartTypeSelector.selectChartType("sankey");
      await pm.chartTypeSelector.selectStream("sankey_data");

      // Add source field
      await pm.chartTypeSelector.searchAndAddField("source", "source");

      // Search for another field and verify +S button is disabled
      const searchInput = page.locator(
        '[data-test="index-field-search-input"]'
      );
      await searchInput.click();
      await searchInput.fill("target");

      const fieldItem = page
        .locator(
          '[data-test^="field-list-item-"][data-test$="-target"]'
        )
        .first();
      await fieldItem.waitFor({ state: "visible", timeout: 5000 });
      const sourceBtn = fieldItem.locator(
        '[data-test="dashboard-add-source-data"]'
      );

      await expect(sourceBtn).toBeDisabled({ timeout: 5000 });

      testLogger.info("+S button disabled state verified");

      // Cleanup
      await searchInput.fill("");
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P1: Create Sankey chart using Custom SQL query mode
  test(
    "should create Sankey chart using Custom SQL query",
    { tag: ["@dashboards", "@sankey", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey chart with custom SQL");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      // Select Sankey chart type
      await pm.chartTypeSelector.selectChartType("sankey");

      // Switch to custom query mode
      await pm.chartTypeSelector.switchToCustomQueryMode();

      // Enter custom SQL for Sankey
      const customSQL = `SELECT source, target, sum(value) as flow FROM "sankey_data" GROUP BY source, target`;
      await pm.chartTypeSelector.enterCustomSQL(customSQL);

      // Apply first to populate field list from query result
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Wait for field list to populate from query result
      await page.locator('[data-test="index-field-search-input"]').waitFor({ state: "visible", timeout: 10000 });

      // Assign fields from custom query result to Sankey axes
      await pm.chartTypeSelector.searchAndAddField("source", "source");
      await pm.chartTypeSelector.searchAndAddField("target", "target");
      await pm.chartTypeSelector.searchAndAddField("flow", "sankeyvalue");

      // Apply again with fields assigned
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify Sankey chart is rendered with data
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      testLogger.info("Sankey chart rendered via custom SQL");

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P1: Create variable, filter Sankey chart by variable, verify chart updates
  test(
    "should filter Sankey chart using a dashboard variable and render filtered data",
    { tag: ["@dashboards", "@sankey", "@functional", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey chart with dashboard variable filter");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);

      // Open dashboard settings and add a variable on `source` field (country names)
      await page.waitForSelector('[data-test="dashboard-setting-btn"]', {
        state: "visible",
        timeout: 15000,
      });
      const settingsButton = page.locator(
        '[data-test="dashboard-setting-btn"]'
      );
      await settingsButton.click();

      await pm.dashboardVariables.addDashboardVariable(
        "countryvar",
        "logs",
        "sankey_data",
        "source"
      );

      // Add panel with Sankey chart
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("sankey");
      await pm.chartTypeSelector.selectStream("sankey_data");

      // Add Source, Target, Value fields
      await pm.chartTypeSelector.searchAndAddField("source", "source");
      await pm.chartTypeSelector.searchAndAddField("target", "target");
      await pm.chartTypeSelector.searchAndAddField("value", "sankeyvalue");

      // Add source as a filter field
      // Sankey mode renders two button groups per field: standard (+X +Y +B +F) and sankey (+S +T +V +F).
      // Scope to the sankey group by finding +F that's a sibling of the +S button.
      const searchInput = page.locator('[data-test="index-field-search-input"]');
      await searchInput.click();
      await searchInput.fill("source");
      const fieldItem = page
        .locator('[data-test^="field-list-item-"][data-test$="-source"]')
        .first();
      // Target the Sankey button group (contains +S) and find +F within it
      const sankeyGroup = fieldItem.locator('.field_icons:has([data-test="dashboard-add-source-data"])');
      const filterBtn = sankeyGroup.locator('[data-test="dashboard-add-filter-data"]');
      await filterBtn.waitFor({ state: "visible", timeout: 5000 });
      await filterBtn.click();
      await searchInput.fill("");

      // Bind the filter to the variable
      await pm.dashboardFilter.addFilterCondition(
        0,
        "source",
        "source",
        "=",
        "$countryvar"
      );

      // Apply and verify unfiltered chart renders
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      await pm.dashboardPanelActions.verifyChartRenders(expect);

      testLogger.info("Sankey chart rendered with variable (default value)");

      // Select "India" from the variable dropdown to filter
      await pm.dashboardVariables.selectValueFromVariableDropDown(
        "countryvar",
        "India"
      );

      // Apply with filtered variable value
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify filtered chart still renders with data (India has 5 cities)
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      testLogger.info(
        "Sankey chart rendered correctly with variable filtered to India"
      );

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );

  // P2: Verify "No Data" when fields produce no results
  test(
    "should show No Data when only Source field is configured",
    { tag: ["@dashboards", "@sankey", "@edge", "@P2"] },
    async ({ page }) => {
      testLogger.info("Testing Sankey no data state");
      const pm = new PageManager(page);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashName = generateDashboardName();
      await pm.dashboardCreate.createDashboard(dashName);
      await pm.dashboardCreate.addPanel();

      await pm.chartTypeSelector.selectChartType("sankey");
      await pm.chartTypeSelector.selectStream("sankey_data");

      // Only add source (missing target and value - incomplete for Sankey)
      await pm.chartTypeSelector.searchAndAddField("source", "source");

      // Apply - should show no data or error since target/value are missing
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify no data or error is shown (incomplete Sankey config)
      const noDataOrError = page.locator('[data-test="no-data"]').or(page.locator('[data-test="dashboard-error"]'));
      await expect(noDataOrError.first()).toBeVisible({ timeout: 10000 });

      testLogger.info("Sankey no data state verified");

      // Cleanup
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
      );
      await waitForDashboardPage(page);
      await deleteDashboard(page, dashName);
    }
  );
});
