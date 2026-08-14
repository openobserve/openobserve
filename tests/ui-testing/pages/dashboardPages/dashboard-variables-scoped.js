// Dashboard Variables Scoped Page Object Model
// Enhanced version supporting Global, Tab, and Panel level variables
// Methods for creating, managing, and validating scoped variables with dependency tracking

import { expect } from "@playwright/test";
import { waitForValuesStreamComplete } from "../../playwright-tests/utils/streaming-helpers.js";
import {
  SELECTORS,
  getVariableSelector,
  getVariableSelectorInner,
  getEditVariableBtn,
  getVariableLoadingIndicator,
  getPanelRefreshBtn,
  getMenuItemByText,
  getTabSelector,
} from "./dashboard-selectors.js";
import {
  selectStreamFromDropdown,
  selectFieldFromDropdown,
  selectStreamType,
  verifyDropdownContainsVariable,
  verifyFieldDropdownEmptyOrVariablesOnly as _verifyFieldDropdownEmpty,
  hasErrorNotification,
} from "./dashboard-stream-field-utils.js";

export default class DashboardVariablesScoped {
  constructor(page) {
    this.page = page;
  }

  // ==========================================
  // Common UI Helper Methods
  // These replace raw selectors in spec files
  // ==========================================

  // Note: getVariableSelectorLocator() and getEditVariableBtnLocator() are
  // defined once further below (canonical copies).

  /**
   * Wait for dialog to be visible
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 5000)
   * @returns {Promise<import('@playwright/test').Locator>}
   */
  async waitForDialogVisible(options = {}) {
    const { timeout = 5000 } = options;
    const dialog = this.page.locator(SELECTORS.DIALOG);
    await dialog.waitFor({ state: "visible", timeout });
    return dialog;
  }

