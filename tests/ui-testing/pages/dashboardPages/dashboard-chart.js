// pages/chartTypeSelector.js
// Methods : selectChartType, selectStreamType, searchAndAddField,  selectStream

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class ChartTypeSelector {
  constructor(page) {
    this.page = page;

    // Raw query / DynamicFunctionPopUp selectors
    this.rawQueryTextarea = page.locator('[data-test="dashboard-raw-query-textarea"]');
    this.popupTabs = page.locator('[data-test="dynamic-function-popup-tabs"]');
    this.buildTab = page.locator('[data-test="dynamic-function-popup-tab-build"]');
    this.rawTab = page.locator('[data-test="dynamic-function-popup-tab-raw"]');

    // Field property checkboxes (visible on table chart type)
    this.treatAsNonTimestampCheckbox = page.locator('[data-test="dynamic-function-popup-treat-as-non-timestamp"]');
    this.showFieldAsJsonCheckbox = page.locator('[data-test="dynamic-function-popup-show-field-as-json"]');

    // Query type selectors
    this.sqlQueryTypeBtn = page.locator('[data-test="dashboard-sql-query-type"]');
    this.customQueryTypeBtn = page.locator('[data-test="dashboard-custom-query-type"]');
    this.builderQueryTypeBtn = page.locator('[data-test="dashboard-builder-query-type"]');

    // Custom query editor
    this.queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
  }

  // Chart Type select
  async selectChartType(chartType) {
    // Wait for panel editor to be ready - could be full page or dialog
    // Look for either the Apply button or any chart type selector
    const panelEditorIndicator = this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    );

    // Wait for panel editor to be visible with retry
    try {
      await panelEditorIndicator.first().waitFor({ state: "visible", timeout: 15000 });
    } catch (e) {
      // Panel editor may take extra time to load, wait for network idle and retry
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await panelEditorIndicator.first().waitFor({ state: "visible", timeout: 10000 });
    }

    const chartOption = this.page.locator(
      `[data-test="selected-chart-${chartType}-item"]`
    );
    await chartOption.waitFor({ state: "visible", timeout: 15000 });
    await chartOption.scrollIntoViewIfNeeded();
    await chartOption.click();
  }

  //  Stream Type select - waits for stream list to load after selection
  async selectStreamType(type) {
    // Click the dropdown
    await this.page.locator('[data-test="index-dropdown-stream_type"]').click();

    await this.page
      .getByRole("option", { name: type })
      .locator("div")
      .nth(2)
      .click();

    // CRITICAL: Wait for stream list API call to complete after changing type
    await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await this.page.locator('[data-test="index-dropdown-stream"]').waitFor({ state: "visible", timeout: 10000 });
  }

  // Stream select with retry mechanism (no page reload to preserve context)
  async selectStream(streamName, maxRetries = 3) {
    const streamInput = this.page.locator(
      '[data-test="index-dropdown-stream"]'
    );

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Close any open dropdown first
        await this.page.keyboard.press("Escape");

        await streamInput.waitFor({ state: "visible", timeout: 5000 });
        await streamInput.click();

        // Log all available options in dropdown for debugging
        const allOptions = await this.page.locator('[role="listbox"] [role="option"]').allTextContents();
        testLogger.debug(`Attempt ${attempt}: Looking for "${streamName}". Available options (${allOptions.length}): ${allOptions.slice(0, 10).join(', ')}`);

        await streamInput.press("Control+a");
        await streamInput.fill(streamName);

        // Wait for dropdown options to filter
        await this.page.locator('[role="listbox"]').waitFor({ state: "visible", timeout: 10000 });

        const streamOption = this.page
          .getByRole("option", { name: streamName, exact: true })
          .locator("div")
          .nth(2);

        await streamOption.waitFor({ state: "visible", timeout: 15000 });
        await streamOption.click();
        return; // Success
      } catch (error) {
        if (attempt === maxRetries) {
          // Final attempt: log full diagnostic info
          const finalOptions = await this.page.locator('[role="listbox"] [role="option"]').allTextContents().catch(() => []);
          testLogger.error(`FAILED after ${maxRetries} attempts. Final options: ${finalOptions.join(', ')}`);
          throw error;
        }
        // Close dropdown and wait for network before retry (don't reload - loses context!)
        await this.page.keyboard.press("Escape");
        await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      }
    }
  }

  // Search field and added for X, Y,Breakdown etc.

  async searchAndAddField(fieldName, target) {
    const searchInput = this.page.locator(
      '[data-test="index-field-search-input"]'
    );
    await searchInput.click();
    await searchInput.fill(fieldName);

    const buttonSelectors = {
      x: "dashboard-add-x-data",
      y: "dashboard-add-y-data",
      b: "dashboard-add-b-data",
      p: "dashboard-add-p-data",
      filter: "dashboard-add-filter-data",
      latitude: "dashboard-add-latitude-data",
      longitude: "dashboard-add-longitude-data",
      weight: "dashboard-add-weight-data",
      z: "dashboard-add-z-data",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
      source: "dashboard-add-source-data",
      target: "dashboard-add-target-data",
      sankeyvalue: "dashboard-add-value-data",
    };

    const buttonTestId = buttonSelectors[target];

    if (!buttonTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    // Locate the specific field item container using the exact field name in the data-test attribute
    // The format is: field-list-item-{streamType}-{streamName}-{fieldName}
    // Fail fast on genuine suffix collisions (different data-test values)
    const fieldItems = this.page.locator(`[data-test^="field-list-item-"][data-test$="-${fieldName}"]`);
    // Wait for at least one match to appear after search filtering
    await fieldItems.first().waitFor({ state: "visible", timeout: 5000 });
    const matchCount = await fieldItems.count();
    if (matchCount > 1) {
      const attrs = await fieldItems.evaluateAll(els => els.map(e => e.getAttribute('data-test')));
      const uniqueAttrs = [...new Set(attrs)];
      if (uniqueAttrs.length > 1) {
        throw new Error(`Ambiguous field match for "${fieldName}": ${attrs.join(', ')}`);
      }
    }
    const fieldItem = fieldItems.first();

    // Now locate the button within that field item
    const button = fieldItem.locator(`[data-test="${buttonTestId}"]`);

    // Click the button
    await button.waitFor({ state: "visible", timeout: 5000 });
    await button.click();
    await searchInput.fill(""); // Clear the search input
  }

  //remove fields from the dashboard
  // Remove field by type (x, y, breakdown, etc.)
  // @param alias - The field alias (e.g., "x_axis_1", "y_axis_1", "breakdown_1")
  // @param target - The target type (x, y, b, filter, etc.)
  async removeField(alias, target) {
    const removeSelectors = {
      x: "dashboard-x-item",
      y: "dashboard-y-item",
      b: "dashboard-b-item",
      filter: "dashboard-filter-item",
      latitude: "dashboard-latitude-item",
      longitude: "dashboard-longitude-item",
      weight: "dashboard-weight-item",
      z: "dashboard-z-item",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
      source: "dashboard-source-item",
      target: "dashboard-target-item",
      sankeyvalue: "dashboard-value-item",
    };

    const baseTestId = removeSelectors[target];
    if (!baseTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const removeButton = this.page.locator(
      `[data-test="${baseTestId}-${alias}-remove"]`
    );

    await removeButton.waitFor({ state: "visible", timeout: 10000 });
    await removeButton.click();
  }

  // Helper function to wait for table data to load completely
  async waitForTableDataLoad() {
    // Wait for table to be visible
    await this.page.waitForSelector('[data-test="dashboard-panel-table"]', {
      timeout: 10000,
    });

    // Wait for table to have headers and data rows with content.
    // Quasar q-table renders data rows inside .q-virtual-scroll__content
    // or plain tbody depending on virtual scroll mode.
    await this.page.waitForFunction(
      () => {
        const table = document.querySelector(
          '[data-test="dashboard-panel-table"]'
        );
        if (!table) return false;

        // Check headers are present
        const headers = table.querySelectorAll("thead tr th");
        if (!headers || headers.length === 0) return false;

        // Check data rows (virtual scroll or plain tbody)
        const virtualContent = table.querySelector(".q-virtual-scroll__content");
        const rows = virtualContent
          ? virtualContent.querySelectorAll("tr")
          : table.querySelectorAll("tbody tr");
        return (
          rows &&
          rows.length > 0 &&
          Array.from(rows).some((row) =>
            Array.from(row.querySelectorAll("td")).some(
              (cell) => cell.textContent.trim() !== ""
            )
          )
        );
      },
      { timeout: 15000 }
    );
  }

  // ===== Y-AXIS FUNCTION CONFIGURATION METHODS =====

  /**
   * Open the Y-axis function configuration popup
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1", "y_axis_2")
   */
  async openYAxisFunctionPopup(alias) {
    const yAxisItem = this.page.locator(`[data-test="dashboard-y-item-${alias}"]`);
    await yAxisItem.waitFor({ state: "visible", timeout: 10000 });
    await yAxisItem.click();

    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "visible", timeout: 10000 });
  }

  /**
   * Select a function from the function dropdown
   * @param {string} functionName - The function to select (e.g., "count", "sum", "avg", "min", "max", "Distinct")
   */
  async selectFunction(functionName) {
    const dropdown = this.page.locator('[data-test="dashboard-function-dropdown"]').first();
    await dropdown.waitFor({ state: "visible", timeout: 10000 });
    await dropdown.click();

    await this.page.locator('[role="listbox"]').waitFor({ state: "visible", timeout: 5000 });
    await this.page.keyboard.type(functionName);

    // Use case-insensitive contains match - filtering by typing already narrows options
    const option = this.page.getByRole("option", { name: new RegExp(functionName, 'i') }).first();
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
  }

  /**
   * Verify Y-axis label contains expected function name
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} expectedFunction - The expected function name in the label
   * @param {Function} expect - Playwright expect function
   */
  async verifyYAxisLabel(alias, expectedFunction, expect) {
    const yAxisLabel = this.page.locator(`[data-test="dashboard-y-item-${alias}"]`);
    const labelText = await yAxisLabel.textContent();
    expect(labelText.toLowerCase()).toContain(expectedFunction.toLowerCase());
    return labelText;
  }

  /**
   * Configure a Y-axis field with a function in one method
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} functionName - The function to apply (e.g., "count", "sum")
   */
  async configureYAxisFunction(alias, functionName) {
    await this.openYAxisFunctionPopup(alias);
    await this.selectFunction(functionName);
    await this.page.keyboard.press("Escape");
    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  // ===== RAW QUERY CONFIGURATION METHODS =====

  /**
   * Switch to the Raw tab in the DynamicFunctionPopUp
   * Requires the Y-axis popup to already be open (call openYAxisFunctionPopup first)
   */
  async switchToRawTab() {
    await this.rawTab.waitFor({ state: "visible", timeout: 10000 });
    await this.rawTab.click();
    await this.rawQueryTextarea.waitFor({ state: "visible", timeout: 10000 });
    testLogger.debug('Switched to Raw tab');
  }

  /**
   * Switch to the Build tab in the DynamicFunctionPopUp
   * Requires the Y-axis popup to already be open
   */
  async switchToBuildTab() {
    await this.buildTab.waitFor({ state: "visible", timeout: 10000 });
    await this.buildTab.click();
    // Wait for Build tab content to render (function dropdown becomes visible)
    await this.page.locator('[data-test="dashboard-function-dropdown"]').first().waitFor({ state: "visible", timeout: 10000 });
    testLogger.debug('Switched to Build tab');
  }

  /**
   * Enter a raw SQL query in the Raw tab textarea
   * Requires the Raw tab to be active
   * @param {string} query - The raw SQL query to enter
   */
  async enterRawQuery(query) {
    await this.rawQueryTextarea.waitFor({ state: "visible", timeout: 10000 });
    await this.rawQueryTextarea.click();
    await this.rawQueryTextarea.fill(query);
    testLogger.debug('Entered raw query', { query });
  }

  /**
   * Get the current value of the raw query textarea
   * Requires the Raw tab to be active
   * @returns {Promise<string>} The raw query text
   */
  async getRawQueryValue() {
    await this.rawQueryTextarea.waitFor({ state: "visible", timeout: 10000 });
    return await this.rawQueryTextarea.inputValue();
  }

  /**
   * Verify the raw query textarea is visible
   * @param {Function} expect - Playwright expect function
   */
  async verifyRawTextareaVisible(expect) {
    await expect(this.rawQueryTextarea).toBeVisible({ timeout: 10000 });
  }

  /**
   * Configure a Y-axis field with a raw query in one method
   * Opens the popup, switches to Raw tab, enters query, and closes popup
   * @param {string} alias - The Y-axis alias (e.g., "y_axis_1")
   * @param {string} query - The raw SQL query to enter
   */
  async configureYAxisRawQuery(alias, query) {
    await this.openYAxisFunctionPopup(alias);
    await this.switchToRawTab();
    await this.enterRawQuery(query);
    await this.page.keyboard.press("Escape");
    // Wait for popup to close
    const menuLocator = this.page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`);
    await menuLocator.waitFor({ state: "hidden", timeout: 10000 });
    testLogger.info('Configured Y-axis raw query', { alias, query });
  }

  /**
   * Verify the Build/Raw tabs are visible in the popup
   * Requires the Y-axis popup to already be open
   * @param {Function} expect - Playwright expect function
   */
  async verifyBuildRawTabsVisible(expect) {
    await expect(this.popupTabs).toBeVisible({ timeout: 10000 });
    await expect(this.buildTab).toBeVisible();
    await expect(this.rawTab).toBeVisible();
  }

  /**
   * Verify the Build/Raw tabs are NOT visible (e.g., in custom query mode)
   * @param {Function} expect - Playwright expect function
   */
  async verifyBuildRawTabsNotVisible(expect) {
    await expect(this.popupTabs).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Open field property popup by clicking on an axis item
   * @param {string} alias - The axis alias (e.g., "x_axis_1", "y_axis_1")
   * @param {string} axis - The axis type ("x" or "y")
   */
  async openFieldPropertyPopup(alias, axis = "x") {
    const itemLocator = this.page.locator(`[data-test="dashboard-${axis}-item-${alias}"]`);
    await itemLocator.waitFor({ state: "visible", timeout: 10000 });
    await itemLocator.click();
    testLogger.debug('Opened field property popup', { alias, axis });
  }

  /**
   * Toggle "Mark this field as non-timestamp" checkbox
   */
  async toggleTreatAsNonTimestamp() {
    await this.treatAsNonTimestampCheckbox.waitFor({ state: "visible", timeout: 10000 });
    await this.treatAsNonTimestampCheckbox.click();
    testLogger.debug('Toggled treat as non-timestamp checkbox');
  }

  /**
   * Toggle "Render Data as JSON / Array" checkbox
   */
  async toggleShowFieldAsJson() {
    await this.showFieldAsJsonCheckbox.waitFor({ state: "visible", timeout: 10000 });
    await this.showFieldAsJsonCheckbox.click();
    testLogger.debug('Toggled show field as JSON checkbox');
  }

  /**
   * Switch to Custom query mode
   */
  async switchToCustomQueryMode() {
    await this.customQueryTypeBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.customQueryTypeBtn.click();
    testLogger.debug('Switched to custom query mode');
  }

  /**
   * Enter a custom SQL query in the Monaco editor
   * @param {string} query - The SQL query to enter
   */
  async enterCustomSQL(query) {
    await this.queryEditor.getByRole('code').click();
    await this.queryEditor.locator(".inputarea").fill(query);
    testLogger.debug('Entered custom SQL query', { query });
  }
}
