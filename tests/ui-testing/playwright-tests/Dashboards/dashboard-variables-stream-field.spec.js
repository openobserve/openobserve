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
  reopenDashboardFromList,
  addSimplePanel,
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
  getTabSelector,
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

/**
 * Navigate from the dashboard list into a dashboard that already has panels.
 * Cannot use reopenDashboardFromList() for this because that function waits
 * for the "add panel if no panel" button which is hidden when panels exist.
 */
async function openDashboardWithPanels(page, dashboardName) {
  const dashboardRow = page
    .locator('//tr[.//div[@title="' + dashboardName + '"]]')
    .nth(0);
  await dashboardRow.locator('div[title="' + dashboardName + '"]').click();
  await page
    .locator('[data-test="dashboard-panel-container"]')
    .waitFor({ state: "visible", timeout: 20000 });
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

    test.skip("cross-source cycles: multi-variable chain and edit-introduced cycle", async ({
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

      // Click save directly — don't use clickSaveButton() which waits up to 10s for
      // the button to hide. A brief DOM rerender can trick it into thinking save
      // succeeded, masking the cycle error. For cycle detection we just need the click.
      const saveBtnF1 = page.locator(SELECTORS.VARIABLE_SAVE_BTN);
      await saveBtnF1.waitFor({ state: "visible", timeout: 10000 });
      await saveBtnF1.click();

      const hasCycleF1 = await scopedVars.hasCircularDependencyError();
      expect(hasCycleF1).toBe(true);

      // Cancel the edit form, go back to variable list
      await page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
      // Wait for edit form to close (save button hidden indicates form is gone)
      await page.locator(SELECTORS.VARIABLE_SAVE_BTN).waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
      await safeWaitForNetworkIdle(page, { timeout: 5000 });
      await page.waitForTimeout(1000); // Extra stabilization for form reset
      await page
        .locator(SELECTORS.ADD_VARIABLE_BTN)
        .waitFor({ state: "visible", timeout: 10000 });

      // --- F2: Edit env to introduce cycle in env→region→pod chain ---
      // Change env from Constant to Query Values with stream=$pod
      await scopedVars.editVariable("env");
      await scopedVars.changeVariableType("Query Values");
      // Wait for Query Values form fields to render after type change
      await page.locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT).waitFor({ state: "visible", timeout: 10000 });
      await selectStreamType(page, "logs");
      await scopedVars.selectStream("$pod");
      await scopedVars.selectField("$region");

      // Click save directly for cycle detection (same reason as F1 above)
      const saveBtnF2 = page.locator(SELECTORS.VARIABLE_SAVE_BTN);
      await saveBtnF2.waitFor({ state: "visible", timeout: 10000 });
      await saveBtnF2.click();

      const hasCycleF2 = await scopedVars.hasCircularDependencyError();
      expect(hasCycleF2).toBe(true);

      // Cancel the edit form before cleanup
      await page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
      await page.locator(SELECTORS.VARIABLE_SAVE_BTN).waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
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

    test.skip("runtime cascade: parent changes reload children via stream and field dependencies", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — creates 5 variables, fresh reload, and cascade API monitoring
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

      // Close settings and navigate away then back for a clean initial load.
      // This ensures variables are resolved from a fresh state (no leftover
      // settings-dialog state) which is the real-world usage scenario.
      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      // Reopen dashboard — this is the initial load we want to test
      await reopenDashboardFromList(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      // --- G3: Verify all variables loaded on initial fresh dashboard load ---
      await scopedVars.waitForVariableSelectorVisible("streamName", { timeout: 40000 });
      await scopedVars.waitForVariableSelectorVisible("fieldName", { timeout: 40000 });
      await scopedVars.waitForVariableSelectorVisible("streamChild", { timeout: 40000 });
      await scopedVars.waitForVariableSelectorVisible("fieldChild", { timeout: 40000 });

      await expect(page.locator(getVariableSelector("streamName"))).toBeVisible();
      await expect(page.locator(getVariableSelector("streamChild"))).toBeVisible();
      await expect(page.locator(getVariableSelector("fieldName"))).toBeVisible();
      await expect(page.locator(getVariableSelector("fieldChild"))).toBeVisible();

      // Allow all initial variable API calls to settle before cascade testing
      await safeWaitForNetworkIdle(page, { timeout: 10000 });
      await page.waitForTimeout(2000);

      // --- G1: Change streamName → "default"; streamChild must cascade-reload
      // with stream="default" (resolved, not "$streamName")
      const streamMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) =>
          call.url.includes("_values_stream") &&
          (call.url.includes("/default/") || call.stream === "default"),
      });
      await scopedVars.changeVariableValue("streamName", { optionText: "default", timeout: 25000 });
      const streamResult = await streamMonitor;

      expect(streamResult.matchedCount).toBeGreaterThanOrEqual(1);

      // Confirm the cascade call used the resolved value, not the literal "$streamName"
      const streamLiteralCall = streamResult.calls.find(
        (c) => (c.stream && c.stream.includes("$")) || (c.url && c.url.includes("%24"))
      );
      expect(streamLiteralCall).toBeUndefined();

      // Allow G1 responses to settle before G2
      await safeWaitForNetworkIdle(page, { timeout: 10000 });
      await page.waitForTimeout(3000);

      // --- G2: Change fieldName → "kubernetes_container_name"; fieldChild must reload
      // with field="kubernetes_container_name" (resolved, not "$fieldName")
      const fieldMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) =>
          call.url.includes("_values_stream") &&
          (call.url.includes("kubernetes_container_name") ||
            (call.field && call.field.includes("kubernetes_container_name"))),
      });
      await scopedVars.changeVariableValue("fieldName", {
        optionText: "kubernetes_container_name",
        timeout: 25000,
      });
      const fieldResult = await fieldMonitor;

      expect(fieldResult.matchedCount).toBeGreaterThanOrEqual(1);

      // Confirm resolved field was used, not "$fieldName"
      const fieldLiteralCall = fieldResult.calls.find(
        (c) => (c.field && c.field.includes("$")) || (c.url && c.url.includes("%24"))
      );
      expect(fieldLiteralCall).toBeUndefined();

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

