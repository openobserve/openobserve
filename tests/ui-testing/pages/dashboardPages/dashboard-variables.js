//dashboard variables page object
//methods: addDashboardVariable, selectValueFromVariableDropDown
//addDashboardVariable params: name, streamtype, streamName, field, customValueSearch, filterConfig, showMultipleValues
import { expect } from "@playwright/test";
import { waitForValuesStreamComplete } from "../../playwright-tests/utils/streaming-helpers.js";

export default class DashboardVariables {
  constructor(page) {
    this.page = page;
  }

  /**
   * Add a dashboard variable with specified configuration
   * @param {string} name - Variable name
   * @param {string} streamtype - Stream type (logs, metrics, traces)
   * @param {string} streamName - Name of the stream
   * @param {string} field - Field name
   * @param {boolean} customValueSearch - Whether to use custom value search
   * @param {Object|Array} filterConfig - Optional filter configuration { filterName, operator, value } or array of them
   * @param {boolean} showMultipleValues - Toggle show multiple values
   * @param {string} scope - 'global', 'tabs', 'panels'
   * @param {Array} targetTabs - Array of tab names
   * @param {Array} targetPanels - Array of panel IDs
   * @param {boolean} save - Whether to save immediately
   */
  async addDashboardVariable(
    name,
    streamtype,
    streamName,
    field,
    customValueSearch = false,
    filterConfig = null,
    showMultipleValues = false,
    scope = 'global',
    targetTabs = [],
    targetPanels = [],
    save = true
  ) {
    await this.openVariablesTab();

    // Add Variable
    const addVarBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    await addVarBtn.click();

    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

    await this.selectVariableType('Query Values');

    // Select Stream Type
    await this.page
      .locator('div.row label:has-text("Stream Type") >> [data-test="dashboard-variable-stream-type-select"]')
      .click();

    await this.page
      .getByRole("option", { name: streamtype, exact: true })
      .locator("div")
      .nth(2)
      .click();

    // Stream Select
    const streamSelect = this.page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill(streamName);
    await this.page.getByRole("option", { name: streamName, exact: true }).click();

    // Select Field
    const fieldSelect = this.page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill(field);

    // Wait for dropdown options
    await this.page.waitForFunction(
      () => document.querySelectorAll('[role="option"]').length > 0,
      { timeout: 10000 }
    );

    // Select field strategy
    await this.selectOptionFromDropdown(field);

    // Add Filter Configuration
    if (filterConfig) {
      const filters = Array.isArray(filterConfig) ? filterConfig : [filterConfig];
      for (const filter of filters) {
        await this.addFilter(filter);
      }
    }

    if (showMultipleValues) {
      await this.toggleShowMultipleValues();
    }

    // Set Scope
    if (scope !== 'global' || targetTabs.length > 0 || targetPanels.length > 0) {
      await this.setScope(scope, targetTabs, targetPanels);
    }

    // Custom Value Search
    if (customValueSearch) {
      await this.toggleCustomValue("test");
    }

    if (save) {
      await this.saveVariable();
      await this.closeSettings();
    }
  }

  async addConstantVariable(name, value, save = true) {
    await this.openVariablesTab();
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();

    await this.selectVariableType('Constant');
    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);
    await this.page.locator('[data-test="dashboard-variable-constant-value"]').fill(value);

