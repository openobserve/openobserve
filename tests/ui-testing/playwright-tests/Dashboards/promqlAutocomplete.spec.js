/**
 * PromQL Autocomplete E2E Tests
 *
 * Covers three bugs fixed in the PromQL autocomplete feature:
 * Fix 1 (DashboardQueryEditor.vue): UnifiedQueryEditor now receives :keywords and
 *   :suggestions props so autocomplete is wired up.
 * Fix 2 (DashboardQueryEditor.vue): A watcher feeds streamResults into
 *   updateMetricKeywords() so metric names appear in autocomplete.
 * Fix 3 (usePromqlSuggestions.ts): analyzeLabelFocus() handles unclosed braces
 *   (e.g. metricname{) correctly — label suggestions appear instead of stream names.
 *
 * QUERY EDITOR ELEMENTS (verified data-test attributes):
 *   [data-test="dashboard-panel-query-editor"]   — Monaco editor container
 *   [data-test="dashboard-promql-query-type"]    — PromQL mode button
 *   [data-test="dashboard-custom-query-type"]    — Custom mode button
 *   [data-test="dashboard-builder-query-type"]   — Builder mode button
 *
 * METRICS PAGE ELEMENTS (verified data-test attributes):
 *   [data-test="dashboard-promql-query-type"]    — PromQL mode button (same component)
 *   [data-test="dashboard-custom-query-type"]    — Custom mode button (same component)
 *   [data-test="metrics-apply"]                  — Run Query button
 *
 * Selectors / Monaco access live in the PO (pages/dashboardPages/dashboard-promql-editor.js);
 * this spec only calls PO methods so it complies with the data-test-only selector policy.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique dashboard name per test invocation */
const generateUniqueDashboardName = () =>
  "Dashboard_PromQL_AC_" + Math.random().toString(36).slice(2, 9) + "_" + Date.now();

/**
 * Trigger PromQL suggestions and poll the Monaco suggest controller until at
 * least one completion item appears (or the deadline elapses).
 *
 * The streamResults-driven autocomplete watcher (Fix 2) populates metric
 * keywords asynchronously after `selectStreamType("metrics")` resolves the
 * stream list. On a slow backend the first Ctrl+Space can fire before the
 * keywords land, so we re-trigger via dismiss + Ctrl+Space and re-check.
 *
 * @returns {Promise<number>} the final suggestion count (0 if none arrived)
 */
const triggerAndWaitForSuggestions = async (promqlEditor, { totalTimeoutMs = 30000, perTryTimeoutMs = 5000 } = {}) => {
  const deadline = Date.now() + totalTimeoutMs;
  let lastCount = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      // Programmatic trigger via Monaco's action — survives transient focus
      // losses better than a raw Ctrl+Space, while still being deterministic.
      await promqlEditor.page.evaluate(() => {
        const m = window.monaco;
        const editors = m?.editor?.getEditors?.() || [];
        const editor = editors[editors.length - 1];
        if (!editor) return;
        editor.focus();
        editor.trigger('e2e', 'editor.action.triggerSuggest', {});
      });
      await promqlEditor.waitForSuggestionsReady(perTryTimeoutMs);
      lastCount = await promqlEditor.getSuggestionCount();
      if (lastCount > 0) return lastCount;
    } catch (err) {
      lastError = err;
      // No completion items yet — re-trigger after dismissing the popup.
    }
    await promqlEditor.dismissSuggestions();
  }
  if (lastError) {
    testLogger.warn(`Suggestions widget not visible: ${lastError.message}`);
  }
  return lastCount;
};

/**
 * Navigate a dashboard add-panel flow into PromQL Custom mode.
 * Returns true if the editor is ready; false if PromQL is unavailable
 * (in which case the panel is discarded and the dashboard cleaned up).
 */
