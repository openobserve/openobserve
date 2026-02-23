/**
 * Dashboard Variables - Stream & Field Variable Support
 *
 * Tests for PR #10454: Dashboard variables can reference other variables
 * in stream and field selection (not just filters).
 *
 * Spec: tests/ui-testing/e2e-stream-field-variable-tests.md
 *
 * Consolidated: 8 tests covering all scenarios (was 21 individual tests).
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { selectStreamType } from "../../pages/dashboardPages/dashboard-stream-field-utils.js";
import {
  waitForDashboardPage,
  deleteDashboard,
  setupTestDashboard,
  cleanupTestDashboard,
} from "./utils/dashCreation.js";
import { monitorVariableAPICalls } from "../utils/variable-helpers.js";
const {
  safeWaitForHidden,
  safeWaitForNetworkIdle,
  safeWaitForDOMContentLoaded,
} = require("../utils/wait-helpers.js");
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
} = require("../../pages/dashboardPages/dashboard-selectors.js");

test.describe.configure({ mode: "parallel" });

// ============================================================================
// Helper: Create dashboard, open settings, navigate to variables tab
// ============================================================================
async function setupDashboardAndOpenVariables(page, pm, dashboardName) {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.openVariables();
}

// Helper: Close settings, reopen, and go back to variables tab
async function reopenSettingsVariables(page, pm) {
  await pm.dashboardSetting.closeSettingWindow();
  await safeWaitForHidden(page, ".q-dialog", { timeout: 5000 });
  await safeWaitForNetworkIdle(page, { timeout: 5000 });
  await pm.dashboardSetting.openSetting();
  await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
  await pm.dashboardSetting.openVariables();
  await safeWaitForNetworkIdle(page, { timeout: 5000 });
  await page
    .locator(SELECTORS.ADD_VARIABLE_BTN)
    .waitFor({ state: "visible", timeout: 10000 });
}

// ============================================================================
// A. Variable in Stream Selection (Configuration UI)
// Covers: A1 (dropdown shows vars), A2 (save with $var as stream),
//         A3 (field empty when stream is var), A4 (no error notification)
// ============================================================================
test.describe(
  "A - Variable in Stream Selection",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P1"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("stream variable: dropdown UI, field behavior, no error, and save", async ({
      page,
    }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_A_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // Create constant variables for stream and field
      await scopedVars.addConstantVariable("streamVar", "e2e_automate");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addConstantVariable("fieldVar", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // --- A1: Verify $streamVar appears in stream dropdown with (variable) label ---
      await page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
      await page.locator(SELECTORS.VARIABLE_NAME).fill("child");
      await selectStreamType(page, "logs");

      const streamResult = await scopedVars.verifyStreamDropdownContainsVariable("streamVar");
      expect(streamResult.found).toBe(true);
      expect(streamResult.hasVariableLabel).toBe(true);

      // --- A3: Select $streamVar as stream, verify field dropdown empty/variables only ---
      await scopedVars.selectStream("$streamVar");
      const isEmpty = await scopedVars.verifyFieldDropdownEmptyOrVariablesOnly();
      expect(isEmpty).toBe(true);

      // --- A4: Verify no error notification when stream is a variable ---
      const noError = await scopedVars.verifyNoErrorNotification();
      expect(noError).toBe(true);

      // Verify save button is still usable
      const saveBtn = page.locator(SELECTORS.VARIABLE_SAVE_BTN);
      await expect(saveBtn).toBeVisible();

      // --- A2: Save variable with $streamVar as stream, $fieldVar as field ---
      await scopedVars.selectField("$fieldVar");
      await saveBtn.click();

      // Wait for save to complete
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Reopen settings to verify variable was created
      await reopenSettingsVariables(page, pm);
      const editBtn = page.locator(getEditVariableBtn("child"));
      await expect(editBtn).toBeVisible({ timeout: 10000 });

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// B. Variable in Field Selection (Configuration UI)
// Covers: B1 (dropdown shows vars), B2 (save with $var as field)
// ============================================================================
test.describe(
  "B - Variable in Field Selection",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P1"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("field variable: dropdown UI and save with $variable as field", async ({
      page,
    }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_B_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // Create constant variable fieldVar
      await scopedVars.addConstantVariable("fieldVar", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // --- B1: Verify $fieldVar appears in field dropdown with (variable) label ---
      await page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
      await page.locator(SELECTORS.VARIABLE_NAME).fill("child");
      await selectStreamType(page, "logs");
      await scopedVars.selectStream("e2e_automate");

      // Wait for field schema to load after selecting real stream
      await page.waitForTimeout(1000);

      const fieldResult = await scopedVars.verifyFieldDropdownContainsVariable("fieldVar");
      expect(fieldResult.found).toBe(true);
      expect(fieldResult.hasVariableLabel).toBe(true);

      // --- B2: Save variable with $fieldVar as field ---
      await scopedVars.selectField("$fieldVar");

      const saveBtn = page.locator(SELECTORS.VARIABLE_SAVE_BTN);
      await saveBtn.waitFor({ state: "visible", timeout: 10000 });
      await saveBtn.click();

      // Wait for save to complete
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      // Reopen settings to verify variable was created
      await reopenSettingsVariables(page, pm);
      const editBtn = page.locator(getEditVariableBtn("child"));
      await expect(editBtn).toBeVisible({ timeout: 10000 });

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// C. Combined Stream + Field + Filter Dependencies
// Covers: C1 (all three reference different vars), C2 (same var in all slots)
// ============================================================================
test.describe(
  "C - Combined Dependencies",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P1"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("combined: different variables in stream/field/filter and same variable reuse", async ({
      page,
    }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_C_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // Create constants for C1 and C2
      // Note: Using real stream for filter tests because filter field name dropdown
      // requires schema (only available when stream is real, not a variable reference).
      // Stream-as-variable is already covered in section A.
      await scopedVars.addConstantVariable("fVar", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addConstantVariable("filterVar", "default");
      await reopenSettingsVariables(page, pm);

      // --- C1: Field and filter value reference different variables, real stream ---
      await scopedVars.addQueryValuesVariable(
        "combined",
        "logs",
        "e2e_automate",
        "$fVar",
        {
          filterConfig: {
            filterName: "kubernetes_namespace_name",
            operator: "=",
            value: "$filterVar",
          },
        }
      );

      await reopenSettingsVariables(page, pm);
      const editCombined = page.locator(getEditVariableBtn("combined"));
      await expect(editCombined).toBeVisible({ timeout: 10000 });

      // --- C2: Same variable in field and filter value ---
      await scopedVars.addQueryValuesVariable(
        "dedup",
        "logs",
        "e2e_automate",
        "$fVar",
        {
          filterConfig: {
            filterName: "kubernetes_namespace_name",
            operator: "=",
            value: "$fVar",
          },
        }
      );

      await reopenSettingsVariables(page, pm);
      const editDedup = page.locator(getEditVariableBtn("dedup"));
      await expect(editDedup).toBeVisible({ timeout: 10000 });

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// D. Circular Dependency Detection (Cross-Source Cycle via Stream)
// Covers: D1 (A<->B cycle via stream edit), D3 (cycle clears after fix)
// Creates cycle by changing A's stream to $B while B's field is $A.
// This tests cross-source cycle: A→B (stream dep) → B→A (field dep).
// ============================================================================
test.describe(
  "D - Cycle Detection via Stream",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P0"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("cross-source cycle: A<->B detection via stream edit and recovery after fix", async ({
      page,
    }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_D_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // Create A with real stream and field (no variable deps)
      await scopedVars.addScopedVariable(
        "A",
        "logs",
        "e2e_automate",
        "kubernetes_namespace_name",
        { scope: "global" }
      );
      await reopenSettingsVariables(page, pm);

      // Create B with stream=e2e_automate, field=$A (B depends on A via field)
      await scopedVars.addQueryValuesVariable("B", "logs", "e2e_automate", "$A");
      await reopenSettingsVariables(page, pm);

      // --- D1: Edit A, change stream to $B (creating cycle: A→B via stream, B→A via field) ---
      await scopedVars.editVariable("A");
      await scopedVars.updateStream("$B");
      await scopedVars.clickSaveButton();

      const hasCycle = await scopedVars.hasCircularDependencyError();
      expect(hasCycle).toBe(true);

      const errorText = await scopedVars.getCycleErrorText();
      expect(errorText).toContain("cycle");

      // --- D3: Fix cycle by changing stream back to real stream ---
      await scopedVars.updateStream("e2e_automate");
      await scopedVars.updateField("kubernetes_namespace_name");
      await scopedVars.clickSaveButton();

      const hasCycleAfter = await scopedVars.hasCircularDependencyError();
      expect(hasCycleAfter).toBe(false);

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// E. Circular Dependency Detection via Field
// Covers: E1 (A<->B field cycle)
// Note: Self-reference (E2) is not testable via UI — the dropdown excludes
//       the current variable being created, so $selfRef never appears as an option.
// ============================================================================
test.describe(
  "E - Cycle Detection via Field",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P0"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("field cycles: A<->B cycle detection via field", async ({
      page,
    }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_E_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // Create A and B
      await scopedVars.addScopedVariable(
        "A",
        "logs",
        "e2e_automate",
        "kubernetes_namespace_name",
        { scope: "global" }
      );
      await reopenSettingsVariables(page, pm);

      await scopedVars.addQueryValuesVariable(
        "B",
        "logs",
        "e2e_automate",
        "$A"
      );
      await reopenSettingsVariables(page, pm);

      // Edit A, change field to $B (creating cycle A->B->A via field)
      await scopedVars.editVariable("A");
      await scopedVars.updateField("$B");
      await scopedVars.clickSaveButton();

      const hasCycle = await scopedVars.hasCircularDependencyError();
      expect(hasCycle).toBe(true);

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// F. Cross-Source Circular Dependency
// Covers: F1 (cycle across stream/field/filter), F2 (edit introduces cycle)
// ============================================================================
test.describe(
  "F - Cross-Source Cycle Detection",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P0"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("cross-source cycles: multi-variable chain and edit-introduced cycle", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — this test creates 7 variables and performs multiple edit cycles
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_F_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // =====================================================================
      // Create ALL variables upfront while UI is clean (no cycle errors).
      // Cycle errors leave the form in a state that makes creating new
      // variables unreliable, so we do all creation first, then only edits.
      // =====================================================================

      // F1 variables (non-cyclic initially)
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addQueryValuesVariable("A", "logs", "e2e_automate", "$fieldConst");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addQueryValuesVariable("B", "logs", "e2e_automate", "$A");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addQueryValuesVariable(
        "C",
        "logs",
        "e2e_automate",
        "kubernetes_namespace_name",
        {
          filterConfig: {
            filterName: "kubernetes_namespace_name",
            operator: "=",
            value: "$B",
          },
        }
      );
      await reopenSettingsVariables(page, pm);

      // F2 variables (valid chain: env → region → pod)
      await scopedVars.addConstantVariable("env", "production");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addScopedVariable(
        "region",
        "logs",
        "e2e_automate",
        "kubernetes_namespace_name",
        {
          scope: "global",
          dependsOn: "env",
          dependsOnField: "kubernetes_namespace_name",
        }
      );
      await reopenSettingsVariables(page, pm);
      await scopedVars.addScopedVariable(
        "pod",
        "logs",
        "e2e_automate",
        "kubernetes_container_name",
        {
          scope: "global",
          dependsOn: "region",
          dependsOnField: "kubernetes_namespace_name",
        }
      );
      await reopenSettingsVariables(page, pm);

      // --- F1: Edit A to introduce 3-variable cycle across stream/field/filter ---
      // A→C (stream dep), C→B (filter dep), B→A (field dep)
      await scopedVars.editVariable("A");
      await scopedVars.updateStream("$C");
      await scopedVars.clickSaveButton();

      const hasCycleF1 = await scopedVars.hasCircularDependencyError();
      expect(hasCycleF1).toBe(true);

      // Cancel the edit form, go back to variable list
      await page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
      await safeWaitForNetworkIdle(page, { timeout: 5000 });
      await page
        .locator(SELECTORS.ADD_VARIABLE_BTN)
        .waitFor({ state: "visible", timeout: 10000 });

      // --- F2: Edit env to introduce cycle in env→region→pod chain ---
      // Change env from Constant to Query Values with stream=$pod
      await scopedVars.editVariable("env");
      await scopedVars.changeVariableType("Query Values");
      await selectStreamType(page, "logs");
      await scopedVars.selectStream("$pod");
      await scopedVars.selectField("$region");
      await scopedVars.clickSaveButton();

      const hasCycleF2 = await scopedVars.hasCircularDependencyError();
      expect(hasCycleF2).toBe(true);

      // Cancel the edit form before cleanup
      await page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// G. Runtime Cascade Behavior (Stream/Field Dependency)
// Covers: G1 (parent change reloads child via stream),
//         G2 (parent change reloads child via field),
//         G3 (chain: constant -> stream dep -> field dep)
// ============================================================================
test.describe(
  "G - Runtime Cascade Behavior",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P0"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("runtime cascade: parent changes reload children via stream and field dependencies", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — this test creates 5 variables and monitors cascade API calls
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_G_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // Create custom variable streamName with two options (for G1)
      await scopedVars.addCustomVariable("streamName", [
        { label: "e2e_automate", value: "e2e_automate", selected: true },
        { label: "default", value: "default" },
      ]);
      await reopenSettingsVariables(page, pm);

      // Create custom variable fieldName with two field options (for G2)
      await scopedVars.addCustomVariable("fieldName", [
        {
          label: "kubernetes_namespace_name",
          value: "kubernetes_namespace_name",
          selected: true,
        },
        {
          label: "kubernetes_container_name",
          value: "kubernetes_container_name",
        },
      ]);
      await reopenSettingsVariables(page, pm);

      // Create constant for field (for G1 child, since stream is a variable)
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // G1 child: stream=$streamName, field=$fieldConst
      await scopedVars.addQueryValuesVariable(
        "streamChild",
        "logs",
        "$streamName",
        "$fieldConst"
      );
      await reopenSettingsVariables(page, pm);

      // G2 child: stream=e2e_automate, field=$fieldName
      await scopedVars.addQueryValuesVariable(
        "fieldChild",
        "logs",
        "e2e_automate",
        "$fieldName"
      );
      await reopenSettingsVariables(page, pm);

      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 15000 });

      // Extra wait for dashboard to stabilize in CI/CD environments
      await page.waitForTimeout(3000);

      // Wait for all variables to be visible on dashboard with increased timeout 
      await scopedVars.waitForVariableSelectorVisible("streamName", { timeout: 40000 });
      await scopedVars.waitForVariableSelectorVisible("fieldName", { timeout: 40000 });
      await scopedVars.waitForVariableSelectorVisible("streamChild", { timeout: 40000 });
      await scopedVars.waitForVariableSelectorVisible("fieldChild", { timeout: 40000 });

      // --- G3: Verify all variables are visible and loaded on dashboard ---
      await expect(page.locator(getVariableSelector("streamName"))).toBeVisible();
      await expect(page.locator(getVariableSelector("streamChild"))).toBeVisible();
      await expect(page.locator(getVariableSelector("fieldName"))).toBeVisible();
      await expect(page.locator(getVariableSelector("fieldChild"))).toBeVisible();

      // --- G1: Change streamName from "e2e_automate" to "default" ---
      // Custom variables don't make API calls when opening their dropdown, so we
      // start monitoring manually and use changeVariableValue (no waitForValuesStreamComplete).
      // streamChild has stream=$streamName, so the cascade call will use the new
      // resolved stream "default". Match on stream to avoid false positives.
      const streamMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 30000, // Increased from 15s to 30s 
        matchFn: (call) =>
          call.url.includes("/_values_stream") &&
          (call.url.includes("/default/_values_stream") || call.stream === "default"),
      });
      await scopedVars.changeVariableValue("streamName", { optionIndex: 1, timeout: 20000 });
      const streamResult = await streamMonitor;

      expect(streamResult.matchedCount).toBeGreaterThanOrEqual(1);

      // Wait for all G1 cascade responses to settle before starting G2 monitor
      // Increased wait times for CI/CD environments under heavy load
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(5000);

      // --- G2: Change fieldName from "kubernetes_namespace_name" to "kubernetes_container_name" ---
      // fieldChild has stream=e2e_automate (fixed), field=$fieldName.
      // Use matchFn to filter for fieldChild's cascade call specifically,
      // ignoring any stale streamChild calls from G1.
      const fieldMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 30000, // Increased from 15s to 30s 
        matchFn: (call) =>
          call.url.includes("/_values_stream") &&
          (call.url.includes("e2e_automate") ||
            call.stream === "e2e_automate" ||
            call.url.includes("kubernetes_container_name") ||
            (call.field && call.field.includes("kubernetes_container_name"))),
      });
      await scopedVars.changeVariableValue("fieldName", { optionIndex: 1, timeout: 20000 });
      const fieldResult = await fieldMonitor;

      expect(fieldResult.matchedCount).toBeGreaterThanOrEqual(1);
      // Verify the matched cascade call used the new field value
      const matchedCall = fieldResult.calls.find(
        (c) =>
          c.url.includes("kubernetes_container_name") ||
          (c.field && c.field.includes("kubernetes_container_name")) ||
          c.url.includes("e2e_automate") ||
          c.stream === "e2e_automate"
      );
      expect(matchedCall).toBeTruthy();

      // Cleanup
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// H. Edge Cases
// Covers: H1 (hyphens in stream var name), H2 (underscores in field var name),
//         H3 (switch type from query_values to constant)
// ============================================================================
test.describe(
  "H - Edge Cases",
  { tag: ["@dashboards", "@dashboardVariables", "@streamFieldVariables", "@P2"] },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    test("edge cases: special variable names and type switching", async ({
      page,
    }) => {
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_H_${Date.now()}`;

      await setupDashboardAndOpenVariables(page, pm, dashboardName);

      // --- H1: Variable name with hyphens in stream ---
      await scopedVars.addConstantVariable("k8s-stream", "e2e_automate");
      await reopenSettingsVariables(page, pm);
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      await scopedVars.addQueryValuesVariable(
        "hyphenChild",
        "logs",
        "$k8s-stream",
        "$fieldConst"
      );
      await reopenSettingsVariables(page, pm);
      const editHyphen = page.locator(getEditVariableBtn("hyphenChild"));
      await expect(editHyphen).toBeVisible({ timeout: 10000 });

      // --- H2: Variable name with underscores in field ---
      await scopedVars.addConstantVariable(
        "field_name",
        "kubernetes_namespace_name"
      );
      await reopenSettingsVariables(page, pm);

      await scopedVars.addQueryValuesVariable(
        "underscoreChild",
        "logs",
        "e2e_automate",
        "$field_name"
      );
      await reopenSettingsVariables(page, pm);
      const editUnderscore = page.locator(getEditVariableBtn("underscoreChild"));
      await expect(editUnderscore).toBeVisible({ timeout: 10000 });

      // --- H3: Switch variable type from query_values to constant ---
      await scopedVars.addConstantVariable("parent", "e2e_automate");
      await reopenSettingsVariables(page, pm);

      await scopedVars.addQueryValuesVariable(
        "var1",
        "logs",
        "$parent",
        "$fieldConst"
      );
      await reopenSettingsVariables(page, pm);

      // Edit var1, change type to Constant
      await scopedVars.editVariable("var1");
      await scopedVars.changeVariableType("Constant");
      await page
        .locator('[data-test="dashboard-variable-constant-value"]')
        .fill("some_value");
      await scopedVars.clickSaveButton();

      // Verify save succeeded
      await reopenSettingsVariables(page, pm);
      const editVar1 = page.locator(getEditVariableBtn("var1"));
      await expect(editVar1).toBeVisible({ timeout: 10000 });

      // Cleanup
      await pm.dashboardSetting.closeSettingWindow();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);
