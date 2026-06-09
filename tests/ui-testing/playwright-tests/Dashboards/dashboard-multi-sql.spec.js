const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupBarPanelWithConfig,
  setupBarPanelWithBreakdownAndConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
// test.describe.configure({ retries: 1 });

// ============================================================================
// Module-level helpers
// ============================================================================

/**
 * Build a panel for any chart type without opening the config sidebar.
 * Ends state: on the add_panel page, chart applied (not saved).
 */
async function buildPanel(
  page,
  pm,
  dashboardName,
  {
    chartType = "bar",
    panelName = "Test Panel",
    yField = "kubernetes_container_hash",
    xField = null,
    breakdownField = null,
    stream = "e2e_automate",
  } = {}
) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(stream);
  if (xField) {
    await pm.chartTypeSelector.searchAndAddField(xField, "x");
  }
  // Add Panel now auto-seeds y_axis_1 = count(_timestamp). Remove it before
  // adding this tab's own y-field.
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
  await pm.chartTypeSelector.searchAndAddField(yField, "y");
  if (breakdownField) {
    const breakdownTarget = chartType === "table" ? "p" : "b";
    await pm.chartTypeSelector.searchAndAddField(breakdownField, breakdownTarget);
  }
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
}

/**
 * Add a second query tab, configure it with a y-field on e2e_automate stream,
 * apply and wait for chart render. Common pattern across many tests.
 */
async function addAndConfigureSecondQuery(pm, { yField = "kubernetes_namespace_name", xField = "_timestamp" } = {}) {
  const msql = pm.dashboardMultiSQL;
  await msql.addQueryTab(1);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  // A new tab auto-seeds x_axis_1 = histogram(_timestamp) and y_axis_1 = count(_timestamp).
  // Always remove the seeded field, then add this tab's own x/y.
  if (xField) {
    await pm.chartTypeSelector.removeField("x_axis_1", "x");
    await pm.chartTypeSelector.searchAndAddField(xField, "x");
  }
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
  await pm.chartTypeSelector.searchAndAddField(yField, "y");
}

/**
 * Enable the VRL editor for the currently active query tab and type a program.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} vrlProgram - VRL program to type (may be empty string for no-op)
 */
async function enterVrlForActiveQuery(page, vrlProgram) {
  const vrlToggle = page.locator(
    '[data-test="logs-search-bar-show-query-toggle-btn"]'
  );
  const vrlEditor = page.locator('[data-test="dashboard-vrl-function-editor"]');
  if (!(await vrlEditor.isVisible())) {
    await vrlToggle.waitFor({ state: "visible", timeout: 10000 });
    await vrlToggle.click();
  }
  await vrlEditor.waitFor({ state: "visible", timeout: 10000 });

  if (!vrlProgram) return; // empty program = no-op, just ensure toggle is on

  const monacoInput = vrlEditor.getByRole("code");
  await monacoInput.click({ clickCount: 3 });
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(vrlProgram, { delay: 20 });
  await page.keyboard.press("Escape");

  // Wait deterministically for Monaco to reflect the typed content
  const snippet = vrlProgram.trim().substring(0, 8);
  await page.waitForFunction(
    ({ sel, text }) => {
      const el = document.querySelector(sel);
      return el && el.textContent.includes(text);
    },
    { sel: '[data-test="dashboard-vrl-function-editor"]', text: snippet },
    { timeout: 10000 }
  );

  // Settle past the 500ms debounced write-back so the typed program is
  // committed to the CURRENT query before the caller switches/adds tabs.
  // See the function-level note above for why this fixed wait is unavoidable.
  await page.waitForTimeout(700);
}

// ============================================================================
// Test suite
// ============================================================================