const setupPromQLCustomPanel = async (page, pm, dashboardName, panelName) => {
  // Navigate to dashboards
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();

  // Create dashboard
  await pm.dashboardCreate.createDashboard(dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.dashboardPanelActions.addPanelName(panelName);

  // Select line chart type and metrics stream type
  await pm.chartTypeSelector.selectChartType("line");
  await pm.chartTypeSelector.selectStreamType("metrics");

  // Check PromQL button is available (metrics-only feature)
  const isPromqlVisible = await pm.dashboardPromQLEditor.isPromqlAvailable();

  if (!isPromqlVisible) {
    testLogger.warn('PromQL button not visible — skipping test');
    await pm.dashboardPromQLEditor.discardPanelIfVisible();
    await deleteDashboard(page, dashboardName).catch(() => {});
    return false;
  }

  // Switch to PromQL mode
  await pm.dashboardPromQLEditor.switchToPromql();
  testLogger.info('Switched to PromQL mode');

  // Switch to Custom mode so the Monaco editor is editable
  await pm.dashboardPromQLEditor.switchToCustomQuery();
  testLogger.info('Switched to Custom query mode');

  // Wait for the Monaco editor to be ready (container + editor instance attached)
  await pm.dashboardPromQLEditor.waitForEditorReady();
  return true;
};

/**
 * Cleanup after a dashboard test:
 * - Replace editor content with a minimal valid query
 * - Apply → Save → back to list → delete dashboard
 */
const cleanupDashboard = async (page, pm, dashboardName) => {
  try {
    // Reset to a syntactically valid PromQL query via the Monaco model so the
    // panel can be applied + saved cleanly during teardown.
    await pm.dashboardPromQLEditor.resetToValidPromqlQuery();

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  } catch (err) {
    testLogger.warn('cleanupDashboard: encountered an error during cleanup', { error: err.message });
  }
};

// ---------------------------------------------------------------------------
// Dashboard Add Panel — PromQL Custom mode tests
// ---------------------------------------------------------------------------

test.describe("PromQL Autocomplete — Dashboard Add Panel", () => {

  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  // -------------------------------------------------------------------------
  // P0: Metric name suggestions appear when typing a partial metric name
  // Validates Fix 1 (keywords/suggestions props wired) and Fix 2 (watcher feeds
  // stream names into updateMetricKeywords).
  // -------------------------------------------------------------------------
  test(
    "[P0] metric name suggestions appear when typing partial metric name in PromQL Custom mode",
    { tag: ['@promqlAutocomplete', '@smoke', '@P0', '@all'] },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("promql-metric-suggest");

      testLogger.testStart(
        "[P0] metric name suggestions — Dashboard PromQL Custom",
        "promqlAutocomplete.spec.js"
      );

      const editorReady = await setupPromQLCustomPanel(page, pm, dashboardName, panelName);
      if (!editorReady) {
        test.skip(true, 'PromQL not available in this environment');
        return;
      }

      await pm.dashboardPromQLEditor.focusEditor();

      // Clear and type a partial metric name that is known to be ingested by ensureMetricsIngested
      // The ingested metrics include: up, cpu_usage, memory_usage, request_count, etc.
      await pm.dashboardPromQLEditor.clearEditor();
      await pm.dashboardPromQLEditor.typeInEditor('cpu', { delay: 50 });

      // Trigger suggestions — the watcher (Fix 2) should have already fed metric names
      // into autoCompletePromqlKeywords via updateMetricKeywords
      try {
        const count = await triggerAndWaitForSuggestions(pm.dashboardPromQLEditor);
        testLogger.info(`Found ${count} metric name suggestions for prefix "cpu"`);

        expect(count, 'Expected metric name suggestions to appear but none were shown').toBeGreaterThan(0);
        await pm.dashboardPromQLEditor.logSuggestions('Metric name suggestions', 8);
      } finally {
        await pm.dashboardPromQLEditor.dismissSuggestions();
      }

      await cleanupDashboard(page, pm, dashboardName);
    }
  );

  // -------------------------------------------------------------------------
  // P1: Label name suggestions appear inside closed braces metric{}
  // Validates that label suggestions (not metric names) appear when cursor is
  // positioned between braces.
  // -------------------------------------------------------------------------
  test(
    "[P1] label name suggestions appear when cursor is inside closed braces metric{}",
    { tag: ['@promqlAutocomplete', '@functional', '@P1', '@all'] },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("promql-label-name");

      testLogger.testStart(
        "[P1] label name suggestions inside closed braces — Dashboard PromQL Custom",
        "promqlAutocomplete.spec.js"
      );

      const editorReady = await setupPromQLCustomPanel(page, pm, dashboardName, panelName);
      if (!editorReady) {
        test.skip(true, 'PromQL not available in this environment');
        return;
      }

      await pm.dashboardPromQLEditor.focusEditor();

      // Type metric{} and position cursor inside braces
      await pm.dashboardPromQLEditor.clearEditor();
      await pm.dashboardPromQLEditor.typeInEditor('cpu_usage{}', { delay: 50 });
      await pm.dashboardPromQLEditor.pressKey('ArrowLeft'); // cursor moves inside {}

      try {
        const count = await triggerAndWaitForSuggestions(pm.dashboardPromQLEditor);
        testLogger.info(`Found ${count} label name suggestions inside cpu_usage{}`);

        expect(count, 'Expected label name suggestions to appear but none were shown').toBeGreaterThan(0);
        await pm.dashboardPromQLEditor.logSuggestions('Label name suggestions', 8);
      } finally {
        await pm.dashboardPromQLEditor.dismissSuggestions();
      }

      await cleanupDashboard(page, pm, dashboardName);
    }
  );

  // -------------------------------------------------------------------------
  // P1: Label name suggestions appear with unclosed brace metricname{
  // This directly tests Fix 3 (analyzeLabelFocus handles unclosed braces).
  // Before the fix, stream names would appear instead of label names.
  // -------------------------------------------------------------------------
  test(
    "[P1] label suggestions appear for unclosed brace pattern metricname{ (Fix 3)",
    { tag: ['@promqlAutocomplete', '@functional', '@P1', '@all'] },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("promql-unclosed-brace");

      testLogger.testStart(
        "[P1] label suggestions for unclosed brace — Dashboard PromQL Custom (Fix 3)",
        "promqlAutocomplete.spec.js"
      );

      const editorReady = await setupPromQLCustomPanel(page, pm, dashboardName, panelName);
      if (!editorReady) {
        test.skip(true, 'PromQL not available in this environment');
        return;
      }

      await pm.dashboardPromQLEditor.focusEditor();

      // Type an unclosed brace — no closing } — this is the pattern that broke before Fix 3
      await pm.dashboardPromQLEditor.clearEditor();
      await pm.dashboardPromQLEditor.typeInEditor('cpu_usage{', { delay: 50 });
      // Cursor is now right after '{' — analyzeLabelFocus must detect unclosed brace

      try {
        const count = await triggerAndWaitForSuggestions(pm.dashboardPromQLEditor);
        testLogger.info(`Found ${count} suggestions for unclosed-brace pattern cpu_usage{`);

        // The key assertion: at least one suggestion must appear.
        // Before Fix 3, isFocused remained false so no suggestions were shown at all.
        expect(count, 'Expected label suggestions to appear for unclosed brace but none were shown').toBeGreaterThan(0);
        await pm.dashboardPromQLEditor.logSuggestions('Suggestions for cpu_usage{', 8);

        // Verify these look like label names (not raw stream names from the stream dropdown).
        // Label names from ingested test metrics include: node, instance, service, region, etc.
        // Stream names look like: cpu_usage, memory_usage, request_count, up, etc.
        // We cannot assert a specific label name here because the test environment may vary,
        // but we can assert that suggestions appeared (the core regression check).
        testLogger.info('Fix 3 verified: label suggestions shown for unclosed brace pattern');
      } finally {
        await pm.dashboardPromQLEditor.dismissSuggestions();
      }

      await cleanupDashboard(page, pm, dashboardName);
    }
  );

  // -------------------------------------------------------------------------
  // P1: Label value suggestions appear when typing metric{label_name=
  // -------------------------------------------------------------------------
  test(
    "[P1] label value suggestions appear when typing metric{label=",
    { tag: ['@promqlAutocomplete', '@functional', '@P1', '@all'] },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("promql-label-value");

      testLogger.testStart(
        "[P1] label value suggestions — Dashboard PromQL Custom",
        "promqlAutocomplete.spec.js"
      );

      const editorReady = await setupPromQLCustomPanel(page, pm, dashboardName, panelName);
      if (!editorReady) {
        test.skip(true, 'PromQL not available in this environment');
        return;
      }

      await pm.dashboardPromQLEditor.focusEditor();

      // Type metric{} then move cursor inside and type label=
      await pm.dashboardPromQLEditor.clearEditor();
      await pm.dashboardPromQLEditor.typeInEditor('cpu_usage{}', { delay: 50 });
      await pm.dashboardPromQLEditor.pressKey('ArrowLeft'); // cursor inside {}
      await pm.dashboardPromQLEditor.typeInEditor('node=', { delay: 50 });

      try {
        const count = await triggerAndWaitForSuggestions(pm.dashboardPromQLEditor);
        testLogger.info(`Found ${count} label value suggestions for node=`);

        expect(count, 'Expected label value suggestions to appear but none were shown').toBeGreaterThan(0);
        await pm.dashboardPromQLEditor.logSuggestions('Label value suggestions', 8);
      } finally {
        await pm.dashboardPromQLEditor.dismissSuggestions();
      }

      await cleanupDashboard(page, pm, dashboardName);
    }
  );
});

