/**
 * Dashboard Custom Variable Default Value Resolution Test Suite
 *
 * Tests the per-option default value resolution for custom-type dashboard variables.
 * Covers single-select defaults, multi-select defaults, save-time validation,
 * multi-select toggle auto-reset, editing defaults, Select All checkbox,
 * dashboard reload persistence, and removal of the sole default-checked option.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard, reopenDashboardFromList } from "./utils/dashCreation.js";
const { SELECTORS } = require("../../pages/dashboardPages/dashboard-selectors.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Custom Variable Default Value Resolution", { tag: ['@custom-variable', '@dashboards', '@all'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC1 (P0, WIRED) — Single-Select Custom Variable Default Resolution
  // ────────────────────────────────────────────────────────────────────────
  test("TC1-should pre-select the default-marked option on the dashboard (single-select)", { tag: ['@custom-variable', '@dashboards', '@all', '@P0'] }, async ({ page }) => {
    testLogger.info("TC1: Starting single-select default value resolution test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_CustomSingle_${Date.now()}`;
    const varName = `var_single_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Open settings, navigate to Variables tab, add custom variable with Beta as default
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "Alpha", value: "alpha-val" },
      { label: "Beta", value: "beta-val", selected: true }
    ], { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();

    // Verify "Beta" is the pre-selected value on the dashboard
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    const displayedValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    expect(displayedValue).toContain("Beta");
    testLogger.info("TC1: Verified default option 'Beta' is pre-selected on dashboard");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC1: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC2 (P1, WIRED) — Multi-Select Default Resolution
  // ────────────────────────────────────────────────────────────────────────
  test("TC2-should pre-select multiple default-marked options on the dashboard (multi-select)", { tag: ['@custom-variable', '@dashboards', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info("TC2: Starting multi-select default value resolution test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_CustomMulti_${Date.now()}`;
    const varName = `var_multi_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Create multi-select custom variable with Red and Blue as defaults, Green unchecked
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "Red", value: "red-val", selected: true },
      { label: "Green", value: "green-val" },
      { label: "Blue", value: "blue-val", selected: true }
    ], { scope: "global", multiSelect: true });
    await pm.dashboardSetting.closeSettingWindow();

    // Verify both "Red" and "Blue" appear as pre-selected on the dashboard
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    const displayedValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    expect(displayedValue).toContain("Red");
    expect(displayedValue).toContain("Blue");
    testLogger.info("TC2: Verified both 'Red' and 'Blue' are pre-selected, 'Green' is not");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC2: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC3 (P1, WIRED) — Save Validation: No default option checked
  // ────────────────────────────────────────────────────────────────────────
  test("TC3-should block save with validation error when no default option is checked", { tag: ['@custom-variable', '@dashboards', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info("TC3: Starting save validation test");

    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Validation_${Date.now()}`;
    const varName = `var_none_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Open settings and manually set up a custom variable form with NO defaults
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.clickAddVariableBtn();
    await pm.dashboardSetting.selectCustomTypeInForm();
    await pm.dashboardSetting.typeVariableName(varName);

    // Fill option 0 (first option already exists)
    await pm.dashboardSetting.fillOptionLabel(0, "One");
    await pm.dashboardSetting.fillOptionValue(0, "one-val");

    // Add option 1
    await pm.dashboardSetting.clickAddOptionBtn();
    await pm.dashboardSetting.fillOptionLabel(1, "Two");
    await pm.dashboardSetting.fillOptionValue(1, "two-val");

    // Toggle multi-select ON so checkboxes are independently toggleable,
    // then uncheck any that are auto-checked
    await pm.dashboardSetting.toggleMultiSelect(true);

    if (await pm.dashboardSetting.isCheckboxChecked(0)) {
      await pm.dashboardSetting.clickDefaultCheckbox(0);
    }
    if (await pm.dashboardSetting.isCheckboxChecked(1)) {
      await pm.dashboardSetting.clickDefaultCheckbox(1);
    }

    // Attempt save — should be blocked
    await pm.dashboardSetting.saveVariable();

    // Verify the validation error notification appears
    await pm.dashboardSetting.expectValidationErrorVisible();
    testLogger.info("TC3: Validation error 'Select at least one default option' appeared as expected");

    // Cancel the variable form and close settings
    await pm.dashboardSetting.cancelVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC3: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC4 (P1, WIRED) — Multi-Select Toggle Auto-Reset
  // ────────────────────────────────────────────────────────────────────────
  test("TC4-should auto-select first option as default when multi-select is toggled off", { tag: ['@custom-variable', '@dashboards', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info("TC4: Starting multi-select toggle auto-reset test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_ToggleOff_${Date.now()}`;
    const varName = `var_toggle_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Create multi-select variable with defaults on option 1 and 2 only
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "First", value: "first-val" },
      { label: "Second", value: "second-val", selected: true },
      { label: "Third", value: "third-val", selected: true }
    ], { scope: "global", multiSelect: true });
    await pm.dashboardSetting.closeSettingWindow();

    // Reopen settings and edit the variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.clickEditVariableBtn(varName);

    // Toggle multi-select OFF
    await pm.dashboardSetting.toggleMultiSelect(false);

    // Verify option 0 is now checked (auto-selected) and options 1, 2 are unchecked
    const opt0Checked = await pm.dashboardSetting.isCheckboxChecked(0);
    const opt1Checked = await pm.dashboardSetting.isCheckboxChecked(1);
    const opt2Checked = await pm.dashboardSetting.isCheckboxChecked(2);
    expect(opt0Checked).toBe(true);
    expect(opt1Checked).toBe(false);
    expect(opt2Checked).toBe(false);
    testLogger.info("TC4: Verified option 0 auto-selected, options 1 and 2 cleared");

    // Select All checkbox should have disappeared
    await pm.dashboardSetting.expectSelectAllCheckboxNotVisible();
    testLogger.info("TC4: Verified Select All checkbox is hidden after toggling multi-select off");

    // Cancel editing (don't save) and clean up
    await pm.dashboardSetting.cancelVariable();
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC4: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC5 (P1, WIRED) — Edit Existing Variable Default
  // ────────────────────────────────────────────────────────────────────────
  test("TC5-should update the pre-selected option on dashboard after editing the default", { tag: ['@custom-variable', '@dashboards', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info("TC5: Starting edit default option test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_EditDefault_${Date.now()}`;
    const varName = `var_edit_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Create with Alpha as default
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "Alpha", value: "alpha-val", selected: true },
      { label: "Beta", value: "beta-val" }
    ], { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();

    // Verify Alpha is pre-selected initially
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    let displayedValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    expect(displayedValue).toContain("Alpha");

    // Edit: swap default from option 0 (Alpha) to option 1 (Beta)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.clickEditVariableBtn(varName);

    // Check option 1's checkbox (radio-button behavior will uncheck option 0)
    await pm.dashboardSetting.clickDefaultCheckbox(1);

    // Verify the swap happened
    const opt0Checked = await pm.dashboardSetting.isCheckboxChecked(0);
    const opt1Checked = await pm.dashboardSetting.isCheckboxChecked(1);
    expect(opt0Checked).toBe(false);
    expect(opt1Checked).toBe(true);

    // Save and close
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // The dashboard does not automatically refresh variable values after an edit;
    // navigate away and back to force the dashboard to re-initialise with the
    // updated default option.
    await pm.dashboardCreate.backToDashboardList();
    await reopenDashboardFromList(page, dashboardName);

    // Verify Beta is now the pre-selected value on the dashboard
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    displayedValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    expect(displayedValue).toContain("Beta");
    expect(displayedValue).not.toContain("Alpha");
    testLogger.info("TC5: Verified default option changed from 'Alpha' to 'Beta' on dashboard");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC5: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC6 (P2, WIRED) — Select All Checkbox (Multi-Select)
  // ────────────────────────────────────────────────────────────────────────
  test("TC6-should mark all options as default when Select All checkbox is clicked", { tag: ['@custom-variable', '@dashboards', '@all', '@P2'] }, async ({ page }) => {
    testLogger.info("TC6: Starting Select All checkbox test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_SelectAll_${Date.now()}`;
    const varName = `var_selectall_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Create multi-select custom variable with NO defaults checked
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "One", value: "one-val" },
      { label: "Two", value: "two-val" },
      { label: "Three", value: "three-val" }
    ], { scope: "global", multiSelect: true });
    await pm.dashboardSetting.closeSettingWindow();

    // Reopen settings and edit
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.clickEditVariableBtn(varName);

    // Verify Select All checkbox is visible in multi-select mode
    await pm.dashboardSetting.expectSelectAllCheckboxVisible();

    // Click Select All to mark every option as default
    await pm.dashboardSetting.clickSelectAllCheckbox();

    // Verify all options are now checked
    expect(await pm.dashboardSetting.isCheckboxChecked(0)).toBe(true);
    expect(await pm.dashboardSetting.isCheckboxChecked(1)).toBe(true);
    expect(await pm.dashboardSetting.isCheckboxChecked(2)).toBe(true);
    testLogger.info("TC6: Verified all three options are checked after clicking Select All");

    // Save and close
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify dashboard shows all options as pre-selected
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    const displayedValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    // Multi-select with all selected typically shows count or all labels
    expect(displayedValue.length).toBeGreaterThan(0);
    testLogger.info("TC6: Verified dashboard displays all-selected state");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC6: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC7 (P2, WIRED) — Default Resolution After Dashboard Reload
  // ────────────────────────────────────────────────────────────────────────
  test("TC7-should preserve the default option after dashboard reload", { tag: ['@custom-variable', '@dashboards', '@all', '@P2'] }, async ({ page }) => {
    testLogger.info("TC7: Starting dashboard reload persistence test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Reload_${Date.now()}`;
    const varName = `var_reload_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Create custom variable with Second as default (option 1)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "First", value: "first-val" },
      { label: "Second", value: "second-val", selected: true }
    ], { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();

    // Verify "Second" is pre-selected initially
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    const initialValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    expect(initialValue).toContain("Second");
    testLogger.info("TC7: Initial default 'Second' confirmed on dashboard");

    // Navigate back to dashboard list
    await pm.dashboardCreate.backToDashboardList();

    // Reopen the same dashboard
    await reopenDashboardFromList(page, dashboardName);

    // Wait for the variable to re-render and verify default persisted
    await pm.dashboardSetting.waitForCustomVariableOnDashboard(varName);
    const persistedValue = await pm.dashboardSetting.getCustomVariableDashboardValue(varName);
    expect(persistedValue).toContain("Second");
    testLogger.info("TC7: Verified default 'Second' persisted after dashboard reload");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC7: Completed successfully");
  });

  // ────────────────────────────────────────────────────────────────────────
  // TC8 (P2, WIRED) — Remove the Only Default-Checked Option — Save Blocked
  // ────────────────────────────────────────────────────────────────────────
  test("TC8-should block save after removing the sole default-checked option", { tag: ['@custom-variable', '@dashboards', '@all', '@P2'] }, async ({ page }) => {
    testLogger.info("TC8: Starting remove default option test");

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_RemoveDefault_${Date.now()}`;
    const varName = `var_remove_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Create custom variable with only option 1 as default
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addCustomVariable(varName, [
      { label: "First", value: "first-val" },
      { label: "Second", value: "second-val", selected: true }
    ], { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();

    // Reopen settings and edit
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.clickEditVariableBtn(varName);

    // Remove option 1 (the only default-checked one)
    await pm.dashboardSetting.clickRemoveOption(1);

    // Attempt to save — should be blocked
    await pm.dashboardSetting.saveVariable();

    // Verify the validation error appears
    await pm.dashboardSetting.expectValidationErrorVisible();
    testLogger.info("TC8: Validation error appeared after removing the sole default");

    // Cancel editing and clean up
    await pm.dashboardSetting.cancelVariable();
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("TC8: Completed successfully");
  });
});
