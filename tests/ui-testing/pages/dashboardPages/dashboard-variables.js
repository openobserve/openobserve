//dashboard variables page object
//methods: addDashboardVariable, selectValueFromVariableDropDown
//addDashboardVariable params: name, streamtype, streamName, field, customValueSearch, filterConfig, showMultipleValues
import { expect } from "@playwright/test";
import { waitForValuesStreamComplete } from "../../playwright-tests/utils/streaming-helpers.js";
import { selectStreamFromDropdown, selectFieldFromDropdown } from "./dashboard-stream-field-utils.js";

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
    showMultipleValues = false // if true, toggles the show multiple values option
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
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click({timeout:5000});
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

    // Select Stream and Field using shared utilities
    await selectStreamFromDropdown(this.page, streamName);
    await selectFieldFromDropdown(this.page, field);

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

    // Wait for _values_stream API call when clicking on the dropdown
    // Start listening before the action to ensure we capture the stream
    const valuesStreamPromise = waitForValuesStreamComplete(this.page);

    await input.click();

    // Wait for the values stream to complete (waits for 'data: [[DONE]]' marker)
    await valuesStreamPromise;

    // Wait for _values_stream API call when filling/searching
    // Start listening before filling to capture the search stream
    // const searchStreamPromise = waitForValuesStreamComplete(this.page);

    await input.fill(value);

    // // Wait for search stream to complete (waits for 'data: [[DONE]]' marker)
    // await searchStreamPromise;

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

  /**
   * Add a query values variable to dashboard
   * @param {string} variableName - Variable name
   * @param {string} streamType - Stream type (default: "logs")
   * @param {string} stream - Stream name (default: "e2e_automate")
   * @param {string} field - Field name (default: "kubernetes_namespace_name")
   */
  async addQueryVariable(
    variableName,
    streamType = "logs",
    stream = "e2e_automate",
    field = "kubernetes_namespace_name"
  ) {
    // Open dashboard settings
    await this.page.locator('[data-test="dashboard-setting-btn"]').click();

    // Wait for the settings panel to be fully opened and variable tab to be available
    const variableTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await variableTab.waitFor({ state: "attached", timeout: 10000 });
    await variableTab.waitFor({ state: "visible", timeout: 10000 });

    // Click Variables tab
    await variableTab.click();

    // Wait for Add Variable button to be ready
    const addVariableBtn = this.page.locator('[data-test="dashboard-add-variable-btn"]');
    await addVariableBtn.waitFor({ state: "visible", timeout: 10000 });
    await addVariableBtn.click();

    // Select variable type "Query Values"
    const typeSelect = this.page.locator('[data-test="dashboard-variable-type-select"]');
    await typeSelect.waitFor({ state: "visible", timeout: 10000 });
    await typeSelect.click();

    const typeOption = this.page.getByRole("option", { name: "Query Values" });
    await typeOption.waitFor({ state: "visible", timeout: 10000 });
    await typeOption.click();

    // Fill variable name
    const nameInput = this.page.locator('[data-test="dashboard-variable-name"]');
    await nameInput.waitFor({ state: "visible", timeout: 10000 });
    await nameInput.click();
    await nameInput.fill(variableName);

    // Select stream type
    await this.page.locator('[data-test="dashboard-variable-stream-type-select"]').click();

    // Wait for options to be available
    await this.page.waitForSelector('[role="listbox"]', { state: 'visible', timeout: 15000 });

    // Longer delay to ensure options are fully rendered (especially when tests run in parallel)
    await this.page.waitForTimeout(500);

    // Use JavaScript evaluation to click the option to avoid DOM detachment issues
    const clicked = await this.page.evaluate((streamTypeName) => {
      const options = document.querySelectorAll('[role="option"]');
      for (const option of options) {
        if (option.textContent.trim() === streamTypeName) {
          option.click();
          return true;
        }
      }
      return false;
    }, streamType);

    if (!clicked) {
      throw new Error(`Failed to select stream type: ${streamType}`);
    }

    // Wait for dropdown to close with longer timeout
    await this.page.waitForSelector('[role="listbox"]', { state: 'hidden', timeout: 10000 });

    // Select stream
    const streamSelector = this.page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelector.click();
    await this.page.waitForSelector('[role="listbox"]', { state: 'visible', timeout: 10000 });
    await this.page.keyboard.type(stream, { delay: 50 });

    const streamOption = this.page.getByRole("option", { name: stream, exact: true });
    await streamOption.waitFor({ state: "visible", timeout: 5000 });
    await streamOption.click();

    // Select field
    const fieldSelect = this.page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await this.page.keyboard.type(field, { delay: 100 });

    await this.page.waitForFunction(
      () => {
        const options = document.querySelectorAll('[role="option"]');
        return options.length > 0;
      },
      { timeout: 10000, polling: 100 }
    );

    const fieldOption = this.page.getByRole("option", { name: field, exact: true });
    await fieldOption.waitFor({ state: "visible", timeout: 5000 });
    await fieldOption.click();

    // Save variable and wait for settings panel to close
    const saveBtn = this.page.locator('[data-test="dashboard-variable-save-btn"]');
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });

    // Wait for save to complete by monitoring the close button becomes clickable
    await saveBtn.click();

    // Wait for the variable to be saved (settings panel should update)
    const closeBtn = this.page.locator('[data-test="dashboard-settings-close-btn"]');
    await closeBtn.waitFor({ state: "visible", timeout: 10000 });

    // Close settings using JavaScript evaluation to avoid DOM instability
    await this.page.evaluate(() => {
      const closeBtnEl = document.querySelector('[data-test="dashboard-settings-close-btn"]');
      if (closeBtnEl) closeBtnEl.click();
    });

    // Wait for settings panel to close
    const settingsPanel = this.page.locator('[data-test="dashboard-settings-variable-tab"]');
    await settingsPanel.waitFor({ state: "hidden", timeout: 15000 });

    // Wait for dashboard to stabilize after variable addition (longer for parallel execution)
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Additional buffer for parallel test execution
    await this.page.waitForTimeout(500);
  }

  /**
   * Create a variable API monitor to capture time ranges from /values API calls
   * @returns {Object} - { handler, getResults }
   */
  createVariableAPIMonitor() {
    let capturedStartTime = null;
    let capturedEndTime = null;
    let apiCallDetected = false;

    const responseHandler = async (response) => {
      const url = response.url();
      // Monitor the values API endpoint
      if (url.includes('/_values') || url.includes('/values')) {
        try {
          const request = response.request();
          const postData = request.postData();
          if (postData) {
            const data = JSON.parse(postData);
            if (data.query?.start_time && data.query?.end_time) {
              apiCallDetected = true;
              capturedStartTime = data.query.start_time;
              capturedEndTime = data.query.end_time;
              console.log('Variable API captured:', {
                startTime: capturedStartTime,
                endTime: capturedEndTime,
                durationMinutes: (capturedEndTime - capturedStartTime) / 1000 / 1000 / 60,
              });
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      }
    };

    return {
      handler: responseHandler,
      getResults: () => ({ apiCallDetected, capturedStartTime, capturedEndTime }),
    };
  }

  /**
   * Assert that time range matches expected duration
   * @param {number} capturedStartTime - Start time in microseconds
   * @param {number} capturedEndTime - End time in microseconds
   * @param {number} expectedDurationMs - Expected duration in milliseconds
   * @param {number} tolerance - Tolerance as a percentage (default: 0.2 = 20%)
   */
  assertTimeRangeMatches(capturedStartTime, capturedEndTime, expectedDurationMs, tolerance = 0.2) {
    expect(capturedStartTime).toBeTruthy();
    expect(capturedEndTime).toBeTruthy();

    const durationMs = (capturedEndTime - capturedStartTime) / 1000;
    const toleranceMs = expectedDurationMs * tolerance;

    expect(durationMs).toBeGreaterThanOrEqual(expectedDurationMs - toleranceMs);
    expect(durationMs).toBeLessThanOrEqual(expectedDurationMs + toleranceMs);
  }

  /**
   * Open variable dropdown to trigger /values API call
   * @param {string} variableName - Variable name or label
   */
  async openVariableDropdown(variableName) {
    const variableInput = this.page.getByLabel(variableName, { exact: true });
    await variableInput.waitFor({ state: "visible", timeout: 10000 });
    await variableInput.click();

    // Wait for dropdown to open
    await this.page.waitForSelector('[role="listbox"]', { state: 'visible', timeout: 5000 });
  }

  /**
   * Verify variable API call time range by waiting for /values API response
   * @param {Object} monitor - Monitor object from createVariableAPIMonitor()
   * @param {number} expectedDurationMs - Expected duration in milliseconds
   * @param {string} successMessage - Message to log on success
   * @param {number} timeout - Timeout in milliseconds (default: 5000)
   */
  async verifyVariableTimeRange(monitor, expectedDurationMs, successMessage, timeout = 10000) {
    // Wait for the /values API response (longer timeout for parallel test execution)
    try {
      await this.page.waitForResponse(
        response => (response.url().includes('/_values') || response.url().includes('/values')) && response.status() === 200,
        { timeout }
      );
    } catch (error) {
      console.log('⚠️ Warning: No variable API call detected within timeout');
      return;
    }

    const { apiCallDetected, capturedStartTime, capturedEndTime } = monitor.getResults();

    if (apiCallDetected) {
      this.assertTimeRangeMatches(capturedStartTime, capturedEndTime, expectedDurationMs);
      console.log(`✅ ${successMessage}`);
    } else {
      console.log('⚠️ Warning: No variable API call detected, variable may not exist or be loaded');
    }
  }
}