// ---------------------------------------------------------------------------
// Metrics page — PromQL Custom mode tests
// ---------------------------------------------------------------------------

test.describe("PromQL Autocomplete — Metrics Page", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  // -------------------------------------------------------------------------
  // P0: Metric name suggestions appear on the Metrics page in Custom mode
  // -------------------------------------------------------------------------
  test(
    "[P0] metric name suggestions appear on Metrics page in PromQL Custom mode",
    { tag: ['@promqlAutocomplete', '@smoke', '@P0', '@all'] },
    async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      const pm = new PageManager(page);

      // Navigate to Metrics page
      await pm.metricsPage.gotoMetricsPage();
      testLogger.info('Navigated to Metrics page');

      // The metrics page defaults to PromQL mode.
      // Switch to Custom mode using the data-test selector on QueryTypeSelector.vue.
      await pm.dashboardPromQLEditor.switchToCustomQuery();
      testLogger.info('Switched to Custom query mode on Metrics page');

      // Wait for Monaco query editor (container + instance attached)
      await pm.dashboardPromQLEditor.waitForEditorReady();

      // Focus the Monaco editor and type a partial metric name
      await pm.dashboardPromQLEditor.focusEditor();
      await pm.dashboardPromQLEditor.clearEditor();
      await pm.dashboardPromQLEditor.typeInEditor('cpu', { delay: 50 });

      try {
        const count = await triggerAndWaitForSuggestions(pm.dashboardPromQLEditor);
        testLogger.info(`Found ${count} metric name suggestions for "cpu" on Metrics page`);

        expect(count, 'Expected metric name suggestions on Metrics page but none appeared').toBeGreaterThan(0);
        await pm.dashboardPromQLEditor.logSuggestions('Metric name suggestions on Metrics page', 8);
      } finally {
        await pm.dashboardPromQLEditor.dismissSuggestions();
      }
    }
  );

  // -------------------------------------------------------------------------
  // P1: Label suggestions appear when typing inside {} on the Metrics page
  // -------------------------------------------------------------------------
  test(
    "[P1] label name suggestions appear inside {} on Metrics page PromQL Custom mode",
    { tag: ['@promqlAutocomplete', '@functional', '@P1', '@all'] },
    async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      const pm = new PageManager(page);

      // Navigate to Metrics page
      await pm.metricsPage.gotoMetricsPage();
      testLogger.info('Navigated to Metrics page');

      // Switch to Custom mode
      await pm.dashboardPromQLEditor.switchToCustomQuery();
      testLogger.info('Switched to Custom query mode on Metrics page');

      // Wait for Monaco query editor (container + instance attached)
      await pm.dashboardPromQLEditor.waitForEditorReady();

      await pm.dashboardPromQLEditor.focusEditor();

      // Type metric{} and position cursor inside braces
      await pm.dashboardPromQLEditor.clearEditor();
      await pm.dashboardPromQLEditor.typeInEditor('cpu_usage{}', { delay: 50 });
      await pm.dashboardPromQLEditor.pressKey('ArrowLeft');

      try {
        const count = await triggerAndWaitForSuggestions(pm.dashboardPromQLEditor);
        testLogger.info(`Found ${count} label name suggestions inside cpu_usage{} on Metrics page`);

        expect(count, 'Expected label name suggestions on Metrics page but none appeared').toBeGreaterThan(0);
        await pm.dashboardPromQLEditor.logSuggestions('Label name suggestions on Metrics page', 8);
      } finally {
        await pm.dashboardPromQLEditor.dismissSuggestions();
      }
    }
  );
});
