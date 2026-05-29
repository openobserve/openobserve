/**
 * Dashboard PromQL Query Editor Suggestions Tests
 *
 * FEATURE OVERVIEW:
 * Tests autocomplete suggestions in the PromQL query editor:
 *   1. Label name suggestions — when typing inside curly braces: metric{
 *   2. Label value suggestions — when typing label_name=: metric{label_name=
 *   3. Filtered label value suggestions — after typing a partial value
 *   4. Selecting a label name then triggering VALUE suggestions after =
 *
 * FIX REFERENCE:
 * - PR #9691: fix: promql query legend config suggestion issue for dashboard
 *
 * SELECTOR RULES (strict):
 *   - All locators live in the dashboard page objects under
 *     `pages/dashboardPages/`. The spec only calls page-object methods.
 *   - Only data-test selectors are used. NO `.monaco-editor`, NO
 *     `.suggest-widget`, NO `.monaco-list-row`, NO getByRole / getByText.
 *   - Suggestion assertions read Monaco's editor model + suggest controller
 *     via page.evaluate inside the page object. The internal Monaco DOM is
 *     never queried.
 */

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateUniqueDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

/**
 * Open a freshly-created dashboard, add a panel, switch the panel to PromQL
 * Custom Query mode and return the page-object handle to the PromQL editor.
 *
 * Returns `null` if the PromQL toggle isn't available in this build — the
 * caller should skip the test in that case.
 */
