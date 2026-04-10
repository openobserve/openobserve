/**
 * Dashboard Variables - Mustache Syntax Support
 * Tests that {{var}} and {{var:format}} syntax works alongside existing $var / ${var} syntax
 * for variable substitution in HTML panels, SQL queries, and mixed usage.
 *
 * Also tests space-tolerant syntax: {{ var }}, ${ var }, {{ var : csv }}, etc.
 *
 * PR #11085: feat: replace variable value with mustache
 */

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import { waitForValuesStreamComplete } from "../utils/streaming-helpers.js";
const testLogger = require("../utils/test-logger.js");

// HTML snippets using mustache syntax
const MUSTACHE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="mustache-heading">Mustache Test</h1>
    <p><span id="mustache-value" style="font-weight:900;">{{variablename}}</span> rendered</p>
  </body>
</html>`;

const DOLLAR_SIGN_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="dollar-heading">Dollar Test</h1>
    <p><span id="dollar-value" style="font-weight:900;">$variablename</span> rendered</p>
  </body>
</html>`;

const MIXED_SYNTAX_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="mixed-heading">Mixed Test</h1>
    <p><span id="mustache-val">{{variablename}}</span> and <span id="dollar-val">$variablename</span></p>
  </body>
</html>`;

const UNDEFINED_MUSTACHE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <p>{{undefinedvar}} Not replaced</p>
  </body>
</html>`;

// HTML snippets using spaced syntax
const SPACED_MUSTACHE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="spaced-mustache-heading">Spaced Mustache Test</h1>
    <p><span id="spaced-mustache-value" style="font-weight:900;">{{ variablename }}</span> rendered</p>
  </body>
</html>`;

const SPACED_DOLLAR_BRACE_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="spaced-dollar-heading">Spaced Dollar-Brace Test</h1>
    <p><span id="spaced-dollar-value" style="font-weight:900;">\${ variablename }</span> rendered</p>
  </body>
</html>`;

const MIXED_SPACED_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="mixed-spaced-heading">Mixed Spaced Test</h1>
    <p><span id="spaced-val">{{ variablename }}</span> and <span id="nospace-val">{{variablename}}</span></p>
  </body>
</html>`;

const EXCESSIVE_SPACES_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <h1 data-test="excessive-spaces-heading">Excessive Spaces Test</h1>
    <p><span id="excessive-value" style="font-weight:900;">{{   variablename   }}</span> rendered</p>
  </body>
</html>`;

test.describe.configure({ mode: "parallel" });