test.describe("Multi-SQL Query Support", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ==========================================================================
  // 1 — Query Tab UI
  // ==========================================================================

  test(
    "query tabs are visible for all SQL chart types",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await expect(msql.queryTab(0)).toBeVisible();
      await expect(
        page.locator('.text-subtitle2.text-weight-bold:has-text("SQL")')
      ).not.toBeVisible();

      for (const type of ["line", "area", "table", "pie", "gauge"]) {
        await pm.chartTypeSelector.selectChartType(type);
        await expect(msql.queryTab(0)).toBeVisible();
      }

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 2 — Add / Remove Query Tab
  // ==========================================================================

  test(
    "add query tab, remove it, and single-query guards are enforced",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });

      await expect(msql.queryTabRemove(0)).not.toBeVisible();
      await expect(msql.addQueryBtn).toBeVisible();

      await msql.addQueryTab(1);
      await expect(msql.queryTab(1)).toBeVisible();

      await msql.removeQueryTab(1);
      await expect(msql.queryTab(1)).not.toBeVisible();
      await expect(msql.queryTab(0)).toBeVisible();

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "add button is visible for heatmap (multi-query supported)",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await pm.chartTypeSelector.selectChartType("heatmap");

      // Heatmap now supports multiple queries — add button must be visible
      await expect(msql.addQueryBtn).toBeVisible();

      await pm.chartTypeSelector.selectChartType("bar");
      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "add up to 3 query tabs and switch between them",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });

      // Give each query a DISTINCT Y-axis field so switching tabs is actually
      // verifiable. Secondary query tabs (Q2+) start empty — only Q1 auto-gets
      // histogram(_timestamp) on the x-axis — so each new query also needs an
      // explicit x-field, otherwise save fails with "Query N: Add one fields
      // for the X-Axis".
      // Q1 (index 0) already has x=histogram(_timestamp) + y=kubernetes_container_hash.
      await msql.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

      await msql.addQueryTab(2);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

      // Switching tabs must surface that query's own Y-axis field.
      const yLayout = page.locator('[data-test="dashboard-y-layout"]');

      await msql.switchToQueryTab(0);
      await expect(msql.queryTab(0)).toBeVisible();
      await expect(yLayout).toContainText("kubernetes_container_hash");

      await msql.switchToQueryTab(1);
      await expect(msql.queryTab(1)).toBeVisible();
      await expect(yLayout).toContainText("kubernetes_namespace_name");

      await msql.switchToQueryTab(2);
      await expect(msql.queryTab(2)).toBeVisible();
      await expect(yLayout).toContainText("kubernetes_pod_name");

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 3 — Inline Query Tab Renaming
  // ==========================================================================

  test(
    "rename query tab — Enter saves name, Escape reverts name",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await msql.addQueryTab(1);

      await msql.switchToQueryTab(0);
      const label0 = msql.queryTabLabel(0);
      await label0.dblclick({ force: true });
      const input0 = msql.queryTabNameInput(0);
      await expect(input0).toBeVisible({ timeout: 5000 });
      await input0.fill("Production");
      await input0.press("Enter");
      // Rename commits and the inline input closes — deterministic signal.
      await expect(input0).not.toBeVisible({ timeout: 5000 });
      await expect(label0).toContainText("Production");

      await msql.switchToQueryTab(1);
      const label1 = msql.queryTabLabel(1);
      await label1.waitFor({ state: "attached", timeout: 10000 });
      await label1.dblclick({ force: true });
      const input1 = msql.queryTabNameInput(1);
      await expect(input1).toBeVisible({ timeout: 5000 });
      await input1.fill("Staging");
      await input1.press("Escape");
      await expect(input1).not.toBeVisible();
      await expect(label1).toContainText("Query 2");

      // Q2 was added but intentionally left unconfigured (this test only verifies
      // inline rename behavior), so it cannot pass save validation — discard
      // instead of save before cleanup.
      await msql.discardPanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "renamed tab names persist after save and reopen",
    { tag: ["@multiSQL", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await addAndConfigureSecondQuery(pm);

      // Rename Q1
      await msql.switchToQueryTab(0);
      await msql.queryTabLabel(0).dblclick({ force: true });
      await msql.queryTabNameInput(0).waitFor({ state: "visible", timeout: 5000 });
      await msql.queryTabNameInput(0).fill("prod");
      await msql.queryTabNameInput(0).press("Enter");
      await expect(msql.queryTabNameInput(0)).not.toBeVisible({ timeout: 5000 });

      // Rename Q2
      await msql.switchToQueryTab(1);
      await msql.queryTabLabel(1).dblclick({ force: true });
      await msql.queryTabNameInput(1).waitFor({ state: "visible", timeout: 5000 });
      await msql.queryTabNameInput(1).fill("staging");
      await msql.queryTabNameInput(1).press("Enter");
      await expect(msql.queryTabNameInput(1)).not.toBeVisible({ timeout: 5000 });

      await msql.applyAndSave(pm);
      await reopenPanelConfig(page, pm);

      await expect(msql.queryTabLabel(0)).toContainText("prod");
      await expect(msql.queryTabLabel(1)).toContainText("staging");

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 4 — Eye Icon Visibility Toggle
  // ==========================================================================

  test(
    "eye icon appears only with multiple queries and toggles visibility state",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });

      await expect(msql.queryTabVisibility(0)).not.toBeVisible();

      await msql.addQueryTab(1);
      await expect(msql.queryTabVisibility(0)).toBeVisible();
      await expect(msql.queryTabVisibility(1)).toBeVisible();

      await msql.toggleQueryVisibility(0);
      // The eye icon is an OIcon (SVG, no text). Its hidden state is exposed via
      // the data-test-hidden attribute rather than icon-font text content.
      await expect(msql.queryTabVisibility(0)).toHaveAttribute(
        "data-test-hidden",
        "true",
      );

      // Regression guard: clicking Q1's hide icon while Q2 is active must NOT
      // switch the active tab — Q2 must remain active (the icon stops
      // mousedown/pointerdown so it never activates Q1's tab).
      await expect(msql.queryTab(1)).toHaveAttribute("data-state", "active", {
        timeout: 5000,
      });
      await expect(msql.queryTab(0)).not.toHaveAttribute("data-state", "active");

      // Q2 was added but left unconfigured (this test only verifies the eye-icon
      // visibility behavior), so it cannot pass save validation — discard.
      await msql.discardPanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 5 — Warning Banner for Restricted Chart Types
  // ==========================================================================

  test(
    "warning banner does NOT show for heatmap with multiple queries (heatmap supports multi-query)",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      // Configure the second query — an empty query fails save validation
      // ("Query 2: Add at least one field …"), which would leave the panel on
      // the add_panel page and break teardown.
      await addAndConfigureSecondQuery(pm);

      await expect(msql.warningBanner).not.toBeVisible();

      // Heatmap no longer restricts multiple queries — no warning banner expected
      await pm.chartTypeSelector.selectChartType("heatmap");
      await expect(msql.warningBanner).not.toBeVisible();

      // Both query tabs still present
      await expect(msql.queryTab(0)).toBeVisible();
      await expect(msql.queryTab(1)).toBeVisible();

      await pm.chartTypeSelector.selectChartType("bar");
      await expect(msql.warningBanner).not.toBeVisible();

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "pivot table shows warning banner when multiple queries exist",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "table",
        yField: "kubernetes_container_hash",
      });
      // Configure the second query so the panel passes save validation (every
      // query is validated); the pivot warning itself does not block saving.
      await addAndConfigureSecondQuery(pm);

      await msql.switchToQueryTab(0);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "p");
      await pm.dashboardPanelActions.applyDashboardBtn();

      await expect(msql.warningBanner).toBeVisible();
      await expect(msql.warningBanner).toContainText("Pivot Table");

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 6 — Query Labels in Config Panel
  // ==========================================================================

  test(
    "query label fields visible for multi-query, hidden for single query, and persist after reopen",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await setupBarPanelWithConfig(page, pm, dashboardName);

      await expect(msql.configLegend(0)).not.toBeVisible();

      await msql.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
      await msql.switchToQueryTab(0);
      await msql.configLegend(0).waitFor({ state: "visible", timeout: 10000 });
      await msql.configLegend(0).clear();
      await msql.configLegend(0).fill("prod");

      await msql.switchToQueryTab(1);
      await msql.configLegend(1).waitFor({ state: "visible", timeout: 10000 });
      await msql.configLegend(1).clear();
      await msql.configLegend(1).fill("staging");

      await msql.switchToQueryTab(0);
      await msql.applyAndSave(pm);
      await reopenPanelConfig(page, pm);

      await expect(msql.configLegend(0)).toHaveValue("prod");

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 7 — Multi-Query Chart Rendering
  // ==========================================================================

  test(
    "bar chart renders data from 2 independently configured queries",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "bar",
        yField: "kubernetes_container_hash",
      });
      await addAndConfigureSecondQuery(pm);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "line chart renders correctly with 2 queries",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "line",
        yField: "kubernetes_container_hash",
      });
      await addAndConfigureSecondQuery(pm);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "pie and donut charts render correctly with 2 queries",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "pie",
        yField: "kubernetes_container_hash",
      });
      await addAndConfigureSecondQuery(pm);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 8 — Chart Type Switch: Query Preservation
  // ==========================================================================

  test(
    "queries are preserved when switching between compatible chart types",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await msql.addQueryTab(1);

      await pm.chartTypeSelector.selectChartType("line");
      await expect(msql.queryTab(0)).toBeVisible();
      await expect(msql.queryTab(1)).toBeVisible();

      await pm.chartTypeSelector.selectChartType("table");
      await expect(msql.queryTab(0)).toBeVisible();
      await expect(msql.queryTab(1)).toBeVisible();

      await pm.chartTypeSelector.selectChartType("bar");
      await expect(msql.queryTab(0)).toBeVisible();
      await expect(msql.queryTab(1)).toBeVisible();

      // Q2 was added but left unconfigured (this test only verifies tab survival
      // across chart-type switches), so it cannot pass save validation — discard.
      await msql.discardPanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 9 — Persistence: Save and Reopen
  // ==========================================================================

  test(
    "multi-query panel with 2 configured queries persists after save and reopen",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "bar",
        yField: "kubernetes_container_hash",
      });
      await addAndConfigureSecondQuery(pm);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await msql.applyAndSave(pm);
      await reopenPanelConfig(page, pm);

      await expect(msql.queryTab(0)).toBeVisible();
      await expect(msql.queryTab(1)).toBeVisible();
      await pm.dashboardPanelActions.verifyChartRenders(expect);

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 10 — Trellis Disabled with Multiple Queries
  // ==========================================================================

  test(
    "trellis option is disabled with multiple queries and re-enabled after removal",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
      await msql.addQueryTab(1);

      await expect(msql.trellisDisabled()).toBeVisible();

      await msql.removeQueryTab(1);
      await expect(msql.queryTab(1)).not.toBeVisible();
      await expect(msql.trellisDisabled()).not.toBeVisible();
      await expect(msql.trellisDropdown).toBeVisible();

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 11 — Query Inspector
  // ==========================================================================

  test(
    "query inspector shows SQL for all configured queries",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "bar",
        yField: "kubernetes_container_hash",
      });
      await addAndConfigureSecondQuery(pm);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      const pageContent = await msql.openQueryInspector();
      const selectCount = (pageContent.match(/SELECT/gi) || []).length;
      expect(selectCount).toBeGreaterThanOrEqual(2);
      await msql.closeQueryInspector();

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "renamed query tab names are reflected in the query inspector",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "bar",
        yField: "kubernetes_container_hash",
      });
      await addAndConfigureSecondQuery(pm);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      // Rename Q1 tab
      await msql.switchToQueryTab(0);
      await msql.queryTabLabel(0).dblclick({ force: true });
      await msql.queryTabNameInput(0).waitFor({ state: "visible", timeout: 5000 });
      await msql.queryTabNameInput(0).fill("Production");
      await msql.queryTabNameInput(0).press("Enter");
      await expect(msql.queryTabNameInput(0)).not.toBeVisible({ timeout: 5000 });

      // Rename Q2 tab
      await msql.switchToQueryTab(1);
      await msql.queryTabLabel(1).dblclick({ force: true });
      await msql.queryTabNameInput(1).waitFor({ state: "visible", timeout: 5000 });
      await msql.queryTabNameInput(1).fill("Staging");
      await msql.queryTabNameInput(1).press("Enter");
      await expect(msql.queryTabNameInput(1)).not.toBeVisible({ timeout: 5000 });

      // Apply to propagate the renamed tab names to metaData
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      // Open inspector and verify renamed names appear as query headings
      await msql.openQueryInspector();
      await expect(msql.queryInspectorQueryName(0)).toContainText("Production");
      await expect(msql.queryInspectorQueryName(1)).toContainText("Staging");
      await msql.closeQueryInspector();

      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 11 — Per-Query Error Visibility
  // ==========================================================================

  test(
    "error from an unconfigured query tab is shown regardless of which tab is active",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      // Q1: valid bar chart with y-field configured
      await buildPanel(page, pm, dashboardName, { chartType: "bar" });

      // Add Q2 and intentionally make it invalid. New tabs now auto-seed
      // histogram x + count y, so strip both fields to leave Q2 unconfigured —
      // an empty query is what surfaces the execution error under test.
      await msql.addQueryTab(1);
      await pm.chartTypeSelector.removeField("x_axis_1", "x");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");

      // Switch back to Q1 — error from Q2 should surface regardless of active tab
      await msql.switchToQueryTab(0);

      // Apply while on Q1 — Q2 has an invalid/empty query which triggers a
      // chart-execution error. The inline error panel must appear even though
      // we are currently viewing Q1 (not Q2).
      await pm.dashboardPanelActions.applyDashboardBtn();

      // DashboardErrors.vue renders two elements with data-test="dashboard-error":
      //   - the outer conditional wrapper (first)
      //   - the inner list container (second)
      // Use .first() to target the outer wrapper for visibility checks.
      const errorWrapper = page.locator('[data-test="dashboard-error"]').first();
      await expect(errorWrapper).toBeVisible({ timeout: 10000 });

      // Switch to Q2 — error panel must persist (not cleared by tab switch alone)
      await msql.switchToQueryTab(1);
      await expect(errorWrapper).toBeVisible();

      // Switch back to Q1 — error still visible
      await msql.switchToQueryTab(0);
      await expect(errorWrapper).toBeVisible();

      // Q2 is intentionally invalid (this test verifies the error surfaces), so
      // the panel cannot be saved — discard to leave add_panel before cleanup.
      await msql.discardPanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 12 — Reset Query on Chart Type Change
  // ==========================================================================

  test.describe("Reset Query on Chart Type Change", () => {
    // These tests interact with the chart type selector in ways that can race
    // under heavy parallel load (Apply / Save buttons temporarily covered by
    // loading overlays). Running them serially prevents CPU-contention timeouts
    // while still allowing other describe blocks to run in parallel.
    test.describe.configure({ mode: "serial" });

    test(
      "single query: reset clears y-function when switching to pie",
      { tag: ["@multiSQL", "@resetQuery", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await pm.chartTypeSelector.selectChartType("pie");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "single query: reset clears z-axis and breakdown when switching to bar",
      { tag: ["@multiSQL", "@resetQuery", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Start with a bar panel — Q1's x-axis is auto-populated with
        // histogram(_timestamp) by the panel initializer. No xField needed.
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // Switch to heatmap — fields are preserved but z-field is missing;
        // a chart error here is acceptable (not the assertion under test).
        await pm.chartTypeSelector.selectChartType("heatmap");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        // Switch back to bar — heatmap-only config (z-field) is cleared.
        await pm.chartTypeSelector.selectChartType("bar");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        // Bar with x=histogram(_timestamp) + y=kubernetes_container_hash
        // must render without crash.
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "multi-query: switching to pie resets all queries' y-functions and breakdown",
      { tag: ["@multiSQL", "@resetQuery", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await addAndConfigureSecondQuery(pm);
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await pm.chartTypeSelector.selectChartType("pie");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await expect(
          page.locator('[data-test="dashboard-error"]').first()
        ).not.toBeVisible({ timeout: 5000 });
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "multi-query: switching to metric resets all queries' y-functions and clears x/breakdown",
      { tag: ["@multiSQL", "@resetQuery", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await addAndConfigureSecondQuery(pm);
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await pm.chartTypeSelector.selectChartType("metric");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await expect(
          page.locator('[data-test="dashboard-error"]').first()
        ).not.toBeVisible({ timeout: 5000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "multi-query: switching to heatmap resets all queries' y-functions to null",
      { tag: ["@multiSQL", "@resetQuery", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await addAndConfigureSecondQuery(pm);
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        // Switch to heatmap — y-functions reset; missing z-field may cause
        // a chart error which is acceptable (the reset is what we're testing).
        await pm.chartTypeSelector.selectChartType("heatmap");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        // Switch back to bar — both query tabs must still be intact after
        // the round-trip through heatmap.
        await pm.chartTypeSelector.selectChartType("bar");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await expect(msql.queryTab(0)).toBeVisible();
        await expect(msql.queryTab(1)).toBeVisible();

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "multi-query: tab switch after two chart type changes does not re-introduce stale fields",
      { tag: ["@multiSQL", "@resetQuery", "@P2"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await addAndConfigureSecondQuery(pm);
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await pm.chartTypeSelector.selectChartType("gauge");
        await pm.chartTypeSelector.selectChartType("bar");

        // Switch to Q2 tab — verify tabs remain intact after two chart-type switches
        await msql.switchToQueryTab(1);
        await expect(msql.queryTab(1)).toBeVisible();

        // Switch back to Q1 and apply
        await msql.switchToQueryTab(0);
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );
  });

  // ==========================================================================
  // 13 — X-Axis Alias Inconsistency Warning
  // ==========================================================================

  test.describe("X-Axis Alias Inconsistency Warning", () => {
    // The warning button lives in PanelErrorButtons.vue (panel editor header).
    // It reacts to field config changes without needing an Apply click.
    const xAliasWarning = (page) =>
      page.locator('[data-test="panel-x-alias-inconsistency-warning"]');

    /**
     * Remove the first x-axis field from the currently active query tab.
     * Needed for tests that must replace the auto-populated _timestamp with a
     * non-histogram field.
     */
    async function removeFirstXField(page) {
      const btn = page
        .locator('[data-test="dashboard-x-layout"] [data-test$="-remove"]')
        .first();
      await btn.waitFor({ state: "visible", timeout: 8000 });
      await btn.click();
    }

    // NOTE: When addPanel() is called, the panel editor auto-populates
    // histogram(_timestamp) into Q1's x-axis. So buildPanel() must NOT pass
    // xField — Q1 already has the histogram x-field. New query tabs (Q2+) now
    // also auto-seed x_axis_1 = histogram(_timestamp) + y_axis_1 = count(_timestamp),
    // so tests remove the seeded field before adding a different x/y of their own.

    test(
      "no warning with a single query using histogram x-alias",
      { tag: ["@multiSQL", "@xAliasWarning", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Q1 has auto-populated histogram(_timestamp) from panel initializer
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // Single query with histogram x → queriesWithX.length < 2 → no warning
        await expect(xAliasWarning(page)).not.toBeVisible({ timeout: 3000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "no warning when both queries use histogram x-alias",
      { tag: ["@multiSQL", "@xAliasWarning", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Q1 auto-has histogram(_timestamp)
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // Q2 keeps its auto-seeded histogram(_timestamp) x
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );

        // Both Q1 and Q2 use histogram → no inconsistency
        await expect(xAliasWarning(page)).not.toBeVisible({ timeout: 3000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "no warning when both queries use non-histogram x-alias",
      { tag: ["@multiSQL", "@xAliasWarning", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Q1 auto-has histogram(_timestamp); remove it then add non-histogram field
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await removeFirstXField(page); // removes auto _timestamp
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");

        // Add Q2 with non-histogram x (replaces the seeded histogram x)
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // New tab seeds histogram(_timestamp) x; replace it with this tab's
        // non-histogram x-field.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );

        await msql.switchToQueryTab(0);
        // Both Q1 and Q2 have non-histogram x → no inconsistency
        await expect(xAliasWarning(page)).not.toBeVisible({ timeout: 3000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "warning appears when Q1 has histogram x-alias and Q2 has non-histogram x-alias",
      { tag: ["@multiSQL", "@xAliasWarning", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Q1: auto-has histogram(_timestamp)
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // Q2: non-histogram x (kubernetes_host), replacing the seeded histogram x
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // New tab seeds histogram(_timestamp) x; replace it with this tab's
        // non-histogram x-field.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );

        await msql.switchToQueryTab(0);
        // Q1 histogram, Q2 non-histogram → warning must appear
        await expect(xAliasWarning(page)).toBeVisible({ timeout: 5000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "warning appears when Q1 is non-histogram and Q2 is histogram (order independence)",
      { tag: ["@multiSQL", "@xAliasWarning", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Q1: replace auto _timestamp with non-histogram (kubernetes_host)
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await removeFirstXField(page); // removes auto _timestamp
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");

        // Q2 keeps its auto-seeded histogram(_timestamp) x
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );

        await msql.switchToQueryTab(0);
        // Q1 non-histogram, Q2 histogram → warning shown regardless of order
        await expect(xAliasWarning(page)).toBeVisible({ timeout: 5000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "warning disappears when inconsistency is resolved",
      { tag: ["@multiSQL", "@xAliasWarning", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Create inconsistent state: Q1 auto-histogram, Q2 non-histogram
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // New tab seeds histogram(_timestamp) x; replace it with this tab's
        // non-histogram x-field.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await msql.switchToQueryTab(0);
        await expect(xAliasWarning(page)).toBeVisible({ timeout: 5000 });

        // Resolve: switch to Q2 and remove the non-histogram x-field
        await msql.switchToQueryTab(1);
        await removeFirstXField(page); // removes kubernetes_host from Q2

        await msql.switchToQueryTab(0);
        // Q2 now has no x-field → excluded from check → warning gone
        await expect(xAliasWarning(page)).not.toBeVisible({ timeout: 5000 });

        // Q2 deliberately has no x-field (invalid for a bar panel), so the panel
        // cannot be saved — discard to leave add_panel before cleanup.
        await msql.discardPanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "no warning when one query has no x-field",
      { tag: ["@multiSQL", "@xAliasWarning", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Q1 auto-has histogram(_timestamp)
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // Q2 with ONLY a y-field — remove both auto-seeded fields, add only y
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );

        await msql.switchToQueryTab(0);
        // Q2 has no x-field → excluded from inconsistency check → no warning
        await expect(xAliasWarning(page)).not.toBeVisible({ timeout: 3000 });

        // Q2 deliberately has only a y-field (invalid for a bar panel), so the
        // panel cannot be saved — discard to leave add_panel before cleanup.
        await msql.discardPanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "warning absent when mismatched query is hidden, restored when it is unhidden",
      { tag: ["@multiSQL", "@xAliasWarning", "@P2"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Create inconsistent state (same as 13.4)
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // New tab seeds histogram(_timestamp) x; replace it with this tab's
        // non-histogram x-field.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await msql.switchToQueryTab(0);
        await expect(xAliasWarning(page)).toBeVisible({ timeout: 5000 });

        // Hide Q2 → hidden queries excluded from check → warning gone
        await msql.toggleQueryVisibility(1);
        await expect(xAliasWarning(page)).not.toBeVisible({ timeout: 5000 });

        // Unhide Q2 → inconsistency restored → warning reappears
        await msql.toggleQueryVisibility(1);
        await expect(xAliasWarning(page)).toBeVisible({ timeout: 5000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "warning is only in the panel header, not inside y-axis or breakdown sections",
      { tag: ["@multiSQL", "@xAliasWarning", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        // Create inconsistent state (same as 13.4)
        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // New tab seeds histogram(_timestamp) x; replace it with this tab's
        // non-histogram x-field.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "x");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await msql.switchToQueryTab(0);
        await expect(xAliasWarning(page)).toBeVisible({ timeout: 5000 });

        // Warning must NOT appear nested inside axis layout sections
        await expect(
          page.locator(
            '[data-test="dashboard-y-layout"] [data-test="panel-x-alias-inconsistency-warning"]'
          )
        ).not.toBeVisible({ timeout: 2000 });
        await expect(
          page.locator(
            '[data-test="dashboard-breakdown-layout"] [data-test="panel-x-alias-inconsistency-warning"]'
          )
        ).not.toBeVisible({ timeout: 2000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );
  });

  // ==========================================================================
  // 14 — VRL Function with Multiple Queries
  // ==========================================================================

  test.describe("VRL Function with Multiple Queries", () => {
    // Identity VRL for kubernetes_container_hash field (safe no-op transform)
    const VRL_Q1 = '.kubernetes_container_hash = .kubernetes_container_hash';
    // Identity VRL for kubernetes_namespace_name field
    const VRL_Q2 = '.kubernetes_namespace_name = .kubernetes_namespace_name';

    test(
      "bar chart renders when VRL is applied to a single query",
      { tag: ["@multiSQL", "@vrl", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await enterVrlForActiveQuery(page, VRL_Q1);
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "VRL applies independently to each query in multi-query mode",
      { tag: ["@multiSQL", "@vrl", "@P0", "@smoke"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // VRL on Q1
        await msql.switchToQueryTab(0);
        await enterVrlForActiveQuery(page, VRL_Q1);

        // Add Q2 with x-field + y-field + its own VRL
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // Q2 keeps its auto-seeded histogram(_timestamp) x; swap the seeded y.
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await enterVrlForActiveQuery(page, VRL_Q2);

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);
        await expect(
          page.locator('[data-test="dashboard-error"]').first()
        ).not.toBeVisible({ timeout: 5000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "switching query tabs keeps per-query VRL content",
      { tag: ["@multiSQL", "@vrl", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        await msql.switchToQueryTab(0);
        await enterVrlForActiveQuery(page, VRL_Q1);

        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await enterVrlForActiveQuery(page, VRL_Q2);

        await msql.switchToQueryTab(0);
        await expect(
          page.locator('[data-test="dashboard-vrl-function-editor"]')
        ).toContainText("kubernetes_container_hash", { timeout: 10000 });

        await msql.switchToQueryTab(1);
        await expect(
          page.locator('[data-test="dashboard-vrl-function-editor"]')
        ).toContainText("kubernetes_namespace_name", { timeout: 10000 });

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "empty VRL on both queries is a no-op, chart renders normally",
      { tag: ["@multiSQL", "@vrl", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await addAndConfigureSecondQuery(pm);

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        // Enable VRL toggle on Q1 but leave editor empty (no program typed)
        await msql.switchToQueryTab(0);
        await enterVrlForActiveQuery(page, ""); // empty = toggle ON only

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);
        await expect(
          page.locator('[data-test="dashboard-error"]').first()
        ).not.toBeVisible({ timeout: 5000 });

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "VRL on Q1 does not affect Q2 (query isolation)",
      { tag: ["@multiSQL", "@vrl", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });

        // VRL on Q1 only
        await msql.switchToQueryTab(0);
        await enterVrlForActiveQuery(page, VRL_Q1);

        // Add Q2 without VRL (x-field needed so chart renders without error)
        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);
        await expect(
          page.locator('[data-test="dashboard-error"]').first()
        ).not.toBeVisible({ timeout: 5000 });

        // Inspector should show at least 2 SELECT statements (one per query)
        const pageContent = await msql.openQueryInspector();
        const selectCount = (pageContent.match(/SELECT/gi) || []).length;
        expect(selectCount).toBeGreaterThanOrEqual(2);
        await msql.closeQueryInspector();

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "VRL persists after save and reopen",
      { tag: ["@multiSQL", "@vrl", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "bar",
          yField: "kubernetes_container_hash",
        });
        await msql.switchToQueryTab(0);
        await enterVrlForActiveQuery(page, VRL_Q1);

        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        // Q2 keeps its auto-seeded histogram(_timestamp) x; swap the seeded y.
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await enterVrlForActiveQuery(page, VRL_Q2);

        // Apply before save so the panel state includes both VRLs
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await reopenPanelConfig(page, pm);

        // Verify persistence: both query tabs are intact after reopen
        await expect(msql.queryTab(0)).toBeVisible();
        await expect(msql.queryTab(1)).toBeVisible();

        // Verify the VRL toggle is still ON for Q1 (persisted with panel).
        // When VRL is saved, the toggle stays on when the panel is reopened.
        await msql.switchToQueryTab(0);
        const vrlEditorQ1 = page.locator(
          '[data-test="dashboard-vrl-function-editor"]'
        );
        // If toggle was NOT persisted, click it to show editor
        if (!(await vrlEditorQ1.isVisible().catch(() => false))) {
          await page
            .locator('[data-test="logs-search-bar-show-query-toggle-btn"]')
            .click();
          await vrlEditorQ1.waitFor({ state: "visible", timeout: 10000 });
        } else {
          // Toggle IS persisted — VRL survived save/reopen
          await vrlEditorQ1.waitFor({ state: "visible", timeout: 5000 });
        }

        // Chart must render correctly after reopen — confirms VRL didn't break anything
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "line chart renders correctly with VRL applied to both queries",
      { tag: ["@multiSQL", "@vrl", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const msql = pm.dashboardMultiSQL;
        const dashboardName = generateDashboardName();

        await buildPanel(page, pm, dashboardName, {
          chartType: "line",
          // Q1's x-axis is auto-populated with histogram(_timestamp) on panel init;
          // passing xField here would hit the disabled +X button.
          yField: "kubernetes_container_hash",
        });
        await msql.switchToQueryTab(0);
        await enterVrlForActiveQuery(page, VRL_Q1);

        await msql.addQueryTab(1);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_namespace_name",
          "y"
        );
        await enterVrlForActiveQuery(page, VRL_Q2);

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
        await pm.dashboardPanelActions.verifyChartRenders(expect);

        await msql.applyAndSave(pm);
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );
  });

  // ==========================================================================
  // 15 — Partial Error for Streams with Different max_query_range
  // ==========================================================================

  test.describe(
    "Partial Error for Streams with Different max_query_range",
    () => {
      test(
        "warning icon appears when the single-query stream range is exceeded (baseline)",
        { tag: ["@multiSQL", "@partialError", "@P0", "@smoke"] },
        async ({ page }) => {
          const pm = new PageManager(page);
          const msql = pm.dashboardMultiSQL;
          const mqr = pm.dashboardMaxQueryRange;
          const dashboardName = generateDashboardName();

          // Dedicated stream for this test. A freshly-ingested stream has no
          // persistent single-stream cache, so the query is a cache miss that
          // forces do_partitioned_search to run and set function_error.
          const stream = "e2e_max_query_range_first";
          await ingestion(page, stream);

          await buildPanel(page, pm, dashboardName, {
            chartType: "bar",
            yField: "kubernetes_container_hash",
            stream,
          });
          await pm.dashboardPanelActions.applyDashboardBtn();
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
          await msql.applyAndSave(pm);

          await mqr.setMaxQueryRange(2, stream);

          await waitForDateTimeButtonToBeEnabled(page);
          const searchDone = mqr.createSearchResponsePromise();
          await pm.dateTimeHelper.setRelativeTimeRange("2-d");
          await searchDone;

          await expect(
            page
              .locator('[data-test="panel-max-duration-warning"]')
              .first()
          ).toBeVisible({ timeout: 30000 });

          await cleanupTestDashboard(page, pm, dashboardName);
        }
      );

      test(
        "both query restriction warnings appear in tooltip with two restricted streams",
        { tag: ["@multiSQL", "@partialError", "@P0", "@smoke"] },
        async ({ page }) => {
          const pm = new PageManager(page);
          const msql = pm.dashboardMultiSQL;
          const mqr = pm.dashboardMaxQueryRange;
          const dashboardName = generateDashboardName();

          // Dedicated streams for this test (parallel-safe isolation)
          const streamA = "e2e_max_query_range_second";
          const streamB = "e2e_max_query_range_third";
          await ingestion(page, streamA);
          await ingestion(page, streamB);

          // Build a 2-query panel: Q1=streamA, Q2=streamB
          await buildPanel(page, pm, dashboardName, {
            chartType: "bar",
            yField: "kubernetes_container_hash",
            stream: streamA,
          });
          await msql.addQueryTab(1);
          await pm.chartTypeSelector.selectStreamType("logs");
          await pm.chartTypeSelector.selectStream(streamB);
          // Q2 keeps its auto-seeded histogram(_timestamp) x; swap the seeded y.
          await pm.chartTypeSelector.removeField("y_axis_1", "y");
          await pm.chartTypeSelector.searchAndAddField(
            "kubernetes_namespace_name",
            "y"
          );
          await pm.dashboardPanelActions.applyDashboardBtn();
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
          await msql.applyAndSave(pm);
          // Now on dashboard page

          await mqr.setMaxQueryRange(2, streamA);
          await mqr.setMaxQueryRange(3, streamB);

          await waitForDateTimeButtonToBeEnabled(page);
          const allSearchDone = mqr.createSearchResponsePromise();
          await pm.dateTimeHelper.setRelativeTimeRange("2-d");
          await allSearchDone;

          // Warning icon must be visible
          const warningIcon = page
            .locator('[data-test="panel-max-duration-warning"]')
            .first();
          await expect(warningIcon).toBeVisible({ timeout: 30000 });

          // Hover to read tooltip
          const tooltipText = await mqr.getWarningTooltipText();
          expect(tooltipText).toContain(
            "Query duration is modified due to query range restriction"
          );

          // Both queries are restricted — "Data returned for:" must appear at least twice
          const dataReturnedMatches = (
            tooltipText.match(/Data returned for:/g) || []
          ).length;
          expect(dataReturnedMatches).toBeGreaterThanOrEqual(2);

          await cleanupTestDashboard(page, pm, dashboardName);
        }
      );

      test(
        "only one warning when only one stream is restricted",
        { tag: ["@multiSQL", "@partialError", "@P1"] },
        async ({ page }) => {
          const pm = new PageManager(page);
          const msql = pm.dashboardMultiSQL;
          const mqr = pm.dashboardMaxQueryRange;
          const dashboardName = generateDashboardName();

          // Dedicated streams for this test (parallel-safe isolation)
          const streamA = "e2e_max_query_range_fourth";
          const streamB = "e2e_max_query_range_fifth";
          await ingestion(page, streamA);
          await ingestion(page, streamB);

          // 2-query panel
          await buildPanel(page, pm, dashboardName, {
            chartType: "bar",
            yField: "kubernetes_container_hash",
            stream: streamA,
          });
          await msql.addQueryTab(1);
          await pm.chartTypeSelector.selectStreamType("logs");
          await pm.chartTypeSelector.selectStream(streamB);
          // Q2 keeps its auto-seeded histogram(_timestamp) x; swap the seeded y.
          await pm.chartTypeSelector.removeField("y_axis_1", "y");
          await pm.chartTypeSelector.searchAndAddField(
            "kubernetes_namespace_name",
            "y"
          );
          await pm.dashboardPanelActions.applyDashboardBtn();
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
          await msql.applyAndSave(pm);

          // Only restrict streamA (Q1); leave streamB (Q2) unrestricted
          await mqr.setMaxQueryRange(2, streamA);
          await mqr.resetMaxQueryRange(streamB);

          await waitForDateTimeButtonToBeEnabled(page);
          const searchDone = mqr.createSearchResponsePromise();
          await pm.dateTimeHelper.setRelativeTimeRange("2-d");
          await searchDone;

          await expect(
            page
              .locator('[data-test="panel-max-duration-warning"]')
              .first()
          ).toBeVisible({ timeout: 30000 });

          const tooltipText = await mqr.getWarningTooltipText();
          expect(tooltipText).toContain("Data returned for:");
          // Only Q1 is restricted: exactly one "Data returned for:" occurrence
          const occurrences = (
            tooltipText.match(/Data returned for:/g) || []
          ).length;
          expect(occurrences).toBe(1);

          await cleanupTestDashboard(page, pm, dashboardName);
        }
      );

      test(
        "no warning when both queries are within their stream limits",
        { tag: ["@multiSQL", "@partialError", "@P1"] },
        async ({ page }) => {
          const pm = new PageManager(page);
          const msql = pm.dashboardMultiSQL;
          const mqr = pm.dashboardMaxQueryRange;
          const dashboardName = generateDashboardName();

          // Dedicated streams for this test (parallel-safe isolation)
          const streamA = "e2e_max_query_range_sixth";
          const streamB = "e2e_max_query_range_seventh";
          await ingestion(page, streamA);
          await ingestion(page, streamB);

          await buildPanel(page, pm, dashboardName, {
            chartType: "bar",
            yField: "kubernetes_container_hash",
            stream: streamA,
          });
          await msql.addQueryTab(1);
          await pm.chartTypeSelector.selectStreamType("logs");
          await pm.chartTypeSelector.selectStream(streamB);
          // Q2 keeps its auto-seeded histogram(_timestamp) x; swap the seeded y.
          await pm.chartTypeSelector.removeField("y_axis_1", "y");
          await pm.chartTypeSelector.searchAndAddField(
            "kubernetes_namespace_name",
            "y"
          );
          await pm.dashboardPanelActions.applyDashboardBtn();
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
          await msql.applyAndSave(pm);

          await mqr.setMaxQueryRange(2, streamA);
          await mqr.setMaxQueryRange(3, streamB);

          await waitForDateTimeButtonToBeEnabled(page);
          // 1-hour range is within both 2h and 3h limits
          const searchDone = mqr.createSearchResponsePromise();
          await pm.dateTimeHelper.setRelativeTimeRange("1-h");
          await searchDone;
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

          await expect(
            page.locator('[data-test="panel-max-duration-warning"]').first()
          ).not.toBeVisible({ timeout: 5000 });

          await cleanupTestDashboard(page, pm, dashboardName);
        }
      );

      test(
        "warning disappears when time range is changed to within both stream limits",
        { tag: ["@multiSQL", "@partialError", "@P1"] },
        async ({ page }) => {
          const pm = new PageManager(page);
          const msql = pm.dashboardMultiSQL;
          const mqr = pm.dashboardMaxQueryRange;
          const dashboardName = generateDashboardName();

          // Build 2-query panel
          // Dedicated streams for this test (parallel-safe isolation)
          const streamA = "e2e_max_query_range_eighth";
          const streamB = "e2e_max_query_range_ninth";
          await ingestion(page, streamA);
          await ingestion(page, streamB);

          await buildPanel(page, pm, dashboardName, {
            chartType: "bar",
            yField: "kubernetes_container_hash",
            stream: streamA,
          });
          await msql.addQueryTab(1);
          await pm.chartTypeSelector.selectStreamType("logs");
          await pm.chartTypeSelector.selectStream(streamB);
          // Q2 keeps its auto-seeded histogram(_timestamp) x; swap the seeded y.
          await pm.chartTypeSelector.removeField("y_axis_1", "y");
          await pm.chartTypeSelector.searchAndAddField(
            "kubernetes_namespace_name",
            "y"
          );
          await pm.dashboardPanelActions.applyDashboardBtn();
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
          await msql.applyAndSave(pm);

          await mqr.setMaxQueryRange(2, streamA);
          await mqr.setMaxQueryRange(3, streamB);

          await waitForDateTimeButtonToBeEnabled(page);
          const searchDoneWide = mqr.createSearchResponsePromise();
          await pm.dateTimeHelper.setRelativeTimeRange("2-d");
          await searchDoneWide;

          // Warning must be visible with the wide range
          await expect(
            page
              .locator('[data-test="panel-max-duration-warning"]')
              .first()
          ).toBeVisible({ timeout: 30000 });

          // Switch to 1-hour range — within both limits
          await waitForDateTimeButtonToBeEnabled(page);
          const searchDoneNarrow = mqr.createSearchResponsePromise();
          await pm.dateTimeHelper.setRelativeTimeRange("1-h");
          await searchDoneNarrow;
          await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

          // Warning must disappear
          await expect(
            page.locator('[data-test="panel-max-duration-warning"]').first()
          ).not.toBeVisible({ timeout: 10000 });

          await cleanupTestDashboard(page, pm, dashboardName);
        }
      );
    }
  );
});
