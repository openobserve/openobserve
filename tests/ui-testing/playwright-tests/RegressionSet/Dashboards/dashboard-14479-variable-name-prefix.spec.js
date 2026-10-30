/**
 * Dashboard Variables - Names Sharing a Prefix
 *
 * PR #14479: fix(dashboards): resolve variables sharing a name prefix
 *
 * Before the fix, placeholder tokens were replaced as plain substrings in
 * variable definition order, so `$env_region` resolved as `<env value>_region`
 * whenever `env` was defined first. The same flaw made the built-in `$__range`
 * eat `$__range_s` / `$__range_ms`, rendering them as `30m_s` / `30m_ms`.
 *
 * These tests pin the resolver contract end to end:
 *   A. HTML panel content (processVariableContent)
 *   B. Panel SQL queries + built-in range variables (usePanelVariableSubstitution)
 */

const { test, expect, navigateToBase } = require("../../utils/enhanced-baseFixtures.js");
import { ingestion } from "../../Dashboards/utils/dashIngestion.js";
import PageManager from "../../../pages/page-manager.js";
import { setupTestDashboard, cleanupTestDashboard } from "../../Dashboards/utils/dashCreation.js";
const { safeWaitForNetworkIdle } = require("../../utils/wait-helpers.js");
const testLogger = require("../../utils/test-logger.js");

// The colliding pair: SHORT_VAR is defined first on purpose, because definition
// order is what used to decide the (wrong) winner.
const SHORT_VAR = "env";
const SHORT_VALUE = "prod";
const LONG_VAR = "env_region";
const LONG_VALUE = "useast1";
// What a prefix-greedy resolver produced for $env_region.
const COLLIDED_VALUE = `${SHORT_VALUE}_region`;

const PREFIX_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <p data-test="prefix-short">$${SHORT_VAR}</p>
    <p data-test="prefix-long">$${LONG_VAR}</p>
  </body>
</html>`;

const ALL_SYNTAX_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <p data-test="prefix-bare">$${LONG_VAR}</p>
    <p data-test="prefix-braced">\${${LONG_VAR}}</p>
    <p data-test="prefix-mustache">{{${LONG_VAR}}}</p>
  </body>
</html>`;

const LITERAL_SUFFIX_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <p data-test="literal-suffix">$${SHORT_VAR}-api</p>
  </body>
</html>`;

const NESTED_HTML_SNIPPET = `<!DOCTYPE html>
<html>
  <body>
    <p data-test="nested-value">$alpha</p>
  </body>