test.describe(
  "Dashboard Variables - Mustache Syntax",
  {
    tag: [
      "@dashboards",
      "@dashboardVariables",
      "@mustache",
    ],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test(
      "Should substitute mustache {{variable}} in HTML panel",
      {
        tag: ["@mustache", "@smoke", "@P0"],
      },
      async ({ page }) => {
        testLogger.info("Testing mustache variable substitution in HTML panel");

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_Mustache_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("mustache-html");

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with mustache syntax
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(MUSTACHE_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", { name: "Mustache Test" })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify the mustache variable was substituted with the selected value
        await expect(
          page
            .locator('[data-test="html-renderer"]')
            .getByText("controller")
        ).toBeVisible();

        testLogger.info(
          "Mustache variable {{variablename}} substituted correctly"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should still substitute dollar-sign $variable in HTML panel (backward compat)",
      {
        tag: ["@mustache", "@smoke", "@P0"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing dollar-sign variable still works (backward compat)"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_Dollar_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("dollar-html");

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with dollar-sign syntax
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(DOLLAR_SIGN_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", { name: "Dollar Test" })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify the dollar-sign variable was substituted with the selected value
        await expect(
          page
            .locator('[data-test="html-renderer"]')
            .getByText("controller")
        ).toBeVisible();

        testLogger.info(
          "Dollar-sign variable $variablename still substitutes correctly"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should substitute both mustache and dollar-sign variables in same HTML panel",
      {
        tag: ["@mustache", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing mixed mustache and dollar-sign syntax in same panel"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_Mixed_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("mixed-html");

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with mixed syntax
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(MIXED_SYNTAX_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", { name: "Mixed Test" })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify both mustache and dollar-sign were substituted
        // The rendered output should contain "controller and controller"
        const renderer = page.locator('[data-test="html-renderer"]');
        const renderedText = await renderer.textContent();

        // Both occurrences should be replaced with "controller"
        expect(renderedText).toContain("controller and controller");

        testLogger.info(
          "Mixed syntax substituted correctly: both {{var}} and $var resolved"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should keep undefined mustache {{variable}} placeholder unchanged in HTML panel",
      {
        tag: ["@mustache", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing undefined mustache variable remains as literal text"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_Undef_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("undef-html");

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.createDashboard(dashboardName);

        // Add an HTML panel with undefined mustache variable
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(UNDEFINED_MUSTACHE_HTML_SNIPPET);

        // Verify the undefined mustache variable remains as literal text
        await expect(
          page
            .locator('[data-test="html-renderer"]')
            .getByText("{{undefinedvar}}")
        ).toBeVisible();

        testLogger.info(
          "Undefined mustache variable {{undefinedvar}} kept as literal text"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should execute SQL query using mustache {{variable}} in custom query mode",
      {
        tag: ["@mustache", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing mustache variable substitution in custom SQL query"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_SQL_Mustache_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("sql-mustache");

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Add a panel with custom SQL query using mustache syntax
        await pm.dashboardCreate.addPanel();
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        // Switch to custom query mode
        await pm.chartTypeSelector.switchToCustomQueryMode();

        // Enter SQL query with mustache variable
        const sqlQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = '{{variablename}}' GROUP BY x_axis_1 ORDER BY x_axis_1`;

        await pm.chartTypeSelector.enterCustomSQL(sqlQuery);

        // Apply the query
        await pm.dashboardPanelActions.applyDashboardBtn();

        // Wait for the panel to render - check for chart or no-data indicator
        // The panel should attempt to render (no error state)
        await page.waitForTimeout(3000);

        // Verify no error toast or error state
        const errorToast = page.locator('.q-notification--standard').filter({ hasText: /error/i });
        const errorCount = await errorToast.count();

        // We expect no errors since the mustache variable should be substituted
        expect(errorCount).toBe(0);

        testLogger.info(
          "SQL query with mustache variable executed without errors"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should substitute mustache {{variable}} in drilldown URL when triggered",
      {
        tag: ["@mustache", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing mustache variable substitution in drilldown URL"
        );

        const pm = new PageManager(page);
        const dashboardName = generateDashboardName();

        // Create dashboard with a variable
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable and select a value
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        const valuesStreamPromise = waitForValuesStreamComplete(page);
        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );
        await valuesStreamPromise;

        // Create a table panel with config sidebar open
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField(
          "kubernetes_container_hash",
          "y"
        );
        await pm.dashboardPanelActions.addPanelName("Drilldown Mustache Test");
        await pm.dashboardPanelActions.applyDashboardBtn();

        // Open config panel and add a URL drilldown with mustache variable
        await pm.dashboardPanelConfigs.openConfigPanel();
        await pm.dashboardDrilldown.addDrilldownByURL(
          "Mustache URL Drilldown",
          "https://openobserve.ai?filter={{variablename}}"
        );

        await expect(
          pm.dashboardDrilldown.drilldownItemAt(0)
        ).toContainText("Mustache URL Drilldown");

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();

        // Click table row to trigger drilldown
        testLogger.info(
          "Clicking table row to trigger drilldown with mustache URL"
        );
        const drilldownMenu =
          await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });

        // Click the drilldown item — should navigate to the URL with variable substituted
        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

        // Wait for navigation — the URL should contain "controller" not "{{variablename}}"
        await page.waitForURL(/openobserve\.ai/, { timeout: 15000 });
        const navigatedUrl = page.url();

        expect(navigatedUrl).toContain("filter=controller");
        expect(navigatedUrl).not.toContain("{{variablename}}");

        testLogger.info(
          "Drilldown URL substituted mustache variable correctly",
          { url: navigatedUrl }
        );

        // Navigate back to app for cleanup
        await navigateToBase(page);
        await pm.dashboardList.menuItem("dashboards-item");
        await deleteDashboard(page, dashboardName);
      }
    );
  }
);

test.describe(
  "Dashboard Variables - Space-Tolerant Syntax",
  {
    tag: [
      "@dashboards",
      "@dashboardVariables",
      "@mustache",
      "@spaceTolerant",
    ],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test(
      "Should substitute spaced mustache {{ variable }} in HTML panel",
      {
        tag: ["@spaceTolerant", "@smoke", "@P0"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing spaced mustache variable substitution in HTML panel"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_SpacedMustache_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName(
            "spaced-mustache-html"
          );

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with spaced mustache syntax {{ variablename }}
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(SPACED_MUSTACHE_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", { name: "Spaced Mustache Test" })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify the spaced mustache variable was substituted with the selected value
        await expect(
          page
            .locator('[data-test="html-renderer"]')
            .getByText("controller")
        ).toBeVisible();

        testLogger.info(
          "Spaced mustache variable {{ variablename }} substituted correctly"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should substitute spaced dollar-brace ${ variable } in HTML panel",
      {
        tag: ["@spaceTolerant", "@smoke", "@P0"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing spaced dollar-brace variable substitution in HTML panel"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_SpacedDollar_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName(
            "spaced-dollar-html"
          );

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with spaced dollar-brace syntax ${ variablename }
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(SPACED_DOLLAR_BRACE_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", {
            name: "Spaced Dollar-Brace Test",
          })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify the spaced dollar-brace variable was substituted with the selected value
        await expect(
          page
            .locator('[data-test="html-renderer"]')
            .getByText("controller")
        ).toBeVisible();

        testLogger.info(
          "Spaced dollar-brace variable ${ variablename } substituted correctly"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should substitute both spaced and non-spaced mustache variables in same HTML panel",
      {
        tag: ["@spaceTolerant", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing mixed spaced and non-spaced mustache syntax in same panel"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_MixedSpaced_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName(
            "mixed-spaced-html"
          );

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with mixed spaced/non-spaced syntax
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(MIXED_SPACED_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", { name: "Mixed Spaced Test" })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify both spaced {{ var }} and non-spaced {{var}} were substituted
        // The rendered output should contain "controller and controller"
        const renderer = page.locator('[data-test="html-renderer"]');
        const renderedText = await renderer.textContent();

        expect(renderedText).toContain("controller and controller");

        testLogger.info(
          "Mixed spaced/non-spaced syntax substituted correctly"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should execute SQL query using spaced mustache {{ variable }} in custom query mode",
      {
        tag: ["@spaceTolerant", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing spaced mustache variable substitution in custom SQL query"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_SQL_SpacedMustache_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName(
            "sql-spaced-mustache"
          );

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Add a panel with custom SQL query using spaced mustache syntax
        await pm.dashboardCreate.addPanel();
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        // Switch to custom query mode
        await pm.chartTypeSelector.switchToCustomQueryMode();

        // Enter SQL query with spaced mustache variable {{ variablename }}
        const sqlQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = '{{ variablename }}' GROUP BY x_axis_1 ORDER BY x_axis_1`;

        await pm.chartTypeSelector.enterCustomSQL(sqlQuery);

        // Apply the query
        await pm.dashboardPanelActions.applyDashboardBtn();

        // Wait for the panel to render
        await page.waitForTimeout(3000);

        // Verify no error toast or error state
        const errorToast = page
          .locator(".q-notification--standard")
          .filter({ hasText: /error/i });
        const errorCount = await errorToast.count();

        // We expect no errors since the spaced mustache variable should be normalized and substituted
        expect(errorCount).toBe(0);

        testLogger.info(
          "SQL query with spaced mustache variable {{ variablename }} executed without errors"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );

    test(
      "Should handle excessive spaces in mustache {{   variable   }} in HTML panel",
      {
        tag: ["@spaceTolerant", "@functional", "@P1"],
      },
      async ({ page }) => {
        testLogger.info(
          "Testing excessive spaces in mustache variable substitution"
        );

        const pm = new PageManager(page);
        const dashboardName = `Dashboard_ExcessSpaces_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName(
            "excessive-spaces-html"
          );

        // Navigate to dashboards and create one
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);

        await page.waitForTimeout(5000);

        // Add a variable
        await pm.dashboardSetting.openSetting();
        await pm.dashboardVariables.addDashboardVariable(
          "variablename",
          "logs",
          "e2e_automate",
          "kubernetes_container_name"
        );

        // Add an HTML panel with excessive spaces {{   variablename   }}
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("html");
        await pm.dashboardTimeRefresh.setRelative("30", "m");

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".monaco-editor")
          .click();

        await page
          .locator('[data-test="dashboard-html-editor"]')
          .locator(".inputarea")
          .fill(EXCESSIVE_SPACES_HTML_SNIPPET);

        // Verify heading renders
        await expect(
          page.getByRole("heading", {
            name: "Excessive Spaces Test",
          })
        ).toBeVisible();

        // Wait for values stream and select a value
        const valuesStreamPromise = waitForValuesStreamComplete(page);

        await pm.dashboardVariables.selectValueFromVariableDropDown(
          "variablename",
          "controller"
        );

        await valuesStreamPromise;

        // Verify the excessively-spaced mustache variable was substituted
        await expect(
          page
            .locator('[data-test="html-renderer"]')
            .getByText("controller")
        ).toBeVisible();

        testLogger.info(
          "Excessive spaces {{   variablename   }} substituted correctly"
        );

        // Save and cleanup
        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
      }
    );
  }
);
