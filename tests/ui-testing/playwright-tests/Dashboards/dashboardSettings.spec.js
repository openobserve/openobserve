// Dashboard Settings Redesign — new surface area not covered by the pre-existing
// general-setting / variables / tabs specs:
//   1. General Settings: description is a multiline <textarea>, save button reads
//      "Save changes", footer/helper copy rendered, save persists name + description.
//   2. Variables: per-variable dependency-count chip + "no variables yet" empty state.
//   3. Tabs: per-tab panel-count badge in the view header (excludes section headers).
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { ingestion } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
  addSimplePanel,
} from "./utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Settings Redesign testcases", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    // Shared/read-only stream used by query-value variables and panels.
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  test(
    "should render description as a textarea, show Save changes label and persist a multi-line description",
    { tag: ["@dashboardSettings", "@dashboards", "@P0", "@smoke", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = `Dashboard_Desc_${Date.now()}`;
      const description = "line1\nline2\nline3";

      testLogger.info("Creating dashboard and opening settings", { dashboardName });
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();
      await pm.dashboardSetting.openSetting();

      // Description renders as a <textarea> (locator targets textarea[data-test=...-field]).
      await expect(pm.dashboardSetting.getDescriptionField()).toBeVisible({ timeout: 10000 });
      // Save button label changed "Save" -> "Save changes".
      await expect(pm.dashboardSetting.getSaveBtn()).toHaveText("Save changes");
      // Footer + helper copy rendered.
      await expect(pm.dashboardSetting.getAppliesToEveryoneHint()).toBeVisible();
      await expect(pm.dashboardSetting.getDynamicFiltersHelp()).toBeVisible();

      // Type a multi-line description and save.
      await pm.dashboardSetting.changeDashboardDescription(description);
      await pm.dashboardSetting.saveSetting();
      await expect(
        pm.dashboardSetting.getToastMessageByText("Dashboard updated successfully")
      ).toBeVisible({ timeout: 30000 });

      // Persistence: reopen the settings drawer and confirm the value survived.
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardSetting.openSetting();
      await expect(pm.dashboardSetting.getDescriptionField()).toHaveValue(description, {
        timeout: 15000,
      });

      testLogger.info("Cleaning up dashboard", { dashboardName });
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "should show a dependency chip on the dependent variable and not on the independent one",
    { tag: ["@dashboardSettings", "@dashboards", "@dashboardVariables", "@P0", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dashboard_DepChip_${Date.now()}`;
      const varA = `var_a_${Date.now()}`;
      const varB = `var_b_${Date.now()}`;

      testLogger.info("Creating dashboard for dependency chip", { dashboardName });
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

      // Add independent query-value variable A.
      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.openVariables();
      await scopedVars.addScopedVariable(
        varA,
        "logs",
        "e2e_automate",
        "kubernetes_namespace_name",
        { scope: "global" }
      );
      await scopedVars
        .getEditVariableBtnLocator(varA)
        .waitFor({ state: "visible", timeout: 10000 });

      // Close + reopen for a clean state, then add B (query_values, filter value $A).
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.openVariables();
      await scopedVars
        .getAddVariableBtnLocator()
        .waitFor({ state: "visible", timeout: 10000 });

      await scopedVars.addScopedVariable(
        varB,
        "logs",
        "e2e_automate",
        "kubernetes_container_name",
        {
          scope: "global",
          dependsOn: varA,
          dependsOnField: "kubernetes_namespace_name",
        }
      );
      await scopedVars
        .getEditVariableBtnLocator(varB)
        .waitFor({ state: "visible", timeout: 10000 });

      // B shows a dependency chip with count 1; A shows no chip at all.
      await expect(pm.dashboardSetting.getVariableDependencyChip(varB)).toBeVisible({
        timeout: 10000,
      });
      await expect(pm.dashboardSetting.getVariableDependencyChip(varB)).toHaveText("1");
      await expect(pm.dashboardSetting.getVariableDependencyChip(varA)).toHaveCount(0);

      // Hovering the chip reveals the "Depends on: <varA>" tooltip.
      await pm.dashboardSetting.hoverVariableDependencyChip(varB);
      await expect(
        pm.dashboardSetting.getDependencyTooltipText(`Depends on: ${varA}`)
      ).toBeVisible({ timeout: 5000 });

      testLogger.info("Cleaning up dashboard", { dashboardName });
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "should show the no-variables empty state and its CTA opens the Add Variable form",
    { tag: ["@dashboardSettings", "@dashboards", "@dashboardVariables", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = `Dashboard_EmptyVars_${Date.now()}`;

      testLogger.info("Creating empty dashboard for empty-state check", { dashboardName });
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.openVariables();

      // Fresh dashboard -> "no variables yet" empty state (after getDashboardData resolves).
      await expect(pm.dashboardSetting.getVariablesEmptyState()).toBeVisible({
        timeout: 15000,
      });

      // The empty-state CTA opens the Add Variable form (type select renders).
      await pm.dashboardSetting.clickVariablesEmptyStateCta();
      await expect(pm.dashboardSetting.getVariableTypeSelect()).toBeVisible({
        timeout: 10000,
      });

      testLogger.info("Cleaning up dashboard", { dashboardName });
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
      testLogger.info("Test completed");
    }
  );

  test(
    "should show panel-count badge 0 on an empty tab and 1 after adding a panel",
    { tag: ["@dashboardSettings", "@dashboards", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = `Dashboard_TabBadge_${Date.now()}`;

      testLogger.info("Creating dashboard for tab badge", { dashboardName });
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();

      // On the view header, the default tab badge shows 0 (no panels yet).
      const badge = pm.dashboardPage.getTabPanelCountBadge("default");
      await expect(badge).toBeVisible({ timeout: 10000 });
      await expect(badge).toHaveText("0");

      // Add a panel -> badge increments to 1.
      await addSimplePanel(pm, `Panel_${Date.now()}`, {
        streamName: "e2e_automate",
        yAxisField: "kubernetes_pod_name",
      });
      await expect(badge).toHaveText("1", { timeout: 30000 });

      testLogger.info("Cleaning up dashboard", { dashboardName });
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
      testLogger.info("Test completed");
    }
  );
});