async function openPromqlPanel(page, pm, dashboardName, panelPrefix) {
  const panelName =
    pm.dashboardPanelActions.generateUniquePanelName(panelPrefix);

  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();

  await pm.dashboardCreate.createDashboard(dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.dashboardPanelActions.addPanelName(panelName);

  await pm.chartTypeSelector.selectChartType("line");
  await pm.chartTypeSelector.selectStreamType("metrics");

  const promqlAvailable =
    await pm.dashboardPromQLEditor.isPromqlAvailable();
  if (!promqlAvailable) {
    testLogger.warn("PromQL query type button is not visible");
    await pm.dashboardPromQLEditor.discardPanelIfVisible();
    await deleteDashboard(page, dashboardName).catch(() => {});
    return null;
  }

  await pm.dashboardPromQLEditor.switchToPromql();
  await pm.dashboardPromQLEditor.switchToCustomQuery();
  await pm.dashboardPromQLEditor.waitForEditorReady();
  await pm.dashboardPromQLEditor.focusEditor();

  return panelName;
}

/**
 * Restore a valid PromQL query in the editor, apply, save the panel and
 * delete the dashboard. Tests typically leave the editor in an invalid /
 * partial state, so we overwrite via the Monaco model before applying.
 */
async function cleanupDashboard(page, pm, dashboardName) {
  await pm.dashboardPromQLEditor.dismissSuggestions();
  await pm.dashboardPromQLEditor.resetToValidPromqlQuery("cpu_usage{}");

  // Wait for Monaco's debounced model -> Vue data sync (~500ms in CodeQueryEditor).
  await page.waitForTimeout(3000);

  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender();

  await pm.dashboardPanelActions.savePanel();
  await pm.dashboardCreate.backToDashboardList();
  await deleteDashboard(page, dashboardName);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard PromQL Query Editor Suggestions", () => {
  // Ensure metric data is ingested once before any test runs.
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
    const editor = pm.dashboardPromQLEditor;

    const panelName = await openPromqlPanel(
      page,
      pm,
      dashboardName,
      "promql-label-suggest",
    );
    if (!panelName) {
      test.skip(true, "PromQL button not available");
      return;
    }

    // Type 'cpu_usage{}' and position the cursor between the braces, then
    // trigger label-name suggestions for the cpu_usage metric.
    await editor.clearEditor();
    await editor.typeInEditor("cpu_usage{}");
    await editor.pressKey("ArrowLeft");
    await editor.triggerSuggestionsAndWait();

    testLogger.info(
      "Monaco autocomplete is open after typing cpu_usage{ inside braces",
    );

    const suggestionsCount = await editor.getSuggestionCount();
    testLogger.info(
      `Found ${suggestionsCount} label name suggestions for 'cpu_usage{}'`,
    );
    expect(suggestionsCount).toBeGreaterThan(0);

    await editor.logSuggestions("Label name suggestions inside curly braces");

    await editor.dismissSuggestions();
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("should display label VALUE suggestions when typing metric{label_name=}", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const editor = pm.dashboardPromQLEditor;

    const panelName = await openPromqlPanel(
      page,
      pm,
      dashboardName,
      "promql-label-value",
    );
    if (!panelName) {
      test.skip(true, "PromQL button not available");
      return;
    }

    // Build cpu_usage{service_name=} with the cursor immediately after '='
    // so suggestions are the VALUE candidates for service_name.
    await editor.clearEditor();
    await editor.typeInEditor("cpu_usage{}");
    await editor.pressKey("ArrowLeft");
    await editor.typeInEditor("service_name=");
    await editor.triggerSuggestionsAndWait();

    testLogger.info(
      "Monaco autocomplete is open after typing cpu_usage{service_name=}",
    );

    const suggestionsCount = await editor.getSuggestionCount();
    testLogger.info(
      `Found ${suggestionsCount} label value suggestions for 'cpu_usage{service_name='`,
    );
    expect(suggestionsCount).toBeGreaterThan(0);

    await editor.logSuggestions("Label value suggestions");

    await editor.dismissSuggestions();
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("should display filtered label VALUE suggestions when typing partial value", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const editor = pm.dashboardPromQLEditor;

    const panelName = await openPromqlPanel(
      page,
      pm,
      dashboardName,
      "promql-value-filter",
    );
    if (!panelName) {
      test.skip(true, "PromQL button not available");
      return;
    }

    // Build cpu_usage{service_name=} and open suggestions, then type 'a'
    // to filter — verify the filtered list still surfaces at least one item.
    await editor.clearEditor();
    await editor.typeInEditor("cpu_usage{}");
    await editor.pressKey("ArrowLeft");
    await editor.typeInEditor("service_name=");
    await editor.triggerSuggestionsAndWait();

    await editor.typeInEditor("a");
    await editor.waitForSuggestionsReady();

    testLogger.info(
      "Monaco autocomplete remains open after typing filter character 'a'",
    );

    const suggestionsCount = await editor.getSuggestionCount();
    testLogger.info(
      `Found ${suggestionsCount} filtered label value suggestions`,
    );
    expect(suggestionsCount).toBeGreaterThan(0);

    await editor.logSuggestions("Filtered label value suggestions");

    await editor.dismissSuggestions();
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("should select label name then show VALUE suggestions after typing =", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const editor = pm.dashboardPromQLEditor;

    const panelName = await openPromqlPanel(
      page,
      pm,
      dashboardName,
      "promql-name-then-value",
    );
    if (!panelName) {
      test.skip(true, "PromQL button not available");
      return;
    }

    // Stage 1: trigger label NAME suggestions inside cpu_usage{}
    await editor.clearEditor();
    await editor.typeInEditor("cpu_usage{}");
    await editor.pressKey("ArrowLeft");
    await editor.triggerSuggestionsAndWait();

    const nameLabels = await editor.getSuggestionLabels(10);
    expect(nameLabels.length).toBeGreaterThan(0);
    testLogger.info(`First label name suggestion: ${nameLabels[0]}`);

    // Accept the first label name suggestion.
    await editor.pressKey("Enter");

    // Stage 2: type '=' to switch the suggestion context to label VALUES.
    await editor.typeInEditor("=");
    await editor.waitForSuggestionsReady();

    const valueLabels = await editor.getSuggestionLabels(5);
    testLogger.info(
      `Found ${valueLabels.length} label value suggestions after typing =`,
    );
    testLogger.info(`Label value suggestions: ${valueLabels.join(", ")}`);
    expect(valueLabels.length).toBeGreaterThan(0);

    await editor.dismissSuggestions();
    await cleanupDashboard(page, pm, dashboardName);
  });
});
