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
   * @param {Object} filterConfig - Optional filter configuration { filterName, operator, value }
   * @param {boolean} showMultipleValues - Toggle show multiple values
   * @param {string} scope - 'global', 'tabs', 'panels'
   * @param {Array} targetTabs - Array of tab names
   * @param {Array} targetPanels - Array of panel IDs
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
    targetPanels = []
  ) {
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await expect(variableTab).toBeAttached({ timeout: 10000 });

    // Ensure the settings panel is open; if not, finding the tab will fail or we might need to open it.
    // Assuming the settings modal is already open when this is called, based on previous usage patterns.
    await expect(variableTab).toBeVisible();
    await variableTab.click();

    // Add Variable
    const addVarBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    await addVarBtn.click();

    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

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
    await this.page.keyboard.type(field, { delay: 50 }); // Reduced delay

    // Wait for dropdown options
    await this.page.waitForFunction(
      () => document.querySelectorAll('[role="option"]').length > 0,
      { timeout: 10000 }
    );

    // Select field strategy
    await this.selectOptionFromDropdown(field);

    // Add Filter Configuration
    if (filterConfig) {
      const addFilterBtn = this.page.locator('[data-test="dashboard-add-filter-btn"]');
      await addFilterBtn.click();

      const filterNameSelector = this.page.locator('[data-test="dashboard-query-values-filter-name-selector"]');
      await filterNameSelector.click();
      await filterNameSelector.fill(filterConfig.filterName);

      const filterNameOption = this.page.getByRole("option", { name: filterConfig.filterName });
      await filterNameOption.click();

      const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]');
      await operatorSelector.click();

      const operatorOption = this.page.getByRole("option", { name: filterConfig.operator, exact: true }).locator("div").nth(2);
      await operatorOption.click();

      const autoComplete = this.page.locator('[data-test="common-auto-complete"]');
      await autoComplete.click();
      await autoComplete.fill(filterConfig.value);

      // If it's a variable reference ($var), we might just need to type it. 
      // If it's a value selection, we might need to click an option.
      // For now, assume filling is sufficient for variable references, 
      // but if it's a real value, we might want to try selecting it if it appears.
      try {
        const valueOption = this.page.getByRole("option", { name: filterConfig.value }).first();
        if (await valueOption.isVisible({ timeout: 2000 })) {
          await valueOption.click();
        }
      } catch (e) {
        // Ignore if option doesn't appear (e.g. for $variable reference)
      }
    }

    if (showMultipleValues) {
      await this.page
        .locator('[data-test="dashboard-query_values-show_multiple_values"] div')
        .nth(2)
        .click();
    }

    // Set Scope
    const scopeSelect = this.page.locator('[data-test="dashboard-variable-scope-select"]');
    await scopeSelect.click();

    let scopeLabel = 'Global';
    if (scope === 'tabs') scopeLabel = 'Selected Tabs';
    if (scope === 'panels') scopeLabel = 'Selected Panels';

    await this.page.getByRole("option", { name: scopeLabel, exact: true }).click();

    if (scope === 'tabs' || scope === 'panels') {
      const targetSelect = scope === 'tabs'
        ? this.page.locator('[data-test="dashboard-variable-tabs-select"]')
        : this.page.locator('[data-test="dashboard-variable-panels-select"]');

      await targetSelect.click();

      const targets = scope === 'tabs' ? targetTabs : targetPanels;
      for (const target of targets) {
        const option = this.page.getByRole("option", { name: target });
        await option.locator('.q-checkbox').click();
      }
      await this.page.keyboard.press('Escape');
    }

    // Custom Value Search
    if (customValueSearch) {
      await this.page.locator('[data-test="dashboard-multi-select-default-value-toggle-custom"]').click();
      await this.page.locator('[data-test="dashboard-add-custom-value-btn"]').click();
      await this.page.locator('[data-test="dashboard-variable-custom-value-0"]').click();
      await this.page.locator('[data-test="dashboard-variable-custom-value-0"]').fill("test");
    }

    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.click();

    // Wait for save to complete (button to disappear or some success indication)
    await expect(saveBtn).not.toBeVisible({ timeout: 5000 });

    // Close settings
    const closeBtn = this.page.locator('[data-test="dashboard-settings-close-btn"]');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
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

    // Click to open dropdown
    await input.click();

    // Wait for options to appear or stream to complete
    // We race these because sometimes data is cached or comes different ways
    await Promise.race([
      this.page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 }),
      waitForValuesStreamComplete(this.page, 5000)
    ]).catch(() => console.log('Wait for options/stream timed out or non-critical error'));

    await input.fill(value);

    // Ensure the specific option is visible before clicking
    const option = this.page.getByRole("option", { name: value });
    await expect(option).toBeVisible();
    await option.click();
  }

  async selectValueFromScopedVariable(name, value, scope = 'global', targetId = null) {
    let selectorLocator = this.getVariableSelectorLocator(name, scope, targetId);

    // Scroll if needed
    await selectorLocator.scrollIntoViewIfNeeded();

    const input = selectorLocator.locator('input');
    await input.click();
    await input.fill(value);

    const option = this.page.getByRole("option", { name: value, exact: true });
    await expect(option).toBeVisible();
    await option.click();
  }

  getVariableSelectorLocator(name, scope, targetId) {
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
    const selector = this.getVariableSelectorLocator(name, scope, targetId);
    await expect(selector).toBeVisible();
  }

  async verifyVariableNotVisible(name, scope = 'global', targetId = null) {
    const selector = this.getVariableSelectorLocator(name, scope, targetId);
    await expect(selector).not.toBeVisible();
  }

  async getVariableValue(name, scope = 'global', targetId = null) {
    const selector = this.getVariableSelectorLocator(name, scope, targetId);
    return await selector.locator('input').inputValue();
  }

  setupApiTracking() {
    const apiCalls = [];
    this.page.on('response', response => {
      if (response.url().includes('/_values') && response.status() === 200) {
        apiCalls.push({
          url: response.url(),
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
      await expect(refreshBtn).toHaveClass(/text-warning|bg-warning/);
    } else {
      await expect(refreshBtn).not.toHaveClass(/text-warning|bg-warning/);
    }
  }

  async verifyPanelRefreshIndicator(panelId, shouldBeVisible) {
    const refreshBtn = this.page.locator(`[data-test-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-panel-btn"]`);
    if (shouldBeVisible) {
      await expect(refreshBtn).toHaveClass(/text-warning|bg-warning/);
    } else {
      await expect(refreshBtn).not.toHaveClass(/text-warning|bg-warning/);
    }
  }

  async waitForVariableApiCall(fieldName, timeout = 10000) {
    await this.page.waitForResponse(
      resp => resp.url().includes(`/_values`) && resp.url().includes(fieldName) && resp.status() === 200,
      { timeout }
    );
  }
}