    if (save) {
      await this.saveVariable();
      await this.closeSettings();
    }
  }

  async addTextBoxVariable(name, save = true) {
    await this.openVariablesTab();
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();

    await this.selectVariableType('TextBox');
    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

    if (save) {
      await this.saveVariable();
      await this.closeSettings();
    }
  }

  async addCustomVariable(name, label, value, save = true) {
    await this.openVariablesTab();
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();

    await this.selectVariableType('Custom');
    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

    await this.page.getByRole("button", { name: "Add Option" }).click();
    await this.page.locator('[data-test="dashboard-custom-variable-0-label"]').fill(label);
    await this.page.locator('[data-test="dashboard-custom-variable-0-value"]').fill(value);

    if (save) {
      await this.saveVariable();
      await this.closeSettings();
    }
  }

  async openVariablesTab() {
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    const closeBtn = this.page.locator('[data-test="dashboard-settings-close-btn"]');

    if (!await closeBtn.isVisible()) {
      const settingsBtn = this.page.locator('[data-test="dashboard-setting-btn"]');
      await settingsBtn.waitFor({ state: "visible" });
      await settingsBtn.click();
    }

    await variableTab.waitFor({ state: "visible" });
    await variableTab.click();
  }

  async selectVariableType(type) {
    await this.page.locator('[data-test="dashboard-variable-type-select"]').click();
    await this.page.getByRole("option", { name: type }).click();
  }

  async addFilter(filter) {
    const addFilterBtn = this.page.locator('[data-test="dashboard-add-filter-btn"]');
    await addFilterBtn.click();

    const filterNameSelector = this.page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.click();
    await filterNameSelector.fill(filter.filterName);

    await this.page.getByRole("option", { name: filter.filterName }).click();

    const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.click();
    await this.page.getByRole("option", { name: filter.operator }).locator('div').nth(2).click();

    const autoComplete = this.page.locator('[data-test="common-auto-complete"]').last();
    await autoComplete.click();
    await autoComplete.fill(filter.value);

    try {
      const option = this.page.getByRole("option", { name: filter.value }).first();
      if (await option.isVisible({ timeout: 1000 })) await option.click();
    } catch (e) { }
  }

  async setScope(scope, targetTabs, targetPanels) {
    const scopeSelect = this.page.locator('[data-test="dashboard-variable-scope-select"]');
    await scopeSelect.click();

    let scopeLabel = 'Global';
    if (scope === 'tabs' || scope === 'tab') scopeLabel = 'Selected Tabs';
    if (scope === 'panels' || scope === 'panel') scopeLabel = 'Selected Panels';

    await this.page.getByRole("option", { name: scopeLabel, exact: true }).click();

    if (scope === 'tabs' || scope === 'tab' || scope === 'panels' || scope === 'panel') {
      const isTab = (scope === 'tabs' || scope === 'tab');
      const targetSelect = isTab
        ? this.page.locator('[data-test="dashboard-variable-tabs-select"]')
        : this.page.locator('[data-test="dashboard-variable-panels-select"]');

      await targetSelect.click();

      const targets = isTab ? targetTabs : targetPanels;
      for (const target of targets) {
        const option = this.page.getByRole("option", { name: target });
        await option.scrollIntoViewIfNeeded();
        if (await option.isVisible()) {
          await option.locator('.q-checkbox').click();
        }
      }
      await this.page.keyboard.press('Escape');
    }
  }

  async toggleShowMultipleValues() {
    await this.page
      .locator('[data-test="dashboard-query_values-show_multiple_values"] div')
      .nth(2)
      .click();
  }

  async setVariableMaxRecordSize(value) {
    await this.page.locator('[data-test="dashboard-variable-max-record-size"]').fill(value.toString());
  }

  async toggleCustomValue(value) {
    await this.page.locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]').click();
    if (value) {
      const customValueInput = this.page.locator('[data-test="dashboard-variable-custom-value-0"]');
      if (!await customValueInput.isVisible()) {
        await this.page.locator('[data-test="dashboard-add-custom-value-btn"]').click();
      }
      await customValueInput.click();
      await customValueInput.fill(value);
    }
  }

  async hideVariable() {
    const toggle = this.page.locator('[data-test="dashboard-variable-hide_on_dashboard"]');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click({ force: true });
  }

  async saveVariable() {
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.click();
    await expect(saveBtn).not.toBeVisible({ timeout: 10000 });
  }

  async cancelVariableCreation() {
    await this.page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
  }

  async closeSettings() {
    const closeBtn = this.page.locator('[data-test="dashboard-settings-close-btn"]');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  }

  generateVariableName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  async selectOptionFromDropdown(text) {
    try {
      const exactOption = this.page.getByRole("option", { name: text, exact: true });
      if (await exactOption.isVisible({ timeout: 3000 })) {
        await exactOption.click();
        return;
      }
    } catch (e) { }

    try {
      const partialOption = this.page.getByRole("option", { name: text, exact: false }).first();
      if (await partialOption.isVisible({ timeout: 3000 })) {
        await partialOption.click();
        return;
      }
    } catch (e) { }

    // Fallback: arrow down and enter
    await this.page.keyboard.press('ArrowDown');
    await this.page.waitForTimeout(200);
    await this.page.keyboard.press('Enter');
  }

  async selectValueFromVariableDropDown(label, value) {
    const input = this.page.getByLabel(label, { exact: true });
    await expect(input).toBeVisible();
    await input.click();

    await Promise.race([
      this.page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 }),
      waitForValuesStreamComplete(this.page, 5000)
    ]).catch(() => console.log('Wait for options/stream timed out or non-critical error'));

    await input.fill(value);

    const option = this.page.getByRole("option", { name: value });
    await expect(option).toBeVisible();
    await option.click();
  }

  async selectValueFromScopedVariable(name, value, scope = 'global', targetId = null) {
    let selectorLocator = await this.getVariableSelectorLocator(name, scope, targetId);
    await selectorLocator.scrollIntoViewIfNeeded();

    const input = selectorLocator.locator('input');
    await input.click();

    // Wait for values API to call
    await Promise.race([
      this.page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 }),
      waitForValuesStreamComplete(this.page, 5000)
    ]).catch(() => { });

    await input.fill(value);

    const option = this.page.getByRole("option", { name: value, exact: true });
    await expect(option).toBeVisible();
    await option.click();
  }

  async getVariableSelectorLocator(name, scope, targetId) {
    if (scope === 'global') {
      return this.page.locator('[data-test="global-variables-selector"]').locator(`[data-test="variable-selector-${name}"]`);
    } else if (scope === 'tab') {
      return this.page.locator('[data-test="tab-variables-selector"]').locator(`[data-test="variable-selector-${name}"]`);
    } else if (scope === 'panel') {
      return this.page.locator(`[data-test-panel-id="${targetId}"]`).locator(`[data-test="variable-selector-${name}"]`);
    }
    throw new Error(`Unknown scope: ${scope}`);
  }

  async verifyVariableVisibleInScope(name, scope = 'global', targetId = null) {
    const selector = await this.getVariableSelectorLocator(name, scope, targetId);
    await expect(selector).toBeVisible();
  }

  async verifyVariableNotVisible(name, scope = 'global', targetId = null) {
    if (scope === 'global') {
      await expect(this.page.locator('[data-test="global-variables-selector"]').locator(`[data-test="variable-selector-${name}"]`)).not.toBeVisible();
    } else if (scope === 'tab') {
      await expect(this.page.locator('[data-test="tab-variables-selector"]').locator(`[data-test="variable-selector-${name}"]`)).not.toBeVisible();
    } else if (scope === 'panel') {
      await expect(this.page.locator(`[data-test-panel-id="${targetId}"]`).locator(`[data-test="variable-selector-${name}"]`)).not.toBeVisible();
    }
  }

  async getVariableValue(name, scope = 'global', targetId = null) {
    try {
      const selector = await this.getVariableSelectorLocator(name, scope, targetId);
      return await selector.locator('input').inputValue();
    } catch (e) {
      return "";
    }
  }

  setupApiTracking() {
    const apiCalls = [];
    this.page.on('request', request => {
      if (request.url().includes('/_values')) {
        apiCalls.push({
          url: request.url(),
          method: request.method(),
          postData: request.postDataJSON(),
          timestamp: Date.now()
        });
      }
    });
    return apiCalls;
  }

  async verifyCircularDependencyError() {
    const errorText = this.page.locator('text=/Variables has cycle|Circular dependency detected/i');
    await expect(errorText).toBeVisible();
  }

  async verifyGlobalRefreshIndicator(shouldBeVisible) {
    const refreshBtn = this.page.locator('[data-test="dashboard-refresh-btn"]');
    if (shouldBeVisible) {
      // Check for yellow indicator (text-warning mapping)
      await expect(refreshBtn).toHaveClass(/text-yellow|bg-yellow|warning/);
    } else {
      await expect(refreshBtn).not.toHaveClass(/text-yellow|bg-yellow|warning/);
    }
  }

  async verifyPanelRefreshIndicator(panelId, shouldBeVisible) {
    const refreshBtn = this.page.locator(`[data-test-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-panel-btn"]`);
    if (shouldBeVisible) {
      await expect(refreshBtn).toHaveClass(/text-yellow|bg-yellow|warning/);
    } else {
      await expect(refreshBtn).not.toHaveClass(/text-yellow|bg-yellow|warning/);
    }
  }

  async waitForVariableApiCall(fieldName, timeout = 10000) {
    return await this.page.waitForResponse(
      resp => resp.url().includes(`/_values`) && (resp.url().includes(fieldName) || (resp.request().postData() && resp.request().postData().includes(fieldName))) && resp.status() === 200,
      { timeout }
    );
  }

  async verifyVariableOptionsLoaded(name) {
    const selector = await this.getVariableSelectorLocator(name, 'global');
    await selector.click();
    await expect(this.page.locator('[role="option"]').first()).toBeVisible({ timeout: 10000 });
    await this.page.keyboard.press('Escape');
  }

  async checkVariableStatus(name, { isLoading, isSuccess, isError, scope = 'global', targetId = null }) {
    const selector = await this.getVariableSelectorLocator(name, scope, targetId);
    if (isLoading) {
      await expect(selector.locator('.q-spinner, .loading-icon')).toBeVisible();
    }
    if (isSuccess) {
      await expect(selector.locator('.q-spinner, .loading-icon')).not.toBeVisible();
    }
    if (isError) {
      await expect(selector).toHaveClass(/error|border-red/);
    }
  }

  async editVariable(name, newConfig) {
    await this.openVariablesTab();

    const editBtn = this.page.locator(`[data-test="variable-edit-btn-${name}"]`);
    await editBtn.click();

    if (newConfig.filterConfig) {
      // Clear filters and re-add
      const deleteFilters = await this.page.locator('[data-test="dashboard-query-values-filter-delete-btn"]').all();
      for (const btn of deleteFilters) {
        await btn.click();
      }

      const filters = Array.isArray(newConfig.filterConfig) ? newConfig.filterConfig : [newConfig.filterConfig];
      for (const filter of filters) {
        await this.addFilter(filter);
      }
    }

    await this.saveVariable();
    await this.closeSettings();
  }

  async deleteVariable(name) {
    await this.openVariablesTab();

    const deleteBtn = this.page.locator(`[data-test="variable-delete-btn-${name}"]`);
    await deleteBtn.click();

    const confirmBtn = this.page.locator('[data-test="confirm-button"]');
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }
  }

  async verifyTargetTabLabel(variableName, tabName, expectedLabel) {
    await this.openVariablesTab();

    const editBtn = this.page.locator(`[data-test="variable-edit-btn-${variableName}"]`);
    await editBtn.waitFor({ state: "visible" });
    await editBtn.click();

    const targetSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
    await targetSelect.click();

    // Check for the label in the dropdown
    await expect(this.page.getByRole("option").filter({ hasText: expectedLabel })).toBeVisible();

    await this.page.keyboard.press('Escape');
    await this.closeSettings();
  }
}