// ============================================================================
// I. Cross-Scope Stream/Field Variable Substitution (View Dashboard)
//
// Regression tests for the bug where global-level constant/custom variables
// referenced as $varName in the stream or field of a tab-level or panel-level
// query_values variable were NOT being resolved in view-dashboard mode.
//
// Root cause: resolveVariableValue() in VariablesValueSelector.vue only
// searched variablesData.values (current scope), missing global variables.
//
// Fix: In manager mode, also search manager.variablesData.global (and
// manager.variablesData.tabs[tabId]) so that cross-scope references resolve.
//
// Covers:
//   I1 – Global constant used in stream of a tab-scoped query_values variable
//   I2 – Global constant used in field of a tab-scoped query_values variable
//   I3 – Global custom used in stream of a tab-scoped query_values variable
// ============================================================================
test.describe(
  "I - Cross-Scope Stream/Field Substitution (View Dashboard)",
  {
    tag: [
      "@dashboards",
      "@dashboardVariables",
      "@streamFieldVariables",
      "@crossScope",
      "@P0",
    ],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    // -------------------------------------------------------------------------
    // I1: Global constant → stream of tab-scoped query_values variable
    // -------------------------------------------------------------------------
    test("I1 - global constant in tab-level variable stream resolves correctly on view dashboard", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — navigate-away/back for clean initial load
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_I1_${Date.now()}`;

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.addTabAndWait("Tab1");

      // Global constant holds the stream name
      await scopedVars.addConstantVariable("globalStream", "e2e_automate");
      await reopenSettingsVariables(page, pm);

      // Need a field constant: when stream is a variable ref the field dropdown
      // shows only variable options (no schema is loaded), so we must use $fieldConst
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // Tab-scoped query_values variable references the global constant in stream
      await scopedVars.addScopedVariable(
        "tabChildVar",
        "logs",
        "$globalStream",
        "$fieldConst",
        { scope: "tabs", assignedTabs: ["tab1"] }
      );
      await page
        .locator(getEditVariableBtn("tabChildVar"))
        .waitFor({ state: "visible", timeout: 15000 });

      // Close settings and navigate away then back for a clean initial load.
      // This ensures variables are resolved from a fresh state (no leftover
      // settings-dialog state) which is the real-world usage scenario.
      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      // Reopen dashboard — this is the initial load we want to test
      await reopenDashboardFromList(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      // Monitor _values_stream calls while switching to Tab1
      const apiMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) => {
          const url = call.url || "";
          const stream = call.stream || "";
          const isResolvedStream =
            stream === "e2e_automate" ||
            url.includes("/e2e_automate/") ||
            url.includes("e2e_automate");
          const isLiteralRef =
            stream.includes("$") || url.includes("%24globalStream");
          return (
            url.includes("_values_stream") && isResolvedStream && !isLiteralRef
          );
        },
      });

      await page.locator(getTabSelector("Tab1")).click();
      await page
        .locator(getVariableSelector("tabChildVar"))
        .waitFor({ state: "visible", timeout: 20000 });

      const result = await apiMonitor;

      // Must have received at least one call using the resolved stream name
      expect(result.matchedCount).toBeGreaterThanOrEqual(1);

      // No call must contain the literal variable reference ($globalStream)
      const literalRefCall = result.calls.find(
        (c) =>
          (c.stream && c.stream.includes("$")) ||
          (c.url && c.url.includes("%24"))
      );
      expect(literalRefCall).toBeUndefined();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });

    // -------------------------------------------------------------------------
    // I2: Global constant → field of tab-scoped query_values variable
    // -------------------------------------------------------------------------
    test("I2 - global constant in tab-level variable field resolves correctly on view dashboard", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — navigate-away/back for clean initial load
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_I2_${Date.now()}`;

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.addTabAndWait("Tab1");

      // Global constant holds the field name
      await scopedVars.addConstantVariable(
        "globalField",
        "kubernetes_namespace_name"
      );
      await reopenSettingsVariables(page, pm);

      // Tab-scoped query_values variable references global constant in field
      await scopedVars.addScopedVariable(
        "tabFieldVar",
        "logs",
        "e2e_automate",
        "$globalField",
        { scope: "tabs", assignedTabs: ["tab1"] }
      );
      await page
        .locator(getEditVariableBtn("tabFieldVar"))
        .waitFor({ state: "visible", timeout: 15000 });

      // Close settings and navigate away then back for a clean initial load.
      // This ensures variables are resolved from a fresh state (no leftover
      // settings-dialog state) which is the real-world usage scenario.
      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      // Reopen dashboard — this is the initial load we want to test
      await reopenDashboardFromList(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      const apiMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) => {
          const url = call.url || "";
          const field = call.field || "";
          const hasResolvedField =
            field.includes("kubernetes_namespace_name") ||
            url.includes("kubernetes_namespace_name");
          const hasLiteralRef =
            field.includes("$") || url.includes("%24globalField");
          return (
            url.includes("_values_stream") && hasResolvedField && !hasLiteralRef
          );
        },
      });

      await page.locator(getTabSelector("Tab1")).click();
      await page
        .locator(getVariableSelector("tabFieldVar"))
        .waitFor({ state: "visible", timeout: 20000 });

      const result = await apiMonitor;

      expect(result.matchedCount).toBeGreaterThanOrEqual(1);

      const literalRefCall = result.calls.find(
        (c) =>
          (c.field && c.field.includes("$")) ||
          (c.url && c.url.includes("%24"))
      );
      expect(literalRefCall).toBeUndefined();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });

    // -------------------------------------------------------------------------
    // I3: Global custom variable → stream of tab-scoped query_values variable
    // -------------------------------------------------------------------------
    test("I3 - global custom variable in tab-level variable stream resolves correctly on view dashboard", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — navigate-away/back for clean initial load
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_I3_${Date.now()}`;

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.addTabAndWait("Tab1");

      // Global custom variable selecting the stream
      await scopedVars.addCustomVariable("streamSelector", [
        { label: "e2e_automate", value: "e2e_automate", selected: true },
      ]);
      await reopenSettingsVariables(page, pm);

      // Need a field constant: when stream is a variable ref the field dropdown
      // shows only variable options (no schema is loaded), so we must use $fieldConst
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // Tab-scoped query_values variable uses $streamSelector as its stream
      await scopedVars.addScopedVariable(
        "tabCustomChild",
        "logs",
        "$streamSelector",
        "$fieldConst",
        { scope: "tabs", assignedTabs: ["tab1"] }
      );
      await page
        .locator(getEditVariableBtn("tabCustomChild"))
        .waitFor({ state: "visible", timeout: 15000 });

      // Close settings and navigate away then back for a clean initial load.
      // This ensures variables are resolved from a fresh state (no leftover
      // settings-dialog state) which is the real-world usage scenario.
      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      // Reopen dashboard — this is the initial load we want to test
      await reopenDashboardFromList(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      const apiMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) => {
          const url = call.url || "";
          const stream = call.stream || "";
          const isResolvedStream =
            stream === "e2e_automate" ||
            url.includes("/e2e_automate/") ||
            url.includes("e2e_automate");
          const isLiteralRef =
            stream.includes("$") || url.includes("%24streamSelector");
          return (
            url.includes("_values_stream") && isResolvedStream && !isLiteralRef
          );
        },
      });

      await page.locator(getTabSelector("Tab1")).click();
      await page
        .locator(getVariableSelector("tabCustomChild"))
        .waitFor({ state: "visible", timeout: 20000 });

      const result = await apiMonitor;

      expect(result.matchedCount).toBeGreaterThanOrEqual(1);

      const literalRefCall = result.calls.find(
        (c) =>
          (c.stream && c.stream.includes("$")) ||
          (c.url && c.url.includes("%24"))
      );
      expect(literalRefCall).toBeUndefined();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);

// ============================================================================
// J. Cross-Scope Stream/Field Variable Substitution at Panel Level (View Dashboard)
//
// Same regression as section I but for panel-scoped variables.
// A global constant/custom variable referenced as $varName in the stream or
// field of a panel-scoped query_values variable must be resolved when the
// panel renders (initial dashboard load).
//
// Key difference from I tests:
//   - A real panel must exist before creating panel-scoped variables
//   - Panel variables load on initial dashboard render (not on tab click)
//   - API monitor starts BEFORE reopening the dashboard
//   - Uses openDashboardWithPanels() instead of reopenDashboardFromList()
//     because the "no panel" button is hidden when panels exist
//
// Covers:
//   J1 – Global constant used in stream of a panel-scoped query_values variable
//   J2 – Global constant used in field of a panel-scoped query_values variable
//   J3 – Global custom used in stream of a panel-scoped query_values variable
// ============================================================================
test.describe(
  "J - Cross-Scope Stream/Field Substitution at Panel Level (View Dashboard)",
  {
    tag: [
      "@dashboards",
      "@dashboardVariables",
      "@streamFieldVariables",
      "@crossScope",
      "@P0",
    ],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBase(page);
      await ingestion(page);
    });

    // -------------------------------------------------------------------------
    // J1: Global constant → stream of panel-scoped query_values variable
    // -------------------------------------------------------------------------
    test("J1 - global constant in panel-level variable stream resolves correctly on view dashboard", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — panel creation + navigate-away/back + API monitoring
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_J1_${Date.now()}`;

      // Create dashboard and add a panel (required to assign the panel-scoped variable to it)
      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, "TestPanel");

      // Open settings and navigate to variables tab
      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.openVariables();
      await page.locator(SELECTORS.ADD_VARIABLE_BTN).waitFor({ state: "visible", timeout: 10000 });

      // Global constant holds the stream name
      await scopedVars.addConstantVariable("globalStream", "e2e_automate");
      await reopenSettingsVariables(page, pm);

      // Field constant: when stream is a variable ref the field dropdown shows only
      // variable options (no schema loaded), so we use $fieldConst instead of a literal
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // Panel-scoped variable referencing the global constant in stream
      await scopedVars.addScopedVariable(
        "panelChildVar",
        "logs",
        "$globalStream",
        "$fieldConst",
        { scope: "panels", assignedPanels: ["TestPanel"] }
      );
      await page
        .locator(getEditVariableBtn("panelChildVar"))
        .waitFor({ state: "visible", timeout: 15000 });

      // Close settings and navigate away for a clean initial load
      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      // Start monitor BEFORE reopening — panel variables load on initial dashboard render
      const apiMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) => {
          const url = call.url || "";
          const stream = call.stream || "";
          const isResolvedStream =
            stream === "e2e_automate" ||
            url.includes("/e2e_automate/") ||
            url.includes("e2e_automate");
          const isLiteralRef =
            stream.includes("$") || url.includes("%24globalStream");
          return url.includes("_values_stream") && isResolvedStream && !isLiteralRef;
        },
      });

      // Reopen dashboard — panel variable loads when the panel renders
      await openDashboardWithPanels(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      const result = await apiMonitor;

      expect(result.matchedCount).toBeGreaterThanOrEqual(1);

      const literalRefCallJ1 = result.calls.find(
        (c) =>
          (c.stream && c.stream.includes("$")) ||
          (c.url && c.url.includes("%24"))
      );
      expect(literalRefCallJ1).toBeUndefined();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });

    // -------------------------------------------------------------------------
    // J2: Global constant → field of panel-scoped query_values variable
    // -------------------------------------------------------------------------
    test("J2 - global constant in panel-level variable field resolves correctly on view dashboard", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — panel creation + navigate-away/back + API monitoring
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_J2_${Date.now()}`;

      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, "TestPanel");

      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.openVariables();
      await page.locator(SELECTORS.ADD_VARIABLE_BTN).waitFor({ state: "visible", timeout: 10000 });

      // Global constant holds the field name
      await scopedVars.addConstantVariable("globalField", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // Panel-scoped variable using real stream so the field dropdown shows real
      // field names alongside variable options — allows $globalField to be selected
      await scopedVars.addScopedVariable(
        "panelFieldVar",
        "logs",
        "e2e_automate",
        "$globalField",
        { scope: "panels", assignedPanels: ["TestPanel"] }
      );
      await page
        .locator(getEditVariableBtn("panelFieldVar"))
        .waitFor({ state: "visible", timeout: 15000 });

      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      const apiMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) => {
          const url = call.url || "";
          const field = call.field || "";
          const hasResolvedField =
            field.includes("kubernetes_namespace_name") ||
            url.includes("kubernetes_namespace_name");
          const hasLiteralRef =
            field.includes("$") || url.includes("%24globalField");
          return url.includes("_values_stream") && hasResolvedField && !hasLiteralRef;
        },
      });

      await openDashboardWithPanels(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      const result = await apiMonitor;

      expect(result.matchedCount).toBeGreaterThanOrEqual(1);

      const literalRefCallJ2 = result.calls.find(
        (c) =>
          (c.field && c.field.includes("$")) ||
          (c.url && c.url.includes("%24"))
      );
      expect(literalRefCallJ2).toBeUndefined();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });

    // -------------------------------------------------------------------------
    // J3: Global custom variable → stream of panel-scoped query_values variable
    // -------------------------------------------------------------------------
    test("J3 - global custom variable in panel-level variable stream resolves correctly on view dashboard", async ({
      page,
    }) => {
      test.slow(); // Triple timeout — panel creation + navigate-away/back + API monitoring
      const pm = new PageManager(page);
      const scopedVars = new DashboardVariablesScoped(page);
      const dashboardName = `Dash_J3_${Date.now()}`;

      await setupTestDashboard(page, pm, dashboardName);
      await addSimplePanel(pm, "TestPanel");

      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.openVariables();
      await page.locator(SELECTORS.ADD_VARIABLE_BTN).waitFor({ state: "visible", timeout: 10000 });

      // Global custom variable selecting the stream
      await scopedVars.addCustomVariable("streamSelector", [
        { label: "e2e_automate", value: "e2e_automate", selected: true },
      ]);
      await reopenSettingsVariables(page, pm);

      // Field constant: needed since stream is a variable ref (field dropdown is empty)
      await scopedVars.addConstantVariable("fieldConst", "kubernetes_namespace_name");
      await reopenSettingsVariables(page, pm);

      // Panel-scoped variable using global custom in stream
      await scopedVars.addScopedVariable(
        "panelCustomChild",
        "logs",
        "$streamSelector",
        "$fieldConst",
        { scope: "panels", assignedPanels: ["TestPanel"] }
      );
      await page
        .locator(getEditVariableBtn("panelCustomChild"))
        .waitFor({ state: "visible", timeout: 15000 });

      await pm.dashboardSetting.closeSettingWindow();
      await safeWaitForHidden(page, ".q-dialog", { timeout: 10000 });
      await pm.dashboardCreate.backToDashboardList();
      await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
      await safeWaitForNetworkIdle(page, { timeout: 5000 });

      const apiMonitor = monitorVariableAPICalls(page, {
        expectedCount: 1,
        timeout: 45000,
        matchFn: (call) => {
          const url = call.url || "";
          const stream = call.stream || "";
          const isResolvedStream =
            stream === "e2e_automate" ||
            url.includes("/e2e_automate/") ||
            url.includes("e2e_automate");
          const isLiteralRef =
            stream.includes("$") || url.includes("%24streamSelector");
          return url.includes("_values_stream") && isResolvedStream && !isLiteralRef;
        },
      });

      await openDashboardWithPanels(page, dashboardName);
      await safeWaitForNetworkIdle(page, { timeout: 15000 });
      await page.waitForTimeout(2000);

      const result = await apiMonitor;

      expect(result.matchedCount).toBeGreaterThanOrEqual(1);

      const literalRefCallJ3 = result.calls.find(
        (c) =>
          (c.stream && c.stream.includes("$")) ||
          (c.url && c.url.includes("%24"))
      );
      expect(literalRefCallJ3).toBeUndefined();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    });
  }
);
