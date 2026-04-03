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
  } = {}
) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  if (xField) {
    await pm.chartTypeSelector.searchAndAddField(xField, "x");
  }
  await pm.chartTypeSelector.searchAndAddField(yField, "y");
  if (breakdownField) {
    const breakdownTarget = chartType === "table" ? "p" : "b";
    await pm.chartTypeSelector.searchAndAddField(breakdownField, breakdownTarget);
  }
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
  await page.waitForTimeout(500);
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
  if (xField) {
    await pm.chartTypeSelector.searchAndAddField(xField, "x");
  }
  await pm.chartTypeSelector.searchAndAddField(yField, "y");
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
    "add button is hidden for heatmap (single-query restriction)",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await pm.chartTypeSelector.selectChartType("heatmap");
      await expect(msql.addQueryBtn).not.toBeVisible();

      await pm.chartTypeSelector.selectChartType("bar");
      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "add button is hidden for pivot table (single-query restriction)",
    { tag: ["@multiSQL", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, {
        chartType: "table",
        yField: "kubernetes_container_hash",
        breakdownField: "kubernetes_namespace_name",
      });
      await expect(msql.addQueryBtn).not.toBeVisible();

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
      await msql.addQueryTab(1);
      await msql.addQueryTab(2);

      await msql.switchToQueryTab(1);
      await expect(msql.queryTab(1)).toBeVisible();

      await msql.switchToQueryTab(2);
      await expect(msql.queryTab(2)).toBeVisible();

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
      await page.waitForTimeout(300);
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

      await msql.applyAndSave(pm);
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
      await page.waitForTimeout(300);

      // Rename Q2
      await msql.switchToQueryTab(1);
      await msql.queryTabLabel(1).dblclick({ force: true });
      await msql.queryTabNameInput(1).waitFor({ state: "visible", timeout: 5000 });
      await msql.queryTabNameInput(1).fill("staging");
      await msql.queryTabNameInput(1).press("Enter");
      await page.waitForTimeout(300);

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
      await expect(msql.queryTabVisibility(0)).toContainText("visibility_off");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await msql.applyAndSave(pm);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ==========================================================================
  // 5 — Warning Banner for Restricted Chart Types
  // ==========================================================================

  test(
    "warning banner shows for restricted chart types and clears when switching back",
    { tag: ["@multiSQL", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      await buildPanel(page, pm, dashboardName, { chartType: "bar" });
      await msql.addQueryTab(1);

      await expect(msql.warningBanner).not.toBeVisible();

      await pm.chartTypeSelector.selectChartType("heatmap");
      await expect(msql.warningBanner).toBeVisible();
      await expect(msql.warningBanner).toContainText("Heatmap");
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
      await msql.addQueryTab(1);

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
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
      await pm.dashboardPanelActions.savePanel();
      await page.waitForTimeout(1000);
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

      await msql.applyAndSave(pm);
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
      await page.waitForTimeout(300);

      // Rename Q2 tab
      await msql.switchToQueryTab(1);
      await msql.queryTabLabel(1).dblclick({ force: true });
      await msql.queryTabNameInput(1).waitFor({ state: "visible", timeout: 5000 });
      await msql.queryTabNameInput(1).fill("Staging");
      await msql.queryTabNameInput(1).press("Enter");
      await page.waitForTimeout(300);

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
});
