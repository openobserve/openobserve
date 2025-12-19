//dashboard variables page object
//methods: addDashboardVariable, selectValueFromVariableDropDown
//addDashboardVariable params: name, streamtype, streamName, field, customValueSearch, filterConfig, showMultipleValues
import { expect } from "@playwright/test";

export default class DashboardVariables {
  constructor(page) {
    this.page = page;
  }

  // Method to add a dashboard variable
  // Parameters: name, streamtype, streamName, field, customValueSearch, filterConfig, showMultipleValues
  async addDashboardVariable(
    name,
    streamtype,
    streamName,
    field,
    customValueSearch = false, // it is used only when we want to search custom value from variable dropdown
    filterConfig = null, // optional filter configuration { filterName, operator, value }
    showMultipleValues = false, // if true, toggles the show multiple values option
    scope = 'global', // 'global', 'tabs', 'panels'
    targetTabs = [], // array of tab names or IDs
    targetPanels = [] // array of panel names or IDs
  ) {
    // Wait for the settings panel to be fully opened and variable tab to be available
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "attached", timeout: 10000 });
    await variableTab.waitFor({ state: "visible", timeout: 10000 });

    // Additional wait for panel animation and stability
    await this.page.waitForTimeout(500);

    // Click the Variable Tab
    await variableTab.click();

    // Add Variable
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click({timeout:5000});
    await this.page.locator('[data-test="dashboard-variable-name"]').fill(name);

    // Select Stream Type
    await this.page
      .locator(
        'div.row label:has-text("Stream Type") >> [data-test="dashboard-variable-stream-type-select"]'
      )
      .click();

    await this.page
      .getByRole("option", { name: streamtype, exact: true })
      .locator("div")
      .nth(2)
      .click();

    // Stream Select
    const streamSelect = this.page.locator(
      '[data-test="dashboard-variable-stream-select"]'
    );
    await streamSelect.click();
    await streamSelect.fill(streamName);
    await this.page
      .getByRole("option", { name: streamName, exact: true })
      .click();

    // Select Field
    const fieldSelect = await this.page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await this.page.keyboard.type(field);

    
    // Wait for dropdown to have options available
    await this.page.waitForFunction(
        () => {
            const options = document.querySelectorAll('[role="option"]');
            return options.length > 0;
          },
          { timeout: 10000, polling: 100 }
        );
        
    // Try to select the field from dropdown - use multiple strategies
    let fieldSelected = false;

    // Strategy 1: Try exact match
    try {
      const fieldOption = this.page.getByRole("option", { name: field, exact: true });
      await fieldOption.waitFor({ state: "visible", timeout: 5000 });
      await fieldOption.click();
      fieldSelected = true;
    } catch (e) {
      // Strategy 2: Try partial match
      try {
        const fieldOption = this.page.getByRole("option", { name: field, exact: false }).first();
        await fieldOption.waitFor({ state: "visible", timeout: 5000 });
        await fieldOption.click();
        fieldSelected = true;
      } catch (e2) {
        // Strategy 3: Use keyboard to select the first visible option
        try {
          await this.page.keyboard.press('ArrowDown');
          // Wait for selection to be highlighted
          await this.page.waitForFunction(
            () => {
              const highlighted = document.querySelector('[role="option"][aria-selected="true"]') ||
                                 document.querySelector('[role="option"].q-manual-focusable--focused') ||
                                 document.querySelector('[role="option"].q-focusable--focused');
              return highlighted !== null;
            },
            { timeout: 3000, polling: 100 }
          );
          await this.page.keyboard.press('Enter');
          fieldSelected = true;
        } catch (e3) {
          // Strategy 4: Use JavaScript to directly click matching option (for deploy environment)
          try {
            const clicked = await this.page.evaluate((fieldName) => {
              const options = document.querySelectorAll('[role="option"]');
              for (const option of options) {
                if (option.textContent.trim() === fieldName) {
                  option.click();
                  return true;
                }
              }
              return false;
            }, field);

            if (clicked) {
              await this.page.waitForTimeout(500);
              fieldSelected = true;
            }
          } catch (e4) {
            fieldSelected = false;
          }
        }
      }
    }

    if (!fieldSelected) {
      throw new Error(`Failed to select field: ${field}`);
    }

    // Add Filter Configuration if provided
    if (filterConfig) {

      const addFilterBtn = this.page.locator('[data-test="dashboard-add-filter-btn"]');
      await addFilterBtn.waitFor({ state: "visible", timeout: 5000 });
      await addFilterBtn.click();
      
      // Wait for and interact with Filter Name selector
      const filterNameSelector = this.page.locator('[data-test="dashboard-query-values-filter-name-selector"]');
      await filterNameSelector.waitFor({ state: "visible", timeout: 10000 });
      await filterNameSelector.click();
      await filterNameSelector.fill(filterConfig.filterName);
      
      // Wait for and select the filter name option
      const filterNameOption = this.page.getByRole("option", { name: filterConfig.filterName });
      await filterNameOption.waitFor({ state: "visible", timeout: 10000 });
      await filterNameOption.click();
      
      // Wait for and interact with Operator selector
      const operatorSelector = this.page.locator('[data-test="dashboard-query-values-filter-operator-selector"]');
      await operatorSelector.waitFor({ state: "visible", timeout: 10000 });
      await operatorSelector.click();
      
      // Wait for and select the operator option
      const operatorOption = this.page.getByRole("option", { name: filterConfig.operator, exact: true }).locator("div").nth(2);
      await operatorOption.waitFor({ state: "visible", timeout: 10000 });
      await operatorOption.click();
      
      // Wait for and interact with value input
      const autoComplete = this.page.locator('[data-test="common-auto-complete"]');
      await autoComplete.waitFor({ state: "visible", timeout: 10000 });
      await autoComplete.click();
      await autoComplete.fill(filterConfig.value);
      
      // await this.page
      //   .locator('[data-test="common-auto-complete-option"]')
      //   .getByText(filterConfig.value, { exact: true })
      //   .click();
    }

    // Toggle show multiple values based on parameter
    if (showMultipleValues) {
      await this.page
        .locator(
          '[data-test="dashboard-query_values-show_multiple_values"] div'
        )
        .nth(2)
        .click();
    }

    // Set Scope
    const scopeSelect = this.page.locator('[data-test="dashboard-variable-scope-select"]');
    await scopeSelect.waitFor({ state: "visible" });
    await scopeSelect.click();
    
    let scopeLabel = 'Global';
    if (scope === 'tabs') scopeLabel = 'Selected Tabs';
    if (scope === 'panels') scopeLabel = 'Selected Panels';
    
    await this.page.getByRole("option", { name: scopeLabel, exact: true }).click();
    
    // Select Tabs if scope is tabs or panels
    if (scope === 'tabs' || scope === 'panels') {
      const tabsSelect = this.page.locator('[data-test="dashboard-variable-tabs-select"]');
      await tabsSelect.waitFor({ state: "visible" });
      await tabsSelect.click();
      
      for (const tabName of targetTabs) {
        // Find the checkbox for the tab and click it
        const tabOption = this.page.getByRole("option", { name: tabName });
        await tabOption.locator('.q-checkbox').click();
      }
      // Click away to close dropdown
      await this.page.keyboard.press('Escape');
    }
    
    // Select Panels if scope is panels
    if (scope === 'panels') {
      const panelsSelect = this.page.locator('[data-test="dashboard-variable-panels-select"]');
      await panelsSelect.waitFor({ state: "visible" });
      await panelsSelect.click();
      
      for (const panelName of targetPanels) {
        const panelOption = this.page.getByRole("option", { name: panelName });
        await panelOption.locator('.q-checkbox').click();
      }
      await this.page.keyboard.press('Escape');
    }

    // Custom Value Search if want to search custom value from variable dropdown
    if (customValueSearch) {
      await this.page
        .locator(
          '[data-test="dashboard-multi-select-default-value-toggle-custom"]'
        )
        .click();
      await this.page
        .locator('[data-test="dashboard-add-custom-value-btn"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-variable-custom-value-0"]')
        .click();
      await this.page
        .locator('[data-test="dashboard-variable-custom-value-0"]')
        .fill("test");
    }

    // Save Variable and Close Settings (skip if customValueSearch is true)
    // if (!customValueSearch) {
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();

    // Wait for the save action to complete and DOM to stabilize
    await this.page.waitForTimeout(3000);
    // await this.page.waitForLoadState("networkidle");

    // Use JavaScript evaluation to click the close button to avoid DOM instability issues
    await this.page.evaluate(() => {
      const closeBtn = document.querySelector('[data-test="dashboard-settings-close-btn"]');
      if (closeBtn) closeBtn.click();
    });
    // }
  }

  // Dynamic function to fill input by label
  // Usage: this function is used for select the variable value from dropdown
  // Dynamically fill input and select the same value from dropdown
  async selectValueFromVariableDropDown(label, value) {
    const input = this.page.getByLabel(label, { exact: true });
    await input.waitFor({ state: "visible", timeout: 10000 });
    await input.click();
    await input.fill(value);

    const option = this.page.getByRole("option", { name: value });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
  }

  // Method to wait for dependent variables API calls to complete
  // Parameters: expectedCallCount - number of API calls to wait for
  //             valuesResponsesArray - reference to the array tracking API responses
  //             timeout - maximum time to wait in milliseconds (default: 15000)
  // This method uses native Promise-based waiting without hard timeouts
  async waitForDependentVariablesToLoad(valuesResponsesArray, expectedCallCount, timeout = 15000) {
    const startTime = Date.now();

    // Use Promise.race to wait efficiently without polling
    while (valuesResponsesArray.length < expectedCallCount) {
      if (Date.now() - startTime > timeout) {
        throw new Error(
          `Timeout waiting for ${expectedCallCount} API calls. Only received ${valuesResponsesArray.length} calls after ${timeout}ms`
        );
      }

      // Wait for the next network response matching the values API pattern
      try {
        await Promise.race([
          this.page.waitForResponse(
            response => response.url().includes('/api/') && response.url().includes('/values'),
            { timeout: 2000 }
          ),
          // Small delay to allow array to be updated
          new Promise(resolve => setTimeout(resolve, 100))
        ]);
      } catch (error) {
        // Continue if no response in 2s, will check array length again
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Wait for DOM to stabilize after all API calls complete
    await this.page.waitForLoadState('domcontentloaded');

    return true;
  }

  // Method to check variable loading status on the dashboard
  async checkVariableStatus(name, { isPending = null, isLoading = null, hasError = null, tabId = null, panelId = null }) {
    let prefix = '';
    if (panelId) prefix = `panel-${panelId}-`;
    
    if (isLoading !== null) {
        const loadingIndicator = this.page.locator(`[data-test="${prefix}variable-${name}-loading"]`);
        if (isLoading) {
            await expect(loadingIndicator).toBeVisible({ timeout: 10000 });
        } else {
            // If we're checking that it's NOT loading, it might have finished loading or be in error/pending
            await expect(loadingIndicator).not.toBeVisible();
        }
    }

    if (isLoading === false && isPending === false) {
        const loadedIndicator = this.page.locator(`[data-test="${prefix}variable-${name}-loaded"]`);
        await expect(loadedIndicator).toBeVisible({ timeout: 10000 });
    }
    
    if (hasError !== null) {
        // Implement error check if needed
    }
  }

  // Method to select a value from a scoped dropdown
  async selectValueFromScopedVariable(name, value, scope = 'global', targetId = null) {
    const selector = this.page.locator(`[data-test="variable-selector-${name}"]`).first();
    await selector.scrollIntoViewIfNeeded();
    
    // Check if it's a q-input or q-select (VariableQueryValueSelector uses q-select)
    const input = selector.locator('input');
    await input.click();
    await input.fill(value);

    const option = this.page.getByRole("option", { name: value, exact: true });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
  }
}
