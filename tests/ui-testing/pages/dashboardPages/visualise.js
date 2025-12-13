//logs visualise page object
//Methods: openLogs, openVisualiseTab, logsApplyQueryButton, Visualize run query button, setRelative, searchAndAddField, showQueryToggle, enableSQLMode, streamIndexList, logsSelectStream, logsToggle, selectChartType, removeField, chartRender, backToLogs, openQueryEditor, fillQueryEditor
import { expect } from "@playwright/test";
export default class LogsVisualise {
  constructor(page) {
    this.page = page;
    this.timeTab = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');
    this.indexListDropdown = page.locator(
      '[data-test="log-search-index-list-select-stream"]'
    );
    this.functionEditor = page.locator(
      '[data-test="logs-vrl-function-editor"]'
    );
    this.queryEditor = page
      .locator("#fnEditor")
      .locator(".inputarea");

    // Dashboard locators
    this.addToDashboardBtn = page.getByRole("button", {
      name: "Add To Dashboard",
    });
    this.newDashboardBtn = page.locator(
      '[data-test="dashboard-dashboard-new-add"]'
    );
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name"]');
    this.dashboardSubmitBtn = page.locator(
      '[data-test="dashboard-add-submit"]'
    );
    this.panelTitleInput = page.locator(
      '[data-test="metrics-new-dashboard-panel-title"]'
    );
    this.updateSettingsBtn = page.locator(
      '[data-test="metrics-schema-update-settings-button"]'
    );

    // Query editor locators
    this.logsQueryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]');
    //Functions
  }
  async openLogs() {
    // Open Logs Page
    await this.page.locator('[data-test="menu-link-\\/logs-item"]').click();
  }

  async openVisualiseTab() {
    // Open Visualise Tab
    await this.page.locator('[data-test="logs-visualize-toggle"]').click();
  }

  //Apply: Logs
  async logsApplyQueryButton() {
    await this.page
      .locator('[data-test="logs-search-bar-refresh-btn"]')
      .click();
  }

  //set relative time selection
  async setRelative(date, time) {
    await this.timeTab.waitFor({ state: "visible" });
    await this.timeTab.click();
    await this.relativeTime.click();
    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .click();
  }

  //search and add fields
  async searchAndAddField(fieldName, target) {
    const searchInput = this.page.locator(
      '[data-test="index-field-search-input"]'
    );
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    await searchInput.click();
    await searchInput.fill(fieldName);

    const buttonSelectors = {
      x: "dashboard-add-x-data",
      y: "dashboard-add-y-data",
      b: "dashboard-add-b-data",
      filter: "dashboard-add-filter-data",
      latitude: "dashboard-add-latitude-data",
      longitude: "dashboard-add-longitude-data",
      weight: "dashboard-add-weight-data",
      z: "dashboard-add-z-data",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
    };

    const buttonTestId = buttonSelectors[target];
    if (!buttonTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const button = this.page.locator(`[data-test="${buttonTestId}"]`);

    // Ensure the button is visible before clicking
    await button.waitFor({ state: "visible", timeout: 5000 });
    await button.click();
  }

  //show query toggle
  async showQueryToggle() {
    await this.page
      .locator('[data-test="logs-search-bar-show-query-toggle-btn"] img')
      .click();
  }

  //enable SQL Mode
  async enableSQLMode() {
    await this.page
      // .getByRole("switch", { name: "SQL Mode" })
      // .locator("div")
      // .nth(2)
      // .click();
      .getByRole("switch", { name: "SQL Mode" })
      .click();
  }

  //stream index list
  async streamIndexList() {
    await this.page
      .locator('[data-test="dashboard-field-list-collapsed-icon"]')
      .click();
  }
  //logs: Select stream
  async logsSelectStream(stream) {
    await this.page
      .locator('[data-test="log-search-index-list-select-stream"]')
      .click({ force: true });
    await this.page
      .locator("div.q-item")
      .getByText(`${stream}`)
      .first()
      .click();
  }

  //logs toggle
  async logsToggle() {
    await this.page.locator('[data-test="logs-logs-toggle"]').click();
  }

  //select chart type
  async selectChartType(chartType) {
    const chartOption = this.page.locator(
      `[data-test="selected-chart-${chartType}-item"]`
    );
    await chartOption.waitFor({ state: "visible" });
    await chartOption.click();
  }

  //remove field
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

  //chart render
  async chartRender(x, y) {
    await this.page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: x,
          y: y,
        },
      });
  }

  //back to logs
  async backToLogs() {
    await this.page.locator('[data-test="logs-logs-toggle"]').click();
  }

  //open query editor
  async openQueryEditor() {
    await this.page.locator('[data-test="logs-search-bar-query-editor"]').locator('.monaco-editor').click();
  }

  //fill query editor
  async fillQueryEditor(sqlQuery) {
    const queryEditor = this.page.locator('[data-test="logs-search-bar-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 5000 });
    await queryEditor.locator('.monaco-editor').click();
    await queryEditor.locator('.inputarea').fill(sqlQuery);
  }

  //fill logs query editor with SQL query
  async fillLogsQueryEditor(sqlQuery) {
    await this.logsQueryEditor.waitFor({ state: "visible", timeout: 5000 });
    await this.logsQueryEditor.locator('.monaco-editor').click();
    await this.logsQueryEditor.locator('.inputarea').fill(sqlQuery);
  }

  // Open the first VRL Function Editor
  async vrlFunctionEditor(vrl) {
    await this.functionEditor.first().click();
    await this.queryEditor.fill(vrl);
  }

  async runQueryAndWaitForCompletion() {
    const runBtn = this.page.locator(
      '[data-test="logs-search-bar-visualize-refresh-btn"]'
    );
    const cancelBtn = this.page.locator(
      '[data-test="logs-search-bar-visualize-cancel-btn"]'
    );
    await runBtn.waitFor({ state: "visible" });
    await runBtn.click();
    await runBtn.waitFor({ state: "visible" });
    // Optional: small buffer to ensure UI is stable
    await this.page.waitForTimeout(300);
  }

  // Helper function to check for dashboard errors
  async checkDashboardErrors(page, chartTypeName) {
    const dashboardErrorContainer = page.locator(
      '[data-test="dashboard-error"]'
    );
    const errorContainerExists = await dashboardErrorContainer.count();

    if (errorContainerExists === 0) {
      return { hasErrors: false, errors: [], errorTextCount: 0, errorListCount: 0 };
    }

    const isErrorVisible = await dashboardErrorContainer.first().isVisible();
    if (!isErrorVisible) {
      return { hasErrors: false, errors: [], errorTextCount: 0, errorListCount: 0 };
    }

    const errors = [];

    // Check for error indicator text
    const errorText = page
      .locator('[data-test="dashboard-error"]')
      .getByText(/Errors \(\d+\)/);
    const errorTextCount = await errorText.count();

    if (errorTextCount > 0) {
      const errorTextContent = await errorText.first().textContent();
      errors.push(`Error indicator: ${errorTextContent}`);
    }

    // Check for error list items
    const errorListItems = page.locator('[data-test="dashboard-error"] ul li');
    const errorListCount = await errorListItems.count();

    if (errorListCount > 0) {
      for (let i = 0; i < errorListCount; i++) {
        const errorItem = errorListItems.nth(i);
        const errorItemText = await errorItem.textContent();
        if (errorItemText && errorItemText.trim().length > 0) {
          errors.push(`Error ${i + 1}: ${errorItemText.trim()}`);
        }
      }
    }

    return {
      hasErrors: errors.length > 0,
      errors,
      errorTextCount,
      errorListCount,
    };
  }

  async verifyChartRenders(page) {
    const chartRenderer = page.locator(
      '[data-test="chart-renderer"], [data-test="dashboard-panel-table"]'
    );

    try {
      // Wait for chart renderer to be present and visible
      await chartRenderer.first().waitFor({
        state: "visible",
        timeout: 15000,
      });

      // Additional check to ensure the chart is actually rendered
      const chartExists = await chartRenderer.count();

      if (chartExists > 0) {
        // Double-check visibility after waiting
        const isVisible = await chartRenderer.first().isVisible();
        if (!isVisible) {
          // Wait for chart content to be rendered intelligently
          const chartContentReady = await this.waitForChartContent(page, 3000);

          if (!chartContentReady) {
            // Fallback: try waiting for chart renderer to be stable
            try {
              await chartRenderer.first().waitFor({
                state: "visible",
                timeout: 2000,
              });
            } catch (fallbackError) {
              throw new Error(
                `Chart renderer present but content failed to load after intelligent waiting. Error: ${fallbackError.message}`
              );
            }
          }

          // Final visibility check after intelligent waiting
          const isVisibleRetry = await chartRenderer.first().isVisible();
          if (!isVisibleRetry) {
            throw new Error(
              "Chart renderer is present but not visible after intelligent retry"
            );
          }
        }
      }

      return chartExists > 0;
    } catch (error) {
      // If waiting times out, check if element exists but is not visible
      const chartExists = await chartRenderer.count();
      if (chartExists > 0) {
        const isVisible = await chartRenderer.first().isVisible();
        throw new Error(
          `Chart renderer found (${chartExists} elements) but visibility check failed. Is visible: ${isVisible}. Original error: ${error.message}`
        );
      } else {
        throw new Error(
          `No chart renderer found. Original error: ${error.message}`
        );
      }
    }
  }

  // RECOMMENDED: Native browser function (fastest & most reliable)
  async waitForChartContent(page, timeout = 5000) {
    return page
      .waitForFunction(
        () =>
          document.querySelector(
            '[data-test="chart-renderer"], [data-test="dashboard-panel-table"]'
          )?.offsetParent !== null,
        {},
        { timeout }
      )
      .then(() => true)
      .catch(() => false);
  }

  // Get quick mode toggle state using the most reliable method
  async getQuickModeToggleState() {
    const quickModeToggle = this.page.locator(
      '[data-test="logs-search-bar-quick-mode-toggle-btn"]'
    );

    // Wait for the toggle to be present
    await quickModeToggle.waitFor({ state: "visible", timeout: 10000 });

    // Check aria-checked attribute - this is the most reliable indicator
    // Falls back to aria-pressed if aria-checked is not available
    let ariaChecked = await quickModeToggle.getAttribute("aria-checked");
    if (ariaChecked === null) {
      ariaChecked = await quickModeToggle.getAttribute("aria-pressed");
    }

    return ariaChecked === "true";
  }

  // Verify quick mode toggle state
  async verifyQuickModeToggle(expectedState = true) {
    const isChecked = await this.getQuickModeToggleState();

    // Validate the toggle state matches expectation
    if (expectedState !== isChecked) {
      throw new Error(
        `Expected quick mode to be ${expectedState} but actual state is ${isChecked}`
      );
    }

    return isChecked;
  }

  // Toggle quick mode to specific state (enable/disable)
  async setQuickModeToggle(enableState) {
    const quickModeToggle = this.page.locator(
      '[data-test="logs-search-bar-quick-mode-toggle-btn"]'
    );

    await quickModeToggle.waitFor({ state: "visible", timeout: 10000 });

    const currentState = await this.getQuickModeToggleState();

    // Only click if we need to change the state
    if (currentState !== enableState) {
      await quickModeToggle.click();

      // Wait for state change to complete
      await this.page.waitForTimeout(500);

      // Verify the state actually changed
      const newState = await this.getQuickModeToggleState();
      if (newState !== enableState) {
        throw new Error(
          `Failed to set quick mode to ${enableState}. Current state: ${newState}`
        );
      }
    }

    return enableState;
  }

  // Enable quick mode if it's currently disabled
  async enableQuickModeIfDisabled() {
    return await this.setQuickModeToggle(true);
  }

  // Disable quick mode if it's currently enabled
  async disableQuickModeIfEnabled() {
    return await this.setQuickModeToggle(false);
  }

  // Helper function to verify chart type selection
  async verifyChartTypeSelected(page, chartType, shouldBeSelected = true) {
    const selector = `[data-test="selected-chart-${chartType}-item"]`;
    const locator = page.locator(selector).locator("..");

    if (shouldBeSelected) {
      await expect(locator).toHaveClass(/bg-grey-[35]/);
    } else {
      await expect(locator).not.toHaveClass(/bg-grey-[35]/);
    }
  }

  async addPanelToNewDashboard(randomDashboardName, panelName) {
    // Add to dashboard and submit it
    await this.addToDashboardBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.addToDashboardBtn.click();

    // Wait for the "Add to Dashboard" side panel to fully load
    const sidePanelTitle = this.page.locator('[data-test="schema-title-text"]');
    await sidePanelTitle.waitFor({ state: "visible", timeout: 10000 });
    await sidePanelTitle.waitFor({ state: "attached", timeout: 5000 });

    // Wait for the "new dashboard" button to be visible and stable
    await this.newDashboardBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.newDashboardBtn.waitFor({ state: "attached", timeout: 5000 });
    // await this.page.waitForTimeout(500);

    // Click new dashboard option
    await this.newDashboardBtn.click();

    // Wait for the "New dashboard" dialog to open and stabilize
    await this.dashboardNameInput.waitFor({ state: "visible", timeout: 10000 });
    await this.dashboardNameInput.waitFor({ state: "attached", timeout: 5000 });
    // await this.page.waitForTimeout(500);

    // Fill dashboard name
    await this.dashboardNameInput.click();
    await this.dashboardNameInput.fill(randomDashboardName);

    // Submit dashboard creation
    await this.dashboardSubmitBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.dashboardSubmitBtn.click();

    // Wait for panel title input to be available (replacing hardcoded timeout)
    await this.panelTitleInput.waitFor({ state: "visible", timeout: 10000 });
    await this.panelTitleInput.click();
    await this.panelTitleInput.fill(panelName);

    // Submit panel settings
    await this.updateSettingsBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.updateSettingsBtn.click();
  }

  //wait for query inspector to be visible
  async waitForQueryInspector(page) {
    const queryInspector = page.getByText("Query Inspectorclose");
    await expect(queryInspector).toBeVisible({ timeout: 10000 });
  }
}