</html>`;

const BASE_SELECT = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_pod_name) as "y_axis_1" FROM "e2e_automate"`;
const BASE_TAIL = `GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

test.describe.configure({ mode: "parallel" });

// Close the settings drawer and land back on the variables tab; the add-variable
// form handles one variable per open, so each extra variable needs a reopen.
async function reopenSettingsVariables(page, pm) {
  const scopedVars = pm.dashboardVariablesScoped;
  await pm.dashboardSetting.closeSettingWindow();
  await scopedVars
    .getSettingsDrawerLocator()
    .waitFor({ state: "hidden", timeout: 5000 });
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.openVariables();
  await scopedVars
    .getAddVariableBtnLocator()
    .waitFor({ state: "visible", timeout: 10000 });
}

async function createDashboardWithConstants(page, pm, dashboardName, constants) {
  const scopedVars = pm.dashboardVariablesScoped;

  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.openVariables();

  for (let i = 0; i < constants.length; i++) {
    const [name, value] = constants[i];
    await scopedVars.addConstantVariable(name, value, { scope: "global" });
    if (i < constants.length - 1) {
      await scopedVars.waitForEditVariableBtnVisible(name);
      await reopenSettingsVariables(page, pm);
    }
  }

  await pm.dashboardSetting.closeSettingWindow();
  await scopedVars.waitForDialogHidden({ timeout: 5000 });

  for (const [name] of constants) {
    await scopedVars.waitForVariableSelectorVisible(name, { timeout: 20000 });
  }
}

async function addHtmlPanel(pm, snippet) {
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("html");
  await pm.dashboardTimeRefresh.setRelative("30", "m");
  await pm.dashboardVariables.clickHtmlEditor();
  await pm.dashboardVariables.fillHtmlEditor(snippet);
}

// Build a line panel whose custom SQL is `BASE_SELECT WHERE <where> BASE_TAIL`,
// run it, and return the substituted query the Query Inspector reports.
async function getExecutedQueryForWhere(page, pm, whereClause) {
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType("line");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
  await pm.dashboardTimeRefresh.setRelative("30", "m");

  await pm.chartTypeSelector.clickSqlQueryType();
  await pm.chartTypeSelector.clickCustomQueryType();

  // Aliases match the auto-generated query so the x/y field mapping survives the
  // switch into custom-query mode. setDashboardPanelQuery writes straight into
  // the reactive schema, so Monaco's auto-closing pairs cannot mangle `{{ }}`.
  await pm.dashboardPage.setDashboardPanelQuery(
    `${BASE_SELECT} WHERE ${whereClause} ${BASE_TAIL}`
  );

  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
  await safeWaitForNetworkIdle(page, { timeout: 5000 });

  await pm.dashboardPanelEdit.dataViewQueryInspectorBtn.click();
  const executedQuery = pm.dashboardPanelEdit.getExecutedQuery(0);
  await executedQuery.waitFor({ state: "visible", timeout: 15000 });
  const raw = await executedQuery.textContent();
  testLogger.info("Executed query from Query Inspector", { raw });

  await pm.dashboardPanelEdit.queryInspectorCloseBtn.click();
  await executedQuery.waitFor({ state: "hidden", timeout: 5000 });
  // The inspector colorizes the SQL, so the DOM text carries non-breaking spaces
  // and zero-width separators between tokens; collapse them to plain spaces.
  return raw.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

// ============================================================================
// A. HTML panel content (processVariableContent)
// ============================================================================
test.describe(
  "A - Prefix-colliding variables in HTML panels",
  {
    tag: [
      "@dashboards",
      "@dashboardVariables",
      "@regression",
      "@dashboardRegression",
      "@bug-14479",
    ],
  },
  () => {
    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      await ingestion(page);
    });

    test(
      "1-should resolve $env_region to its own value when $env is defined first",
      { tag: ["@bug-14479", "@smoke", "@P0"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixHtml_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-html");

        await createDashboardWithConstants(page, pm, dashboardName, [
          [SHORT_VAR, SHORT_VALUE],
          [LONG_VAR, LONG_VALUE],
        ]);

        await addHtmlPanel(pm, PREFIX_HTML_SNIPPET);

        await expect(
          pm.dashboardVariables.getHtmlContentLocator("prefix-long")
        ).toHaveText(LONG_VALUE, { timeout: 15000 });
        await expect(
          pm.dashboardVariables.getHtmlContentLocator("prefix-short")
        ).toHaveText(SHORT_VALUE);

        const rendered = await pm.dashboardVariables
          .getHtmlContentLocator("html-renderer")
          .textContent();
        expect(rendered).not.toContain(COLLIDED_VALUE);

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "2-should resolve both names regardless of variable definition order",
      { tag: ["@bug-14479", "@functional", "@P0"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixOrder_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-order");

        // Reverse of test 1: the longer name is defined first.
        await createDashboardWithConstants(page, pm, dashboardName, [
          [LONG_VAR, LONG_VALUE],
          [SHORT_VAR, SHORT_VALUE],
        ]);

        await addHtmlPanel(pm, PREFIX_HTML_SNIPPET);

        await expect(
          pm.dashboardVariables.getHtmlContentLocator("prefix-long")
        ).toHaveText(LONG_VALUE, { timeout: 15000 });
        await expect(
          pm.dashboardVariables.getHtmlContentLocator("prefix-short")
        ).toHaveText(SHORT_VALUE);

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "3-should resolve bare, braced and mustache forms of the longer name alike",
      { tag: ["@bug-14479", "@functional", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixSyntax_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-syntax");

        await createDashboardWithConstants(page, pm, dashboardName, [
          [SHORT_VAR, SHORT_VALUE],
          [LONG_VAR, LONG_VALUE],
        ]);

        await addHtmlPanel(pm, ALL_SYNTAX_HTML_SNIPPET);

        for (const dataTest of [
          "prefix-bare",
          "prefix-braced",
          "prefix-mustache",
        ]) {
          await expect(
            pm.dashboardVariables.getHtmlContentLocator(dataTest)
          ).toHaveText(LONG_VALUE, { timeout: 15000 });
        }

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "4-should keep a literal suffix after $env when no longer variable matches",
      { tag: ["@bug-14479", "@functional", "@P1"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixLiteral_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-literal");

        await createDashboardWithConstants(page, pm, dashboardName, [
          [SHORT_VAR, SHORT_VALUE],
          [LONG_VAR, LONG_VALUE],
        ]);

        await addHtmlPanel(pm, LITERAL_SUFFIX_HTML_SNIPPET);

        // Backward compatibility: `$env-api` still means `<env>-api`; it is not
        // left unresolved just because a longer `env_region` exists.
        await expect(
          pm.dashboardVariables.getHtmlContentLocator("literal-suffix")
        ).toHaveText(`${SHORT_VALUE}-api`, { timeout: 15000 });

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "5-should not re-scan a substituted value for further placeholders",
      { tag: ["@bug-14479", "@functional", "@P2"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixNoRescan_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-norescan");

        await createDashboardWithConstants(page, pm, dashboardName, [
          ["alpha", "$beta"],
          ["beta", "resolved"],
        ]);

        await addHtmlPanel(pm, NESTED_HTML_SNIPPET);

        // Single-pass resolution: `$alpha` yields the literal `$beta`; it is not
        // expanded a second time into `resolved`.
        await expect(
          pm.dashboardVariables.getHtmlContentLocator("nested-value")
        ).toHaveText("$beta", { timeout: 15000 });

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );
  }
);

// ============================================================================
// B. Panel queries and built-in range variables (usePanelVariableSubstitution)
// ============================================================================
test.describe(
  "B - Prefix-colliding variables in panel queries",
  {
    tag: [
      "@dashboards",
      "@dashboardVariables",
      "@regression",
      "@dashboardRegression",
      "@bug-14479",
    ],
  },
  () => {
    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      await ingestion(page);
    });

    test(
      "6-should substitute $env and $env_region independently in a panel query",
      { tag: ["@bug-14479", "@smoke", "@P0"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixSql_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-sql");

        await createDashboardWithConstants(page, pm, dashboardName, [
          [SHORT_VAR, SHORT_VALUE],
          [LONG_VAR, LONG_VALUE],
        ]);

        const executedQuery = await getExecutedQueryForWhere(
          page,
          pm,
          `kubernetes_namespace_name != '$${SHORT_VAR}' ` +
            `AND kubernetes_pod_name != '$${LONG_VAR}' ` +
            `AND kubernetes_container_name != '\${${LONG_VAR}}' ` +
            `AND kubernetes_host != '{{${LONG_VAR}}}'`
        );

        expect(executedQuery).toContain(
          `kubernetes_namespace_name != '${SHORT_VALUE}'`
        );
        expect(executedQuery).toContain(
          `kubernetes_pod_name != '${LONG_VALUE}'`
        );
        expect(executedQuery).toContain(
          `kubernetes_container_name != '${LONG_VALUE}'`
        );
        expect(executedQuery).toContain(`kubernetes_host != '${LONG_VALUE}'`);
        expect(executedQuery).not.toContain(COLLIDED_VALUE);

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );

    test(
      "7-should substitute $__range, $__range_s and $__range_ms independently",
      { tag: ["@bug-14479", "@smoke", "@P0"] },
      async ({ page }) => {
        const pm = new PageManager(page);
        const dashboardName = `Dash_PrefixRange_${Date.now()}`;
        const panelName =
          pm.dashboardPanelActions.generateUniquePanelName("prefix-range");

        await setupTestDashboard(page, pm, dashboardName);

        const executedQuery = await getExecutedQueryForWhere(
          page,
          pm,
          `kubernetes_namespace_name != '$__range' ` +
            `AND kubernetes_pod_name != '$__range_s' ` +
            `AND kubernetes_container_name != '$__range_ms'`
        );

        // `$__range` is a duration string; `_s` / `_ms` are plain numbers. Exact
        // values drift with the clock, so assert the shape, not the digits.
        expect(executedQuery).toMatch(
          /kubernetes_namespace_name != '\d+[smhdwy]/
        );
        expect(executedQuery).toMatch(/kubernetes_pod_name != '\d+'/);
        expect(executedQuery).toMatch(/kubernetes_container_name != '\d+'/);

        // The old resolver let `$__range` swallow the longer names, leaving
        // `30m_s` / `30m_ms` behind.
        expect(executedQuery).not.toMatch(/'[^']*m_s'/);
        expect(executedQuery).not.toMatch(/'[^']*m_ms'/);
        expect(executedQuery).not.toContain("$__range");

        await pm.dashboardPanelActions.addPanelName(panelName);
        await pm.dashboardPanelActions.savePanel();
        await cleanupTestDashboard(page, pm, dashboardName);
      }
    );
  }
);
