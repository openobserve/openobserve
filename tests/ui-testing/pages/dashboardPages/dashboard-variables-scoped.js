// Dashboard Variables Scoped Page Object Model
// Enhanced version supporting Global, Tab, and Panel level variables
// Methods for creating, managing, and validating scoped variables with dependency tracking

import { expect } from "@playwright/test";
import { waitForValuesStreamComplete } from "../../playwright-tests/utils/streaming-helpers.js";

export default class DashboardVariablesScoped {
  constructor(page) {
    this.page = page;
  }

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
      dependsOnMultiple = [],
      dependencyFieldMap = {},
      defaultValue = null,
      hideOnDashboard = false,
    } = options;

    // Wait for settings panel and variable tab
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "visible", timeout: 10000 });
    await variableTab.click();
    await this.page.waitForTimeout(500);

    // Click Add Variable
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click({ timeout: 5000 });

    // Fill variable name
    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

    // Normalize scope - accept both "panel" and "panels", "tab" and "tabs"
    const normalizedScope = scope === 'panel' ? 'panels' : (scope === 'tab' ? 'tabs' : scope);

    // Select Scope Level - Map scope value to UI text
    const scopeUIText = {
      'global': 'Global',
      'tabs': 'Selected Tabs',
      'panels': 'Selected Panels'
    };

    await this.page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await this.page.getByRole("option", { name: scopeUIText[normalizedScope] || normalizedScope, exact: true }).click();

    // Assign to tabs if tab-scoped
    if (normalizedScope === "tabs" && assignedTabs.length > 0) {
      // Open the tabs dropdown
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible", timeout: 10000 });
      await tabsSelect.click();
      await this.page.waitForTimeout(500); // Wait for dropdown to open

      // Click each tab by label text
      for (const tabId of assignedTabs) {
        // Convert tabId to label format (e.g., "tab1" -> "Tab1", "default" -> "Default")
        const tabLabel = tabId === 'default' ? 'Default' :
                        tabId.charAt(0).toUpperCase() + tabId.slice(1);
        // Use .q-item with exact text match
        const tabItem = this.page.locator('.q-item').filter({ hasText: new RegExp(`^${tabLabel}$`) });
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the dropdown by clicking outside or pressing Escape
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
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
      await this.page.waitForTimeout(500);

      // Click each tab by label text
      for (const tabId of tabsToSelect) {
        // Convert tabId to label format (e.g., "tab1" -> "Tab1", "default" -> "Default")
        const tabLabel = tabId === 'default' ? 'Default' :
                        tabId.charAt(0).toUpperCase() + tabId.slice(1);
        // Use .q-item with exact text match
        const tabItem = this.page.locator('.q-item').filter({ hasText: new RegExp(`^${tabLabel}$`) });
        await tabItem.waitFor({ state: "visible", timeout: 5000 });
        await tabItem.click();
      }

      // Close the tabs dropdown
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);

      // Now select the panels
      if (assignedPanels.length > 0) {
        // Open the panels dropdown
        const panelsSelect = this.page.locator('[data-test="dashboard-variable-panels-select"]');
        await panelsSelect.waitFor({ state: "visible", timeout: 10000 });
        await panelsSelect.click();
        await this.page.waitForTimeout(1000);

        // Wait for dropdown items to load
        await this.page.waitForSelector('.q-item', { state: "visible", timeout: 5000 });

        // Click each panel checkbox by panel name
        for (const panelName of assignedPanels) {
          // Use .q-item with exact text match for panel name
          const panelItem = this.page.locator('.q-item').filter({ hasText: new RegExp(`^${panelName}$`) });
          await panelItem.waitFor({ state: "visible", timeout: 5000 });
          await panelItem.click();
          await this.page.waitForTimeout(500); // Wait after each selection
        }

        // Close the dropdown
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }
    }

    // Select Stream Type
    await this.page
      .locator('[data-test="dashboard-variable-stream-type-select"]')
      .click();
    await this.page
      .getByRole("option", { name: streamType, exact: true })
      .locator("div")
      .nth(2)
      .click();

    // Select Stream
    const streamSelect = this.page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill(streamName);
    await this.page.getByRole("option", { name: streamName, exact: true }).click();

    // Select Field
    const fieldSelect = this.page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await this.page.keyboard.type(field, { delay: 100 });
    await this.page.waitForFunction(
      () => document.querySelectorAll('[role="option"]').length > 0,
      { timeout: 10000, polling: 100 }
    );

    // Select field using multiple strategies
    let fieldSelected = false;
    try {
      await this.page.getByRole("option", { name: field, exact: true }).click({ timeout: 5000 });
      fieldSelected = true;
    } catch (e) {
      try {
        await this.page.getByRole("option", { name: field, exact: false }).first().click({ timeout: 5000 });
        fieldSelected = true;
      } catch (e2) {
        await this.page.keyboard.press("ArrowDown");
        await this.page.keyboard.press("Enter");
        fieldSelected = true;
      }
    }

    if (!fieldSelected) {
      throw new Error(`Failed to select field: ${field}`);
    }

    // Add dependency if specified
    if (dependsOn) {
      await this.addDependency(dependsOn, dependsOnField);
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

    // Set default value if provided
    if (defaultValue) {
      await this.setDefaultValue(defaultValue);
    }

    // Hide on dashboard if specified
    if (hideOnDashboard) {
      await this.page.locator('[data-test="dashboard-variable-hide_on_dashboard"]').click();
    }

    // Custom value search
    if (customValueSearch) {
      await this.page
        .locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]')
        .click();
      await this.page.locator('[data-test="dashboard-add-custom-value-btn"]').click();
      await this.page.locator('[data-test="dashboard-variable-custom-value-0"]').fill("test");
    }

    // Save variable
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for save operation to complete by checking if either:
    // 1. The add variable button becomes visible (stayed in settings)
    // 2. The settings dialog closes (auto-redirect to dashboard)
    // 3. We're back on the dashboard page
    await Promise.race([
      // Option 1: Variable list appears (dialog stayed open)
      this.page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: "visible", timeout: 5000 }),
      // Option 2: Dialog closes (use multiple selectors for robustness)
      this.page.locator('[data-test="dashboard-settings-dialog"]').or(this.page.locator('.q-dialog')).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {}),
      // Option 3: Dashboard elements become visible (fallback)
      this.page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
    ]);
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
      // Get the currently selected field value
      const fieldInput = this.page.locator('[data-test="dashboard-variable-field-select"]');
      filterFieldName = await fieldInput.inputValue();

      // If still no field, default to a common field name
      if (!filterFieldName) {
        filterFieldName = "kubernetes_namespace_name";
      }
    }

    // Dependencies are added through filters where the value references another variable using $variableName
    // Wait for any pending DOM updates to complete
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(500); // Small wait for UI to stabilize

    const addFilterBtn = this.page.locator('[data-test="dashboard-add-filter-btn"]');
    await addFilterBtn.waitFor({ state: "visible", timeout: 10000 });
    // Wait for element to be stable before clicking
    await addFilterBtn.waitFor({ state: "attached", timeout: 5000 });
    await addFilterBtn.click({ force: false, timeout: 15000 });

    // Select the filter field name
    const filterNameSelector = this.page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.waitFor({ state: "visible", timeout: 10000 });
    await filterNameSelector.click();
    await filterNameSelector.fill(filterFieldName);

    const filterNameOption = this.page.getByRole("option", { name: filterFieldName });
    await filterNameOption.waitFor({ state: "visible", timeout: 10000 });
    await filterNameOption.click();

    // Select the operator
    const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.waitFor({ state: "visible", timeout: 10000 });
    await operatorSelector.click();

    const operatorOption = this.page.getByRole("option", { name: operator, exact: true }).locator("div").nth(2);
    await operatorOption.waitFor({ state: "visible", timeout: 10000 });
    await operatorOption.click();

    // Set the value to reference the dependency variable using $variableName syntax
    const autoComplete = this.page.locator('[data-test="common-auto-complete"]').last();
    await autoComplete.waitFor({ state: "visible", timeout: 10000 });
    await autoComplete.click();

    // Wait for input to be focused and ready
    await autoComplete.waitFor({ state: "attached", timeout: 5000 });

    // Clear any existing value and type the variable name to trigger autocomplete
    await autoComplete.clear();
    await autoComplete.fill(dependencyVariableName);

    // Wait for dropdown options to appear
    const dropdownAppeared = await this.page.waitForSelector('[role="listbox"]', {
      state: "visible",
      timeout: 3000
    }).then(() => true).catch(() => false);

    if (dropdownAppeared) {
      // Try to find and click the option - the dropdown shows variable names
      try {
        // Wait a bit for options to fully render
        await this.page.waitForSelector(`[role="option"]:has-text("${dependencyVariableName}")`, {
          state: "visible",
          timeout: 2000
        });

        // Click the matching option
        await this.page.getByRole("option", { name: dependencyVariableName, exact: true }).click();

        // Verify the value was set correctly with $ prefix
        const currentValue = await autoComplete.inputValue();
        if (!currentValue.startsWith('$')) {
          // If $ wasn't added automatically, add it manually
          await autoComplete.clear();
          await autoComplete.fill(`$${dependencyVariableName}`);
        }
      } catch (error) {
        // If clicking option failed, manually set the value with $ prefix
        await autoComplete.clear();
        await autoComplete.fill(`$${dependencyVariableName}`);
        // await this.page.keyboard.press('Escape');
      }
    } else {
      // No dropdown appeared, manually set the value with $ prefix
      await autoComplete.clear();
      await autoComplete.fill(`$${dependencyVariableName}`);
    }
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
    await filterNameSelector.fill(filterConfig.filterName);

    const filterNameOption = this.page.getByRole("option", { name: filterConfig.filterName });
    await filterNameOption.waitFor({ state: "visible", timeout: 10000 });
    await filterNameOption.click();

    const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]');
    await operatorSelector.waitFor({ state: "visible", timeout: 10000 });
    await operatorSelector.click();

    const operatorOption = this.page.getByRole("option", { name: filterConfig.operator, exact: true }).locator("div").nth(2);
    await operatorOption.waitFor({ state: "visible", timeout: 10000 });
    await operatorOption.click();

    const autoComplete = this.page.locator('[data-test="common-auto-complete"]');
    await autoComplete.waitFor({ state: "visible", timeout: 10000 });
    await autoComplete.click();
    await autoComplete.fill(filterConfig.value);
  }

  /**
   * Set default value for variable
   */
  async setDefaultValue(value) {
    await this.page
      .locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]')
      .click();
    await this.page.locator('[data-test="dashboard-variable-custom-value-0"]').fill(value);
  }

  /**
   * Select value from variable dropdown with API monitoring
   * @param {string} label - Variable label
   * @param {string} value - Value to select
   * @returns {Promise<boolean>} - Returns true if API was called successfully
   */
  async selectValueFromVariableDropDown(label, value) {
    const input = this.page.getByLabel(label, { exact: true });
    await input.waitFor({ state: "visible", timeout: 10000 });

    // Monitor API call when clicking dropdown
    const valuesStreamPromise = waitForValuesStreamComplete(this.page);
    await input.click();

    try {
      await valuesStreamPromise;
    } catch (error) {
      throw new Error(`Failed to load variable values API for ${label}: ${error.message}`);
    }

    await input.fill(value);

    const option = this.page.getByRole("option", { name: value });
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
    // The error is displayed as red text with the message "Variables has cycle:"
    // Look for text containing "cycle" in red color
    const errorElement = this.page.locator('div[style*="color: red"], div[style*="color:red"]').filter({ hasText: /cycle/i });
    try {
      await errorElement.waitFor({ state: "visible", timeout: 3000 });
      return true;
    } catch {
      // Fallback: check for any text containing "Variables has cycle"
      const fallbackError = this.page.getByText(/Variables has cycle/i);
      try {
        await fallbackError.waitFor({ state: "visible", timeout: 1000 });
        return true;
      } catch {
        return false;
      }
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

    // Find the variable row in the variables list
    const variableRow = this.page.locator(`[data-test="dashboard-variable-settings-draggable-row"]`);
    await variableRow.waitFor({ state: "visible", timeout: 5000 });

    // Hover over the scope chip to see the tooltip showing "Deleted Tab" or "Deleted Panel"
    const scopeChip = variableRow.locator('.q-chip, [class*="scope"]').first();
    await scopeChip.hover();

    // Wait for tooltip to appear and verify it contains "Deleted Tab" or "Deleted Panel"
    const expectedText = normalizedType === 'tab' ? 'Deleted Tab' : 'Deleted Panel';
    const tooltip = this.page.locator('.q-tooltip, [role="tooltip"]').filter({ hasText: new RegExp(expectedText, 'i') });
    await expect(tooltip).toBeVisible({ timeout: 5000 });
  }
}