  /**
   * Wait for dialog to be hidden
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 10000)
   * @returns {Promise<boolean>}
   */
  async waitForDialogHidden(options = {}) {
    const { timeout = 10000 } = options;
    try {
      await this.page.locator(SELECTORS.DIALOG).waitFor({ state: "hidden", timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for dropdown menu to be visible
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 5000)
   * @returns {Promise<import('@playwright/test').Locator>}
   */
  async waitForMenuVisible(options = {}) {
    const { timeout = 5000 } = options;
    const menu = this.page.locator(SELECTORS.MENU);
    await menu.waitFor({ state: "visible", timeout });
    return menu;
  }

  /**
   * Wait for dropdown menu to be hidden
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 5000)
   * @returns {Promise<boolean>}
   */
  async waitForMenuHidden(options = {}) {
    const { timeout = 5000 } = options;
    try {
      await this.page.locator(SELECTORS.MENU).waitFor({ state: "hidden", timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for a specific variable's inner popover to be visible
   * @param {string} variableName - Variable name/label
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 5000)
   * @returns {Promise<import('@playwright/test').Locator>}
   */
  async waitForVariablePopoverVisible(variableName, options = {}) {
    const { timeout = 5000 } = options;
    const popover = this.page.locator(
      `[data-test="variable-selector-${variableName}-inner-popover"]`
    );
    await popover.waitFor({ state: "visible", timeout });
    return popover;
  }

  /**
   * Wait for a specific variable's inner popover to be hidden
   * @param {string} variableName - Variable name/label
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 3000)
   * @returns {Promise<void>}
   */
  async waitForVariablePopoverHidden(variableName, options = {}) {
    const { timeout = 3000 } = options;
    await this.page
      .locator(`[data-test="variable-selector-${variableName}-inner-popover"]`)
      .waitFor({ state: "hidden", timeout });
  }

  /**
   * Change a variable's selected value by clicking the dropdown and selecting an option
   * @param {string} variableName - Variable name/label
   * @param {Object} options - Options
   * @param {number} options.optionIndex - Index of option to select (default: 1 for second option, ignored if optionText provided)
   * @param {string} options.optionText - Text of option to select (preferred over optionIndex for reliability)
   * @param {boolean} options.monitorApi - Whether to monitor API calls (default: false)
   * @param {number} options.expectedApiCalls - Expected API call count when monitoring (default: 1)
   * @param {number} options.timeout - Timeout in ms (default: 10000, increased )
   * @param {boolean} options.returnSelectedValue - Whether to return the selected value text (default: false)
   * @returns {Promise<Object>} Result object with apiResult and/or selectedValue
   */
  async changeVariableValue(variableName, options = {}) {
    const {
      optionIndex = 1,
      optionText = null,
      monitorApi = false,
      expectedApiCalls = 1,
      timeout = 10000, // Increased from 5s to 10s
      returnSelectedValue = false
    } = options;

    let apiMonitor;
    if (monitorApi) {
      const { monitorVariableAPICalls } = await import("../../playwright-tests/utils/variable-helpers.js");
      apiMonitor = monitorVariableAPICalls(this.page, { expectedCount: expectedApiCalls, timeout: 15000 });
    }

    // Wait for variable dropdown trigger to be visible and ready
    const varTrigger = this.page.locator(`[data-test="variable-selector-${variableName}-inner-trigger"]`);
    await varTrigger.waitFor({ state: "visible", timeout });

    // Ensure network is idle before clicking
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    } catch { /* acceptable if timeout */ }

    // Opening the dropdown mid-load is a silent no-op — see waitForVariableIdle.
    await this.waitForVariableIdle(variableName);

    await varTrigger.click();

    // Wait for the variable's own inner popover to open
    const popoverSelector = `[data-test="variable-selector-${variableName}-inner-popover"]`;
    await this.page.locator(popoverSelector).waitFor({ state: "visible", timeout });

    // Build the target option locator scoped to this variable's popover
    const menu = this.page.locator(popoverSelector);
    let targetOption;
    if (optionText) {
      targetOption = menu.locator(`[data-test-value="${optionText}"]`);
    } else {
      // Use the option locator scoped to the menu popover, indexed by position
      targetOption = menu.locator(SELECTORS.OPTION).nth(optionIndex);
    }
    const optionTimeout = Math.max(timeout, 15000); // At least 15s for options under load

    // Retry mechanism: if option not visible, close and reopen dropdown
    try {
      await targetOption.waitFor({ state: "visible", timeout: optionTimeout });
    } catch (e) {
      // Close by pressing Escape, then reopen
      await this.page.keyboard.press('Escape');
      await this.waitForMenuHidden({ timeout: 3000 });
      await varTrigger.click();
      await this.page.locator(popoverSelector).waitFor({ state: "visible", timeout });
      await targetOption.waitFor({ state: "visible", timeout: optionTimeout });
    }

    // Capture selected value text if needed
    let selectedValue = null;
    if (returnSelectedValue) {
      selectedValue = await targetOption.textContent();
      selectedValue = selectedValue?.trim() || null;
    }

    // Nothing may be mid-load when the value commits, or the dependent's reload is
    // silently dropped and callers asserting on it see nothing — see waitForValuesQuiet.
    await this.waitForValuesQuiet({ timeout: Math.max(10000, timeout) });

    // Click the specified option
    await targetOption.click();

    // Wait for dropdown to close
    await this.waitForMenuHidden({ timeout: 3000 });

    // Build result object
    const result = {};
    if (selectedValue !== null) {
      result.selectedValue = selectedValue;
    }
    if (apiMonitor) {
      result.apiResult = await apiMonitor;
    }

    // Return result - always return an object when called with options
    if (Object.keys(result).length > 0 || returnSelectedValue || monitorApi) {
      return result;
    }
  }

  /**
   * Select a menu item by text
   * @param {string} text - Item text to select
   * @param {Object} options - Options
   * @param {boolean} options.exact - Use exact match (default: true)
   * @param {number} options.timeout - Timeout in ms (default: 5000)
   */
  async selectMenuItem(text, options = {}) {
    const { exact = true, timeout = 5000 } = options;
    // Use data-test-label for items whose value may be a UUID but label is text
    const item = this.page.locator(`[data-test$="-option"][data-test-label="${text}"]`);
    await item.waitFor({ state: "visible", timeout });
    await item.click();
  }

  /**
   * Wait for variable selector to be visible on dashboard
   * @param {string} variableName - Variable name
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 30000, increased )
   * @returns {Promise<import('@playwright/test').Locator>}
   */
  async waitForVariableSelectorVisible(variableName, options = {}) {
    const { timeout = 30000 } = options; // Increased from 20s to 30s 
    const selector = this.page.locator(getVariableSelector(variableName));

    // Retry pattern for variable visibility under load
    const startTime = Date.now();
    let lastError;

    while (Date.now() - startTime < timeout) {
      try {
        // Wait for network to settle before checking for variable
        // Increased timeout for network idle in CI/CD environments
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await selector.waitFor({ state: "visible", timeout: 8000 });

        // Additional check: ensure the variable is actually interactive
        const isEnabled = await selector.isEnabled().catch(() => false);
        if (isEnabled) {
          return selector;
        }
      } catch (e) {
        lastError = e;
        // Wait for DOM to settle and retry
        await this.page.waitForLoadState('domcontentloaded');
      }
    }

    // Final attempt with remaining timeout
    const remainingTimeout = Math.max(timeout - (Date.now() - startTime), 8000);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await selector.waitFor({ state: "visible", timeout: remainingTimeout });
    return selector;
  }

  /**
   * Wait for edit variable button to be visible in settings
   * @param {string} variableName - Variable name
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 10000)
   * @returns {Promise<import('@playwright/test').Locator>}
   */
  async waitForEditVariableBtnVisible(variableName, options = {}) {
    const { timeout = 10000 } = options;
    const btn = this.page.locator(getEditVariableBtn(variableName));
    await btn.waitFor({ state: "visible", timeout });
    return btn;
  }

  /**
   * Click edit variable button
   * @param {string} variableName - Variable name
   */
  async clickEditVariable(variableName) {
    const btn = await this.waitForEditVariableBtnVisible(variableName);
    await btn.click();
  }

  /**
   * Wait for dashboard to be ready (settings button visible)
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 10000)
   */
  async waitForDashboardReady(options = {}) {
    const { timeout = 10000 } = options;
    await this.page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout });
  }

  /**
   * Wait for add panel button (empty dashboard state)
   *
   * 30s to match setupTestDashboard(): renders only after the dashboard GET and
   * variables init, well after the header createDashboard() waits on.
   *
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 30000)
   */
  async waitForAddPanelBtn(options = {}) {
    const { timeout = 30000 } = options;
    await this.page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible", timeout });
  }

  /**
   * Click dashboard refresh button
   */
  async clickDashboardRefresh() {
    await this.page.locator(SELECTORS.REFRESH_BTN).click();
  }

  /**
   * Wait for dashboard search to be visible
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 10000)
   */
  async waitForDashboardSearch(options = {}) {
    const { timeout = 10000 } = options;
    await this.page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout });
  }

  /**
   * Get variable dropdown inner element
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableDropdown(variableName) {
    return this.page.locator(getVariableSelectorInner(variableName));
  }

  /**
   * Get variable loading indicator
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableLoadingIndicator(variableName) {
    return this.page.locator(getVariableLoadingIndicator(variableName));
  }

  /**
   * Get variable selector locator on the dashboard by name
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableSelectorLocator(variableName) {
    return this.page.locator(getVariableSelector(variableName));
  }

  /**
   * Get an any-panel locator (matches any dashboard panel) by index
   * @param {number} index - 0-based index (default 0)
   * @returns {import('@playwright/test').Locator}
   */
  getAnyPanel(index = 0) {
    return this.page.locator(SELECTORS.PANEL_ANY).nth(index);
  }

  // ==========================================
  // Locator getters (behavior-preserving relocation of raw spec selectors)
  // ==========================================

  /**
   * Get the "add panel" (empty dashboard) button locator
   * @returns {import('@playwright/test').Locator}
   */
  getAddPanelBtnLocator() {
    return this.page.locator(SELECTORS.ADD_PANEL_BTN);
  }

  /**
   * Get the dashboard settings button locator
   * @returns {import('@playwright/test').Locator}
   */
  getSettingBtnLocator() {
    return this.page.locator(SELECTORS.SETTING_BTN);
  }

  /**
   * Get the settings/dialog overlay locator (matches legacy dialog + ODrawer/ODialog)
   * @returns {import('@playwright/test').Locator}
   */
  getDialogLocator() {
    return this.page.locator(SELECTORS.DIALOG);
  }

  /**
   * Get the dashboard settings drawer locator
   * @returns {import('@playwright/test').Locator}
   */
  getSettingsDrawerLocator() {
    return this.page.locator(SELECTORS.DIALOG_CARD);
  }

  /**
   * Get the "Add Variable" button locator
   * @returns {import('@playwright/test').Locator}
   */
  getAddVariableBtnLocator() {
    return this.page.locator(SELECTORS.ADD_VARIABLE_BTN);
  }

  /**
   * Get the variable settings draggable container locator
   * @returns {import('@playwright/test').Locator}
   */
  getVariableDragLocator() {
    return this.page.locator(SELECTORS.VARIABLE_DRAG);
  }

  /**
   * Get the variable "scope" select locator (edit-variable form)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableScopeSelectLocator() {
    return this.page.locator(SELECTORS.VARIABLE_SCOPE_SELECT);
  }

  /**
   * Get the variable "save" button locator (variable form)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableSaveBtnLocator() {
    return this.page.locator(SELECTORS.VARIABLE_SAVE_BTN);
  }

  /**
   * Get the variable "cancel" button locator (variable form)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableCancelBtnLocator() {
    return this.page.locator('[data-test="dashboard-variable-cancel-btn"]');
  }

  /**
   * Get the variable stream-type select locator (variable form)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableStreamTypeSelectLocator() {
    return this.page.locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT);
  }

  /**
   * Get the constant-value field locator (constant variable form)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableConstantValueFieldLocator() {
    return this.page.locator('[data-test="dashboard-variable-constant-value-field"]');
  }

  /**
   * Get a dashboard-list entry locator by its title text
   * @param {string} title - Dashboard title
   * @returns {import('@playwright/test').Locator}
   */
  getDashboardTitleLocator(title) {
    return this.page.getByTitle(title, { exact: true });
  }

  /**
   * Get the (unscoped) dashboard panel container locator
   * @returns {import('@playwright/test').Locator}
   */
  getPanelContainerLocator() {
    return this.page.locator(SELECTORS.PANEL_CONTAINER);
  }

  /**
   * Get the variable-name form field locator (dashboard-variable-name)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableNameLocator() {
    return this.page.locator(SELECTORS.VARIABLE_NAME);
  }

  /**
   * Get the "No Data Found" indicator locator for a variable query-value selector
   * @returns {import('@playwright/test').Locator}
   */
  getVariableNoDataLocator() {
    return this.page.locator('[data-test="variable-query-value-selector-no-data"]');
  }

  /**
   * Get the Query Inspector executed-query editor locator
   * @returns {import('@playwright/test').Locator}
   */
  getQueryEditorLocator() {
    return this.page.locator(SELECTORS.QUERY_EDITOR);
  }

  /**
   * Get the global dashboard refresh button locator
   * @returns {import('@playwright/test').Locator}
   */
  getDashboardRefreshBtnLocator() {
    return this.page.locator(SELECTORS.REFRESH_BTN);
  }

  /**
   * Get the Query Inspector dialog locator
   * @returns {import('@playwright/test').Locator}
   */
  getQueryInspectorDialogLocator() {
    return this.page.locator('[data-test="query-inspector-dialog"]');
  }

  /**
   * Get the Query Inspector dialog close button locator
   * @returns {import('@playwright/test').Locator}
   */
  getQueryInspectorCloseBtn() {
    return this.page.locator(
      '[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]'
    );
  }

  /**
   * Get generic ARIA-role option locators ([role="option"])
   * @returns {import('@playwright/test').Locator}
   */
  getAriaRoleOptions() {
    return this.page.locator('[role="option"]');
  }

  /**
   * Get the inner selected-value element locator scoped to a variable selector
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableInnerValueLocator(variableName) {
    return this.page
      .locator(getVariableSelector(variableName))
      .locator('[data-test$="-inner-value"]');
  }

  /**
   * Get the dashboard list search input locator
   * @returns {import('@playwright/test').Locator}
   */
  getDashboardSearchLocator() {
    return this.page.locator(SELECTORS.SEARCH);
  }

  /**
   * Get a dashboard tab locator by title
   * @param {string} tabTitle - Tab title (e.g., "Tab1")
   * @returns {import('@playwright/test').Locator}
   */
  getTabLocator(tabTitle) {
    return this.page.locator(getTabSelector(tabTitle));
  }

  /**
   * Get the edit-variable button locator (in settings) by variable name
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getEditVariableBtnLocator(variableName) {
    return this.page.locator(getEditVariableBtn(variableName));
  }

  /**
   * Get a variable dropdown inner trigger locator by name
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableTriggerLocator(variableName) {
    return this.page.locator(
      `[data-test="variable-selector-${variableName}-inner-trigger"]`
    );
  }

  /**
   * Get a variable's inner popover locator by name
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariablePopoverLocator(variableName) {
    return this.page.locator(
      `[data-test="variable-selector-${variableName}-inner-popover"]`
    );
  }

  /**
   * Get a variable's inner option locators by name
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableInnerOption(variableName) {
    return this.page.locator(
      `[data-test="variable-selector-${variableName}-inner-option"]`
    );
  }

  /**
   * Get the generic OSelect option locators (any `*-option`)
   * @returns {import('@playwright/test').Locator}
   */
  getRoleOptionLocator() {
    return this.page.locator(SELECTORS.ROLE_OPTION);
  }

  /**
   * Get the generic OSelect option locators (alias of getRoleOptionLocator)
   * @returns {import('@playwright/test').Locator}
   */
  getOptionLocator() {
    return this.page.locator(SELECTORS.OPTION);
  }

  /**
   * Get the generic popover/menu locators (any `*-popover`)
   * @returns {import('@playwright/test').Locator}
   */
  getMenuLocator() {
    return this.page.locator(SELECTORS.MENU);
  }

  /**
   * Get the panel refresh button locators
   * @returns {import('@playwright/test').Locator}
   */
  getPanelRefreshBtnLocator() {
    return this.page.locator(SELECTORS.PANEL_REFRESH_BTN);
  }

  /**
   * Get the variable-name field input locator (variable form)
   * @returns {import('@playwright/test').Locator}
   */
  getVariableNameField() {
    return this.page.locator('[data-test="dashboard-variable-name-field"]');
  }

  /**
   * Get a variable element scoped within a numbered panel (`dashboard-panel-{n}`)
   * @param {number|string} panelNumber - Panel data-test number
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableInPanelNumber(panelNumber, variableName) {
    return this.page
      .locator(`[data-test="dashboard-panel-${panelNumber}"]`)
      .locator(`[data-test="dashboard-variable-${variableName}"]`);
  }

  /**
   * Get a variable selector scoped within a panel container matched by title
   * @param {string} panelTitle - Panel title (data-test-panel-title)
   * @param {string} variableName - Variable name
   * @returns {import('@playwright/test').Locator}
   */
  getVariableSelectorWithinPanelTitle(panelTitle, variableName) {
    return this.page
      .locator(
        `[data-test="dashboard-panel-container"][data-test-panel-title="${panelTitle}"]`
      )
      .locator(getVariableSelector(variableName));
  }

  /**
   * Wait for a dashboard tab (by title) to be visible
   * @param {string} tabTitle - Tab title (e.g., "Tab1")
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 10000)
   */
  async waitForTabVisible(tabTitle, options = {}) {
    const { timeout = 10000 } = options;
    await this.page.locator(getTabSelector(tabTitle)).waitFor({ state: "visible", timeout });
  }

  /**
   * Click a dashboard tab by title
   * @param {string} tabTitle - Tab title (e.g., "Tab1")
   */
  async clickTab(tabTitle) {
    await this.page.locator(getTabSelector(tabTitle)).click();
  }

  /**
   * Wait for tab content to load (empty add-panel button OR any panel visible)
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 5000)
   */
  async waitForTabContentLoaded(options = {}) {
    const { timeout = 5000 } = options;
    await this.page
      .locator(SELECTORS.ADD_PANEL_BTN)
      .or(this.page.locator(SELECTORS.PANEL_ANY))
      .first()
      .waitFor({ state: "visible", timeout });
  }

  /**
   * Wait for the panel editor to open (chart type item OR apply button visible)
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 15000)
   */
  async waitForPanelEditorOpen(options = {}) {
    const { timeout = 15000 } = options;
    await this.page
      .locator(SELECTORS.CHART_LINE_ITEM)
      .or(this.page.locator(SELECTORS.APPLY_BTN))
      .first()
      .waitFor({ state: "visible", timeout });
  }

  /**
   * Wait for the "Add Variable" button to be visible
   * @param {Object} options - Wait options
   * @param {number} options.timeout - Timeout in ms (default: 10000)
   */
  async waitForAddVariableBtnVisible(options = {}) {
    const { timeout = 10000 } = options;
    await this.page.locator(SELECTORS.ADD_VARIABLE_BTN).waitFor({ state: "visible", timeout });
  }

  /**
   * Click the "Add Variable" button
   */
  async clickAddVariableBtn() {
    await this.page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
  }

  /**
   * Fill the variable name field
   * @param {string} name - Variable name
   */
  async fillVariableName(name) {
    await this.page.locator('[data-test="dashboard-variable-name-field"]').fill(name);
  }

  /**
   * Select a variable scope (e.g. "global" | "tabs" | "panels") via the scope dropdown
   * @param {string} scopeValue - data-test-value of the scope option
   */
  async selectVariableScope(scopeValue) {
    await this.page.locator(SELECTORS.VARIABLE_SCOPE_SELECT).click();
    await this.page
      .locator('[data-test="dashboard-variable-scope-select-popover"]')
      .waitFor({ state: "visible", timeout: 5000 });
    await this.page
      .locator(`[data-test="dashboard-variable-scope-select-option"][data-test-value="${scopeValue}"]`)
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-scope-select-popover"]')
      .waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Select a tab (by label) in the variable "Selected Tabs" dropdown, then close it
   * @param {string} tabLabel - data-test-label of the tab option (e.g. "Tab2", "Default")
   */
  async selectVariableTab(tabLabel) {
    const tabsSelect = this.page.locator(SELECTORS.VARIABLE_TABS_SELECT);
    await tabsSelect.waitFor({ state: "visible" });
    await tabsSelect.click();
    await this.page
      .locator('[data-test="dashboard-variable-tabs-select-popover"]')
      .waitFor({ state: "visible", timeout: 5000 });
    const option = this.page.locator(
      `[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`
    );
    await option.waitFor({ state: "visible" });
    await option.click();
    await tabsSelect.click();
    await this.page
      .locator('[data-test="dashboard-variable-tabs-select-popover"]')
      .waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Select a panel (by label) in the variable "Selected Panels" dropdown, then close it
   * @param {string} panelLabel - data-test-label of the panel option (e.g. "Panel1")
   */
  async selectVariablePanel(panelLabel) {
    const panelsSelect = this.page.locator(SELECTORS.VARIABLE_PANELS_SELECT);
    await panelsSelect.waitFor({ state: "visible" });
    await panelsSelect.click();
    await this.page
      .locator('[data-test="dashboard-variable-panels-select-popover"]')
      .waitFor({ state: "visible", timeout: 5000 });
    const option = this.page.locator(
      `[data-test="dashboard-variable-panels-select-option"][data-test-label="${panelLabel}"]`
    );
    await option.waitFor({ state: "visible" });
    await option.click();
    await panelsSelect.click();
    await this.page
      .locator('[data-test="dashboard-variable-panels-select-popover"]')
      .waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Click the "Add Filter" button in the variable form
   */
  async clickAddFilter() {
    await this.page.locator(SELECTORS.ADD_FILTER_BTN).click();
  }

  /**
   * Select a filter field name in the last filter row
   * @param {string} fieldName - Field name / data-test-value of the option
   */
  async selectFilterName(fieldName) {
    const filterNameSelector = this.page.locator(SELECTORS.FILTER_NAME_SELECTOR).last();
    await filterNameSelector.waitFor({ state: "visible" });
    await filterNameSelector.click();
    await this.page
      .locator('[data-test="dashboard-query-values-filter-name-selector-search"]')
      .fill(fieldName);
    await this.page
      .locator(`[data-test="dashboard-query-values-filter-name-selector-option"][data-test-value="${fieldName}"]`)
      .click();
  }

  /**
   * Select a filter operator in the last filter row
   * @param {string} operator - Operator data-test-value (e.g. "=")
   */
  async selectFilterOperator(operator) {
    const operatorSelector = this.page.locator(SELECTORS.FILTER_OPERATOR_SELECTOR).last();
    await operatorSelector.click();
    await this.page
      .locator(`[data-test="dashboard-query-values-filter-operator-selector-option"][data-test-value="${operator}"]`)
      .click();
  }

  /**
   * Get the last filter-value OCombobox input locator
   * @returns {import('@playwright/test').Locator}
   */
  getFilterValueInput() {
    return this.page
      .locator('[data-test*="filter-value-selector"][data-test$="-input"]')
      .last();
  }

  /**
   * Get the filter-value dependency options locator
   * @returns {import('@playwright/test').Locator}
   */
  getFilterValueOptions() {
    return this.page.locator('[data-test*="filter-value-selector"][data-test$="-option"]');
  }

  /**
   * Get all filter-value dependency option text contents
   * @returns {Promise<string[]>}
   */
  async getFilterValueOptionTexts() {
    return await this.getFilterValueOptions().allTextContents();
  }

  /**
   * Get first panel container
   * @returns {import('@playwright/test').Locator}
   */
  getFirstPanelContainer() {
    return this.page.locator(SELECTORS.PANEL_CONTAINER).first();
  }

  /**
   * Get panel container by index
   * @param {number} index - Panel index (0-based)
   * @returns {import('@playwright/test').Locator}
   */
  getPanelContainer(index) {
    return this.page.locator(SELECTORS.PANEL_CONTAINER).nth(index);
  }

  /**
   * Get panel refresh button by panel ID
   * @param {string} panelId - Panel ID
   * @returns {import('@playwright/test').Locator}
   */
  getPanelRefreshBtn(panelId) {
    return this.page.locator(getPanelRefreshBtn(panelId));
  }

  /**
   * Check if dialog is visible
   * @returns {Promise<boolean>}
   */
  async isDialogVisible() {
    try {
      return await this.page.locator(SELECTORS.DIALOG).isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Get all checked checkboxes count
   * @returns {Promise<number>}
   */
  async getCheckedCheckboxesCount() {
    return await this.page.locator(SELECTORS.CHECKBOX_CHECKED).count();
  }

  /**
   * Click time range 6h button
   */
  async selectTimeRange6Hours() {
    await this.page.locator(SELECTORS.DATE_TIME_BTN).click();
    await this.page.locator(SELECTORS.DATE_TIME_RELATIVE_6H).click();
  }

  // ==========================================
  // End Common UI Helper Methods
  // ==========================================

  /**
   * Add a dashboard variable with scope support (Global/Tab/Panel)
   * @param {string} name - Variable name
   * @param {string} streamType - Stream type (logs, metrics, traces)
   * @param {string} streamName - Stream name
   * @param {string} field - Field name
   * @param {Object} options - Additional options
   * @param {string} options.scope - 'global', 'tabs', or 'panels'
   * @param {string[]} options.assignedTabs - Array of tab IDs for tab-scoped variables
   * @param {string[]} options.assignedPanels - Array of panel names for panel-scoped variables (e.g., ["Panel1", "Panel2"])
   * @param {Object} options.filterConfig - Filter configuration {filterName, operator, value}
   * @param {boolean} options.showMultipleValues - Enable multi-select
   * @param {boolean} options.customValueSearch - Enable custom value search
   * @param {string} options.dependsOn - Variable name this depends on
   * @param {string} options.dependsOnField - Field name of the variable this depends on (used in filter)
   * @param {string} options.dependsOnOperator - Operator to use in dependency filter (default: "=", use "IN" for multi-select dependencies)
   * @param {string[]} options.dependsOnMultiple - Array of variable names for multi-dependency
   * @param {Object} options.dependencyFieldMap - Map of {variableName: fieldName} for multi-dependency
   * @param {string} options.defaultValue - Default value for the variable
   * @param {boolean} options.hideOnDashboard - Hide variable on dashboard
   */
  async addScopedVariable(name, streamType, streamName, field, options = {}) {
    const {
      scope = "global",
      assignedTabs = [],
      assignedPanels = [],
      filterConfig = null,
      showMultipleValues = false,
      customValueSearch = false,
      dependsOn = null,
      dependsOnField = null,
      dependsOnOperator = "=",
      dependsOnMultiple = [],
      dependencyFieldMap = {},
      defaultValue = null,
      defaultValueType = null, // "all" | "custom" | "first" (default)
      customValues = [], // Array of custom values for "custom" default type
      hideOnDashboard = false,
    } = options;

    // Wait for settings panel and variable tab
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "visible", timeout: 10000 });
    await variableTab.click();
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: 'visible', timeout: 10000 });

    // Click Add Variable
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click({ timeout: 5000 });

    // Fill variable name
    await this.page.locator('[data-test="dashboard-variable-name-field"]').fill(name);

    // Normalize scope - accept both "panel" and "panels", "tab" and "tabs"
    const normalizedScope = scope === 'panel' ? 'panels' : (scope === 'tab' ? 'tabs' : scope);

    // Select Scope Level - Map scope value to UI text
    const scopeUIText = {
      'global': 'Global',
      'tabs': 'Selected Tabs',
      'panels': 'Selected Panels'
    };

    await this.page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(`[data-test="dashboard-variable-scope-select-option"][data-test-value="${normalizedScope}"]`).click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Assign to tabs if tab-scoped
    if (normalizedScope === "tabs" && assignedTabs.length > 0) {
      // Open the tabs dropdown
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      // Click each tab by label text using data-test-label
      for (const tabId of assignedTabs) {
        // Convert tabId to label format (e.g., "tab1" -> "Tab1", "default" -> "Default")
        const tabLabel = tabId === 'default' ? 'Default' :
                        tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page
          .locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the dropdown by clicking the trigger again to toggle it closed
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Assign to panels if panel-scoped
    if (normalizedScope === "panels") {
      // For panel scope, we need to select tabs first
      // If no tabs are explicitly provided, we need to select the default tab
      const tabsToSelect = assignedTabs.length > 0 ? assignedTabs : ['default'];

      // Open the tabs dropdown first
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      // Click each tab by label text using data-test-label
      for (const tabId of tabsToSelect) {
        // Convert tabId to label format (e.g., "tab1" -> "Tab1", "default" -> "Default")
        const tabLabel = tabId === 'default' ? 'Default' :
                        tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page
          .locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking the trigger again to toggle it closed
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

      // Now select the panels
      if (assignedPanels.length > 0) {
        // Open the panels dropdown
        const panelsSelect = this.page.locator('[data-test="dashboard-variable-panels-select"]');
        await panelsSelect.waitFor({ state: "visible", timeout: 10000 });
        await panelsSelect.click();

        // Wait for panels popover to open
        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: "visible", timeout: 5000 });

        // Click each panel by panel name using data-test-label
        for (const panelName of assignedPanels) {
          const panelItem = this.page
            .locator(`[data-test="dashboard-variable-panels-select-option"][data-test-label="${panelName}"]`);
          await panelItem.waitFor({ state: "visible", timeout: 5000 });
          await panelItem.click();
        }

        // Close the dropdown by clicking the trigger again to toggle it closed
        await panelsSelect.click();
        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
      }
    }

    // Select Stream Type, Stream, and Field using shared utilities
    await selectStreamType(this.page, streamType);
    await selectStreamFromDropdown(this.page, streamName);
    await selectFieldFromDropdown(this.page, field);

    // Add dependency if specified
    if (dependsOn) {
      await this.addDependency(dependsOn, dependsOnField, dependsOnOperator);
    }

    // Add multiple dependencies if specified
    if (dependsOnMultiple.length > 0) {
      for (const dep of dependsOnMultiple) {
        // Use the field from dependencyFieldMap if provided, otherwise pass null
        const depField = dependencyFieldMap[dep] || null;
        await this.addDependency(dep, depField);
      }
    }

    // Add filter configuration if provided
    if (filterConfig) {
      await this.addFilterToVariable(filterConfig);
    }

    // Toggle show multiple values
    if (showMultipleValues) {
      await this.page
        .locator('[data-test="dashboard-query_values-show_multiple_values"]')
        .click();
    }

    // Handle default value type (all, custom, or first)
    if (defaultValueType === "all") {
      // Set default to "All"
      // Note: Even for single-select, we use the multi-select toggle selector
      await this.page
        .locator('[data-test="dashboard-multi-select-default-value-toggle-all-values"]')
        .click();
    } else if (defaultValueType === "custom") {
      // Set default to custom values
      if (showMultipleValues) {
        // Multi-select: use multi-select custom toggle
        await this.page
          .locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]')
          .click();

        // Add custom values
        if (customValues.length > 0) {
          for (let i = 0; i < customValues.length; i++) {
            // if (i > 0) {
              // Click add button for additional values
              await this.page.locator('[data-test="dashboard-add-custom-value-btn"]').click();
            // }
            await this.page.locator(`[data-test="dashboard-variable-custom-value-${i}-field"]`).fill(customValues[i]);
          }
        }
      } else {
        // Single-select: use single-select custom toggle
        await this.page
          .locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]')
          .click();

        // Add single custom value
        if (customValues.length > 0) {
          await this.page.locator('[data-test="dashboard-variable-custom-value-0-field"]').fill(customValues[0]);
        }
      }
    }
    // If defaultValueType is "first" or null, do nothing (default behavior)

    // Legacy: Set default value if provided (deprecated, use defaultValueType instead)
    if (defaultValue) {
      await this.setDefaultValue(defaultValue);
    }

    // Hide on dashboard if specified
    if (hideOnDashboard) {
      await this.page.locator('[data-test="dashboard-variable-hide_on_dashboard"]').click();
    }

    // Legacy: Custom value search (deprecated, use defaultValueType instead)
    if (customValueSearch) {
      await this.page
        .locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]')
        .click();
      await this.page.locator('[data-test="dashboard-add-custom-value-btn"]').click();
      await this.page.locator('[data-test="dashboard-variable-custom-value-0-field"]').fill("test");
    }

    // Save variable
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for network to settle after save (ensures API call completes)
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Wait for save operation to complete by checking one of these conditions:
    // 1. The add variable button becomes visible (stayed in settings with variable list)
    // 2. The edit button for this variable appears (confirms save success)
    const addVariableBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    const editBtn = this.page.locator(`[data-test="dashboard-edit-variable-${name}"]`);

    // Try to wait for success indicator
    try {
      await Promise.race([
        addVariableBtn.waitFor({ state: "visible", timeout: 8000 }),
        editBtn.waitFor({ state: "visible", timeout: 8000 })
      ]);
    } catch (e) {
      // If neither indicator appears, try network idle as fallback
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Add dependency for a variable using filter mechanism
   * @param {string} dependencyVariableName - Name of the variable to depend on
   * @param {string|Object} filterFieldNameOrConfig - The field name to use in the filter, or an object with {filterName, operator}
   * @param {string} operator - The operator to use (default: "=") - only used if second param is a string
   */
  async addDependency(dependencyVariableName, filterFieldNameOrConfig = null, operator = "=") {
    // Handle both old and new calling conventions
    let filterFieldName = filterFieldNameOrConfig;

    // If second parameter is an object, extract filterName and operator from it
    if (typeof filterFieldNameOrConfig === 'object' && filterFieldNameOrConfig !== null) {
      filterFieldName = filterFieldNameOrConfig.filterName;
      operator = filterFieldNameOrConfig.operator || "=";
    }

    // If no filter field is specified, try to get the current variable's field
    // This maintains backward compatibility when called from addScopedVariable with just the dependency name
    if (!filterFieldName) {
      // Get the currently selected field value from the OSelect trigger's data-test-selected-value attribute
      const fieldTrigger = this.page.locator('[data-test="dashboard-variable-field-select-trigger"]');
      filterFieldName = await fieldTrigger.getAttribute('data-test-selected-value') ?? '';

      // If still no field, default to a common field name
      if (!filterFieldName) {
        filterFieldName = "kubernetes_namespace_name";
      }
    }

    // Dependencies are added through filters where the value references another variable using $variableName
    // Wait for any pending DOM updates to complete
    await this.page.waitForLoadState('domcontentloaded');

    const addFilterBtn = this.page.locator('[data-test="dashboard-add-filter-btn"]');
    await addFilterBtn.waitFor({ state: "visible", timeout: 10000 });
    // Wait for element to be stable before clicking
    await addFilterBtn.waitFor({ state: "attached", timeout: 5000 });
    await addFilterBtn.click({ force: false, timeout: 15000 });

    // Select the filter field name
    const filterNameSelector = this.page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.waitFor({ state: "visible", timeout: 10000 });
    await filterNameSelector.click();
    const filterNameSearch = this.page.locator('[data-test="dashboard-query-values-filter-name-selector-search"]').last();
    await filterNameSearch.waitFor({ state: "visible", timeout: 5000 });
    await filterNameSearch.fill(filterFieldName);

    const filterNameOption = this.page.locator(`[data-test="dashboard-query-values-filter-name-selector-option"][data-test-value="${filterFieldName}"]`);
    await filterNameOption.waitFor({ state: "visible", timeout: 10000 });
    await filterNameOption.click();

    // Select the operator
    const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.waitFor({ state: "visible", timeout: 10000 });
    await operatorSelector.click();

    const operatorOption = this.page.locator(`[data-test="dashboard-query-values-filter-operator-selector-option"][data-test-value="${operator}"]`);
    await operatorOption.waitFor({ state: "visible", timeout: 10000 });
    await operatorOption.click();

    // Set the value to reference the dependency variable using $variableName syntax.
    // OCombobox renders its inner input as [data-test="${name}-input"]; we target the last filter row's input.
    // We MUST click the input before filling so that reka-ui's openOnClick fires and opens the portal dropdown.
    const filterValueInput = this.page.locator('[data-test*="filter-value-selector"][data-test$="-input"]').last();
    await filterValueInput.waitFor({ state: "visible", timeout: 10000 });

    /**
     * Try to find and click the option with the given label inside the OCombobox portal.
     * Returns true on success (onSelect fires immediately, no debounce). Returns false if option not found.
     * @param {string} label - The data-test-label value to look for
     */
    const tryClickDropdownOption = async (label) => {
      try {
        const option = this.page.locator(
          `[data-test*="filter-value-selector"][data-test$="-option"][data-test-label="${label}"]`
        ).first();
        await option.waitFor({ state: 'visible', timeout: 3000 });
        await option.click();
        return true;
      } catch {
        return false;
      }
    };

    // Attempt 1: click to open, fill variable name (no $), click the matching option.
    // onSelect() fires synchronously → filter.value = "$varName" with no debounce.
    await filterValueInput.click();
    await filterValueInput.fill(dependencyVariableName);

    const optionsLocator = '[data-test*="filter-value-selector"][data-test$="-option"]';
    const dropdownAppeared = await this.page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length > 0,
      optionsLocator,
      { timeout: 4000 }
    ).then(() => true).catch(() => false);

    let valueCommitted = false;

    if (dropdownAppeared) {
      valueCommitted = await tryClickDropdownOption(dependencyVariableName);
    }

    // Attempt 2: fill with $ prefix — searchRegex extracts the name and the same options appear.
    // Then click the option so onSelect fires immediately (still no debounce).
    if (!valueCommitted) {
      await filterValueInput.clear();
      await filterValueInput.click();
      await filterValueInput.fill(`$${dependencyVariableName}`);

      const fallbackDropdownAppeared = await this.page.waitForFunction(
        (sel) => document.querySelectorAll(sel).length > 0,
        optionsLocator,
        { timeout: 4000 }
      ).then(() => true).catch(() => false);

      if (fallbackDropdownAppeared) {
        valueCommitted = await tryClickDropdownOption(dependencyVariableName);
      }
    }

    // Log final result
    const finalInputValue = await filterValueInput.inputValue().catch(() => '');
  }

  /**
   * Click the save button with retry logic to handle DOM updates
   * This handles cases where the button is detached/reattached during form updates
   */
  async clickSaveButton() {
    // Wait for any ongoing DOM updates to settle
    await this.page.waitForLoadState('domcontentloaded');

    // Use a retry loop with fresh locators
    const maxRetries = 3;
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Create a fresh locator each attempt to avoid stale elements
        const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');

        // Wait for button to be ready
        await saveBtn.waitFor({ state: "visible", timeout: 10000 });

        // Try to click - Playwright will wait for stability automatically
        await saveBtn.click({ timeout: 10000 });

        // Wait for the dialog to transition back to listing view
        // The save button should disappear after successful save
        await saveBtn.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});

