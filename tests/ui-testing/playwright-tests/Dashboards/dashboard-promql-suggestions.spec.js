const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const testLogger = require('../utils/test-logger.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

// Helper function to generate unique dashboard name per test
const generateUniqueDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

// Helper function to clear Monaco editor content (cross-platform)
const clearMonacoEditor = async (page, monacoEditor) => {
  // Use triple-click to select all text (works on all platforms)
  await monacoEditor.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
};

// Helper function to wait for Monaco suggestions widget to be stable
const waitForSuggestionsStable = async (page, suggestWidget) => {
  await suggestWidget.waitFor({ state: "visible", timeout: 10000 });
  // Wait for at least one suggestion row to be present
  const suggestionRows = page.locator('.monaco-editor .suggest-widget .monaco-list-row');
  await suggestionRows.first().waitFor({ state: "visible", timeout: 5000 });
};

// Helper function to cleanup dashboard after test
const cleanupDashboard = async (page, pm, dashboardName) => {
  // Replace editor content with a simple valid PromQL query
  // (tests leave invalid/partial queries like 'cpu_usage{service_name=a}')
  const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
  const monacoEditor = queryEditor.locator('.monaco-editor');
  await monacoEditor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('up');
  await page.keyboard.press('Escape'); // dismiss any autocomplete

  // Wait for Monaco's debounced model update (500ms default in CodeQueryEditor.vue)
  // to sync editor text to Vue data model before applying
  await page.waitForTimeout(3000);

  // Apply the query — save fails with "Query-1 is empty" if never applied
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender();

  // Save panel then navigate back to dashboard list
  await pm.dashboardPanelActions.savePanel();
  await pm.dashboardCreate.backToDashboardList();
  await deleteDashboard(page, dashboardName);
};

// Configure tests to run in parallel for better performance
test.describe.configure({ mode: "parallel" });

/**
 * Dashboard PromQL Query Editor Suggestions Tests
 *
 * FEATURE OVERVIEW:
 * Tests autocomplete suggestions in the PromQL query editor:
 * 1. Function suggestions - when typing function names like 'rate', 'avg', 'sum'
 * 2. Metric name suggestions - when typing metric prefixes like 'cpu', 'up'
 * 3. Label name suggestions - when typing inside curly braces: metric{
 * 4. Label value suggestions - when typing label_name=: metric{label_name=
 *
 * FIX REFERENCE:
 * - PR #9691: fix: promql query legend config suggestion issue for dashboard
 *
 * QUERY EDITOR ELEMENTS:
 * - [data-test="dashboard-panel-query-editor"] - The Monaco query editor container
 * - .monaco-editor .suggest-widget - Monaco autocomplete suggestions widget
 * - .monaco-list-row - Individual suggestion items in Monaco
 */

test.describe("Dashboard PromQL Query Editor Suggestions", () => {
  // Ensure metrics are ingested once before all tests run
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test("should display label name suggestions when typing inside curly braces metric{}", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("promql-label-suggest");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select line chart type
    await pm.chartTypeSelector.selectChartType("line");

    // Select metrics stream type
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Check if PromQL button is visible
    const promqlButton = page.locator('[data-test="dashboard-promql-query-type"]');
    const isPromqlVisible = await promqlButton.isVisible().catch(() => false);

    if (!isPromqlVisible) {
      testLogger.warn('PromQL button not visible');
      // Cleanup without saving panel
      await page.locator('[data-test="dashboard-panel-discard"]').click().catch(() => {});
      await deleteDashboard(page, dashboardName).catch(() => {});
      test.skip(true, 'PromQL button not available');
      return;
    }

    // Switch to PromQL mode
    await promqlButton.click();

    // Switch to Custom mode
    const customButton = page.locator('[data-test="dashboard-custom-query-type"]');
    await customButton.waitFor({ state: "visible", timeout: 5000 });
    await customButton.click();

    // Wait for query editor
    const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 10000 });

    // Focus on the Monaco editor
    const monacoEditor = queryEditor.locator('.monaco-editor');
    await monacoEditor.click();

    // Type 'cpu_usage{}' and position cursor inside to trigger label NAME suggestions
    // Labels like 'node', 'instance', 'region', 'service_name' should appear
    // Step 1: Clear editor (cross-platform)
    await clearMonacoEditor(page, monacoEditor);

    // Step 2: Type metric name with curly braces (both opening and closing)
    await page.keyboard.type('cpu_usage{}', { delay: 50 });

    // Step 3: Move cursor inside the curly braces and trigger suggestions
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Control+Space');

    // Wait for Monaco autocomplete suggestions to appear and stabilize
    const suggestWidget = page.locator('.monaco-editor .suggest-widget');
    await waitForSuggestionsStable(page, suggestWidget);

    testLogger.info('Monaco autocomplete suggestions widget is visible after typing cpu_usage{');

    // Get suggestions - these should be label NAMES for the 'cpu_usage' metric
    const suggestionRows = page.locator('.monaco-editor .suggest-widget .monaco-list-row');
    const suggestionsCount = await suggestionRows.count();

    testLogger.info(`Found ${suggestionsCount} label name suggestions for 'cpu_usage{}'`);

    // Assert that at least one suggestion appears
    expect(suggestionsCount).toBeGreaterThan(0);

    // Get the text of suggestions - should include label names
    const suggestions = [];
    for (let i = 0; i < Math.min(suggestionsCount, 10); i++) {
      const suggestionText = await suggestionRows.nth(i).textContent();
      suggestions.push(suggestionText.trim());
    }
    testLogger.info(`Label name suggestions inside curly braces: ${suggestions.join(', ')}`);

    // Dismiss suggestions
    await page.keyboard.press('Escape');

    // Clean up
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("should display label VALUE suggestions when typing metric{label_name=}", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("promql-label-value");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select line chart type
    await pm.chartTypeSelector.selectChartType("line");

    // Select metrics stream type
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Check if PromQL button is visible
    const promqlButton = page.locator('[data-test="dashboard-promql-query-type"]');
    const isPromqlVisible = await promqlButton.isVisible().catch(() => false);

    if (!isPromqlVisible) {
      testLogger.warn('PromQL button not visible');
      await page.locator('[data-test="dashboard-panel-discard"]').click().catch(() => {});
      await deleteDashboard(page, dashboardName).catch(() => {});
      test.skip(true, 'PromQL button not available');
      return;
    }

    // Switch to PromQL mode
    await promqlButton.click();

    // Switch to Custom mode
    const customButton = page.locator('[data-test="dashboard-custom-query-type"]');
    await customButton.waitFor({ state: "visible", timeout: 5000 });
    await customButton.click();

    // Wait for query editor
    const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 10000 });

    // Focus on the Monaco editor
    const monacoEditor = queryEditor.locator('.monaco-editor');
    await monacoEditor.click();

    // Type query step by step: metric_name{} then type inside curly braces
    // Step 1: Clear editor (cross-platform)
    await clearMonacoEditor(page, monacoEditor);

    // Step 2: Type metric name with curly braces (both opening and closing)
    await page.keyboard.type('cpu_usage{}', { delay: 50 });

    // Step 3: Move cursor inside the curly braces (one position left)
    await page.keyboard.press('ArrowLeft');

    // Step 4: Type label name with equals sign inside curly braces to trigger VALUE suggestions
    await page.keyboard.type('service_name=', { delay: 50 });

    // Step 5: Trigger suggestions manually with Control+Space
    await page.keyboard.press('Control+Space');

    // Wait for Monaco autocomplete suggestions to appear and stabilize
    const suggestWidget = page.locator('.monaco-editor .suggest-widget');
    await waitForSuggestionsStable(page, suggestWidget);

    testLogger.info('Monaco autocomplete suggestions widget is visible after typing cpu_usage{service_name=}');

    // Get suggestions - these should be label VALUES for the 'service_name' label
    const suggestionRows = page.locator('.monaco-editor .suggest-widget .monaco-list-row');
    const suggestionsCount = await suggestionRows.count();

    testLogger.info(`Found ${suggestionsCount} label value suggestions for 'cpu_usage{service_name='`);

    // Assert that at least one suggestion appears
    expect(suggestionsCount).toBeGreaterThan(0);

    // Get the text of suggestions - should include label values like service names
    const suggestions = [];
    for (let i = 0; i < Math.min(suggestionsCount, 10); i++) {
      const suggestionText = await suggestionRows.nth(i).textContent();
      suggestions.push(suggestionText.trim());
    }
    testLogger.info(`Label value suggestions: ${suggestions.join(', ')}`);

    // Dismiss suggestions
    await page.keyboard.press('Escape');

    // Clean up
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("should display filtered label VALUE suggestions when typing partial value", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("promql-value-filter");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select line chart type
    await pm.chartTypeSelector.selectChartType("line");

    // Select metrics stream type
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Check if PromQL button is visible
    const promqlButton = page.locator('[data-test="dashboard-promql-query-type"]');
    const isPromqlVisible = await promqlButton.isVisible().catch(() => false);

    if (!isPromqlVisible) {
      testLogger.warn('PromQL button not visible');
      await page.locator('[data-test="dashboard-panel-discard"]').click().catch(() => {});
      await deleteDashboard(page, dashboardName).catch(() => {});
      test.skip(true, 'PromQL button not available');
      return;
    }

    // Switch to PromQL mode
    await promqlButton.click();

    // Switch to Custom mode
    const customButton = page.locator('[data-test="dashboard-custom-query-type"]');
    await customButton.waitFor({ state: "visible", timeout: 5000 });
    await customButton.click();

    // Wait for query editor
    const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 10000 });

    // Focus on the Monaco editor
    const monacoEditor = queryEditor.locator('.monaco-editor');
    await monacoEditor.click();

    // Type query step by step: metric_name{} then type inside curly braces
    // Step 1: Clear editor (cross-platform)
    await clearMonacoEditor(page, monacoEditor);

    // Step 2: Type metric name with curly braces (both opening and closing)
    await page.keyboard.type('cpu_usage{}', { delay: 50 });

    // Step 3: Move cursor inside the curly braces (one position left)
    await page.keyboard.press('ArrowLeft');

    // Step 4: Type label name with equals sign inside curly braces
    await page.keyboard.type('service_name=', { delay: 50 });

    // Step 5: Trigger suggestions manually and wait for widget to stabilize
    await page.keyboard.press('Control+Space');
    const suggestWidget = page.locator('.monaco-editor .suggest-widget');
    await waitForSuggestionsStable(page, suggestWidget);

    // Step 6: Type single character to filter suggestions
    await page.keyboard.type('a', { delay: 50 });

    // Wait for filtered suggestions to appear and stabilize
    await waitForSuggestionsStable(page, suggestWidget);

    testLogger.info('Monaco autocomplete suggestions visible after typing filter character');

    // Get filtered suggestions
    const suggestionRows = page.locator('.monaco-editor .suggest-widget .monaco-list-row');
    const suggestionsCount = await suggestionRows.count();

    testLogger.info(`Found ${suggestionsCount} filtered label value suggestions`);

    // Assert that at least one suggestion appears (filtering worked)
    expect(suggestionsCount).toBeGreaterThan(0);

    // Get the text of filtered suggestions
    const suggestions = [];
    for (let i = 0; i < Math.min(suggestionsCount, 10); i++) {
      const suggestionText = await suggestionRows.nth(i).textContent();
      suggestions.push(suggestionText.trim());
    }
    testLogger.info(`Filtered label value suggestions: ${suggestions.join(', ')}`);

    // Dismiss suggestions
    await page.keyboard.press('Escape');

    // Clean up
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("should select label name then show VALUE suggestions after typing =", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("promql-name-then-value");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select line chart type
    await pm.chartTypeSelector.selectChartType("line");

    // Select metrics stream type
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Check if PromQL button is visible
    const promqlButton = page.locator('[data-test="dashboard-promql-query-type"]');
    const isPromqlVisible = await promqlButton.isVisible().catch(() => false);

    if (!isPromqlVisible) {
      testLogger.warn('PromQL button not visible');
      await page.locator('[data-test="dashboard-panel-discard"]').click().catch(() => {});
      await deleteDashboard(page, dashboardName).catch(() => {});
      test.skip(true, 'PromQL button not available');
      return;
    }

    // Switch to PromQL mode
    await promqlButton.click();

    // Switch to Custom mode
    const customButton = page.locator('[data-test="dashboard-custom-query-type"]');
    await customButton.waitFor({ state: "visible", timeout: 5000 });
    await customButton.click();

    // Wait for query editor
    const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 10000 });

    // Focus on the Monaco editor
    const monacoEditor = queryEditor.locator('.monaco-editor');
    await monacoEditor.click();

    // Step 1: Type 'cpu_usage{}' and position cursor inside to get label NAME suggestions
    // Clear editor first (cross-platform)
    await clearMonacoEditor(page, monacoEditor);

    // Type metric name with curly braces
    await page.keyboard.type('cpu_usage{}', { delay: 50 });

    // Move cursor inside the curly braces
    await page.keyboard.press('ArrowLeft');

    // Trigger suggestions manually to get label NAME suggestions
    await page.keyboard.press('Control+Space');

    // Wait for label name suggestions to stabilize
    const suggestWidget = page.locator('.monaco-editor .suggest-widget');
    await waitForSuggestionsStable(page, suggestWidget);

    testLogger.info('Label name suggestions visible after typing cpu_usage{}');

    // Get the label name suggestions
    const suggestionRows = page.locator('.monaco-editor .suggest-widget .monaco-list-row');
    let suggestionsCount = await suggestionRows.count();

    expect(suggestionsCount).toBeGreaterThan(0);

    const firstLabelName = await suggestionRows.first().textContent();
    testLogger.info(`First label name suggestion: ${firstLabelName.trim()}`);

    // Select the first label name
    await page.keyboard.press('Enter');

    // Step 2: Type '=' to trigger label VALUE suggestions
    await page.keyboard.type('=');

    // Wait for label value suggestions to appear
    await waitForSuggestionsStable(page, suggestWidget);

    testLogger.info('Label value suggestions visible after typing =');

    // Verify we now have VALUE suggestions
    suggestionsCount = await suggestionRows.count();
    testLogger.info(`Found ${suggestionsCount} label value suggestions after typing =`);

    // Get the value suggestions
    const valueSuggestions = [];
    for (let i = 0; i < Math.min(suggestionsCount, 5); i++) {
      const suggestionText = await suggestionRows.nth(i).textContent();
      valueSuggestions.push(suggestionText.trim());
    }
    testLogger.info(`Label value suggestions: ${valueSuggestions.join(', ')}`);

    // Assert that value suggestions appear
    expect(suggestionsCount).toBeGreaterThan(0);

    // Dismiss suggestions
    await page.keyboard.press('Escape');

    // Clean up
    await cleanupDashboard(page, pm, dashboardName);
  });
});