        // Wait for network to be idle after save
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        // If click succeeded, return
        return;
      } catch (error) {
        lastError = error;

        // If this isn't the last attempt, wait for DOM to settle and retry
        if (i < maxRetries - 1) {
          await this.page.waitForLoadState('domcontentloaded');
        }
      }
    }

    // All retries failed, throw the last error
    throw lastError;
  }

  /**
   * Add filter configuration to variable
   */
  async addFilterToVariable(filterConfig) {
    const addFilterBtn = this.page.locator('[data-test="dashboard-add-filter-btn"]');
    await addFilterBtn.waitFor({ state: "visible", timeout: 5000 });
    await addFilterBtn.click();

    const filterNameSelector = this.page.locator('[data-test="dashboard-query-values-filter-name-selector"]');
    await filterNameSelector.waitFor({ state: "visible", timeout: 10000 });
    await filterNameSelector.click();
    const filterNameSearchInput = this.page.locator('[data-test="dashboard-query-values-filter-name-selector-search"]');
    await filterNameSearchInput.waitFor({ state: "visible", timeout: 5000 });
    await filterNameSearchInput.fill(filterConfig.filterName);

    const filterNameOption = this.page.locator(`[data-test="dashboard-query-values-filter-name-selector-option"][data-test-value="${filterConfig.filterName}"]`);
    await filterNameOption.waitFor({ state: "visible", timeout: 10000 });
    await filterNameOption.click();

    const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]');
    await operatorSelector.waitFor({ state: "visible", timeout: 10000 });
    await operatorSelector.click();

    const operatorOption = this.page.locator(`[data-test="dashboard-query-values-filter-operator-selector-option"][data-test-value="${filterConfig.operator}"]`);
    await operatorOption.waitFor({ state: "visible", timeout: 10000 });
    await operatorOption.click();

    // OCombobox renders its inner input as [data-test="${name}-input"]; target the last filter row's input
    const filterValueInput = this.page.locator('[data-test*="filter-value-selector"][data-test$="-input"]').last();
    await filterValueInput.waitFor({ state: "visible", timeout: 10000 });
    await filterValueInput.fill(filterConfig.value);
  }

  /**
   * Set default value for variable
   */
  async setDefaultValue(value) {
    await this.page
      .locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]')
      .click();
    await this.page.locator('[data-test="dashboard-variable-custom-value-0-field"]').fill(value);
  }

  /**
   * Select value from variable dropdown with API monitoring
   * @param {string} label - Variable label
   * @param {string} value - Value to select
   * @returns {Promise<boolean>} - Returns true if API was called successfully
   */
  async selectValueFromVariableDropDown(label, value) {
    const trigger = this.page.locator(`[data-test="variable-selector-${label}-inner-trigger"]`);
    await trigger.waitFor({ state: "visible", timeout: 10000 });

    // Monitor API call when clicking dropdown
    const valuesStreamPromise = waitForValuesStreamComplete(this.page);
    await trigger.click();

    try {
      await valuesStreamPromise;
    } catch (error) {
      throw new Error(`Failed to load variable values API for ${label}: ${error.message}`);
    }

    const searchInput = this.page.locator(`[data-test="variable-selector-${label}-inner-search"]`);
    const hasSearch = await searchInput.count() > 0;
    if (hasSearch) {
      await searchInput.waitFor({ state: "visible", timeout: 5000 });
      await searchInput.fill(value);
    }

    const option = this.page.locator(`[data-test="variable-selector-${label}-inner-option"][data-test-value="${value}"]`);
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();

    return true;
  }

  /**
   * Wait for variable values API to complete
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<boolean>}
   */
  async waitForVariableValuesAPI(timeout = 15000) {
    try {
      await waitForValuesStreamComplete(this.page, timeout);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Track all variable API calls
   * @returns {Promise<Array>} Array of API call responses
   */
  async trackVariableAPICalls() {
    const apiCalls = [];

    this.page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("_values_stream") || url.includes("/values")) {
        const status = response.status();
        const body = await response.text().catch(() => "");

        apiCalls.push({
          url,
          status,
          timestamp: Date.now(),
          completed: body.includes("[[DONE]]") || body.includes('"type":"end"'),
          body: body.substring(0, 200), // Store first 200 chars for debugging
        });
      }
    });

    return apiCalls;
  }

  /**
   * Wait for dependent variables to load after a variable value change
   * @param {number} expectedCallCount - Expected number of API calls
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Returns {success: boolean, actualCount: number}
   */
  async waitForDependentVariablesToLoad(expectedCallCount, timeout = 15000) {
    const startTime = Date.now();
    const apiCalls = [];

    return new Promise((resolve) => {
      const responseHandler = async (response) => {
        const url = response.url();

        if (url.includes("_values_stream") || url.includes("/values")) {
          try {
            const body = await response.text();
            if (body.includes("[[DONE]]") || body.includes('"type":"end"')) {
              apiCalls.push({
                url,
                timestamp: Date.now(),
                status: response.status(),
              });

              if (apiCalls.length >= expectedCallCount) {
                this.page.off("response", responseHandler);
                resolve({ success: true, actualCount: apiCalls.length, calls: apiCalls });
              }
            }
          } catch (error) {
            // Continue listening
          }
        }
      };

      this.page.on("response", responseHandler);

      // Timeout handler
      setTimeout(() => {
        this.page.off("response", responseHandler);
        resolve({
          success: apiCalls.length >= expectedCallCount,
          actualCount: apiCalls.length,
          calls: apiCalls,
          timedOut: true
        });
      }, timeout);
    });
  }

  /**
   * Verify variable is visible on dashboard
   * @param {string} variableName - Variable name
   * @param {boolean} shouldBeVisible - Expected visibility
   */
  async verifyVariableVisibility(variableName, shouldBeVisible = true) {
    const variableElement = this.page.locator(`[data-test="variable-selector-${variableName}"]`);

    if (shouldBeVisible) {
      await expect(variableElement).toBeVisible({ timeout: 5000 });
    } else {
      await expect(variableElement).not.toBeVisible();
    }
  }

  /**
   * Verify variable has specific value
   * @param {string} variableName - Variable name
   * @param {string} expectedValue - Expected value
   */
  async verifyVariableValue(variableName, expectedValue) {
    const variableElement = this.page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableElement).toContainText(expectedValue, { timeout: 5000 });
  }

  /**
   * Check if variable shows error state (red box)
   * @param {string} variableName - Variable name
   * @returns {Promise<boolean>}
   */
  async hasVariableError(variableName) {
    const errorElement = this.page.locator(`[data-test="dashboard-variable-${variableName}-error"]`);
    try {
      await errorElement.waitFor({ state: "visible", timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify variable loading state
   * @param {string} variableName - Variable name
   * @param {string} expectedState - Expected state: 'loading', 'loaded', 'error', 'partial'
   */
  async verifyVariableLoadingState(variableName, expectedState) {
    const stateElement = this.page.locator(`[data-test="dashboard-variable-${variableName}-state"]`);

    await expect(stateElement).toHaveAttribute("data-state", expectedState, { timeout: 5000 });
  }

  /**
   * Verify circular dependency is detected
   * @returns {Promise<boolean>}
   */
  async hasCircularDependencyError() {
    const errorEl = this.page.locator('[data-test="dashboard-variable-cycle-error"]');
    try {
      await errorEl.waitFor({ state: 'visible', timeout: 12000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get variable value from dropdown
   * @param {string} variableName - Variable name
   * @returns {Promise<string>}
   */
  async getVariableValue(variableName) {
    const variableElement = this.page.locator(`[data-test="dashboard-variable-${variableName}"] input`);
    return await variableElement.inputValue();
  }

  /**
   * Verify variable is available in panel edit mode
   * @param {string} variableName - Variable name
   * @param {boolean} shouldBeAvailable - Expected availability
   */
  async verifyVariableInPanelEdit(variableName, shouldBeAvailable = true) {
    const variableOption = this.page.locator(`[data-test="variable-selector-${variableName}"]`);

    if (shouldBeAvailable) {
      await expect(variableOption).toBeVisible({ timeout: 5000 });
    } else {
      await expect(variableOption).not.toBeVisible();
    }
  }

  /**
   * Verify deleted tab/panel shows "(deleted)" in variable assignment
   * This method verifies the deleted scope label by hovering over the scope chip
   * and checking if the tooltip contains "Deleted Tab" or "Deleted Panel"
   * @param {string} scopeType - 'tab' or 'panel' (also accepts 'tabs' or 'panels')
   */
  async verifyDeletedScopeLabel(scopeType) {
    // Normalize scope type
    const normalizedType = scopeType === 'tabs' ? 'tab' : (scopeType === 'panels' ? 'panel' : scopeType);

    // Find the variable's scope chip in the variables list. The list migrated
    // to OTable, so the old per-row `dashboard-variable-settings-draggable-row`
    // attribute is gone; the scope badge data-test is preserved, so anchor on it.
    const scopeChip = this.page.locator('[data-test="dashboard-variable-scope-badge"]').first();
    await scopeChip.waitFor({ state: "visible", timeout: 5000 });

    // Hover over the scope chip to see the tooltip showing "Deleted Tab" or "Deleted Panel"
    await scopeChip.hover();

    // Wait for tooltip to appear and verify it contains "Deleted Tab" or "Deleted Panel"
    const expectedText = normalizedType === 'tab' ? 'Deleted Tab' : 'Deleted Panel';
    const tooltip = this.page.locator('[data-test="o-tooltip-content"]');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toContainText(expectedText, { ignoreCase: true });
  }

  /**
   * Block until the variable's in-flight load has finished.
   *
   * loadVariableOptions() early-returns while isLoading is true, so a click landing
   * mid-load is silently dropped. Tracked via the OSpinner (role="status"); idle must
   * HOLD, as a cascade can start a second load just after the first clears.
   *
   * @param {string} variableName - Variable name
   * @param {Object} options - Wait options
   * @param {number} options.quietMs - How long idle must hold (default: 1000)
   * @param {number} options.timeout - Overall budget in ms (default: 30000)
   */
  async waitForVariableIdle(variableName, options = {}) {
    const { quietMs = 1000, timeout = 30000 } = options;
    const spinner = this.page.locator(
      `[data-test="variable-selector-${variableName}"] [role="status"]`
    );
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await spinner
        .first()
        .waitFor({ state: "detached", timeout: Math.max(1000, deadline - Date.now()) })
        .catch(() => {});

      await this.page.waitForTimeout(quietMs);
      if ((await spinner.count()) === 0) return;
    }
  }

  /**
   * Arm a wait for a `_values_stream` response, optionally filtered by field.
   *
   * The endpoint is a POST with no query string, so field matching reads
   * request.postData(). Arm before the triggering action, await after; resolves to
   * null instead of rejecting so callers can branch on "did it fire".
   *
   * @param {string[]|null} fields - Only match calls fetching one of these fields (null = any)
   * @param {Object} options - Options
   * @param {number} options.timeout - Timeout in ms (default: 30000)
   * @returns {Promise<import('@playwright/test').Response|null>}
   */
  waitForValuesResponse(fields = null, options = {}) {
    const { timeout = 30000 } = options;
    return this.page
      .waitForResponse((response) => {
        if (!response.url().includes("_values_stream")) return false;
        if (!fields) return true;
        try {
          const body = JSON.parse(response.request().postData() || "null");
          return (body?.fields || []).some((f) => fields.includes(f));
        } catch {
          return false;
        }
      }, { timeout })
      .catch(() => null);
  }

  /**
   * Resolve once no `_values_stream` request has been in flight for `quietMs`.
   *
   * A cascade only queues when nothing is mid-load (canVariableLoad bails on isLoading).
   * Counting in-flight requests covers every variable, unlike the parent's spinner
   * (hidden while its dropdown is open) or a single response wait (can match a sibling).
   * Decrements on `response`, not `requestfinished` — these are SSE streams.
   *
   * @param {Object} options - Options
   * @param {number} options.quietMs - Required quiet period in ms (default: 1000)
   * @param {number} options.timeout - Overall budget in ms (default: 20000)
   * @returns {Promise<boolean>} true if quiet was reached, false if it timed out
   */
  async waitForValuesQuiet(options = {}) {
    const { quietMs = 1000, timeout = 20000 } = options;
    const isValues = (url) => url.includes("_values_stream");

    let inFlight = 0;
    let lastActivity = Date.now();

    const onRequest = (request) => {
      if (isValues(request.url())) {
        inFlight++;
        lastActivity = Date.now();
      }
    };
    const onSettled = (reqOrRes) => {
      if (isValues(reqOrRes.url())) {
        inFlight = Math.max(0, inFlight - 1);
        lastActivity = Date.now();
      }
    };

    this.page.on("request", onRequest);
    this.page.on("response", onSettled);
    this.page.on("requestfailed", onSettled);

    try {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (inFlight === 0 && Date.now() - lastActivity >= quietMs) return true;
        await this.page.waitForTimeout(100);
      }
      return false;
    } finally {
      this.page.off("request", onRequest);
      this.page.off("response", onSettled);
      this.page.off("requestfailed", onSettled);
    }
  }

  /**
   * Change variable value and monitor dependent variable API calls
   * This function is designed for dependency tests where changing one variable
   * triggers API calls for dependent variables
   *
   * @param {string} variableName - Name of the variable to change
   * @param {Object} options - Configuration options
   * @param {number} options.optionIndex - Preferred index of option to select (default: 0).
   *   Clamped into range, then advanced to the first option whose value differs from
   *   the current selection — re-picking the current value does not cascade.
   * @param {number} options.expectedAPICalls - Expected number of dependent variable API calls (default: 1)
   * @param {number} options.timeout - Timeout for API monitoring, measured from the moment
   *   the option is clicked (default: 15000)
   * @param {string[]} options.dependentFields - Fields queried by the variables expected to
   *   reload. When supplied, ONLY _values_stream calls for these fields are counted, so
   *   `expectedAPICalls` means "number of dependent variables" and the parent's own
   *   dropdown-open request is excluded from the tally.
   * @param {number} options.optionsTimeout - Budget for the PARENT's own options to render
   *   before selecting (default: 45000). Separate from `timeout` on purpose.
   * @returns {Promise<Object>} - API monitoring result with actualCount, matchedCount, calls, success, etc.
   */
  async changeVariableValueAndMonitorDependencies(variableName, options = {}) {
    const {
      optionIndex = 0,
      expectedAPICalls = 1,
      timeout = 15000,
      dependentFields = null,
      optionsTimeout = 45000
    } = options;

    // Dynamic import to avoid circular dependencies
    const { monitorVariableAPICalls } = await import('../../playwright-tests/utils/variable-helpers.js');

    // Wait for variable dropdown trigger to be visible and ready
    const varDropdown = this.page.locator(`[data-test="variable-selector-${variableName}-inner-trigger"]`);
    await varDropdown.waitFor({ state: "visible", timeout: 10000 });

    // Ensure network is idle before clicking
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Opening the dropdown while this variable's own load is still in flight is a
    // silent no-op — see waitForVariableIdle.
    await this.waitForVariableIdle(variableName);

    // Without dependentFields, keep the original semantics: monitor armed pre-open, so
    // the parent's own request still counts toward expectedAPICalls.
    let apiMonitor = dependentFields
      ? null
      : monitorVariableAPICalls(this.page, {
          expectedCount: expectedAPICalls,
          timeout: timeout
        });

    // OSelect popover exposes data-test `${parentDataTest}-popover`. The selector
    // forwards `variable-selector-<name>-inner` to OSelect, so the popover/options
    // carry a `variable-selector-<name>-inner-*` prefix.
    const selectorDataTest = `variable-selector-${variableName}-inner`;
    const dropdownMenu = this.page.locator(`[data-test="${selectorDataTest}-popover"]`).first();
    const optionLocator = this.page.locator(`[data-test="${selectorDataTest}-option"]`);

    // Load the PARENT's own options first, on their own budget. Previously this awaited
    // waitForValuesStreamComplete() on the SAME timeout as the dependency monitor; that
    // reads the SSE body via CDP, never settles on deployed envs, and burned the whole
    // budget before any option was clicked. waitForValuesResponse resolves on headers.
    //
    // Needs >= 2 options or the value cannot change and nothing cascades; freshly
    // ingested values can lag, so reopen (forcing a new query) rather than accept one
    // blank option.
    const deadline = Date.now() + optionsTimeout;
    let optionCount = 0;
    while (Date.now() < deadline) {
      if (!(await dropdownMenu.isVisible().catch(() => false))) {
        // Arm the values wait BEFORE the click that triggers it, then await after.
        const parentValues = this.waitForValuesResponse(null, {
          timeout: Math.max(5000, deadline - Date.now())
        });
        await varDropdown.click();
        await dropdownMenu.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
        await parentValues;
      }
      await optionLocator.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      optionCount = await optionLocator.count();
      if (optionCount >= 2) break;

      await this.page.keyboard.press('Escape');
      await dropdownMenu.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      await this.waitForVariableIdle(variableName, { timeout: 10000 });
    }

    if (optionCount < 2) {
      throw new Error(
        `Variable "${variableName}" loaded ${optionCount} option(s) within ${optionsTimeout}ms; ` +
        `at least 2 are needed to change its value and trigger a dependency reload.`
      );
    }

    // Pick an option that actually CHANGES the value — re-selecting the current one does
    // not cascade. Clamp the index, then walk forward to the first differing value.
    // data-test-value exists only on virtualized rows, so fall back to text.
    const currentValue = await varDropdown.getAttribute('data-test-selected-value').catch(() => null);
    const optionValueAt = async (i) => {
      const option = optionLocator.nth(i);
      const value = await option.getAttribute('data-test-value').catch(() => null);
      if (value !== null) return value;
      const text = await option.textContent().catch(() => null);
      return text ? text.trim() : null;
    };

    let targetIdx = Math.min(Math.max(optionIndex, 0), optionCount - 1);
    for (let i = 0; i < optionCount; i++) {
      const idx = (targetIdx + i) % optionCount;
      if ((await optionValueAt(idx)) !== currentValue) {
        targetIdx = idx;
        break;
      }
    }

    const targetOption = optionLocator.nth(targetIdx);
    const targetOptionText = await targetOption.textContent().then((t) => (t ? t.trim() : null)).catch(() => null);

    // Nothing may still be loading when the new value is committed, or the cascade is
    // silently dropped (see waitForValuesQuiet). Sibling variables on the dashboard can
    // still be settling at this point, so gate on all values traffic being quiet rather
    // than on this variable alone.
    await this.waitForValuesQuiet({ timeout: Math.max(10000, Math.floor(optionsTimeout / 2)) });

    // Arm before the click so we sync on the values API, not the DOM. The monitor counts
    // how many dependents fired; this waiter makes the first one a deterministic signal.
    const dependentResponse = dependentFields
      ? this.waitForValuesResponse(dependentFields, { timeout })
      : Promise.resolve(null);

    // When dependentFields is supplied, start monitoring only now so the whole budget
    // belongs to the cascade and the tally counts dependents rather than the parent's
    // own request. (Otherwise the monitor was already armed above, pre-open.)
    if (!apiMonitor) {
      apiMonitor = monitorVariableAPICalls(this.page, {
        expectedCount: expectedAPICalls,
        timeout: timeout,
        matchFn: (call) => dependentFields.includes(call.field)
      });
    }

    // Click the target option
    await targetOption.click();

    // Wait for dropdown to close
    await dropdownMenu.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Wait for any dependent variable API calls to complete
    const firstDependentResponse = await dependentResponse;
    const apiResult = await apiMonitor;

    // Verify the value actually changed by checking the trigger's selected value
    const currentValueAfter = await varDropdown.getAttribute('data-test-selected-value').catch(() => '');

    return {
      ...apiResult,
      // True when a dependent variable actually re-queried after the change — the
      // deterministic "the cascade happened" signal, independent of the call tally.
      dependentResponded: firstDependentResponse !== null,
      selectedValue: targetOptionText,
      currentValue: currentValueAfter,
      variableName: variableName
    };
  }

  /**
   * Add a custom type variable
   * @param {string} name - Variable name
   * @param {string[]} values - Array of custom values (can also be objects with {label, value})
   * @param {Object} options - Additional options
   * @param {string} options.label - Display label (defaults to name)
   * @param {string} options.scope - Variable scope: 'global', 'tabs', 'panels'
   * @param {string[]} options.assignedTabs - Tab IDs if scope is 'tabs'
   * @param {string[]} options.assignedPanels - Panel IDs if scope is 'panels'
   * @param {boolean} options.multiSelect - Enable multi-select (default: false)
   * @returns {Promise<void>}
   */
  async addCustomVariable(name, values = [], options = {}) {
    const {
      label = name,
      scope = "global",
      assignedTabs = [],
      assignedPanels = [],
      multiSelect = false,
    } = options;

    // Wait for settings panel and variable tab
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "visible", timeout: 10000 });

    // Only click if not already active
    const isActive = await variableTab.getAttribute('aria-selected');
    if (isActive !== 'true') {
      await variableTab.click();
      await this.page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: 'visible', timeout: 10000 });
    }

    // Click Add Variable button
    await this.page.locator(SELECTORS.ADD_VARIABLE_BTN).click();

    // Select scope first (before filling other fields)
    const normalizedScope = scope === 'panel' ? 'panels' : (scope === 'tab' ? 'tabs' : scope);

    await this.page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(`[data-test="dashboard-variable-scope-select-option"][data-test-value="${normalizedScope}"]`).click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Assign to tabs if needed
    if (normalizedScope === "tabs" && assignedTabs.length > 0) {
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      for (const tabId of assignedTabs) {
        const tabLabel = tabId === 'default' ? 'Default' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page.locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Assign to panels if needed
    if (normalizedScope === "panels") {
      const tabsToSelect = assignedTabs.length > 0 ? assignedTabs : ['default'];

      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      for (const tabId of tabsToSelect) {
        const tabLabel = tabId === 'default' ? 'Default' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page.locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

      if (assignedPanels.length > 0) {
        const panelsSelect = this.page.locator('[data-test="dashboard-variable-panels-select"]');
        await panelsSelect.waitFor({ state: "visible", timeout: 10000 });
        await panelsSelect.click();

        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: "visible", timeout: 5000 });

        for (const panelName of assignedPanels) {
          const panelItem = this.page.locator(`[data-test="dashboard-variable-panels-select-option"][data-test-label="${panelName}"]`);
          await panelItem.waitFor({ state: "visible", timeout: 5000 });
          await panelItem.click();
        }

        // Close the panels dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
        await panelsSelect.click();
        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
      }
    }

    // Select variable type - Custom
    await this.page.locator('[data-test="dashboard-variable-type-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator('[data-test="dashboard-variable-type-select-option"][data-test-value="custom"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Fill name and label
    await this.page.locator('[data-test="dashboard-variable-name-field"]').fill(name);
    await this.page.locator('[data-test="dashboard-variable-label-field"]').fill(label);

    // Add custom options - the first option already exists by default
    if (values.length > 0) {
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        const valueLabel = typeof value === 'string' ? value : value.label;
        const valueValue = typeof value === 'string' ? value : value.value;
        const isDefault = typeof value === 'object' && value.selected === true;

        // If this is not the first item, add a new option and wait for it to appear.
        // The field's bottom validation div permanently intercepts pointer events over
        // the button, blocking both regular and force clicks. Use evaluate() to call the DOM
        // native click() which fires the full event sequence and bypasses CSS pointer-events.
        if (i > 0) {
          const addOptionBtn = this.page.locator('[data-test="dashboard-add-option-btn"]');
          await addOptionBtn.waitFor({ state: "visible", timeout: 10000 });
          await addOptionBtn.scrollIntoViewIfNeeded();
          await addOptionBtn.evaluate(btn => btn.click());
          // Wait for the new option row to appear in the DOM before proceeding
          await this.page.locator(`[data-test="dashboard-custom-variable-${i}-label-field"]`).waitFor({ state: "visible", timeout: 10000 });
        }

        // Fill label and value for this option
        await this.page.locator(`[data-test="dashboard-custom-variable-${i}-label-field"]`).fill(valueLabel);
        await this.page.locator(`[data-test="dashboard-custom-variable-${i}-value-field"]`).fill(valueValue);

        // Set as default if specified
        if (isDefault) {
          const checkbox = this.page.locator(`[data-test="dashboard-custom-variable-${i}-checkbox"]`);
          const isChecked = await checkbox.isChecked();
          if (!isChecked) {
            await checkbox.click();
          }
        }
      }
    }

    // Enable multi-select if requested
    if (multiSelect) {
      await this.page.locator('[data-test="dashboard-query_values-show_multiple_values"]').click();
    }

    // Save variable
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for save to complete
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const addVariableBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    const editBtn = this.page.locator(`[data-test="dashboard-edit-variable-${name}"]`);

    try {
      await Promise.race([
        addVariableBtn.waitFor({ state: "visible", timeout: 8000 }),
        editBtn.waitFor({ state: "visible", timeout: 8000 })
      ]);
    } catch (e) {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Add a constant type variable
   * @param {string} name - Variable name
   * @param {string} value - Constant value
   * @param {Object} options - Additional options
   * @param {string} options.label - Display label (defaults to name)
   * @param {string} options.scope - Variable scope: 'global', 'tabs', 'panels'
   * @param {string[]} options.assignedTabs - Tab IDs if scope is 'tabs'
   * @param {string[]} options.assignedPanels - Panel IDs if scope is 'panels'
   * @returns {Promise<void>}
   */
  async addConstantVariable(name, value, options = {}) {
    const {
      label = name,
      scope = "global",
      assignedTabs = [],
      assignedPanels = [],
    } = options;

    // Wait for settings panel and variable tab
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "visible", timeout: 10000 });

    // Only click if not already active
    const isActive = await variableTab.getAttribute('aria-selected');
    if (isActive !== 'true') {
      await variableTab.click();
      await this.page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: 'visible', timeout: 10000 });
    }

    // Click Add Variable button
    await this.page.locator(SELECTORS.ADD_VARIABLE_BTN).click();

    // Select scope first
    const normalizedScope = scope === 'panel' ? 'panels' : (scope === 'tab' ? 'tabs' : scope);

    await this.page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(`[data-test="dashboard-variable-scope-select-option"][data-test-value="${normalizedScope}"]`).click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Assign to tabs if needed
    if (normalizedScope === "tabs" && assignedTabs.length > 0) {
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      for (const tabId of assignedTabs) {
        const tabLabel = tabId === 'default' ? 'Default' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page.locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Assign to panels if needed
    if (normalizedScope === "panels") {
      const tabsToSelect = assignedTabs.length > 0 ? assignedTabs : ['default'];

      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      for (const tabId of tabsToSelect) {
        const tabLabel = tabId === 'default' ? 'Default' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page.locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

      if (assignedPanels.length > 0) {
        const panelsSelect = this.page.locator('[data-test="dashboard-variable-panels-select"]');
        await panelsSelect.waitFor({ state: "visible", timeout: 10000 });
        await panelsSelect.click();

        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: "visible", timeout: 5000 });

        for (const panelName of assignedPanels) {
          const panelItem = this.page.locator(`[data-test="dashboard-variable-panels-select-option"][data-test-label="${panelName}"]`);
          await panelItem.waitFor({ state: "visible", timeout: 5000 });
          await panelItem.click();
        }

        // Close the panels dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
        await panelsSelect.click();
        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
      }
    }

    // Select variable type - Constant
    await this.page.locator('[data-test="dashboard-variable-type-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator('[data-test="dashboard-variable-type-select-option"][data-test-value="constant"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Fill name and label
    await this.page.locator('[data-test="dashboard-variable-name-field"]').fill(name);
    await this.page.locator('[data-test="dashboard-variable-label-field"]').fill(label);

    // Set constant value
    await this.page.locator('[data-test="dashboard-variable-constant-value-field"]').fill(value);

    // Save variable
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for save to complete
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const addVariableBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    const editBtn = this.page.locator(`[data-test="dashboard-edit-variable-${name}"]`);

    try {
      await Promise.race([
        addVariableBtn.waitFor({ state: "visible", timeout: 8000 }),
        editBtn.waitFor({ state: "visible", timeout: 8000 })
      ]);
    } catch (e) {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Add a textbox type variable
   * @param {string} name - Variable name
   * @param {string} defaultValue - Default textbox value
   * @param {Object} options - Additional options
   * @param {string} options.label - Display label (defaults to name)
   * @param {string} options.scope - Variable scope: 'global', 'tabs', 'panels'
   * @param {string[]} options.assignedTabs - Tab IDs if scope is 'tabs'
   * @param {string[]} options.assignedPanels - Panel IDs if scope is 'panels'
   * @returns {Promise<void>}
   */
  async addTextboxVariable(name, defaultValue = "", options = {}) {
    const {
      label = name,
      scope = "global",
      assignedTabs = [],
      assignedPanels = [],
    } = options;

    // Wait for settings panel and variable tab
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "visible", timeout: 10000 });

    // Only click if not already active
    const isActive = await variableTab.getAttribute('aria-selected');
    if (isActive !== 'true') {
      await variableTab.click();
      await this.page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: 'visible', timeout: 10000 });
    }

    // Click Add Variable button
    await this.page.locator(SELECTORS.ADD_VARIABLE_BTN).click();

    // Select scope first
    const normalizedScope = scope === 'panel' ? 'panels' : (scope === 'tab' ? 'tabs' : scope);

    await this.page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(`[data-test="dashboard-variable-scope-select-option"][data-test-value="${normalizedScope}"]`).click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Assign to tabs if needed
    if (normalizedScope === "tabs" && assignedTabs.length > 0) {
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      for (const tabId of assignedTabs) {
        const tabLabel = tabId === 'default' ? 'Default' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page.locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Assign to panels if needed
    if (normalizedScope === "panels") {
      const tabsToSelect = assignedTabs.length > 0 ? assignedTabs : ['default'];

      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });

      for (const tabId of tabsToSelect) {
        const tabLabel = tabId === 'default' ? 'Default' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
        const tabItem = this.page.locator(`[data-test="dashboard-variable-tabs-select-option"][data-test-label="${tabLabel}"]`);
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
      await tabsSelect.click();
      await this.page.locator('[data-test="dashboard-variable-tabs-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

      if (assignedPanels.length > 0) {
        const panelsSelect = this.page.locator('[data-test="dashboard-variable-panels-select"]');
        await panelsSelect.waitFor({ state: "visible", timeout: 10000 });
        await panelsSelect.click();

        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: "visible", timeout: 5000 });

        for (const panelName of assignedPanels) {
          const panelItem = this.page.locator(`[data-test="dashboard-variable-panels-select-option"][data-test-label="${panelName}"]`);
          await panelItem.waitFor({ state: "visible", timeout: 5000 });
          await panelItem.click();
        }

        // Close the panels dropdown by clicking trigger again (toggle — Escape does not close OSelect multi-select)
        await panelsSelect.click();
        await this.page.locator('[data-test="dashboard-variable-panels-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
      }
    }

    // Select variable type - Textbox
    await this.page.locator('[data-test="dashboard-variable-type-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator('[data-test="dashboard-variable-type-select-option"][data-test-value="textbox"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Fill name and label
    await this.page.locator('[data-test="dashboard-variable-name-field"]').fill(name);
    await this.page.locator('[data-test="dashboard-variable-label-field"]').fill(label);

    // Set default value
    if (defaultValue) {
      await this.page.locator('[data-test="dashboard-variable-textbox-default-value-field"]').fill(defaultValue);
    }

    // Save variable
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for save to complete
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const addVariableBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    const editBtn = this.page.locator(`[data-test="dashboard-edit-variable-${name}"]`);

    try {
      await Promise.race([
        addVariableBtn.waitFor({ state: "visible", timeout: 8000 }),
        editBtn.waitFor({ state: "visible", timeout: 8000 })
      ]);
    } catch (e) {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }


  /**
   * Change textbox variable value (clear, fill, submit)
   * @param {string} variableName - Variable name
   * @param {string} newValue - New value to set
   */
  async changeTextboxVariableValue(variableName, newValue) {
    const field = this.page.locator(`[data-test="variable-selector-${variableName}-field"]`);
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.clear();
    await field.fill(newValue);
    await this.page.keyboard.press('Enter');
  }

  /**
   * Verify variable has loaded options (is not empty)
   * @param {string} variableName - Variable name
   * @param {Object} options - Options
   * @param {number} options.timeout - Timeout in ms
   * @returns {Promise<number>} Number of options found
   */
  async verifyVariableHasOptions(variableName, options = {}) {
    const { timeout = 10000 } = options;

    // Open variable dropdown via the OSelect trigger. Gate on idle first: a click
    // landing mid-load opens the popover but never fetches (see waitForVariableIdle).
    const selector = this.page.locator(`[data-test="variable-selector-${variableName}-inner-trigger"]`);
    await this.waitForVariableIdle(variableName);
    await selector.click();

    // Wait for dropdown menu
    await this.page.locator(SELECTORS.MENU).waitFor({ state: "visible", timeout: 5000 });

    // Wait for and count options
    const dropdown = this.page.locator(`${SELECTORS.MENU} ${SELECTORS.MENU_ITEM}`);
    await dropdown.first().waitFor({ state: "visible", timeout });
    const count = await dropdown.count();

    // Close dropdown by pressing Escape
    await this.page.keyboard.press('Escape');
    await this.page.locator(SELECTORS.MENU).waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    return count;
  }

  // ==========================================
  // Stream & Field Variable Support Methods
  // For the new feature where variables can
  // reference other variables in stream/field
  // ==========================================

  /**
   * Select a stream (real name or $variable reference) using shared utils
   * @param {string} streamNameOrVar - Stream name or $variable reference
   */
  async selectStream(streamNameOrVar) {
    await selectStreamFromDropdown(this.page, streamNameOrVar);
  }

  /**
   * Select a field (real name or $variable reference) using shared utils
   * @param {string} fieldNameOrVar - Field name or $variable reference
   */
  async selectField(fieldNameOrVar) {
    await selectFieldFromDropdown(this.page, fieldNameOrVar);
  }

  /**
   * Verify that $variableName appears in the stream dropdown with "(variable)" label
   * @param {string} variableName - Variable name (without $ prefix)
   * @returns {Promise<{found: boolean, hasVariableLabel: boolean}>}
   */
  async verifyStreamDropdownContainsVariable(variableName) {
    return await verifyDropdownContainsVariable(
      this.page,
      SELECTORS.VARIABLE_STREAM_SELECT,
      variableName
    );
  }

  /**
   * Verify that $variableName appears in the field dropdown with "(variable)" label
   * @param {string} variableName - Variable name (without $ prefix)
   * @returns {Promise<{found: boolean, hasVariableLabel: boolean}>}
   */
  async verifyFieldDropdownContainsVariable(variableName) {
    return await verifyDropdownContainsVariable(
      this.page,
      SELECTORS.VARIABLE_FIELD_SELECT,
      variableName
    );
  }

  /**
   * Verify field dropdown is empty or only contains variable references
   * (expected when stream is a $variable reference with no known schema)
   * @returns {Promise<boolean>}
   */
  async verifyFieldDropdownEmptyOrVariablesOnly() {
    return await _verifyFieldDropdownEmpty(this.page);
  }

  /**
   * Verify no error notification appeared (e.g., "Failed to get stream fields")
   * @param {number} waitMs - Time to wait for notification (default: 3000)
   * @returns {Promise<boolean>} true if NO error notification is visible (test passes)
   */
  async verifyNoErrorNotification(waitMs = 3000) {
    const hasError = await hasErrorNotification(this.page, waitMs);
    return !hasError;
  }

  /**
   * Edit an existing variable by clicking its edit button in the settings list
   * @param {string} variableName - Variable name
   */
  async editVariable(variableName) {
    // The row renders only after the drawer opens AND the dashboard fetch resolves,
    // which under parallel load lands past 10s — use the same 30s as setupTestDashboard.
    const editBtn = this.page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`);
    await editBtn.waitFor({ state: "visible", timeout: 30000 });
    await editBtn.click();

    // Wait for form to be visible
    const nameInput = this.page.locator(SELECTORS.VARIABLE_NAME);
    await nameInput.waitFor({ state: "visible", timeout: 15000 });
  }

  /**
   * Get the cycle error text displayed on the form
   * @returns {Promise<string|null>} The error text or null if not visible
   */
  async getCycleErrorText() {
    const errorEl = this.page.locator('[data-test="dashboard-variable-cycle-error"]');
    try {
      await errorEl.waitFor({ state: 'visible', timeout: 3000 });
      return await errorEl.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Verify that cycle error is NOT visible (cleared after fix)
   * @returns {Promise<boolean>} true if no cycle error is visible
   */
  async verifyCycleErrorCleared() {
    const errorText = await this.getCycleErrorText();
    return errorText === null;
  }

  /**
   * Add a query_values variable that supports $variable references in stream and/or field.
   * This is the primary method for the new stream/field variable feature tests.
   *
   * @param {string} name - Variable name
   * @param {string} streamType - Stream type (logs, metrics, traces)
   * @param {string} streamNameOrVar - Real stream name or $variable reference
   * @param {string} fieldNameOrVar - Real field name or $variable reference
   * @param {Object} options - Additional options
   * @param {string} options.scope - 'global', 'tabs', 'panels'
   * @param {Object} options.filterConfig - Filter configuration {filterName, operator, value}
   * @param {boolean} options.expectCycleError - If true, don't wait for save success (expect error)
   * @param {boolean} options.skipSave - If true, don't click save button
   */
  async addQueryValuesVariable(name, streamType, streamNameOrVar, fieldNameOrVar, options = {}) {
    const {
      scope = "global",
      filterConfig = null,
      expectCycleError = false,
      skipSave = false,
    } = options;

    // Navigate to variable tab
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "visible", timeout: 10000 });
    await variableTab.click();
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: 'visible', timeout: 10000 });

    // Click Add Variable
    await this.page.locator(SELECTORS.ADD_VARIABLE_BTN).click();

    // Fill variable name (use -field suffix to target the inner input, not the OInput wrapper)
    await this.page.locator('[data-test="dashboard-variable-name-field"]').fill(name);

    // Select scope
    const normalizedScope = scope === 'panel' ? 'panels' : (scope === 'tab' ? 'tabs' : scope);
    await this.page.locator(SELECTORS.VARIABLE_SCOPE_SELECT).click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(`[data-test="dashboard-variable-scope-select-option"][data-test-value="${normalizedScope}"]`).click();
    await this.page.locator('[data-test="dashboard-variable-scope-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Select stream type
    await selectStreamType(this.page, streamType);

    // Select stream (real or $variable)
    await selectStreamFromDropdown(this.page, streamNameOrVar);

    // Select field (real or $variable)
    await selectFieldFromDropdown(this.page, fieldNameOrVar);

    // Add filter if specified
    if (filterConfig) {
      await this.addFilterToVariable(filterConfig);
    }

    if (skipSave) return;

    // Save
    const saveBtn = this.page.locator(SELECTORS.VARIABLE_SAVE_BTN);
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    if (expectCycleError) {
      // Wait for cycle error to appear using the data-test attribute
      await this.page.locator('[data-test="dashboard-variable-cycle-error"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      return;
    }

    // Wait for save to complete
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const addVariableBtn = this.page.locator(SELECTORS.ADD_VARIABLE_BTN);
    const editBtn = this.page.locator(`[data-test="dashboard-edit-variable-${name}"]`);
    try {
      await Promise.race([
        addVariableBtn.waitFor({ state: "visible", timeout: 8000 }),
        editBtn.waitFor({ state: "visible", timeout: 8000 })
      ]);
    } catch {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Update the stream selection on an already-open variable edit form
   * @param {string} streamNameOrVar - New stream name or $variable reference
   */
  async updateStream(streamNameOrVar) {
    // selectStreamFromDropdown handles click, popover search fill, and option selection.
    await selectStreamFromDropdown(this.page, streamNameOrVar);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  /**
   * Update the field selection on an already-open variable edit form
   * @param {string} fieldNameOrVar - New field name or $variable reference
   */
  async updateField(fieldNameOrVar) {
    // selectFieldFromDropdown handles click, popover search fill, and option selection.
    await selectFieldFromDropdown(this.page, fieldNameOrVar);
  }

  /**
   * Change variable type on an open edit form (e.g., from query_values to constant)
   * @param {string} typeName - Type name (e.g., "Constant", "Query Values", "Custom", "Textbox")
   */
  async changeVariableType(typeName) {
    const typeValueMap = {
      'Query Values': 'query_values',
      'Constant': 'constant',
      'Textbox': 'textbox',
      'Custom': 'custom',
    };
    const typeValue = typeValueMap[typeName] || typeName.toLowerCase().replace(/\s+/g, '_');
    await this.page.locator('[data-test="dashboard-variable-type-select"]').click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
    await this.page.locator(`[data-test="dashboard-variable-type-select-option"][data-test-value="${typeValue}"]`).click();
    await this.page.locator('[data-test="dashboard-variable-type-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
}
