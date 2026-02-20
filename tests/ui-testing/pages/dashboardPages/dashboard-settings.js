// Dashboard Setting Page Object
// This class contains methods to interact with the dashboard settings page in OpenObserve.
// This includes changing the dashboard name, adding tabs, managing variables, and more.
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getTabSelector } = require('./dashboard-selectors.js');

export default class DashboardSetting {
  constructor(page) {
    this.page = page;
    this.setting = page.locator('[data-test="dashboard-setting-btn"]');
    this.general = page.locator('[data-test="dashboard-settings-general-tab"]');
    this.variables = page.locator(
      '[data-test="dashboard-settings-variable-tab"]'
    );
    this.tab = page.locator('[data-test="dashboard-settings-tab-tab"]');
    this.addtab = page.locator('[data-test="dashboard-tab-settings-add-tab"]');
    this.time = page.locator('[data-test="date-time-btn"]');
    this.dynamicFilter = page.locator(
      '[data-test="dashboard-general-setting-dynamic-filter"]'
    );
    this.newName = page.locator('[data-test="dashboard-general-setting-name"]');
    this.saveSettingBtn = page.locator(
      '[data-test="dashboard-general-setting-save-btn"]'
    );
    this.cancelBtn = page.locator('[data-test="cancel-button"]');
    this.deletebtn = page.locator(
      '[data-test="dashboard-tab-settings-tab-delete-btn"]'
    );
    this.editBtn = page.locator(
      '[data-test="dashboard-tab-settings-tab-edit-btn"]'
    );
    this.deleteconfirmBtn = page.locator('[data-test="confirm-button"]');
    this.editName = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit"]'
    );
    this.fullScreen = page.locator('[data-test="dashboard-fullscreen-btn"]');
    this.tabName = page.locator('[data-test="dashboard-add-tab-name"]');
    this.saveTab = page.locator('[data-test="dashboard-add-tab-submit"]');
    this.closeSetting = page.locator(
      '[data-test="dashboard-settings-close-btn"]'
    );
    this.timeBtn = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');

    this.addTabCancel = page.locator('[data-test="dashboard-add-cancel"]');
    this.EditSave = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit-save"]'
    );
  }

  //Dashboard Settings//
  //Generate unique dashboard name
  generateUniqueDashboardnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Open Dashboard Setting//
  async openSetting() {
    await this.page.waitForSelector('[data-test="dashboard-setting-btn"]', {
      state: "visible",
      timeout: 15000,
    });
    await this.setting.click();
    // Wait for settings dialog to open - use more specific selector
    await this.page.locator('[data-test="dashboard-settings-general-tab"]').waitFor({ state: "visible", timeout: 10000 });
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Wait for all tabs to be rendered in the dialog
    // The dialog has General, Tab, and Variables tabs - wait for the container to stabilize
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(500); // Allow Vue to finish rendering all tabs
  }
  //General Setting//
  //Change Dashboard Name//
  async dashboardNameChange(name) {
    await this.general.waitFor({ state: "visible" });
    await this.newName.waitFor({ state: "visible" });
    await this.newName.click();
    await this.newName.fill(name);
  }

  //Time Setting//
  async relativeTimeSelection(date, time) {
    await this.page
      .locator(
        '[data-test="dashboard-general-setting-datetime-picker"] [data-test="date-time-btn"]'
      )
      .click();

    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .click();
  }

  //Save Setting//
  async saveSetting() {
    await this.saveSettingBtn.waitFor({ state: "visible" });
    await this.saveSettingBtn.click();
  }

  //Cancel dashboard changes//
  async cancelSettingDashboard() {
    await this.cancelBtn.waitFor({ state: "visible" });
    await this.cancelBtn.click();
  }
  //close setting dashboard//
  async closeSettingDashboard() {
    await this.closeSetting.waitFor({ state: "visible" });
    await this.closeSetting.click();
  }

  //show dynamic filter//
  async showDynamicFilter() {
    await this.dynamicFilter.waitFor({ state: "visible" });
    await this.dynamicFilter.click();
  }
  //Add Tabs//
  generateUniqueTabnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Tab Settings//

  //Add new tab//
  async addTabSetting(tabnewName) {
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
    await this.addtab.click();
    await this.tabName.fill(tabnewName);
  }

  //save new tab setting//
  async saveTabSetting() {
    await this.saveTab.click();
  }

  /**
   * Add a new tab and wait for it to be visible on the dashboard
   * Consolidates the common pattern:
   *   await pm.dashboardSetting.addTabSetting("Tab1");
   *   await pm.dashboardSetting.saveTabSetting();
   *   await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });
   *
   * @param {string} tabName - Name for the new tab
   * @param {Object} options - Additional options
   * @param {number} options.timeout - Timeout in ms for waiting for tab visibility (default: 10000)
   */
  async addTabAndWait(tabName, options = {}) {
    const { timeout = 10000 } = options;

    testLogger.info('Adding tab and waiting for visibility', { tabName });

    await this.addTabSetting(tabName);
    await this.saveTabSetting();
    await this.page.locator(getTabSelector(tabName)).waitFor({ state: "visible", timeout });

    testLogger.info('Tab added and visible', { tabName });
  }

  //Edit tab in settings//
  editTabnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Full screen//
  async fullScreenSettings() {
    await this.fullScreen.waitFor({ state: "visible" });
    await this.fullScreen.click();
  }

  //cancel changes
  async cancelTabwithoutSave() {
    await this.page.locator('[data-test="dashboard-add-cancel"]').click();
  }

  //Cancel edit tab name
  async cancelEditedtab() {
    await this.page
      .locator('[data-test="dashboard-tab-settings-tab-name-edit-cancel"]')
      .click();
  }

  //Variables Settings
  //Open Variables tab

  async openVariables() {
    // Check if the settings dialog is already open
    const generalTab = this.page.locator('[data-test="dashboard-settings-general-tab"]');
    const isDialogOpen = await generalTab.isVisible().catch(() => false);

    if (!isDialogOpen) {
      testLogger.warn('openVariables: Settings dialog not open, opening it first...');
      // Need to open the settings dialog first
      await this.openSetting();
    }

    // Wait for settings dialog to be fully open before clicking variables tab
    await generalTab.waitFor({ state: "visible", timeout: 10000 });
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Wait for dialog tabs to be fully loaded - the tabs are in a q-tabs container
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(500); // Allow Vue to finish rendering tabs

    // Retry pattern for clicking variables tab (element can get detached during dialog transitions)
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const variablesTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');

        // Check if tab exists in DOM first
        const tabCount = await variablesTab.count();
        if (tabCount === 0) {
          testLogger.warn(`openVariables attempt ${attempt}: Variables tab not found in DOM, waiting...`);
          await this.page.waitForTimeout(1000);
          continue;
        }

        await variablesTab.waitFor({ state: "visible", timeout: 10000 });
        await this.page.waitForTimeout(200); // Brief pause to let DOM stabilize
        await variablesTab.scrollIntoViewIfNeeded();
        await variablesTab.click();
        return; // Success
      } catch (e) {
        testLogger.warn(`openVariables attempt ${attempt} failed: ${e.message}`);
        if (attempt === maxRetries) throw e;
        await this.page.waitForTimeout(1000); // Wait before retry
      }
    }
  }

  // Navigate to Variables tab after opening settings
  async goToVariablesTab() {
    // Wait for dialog to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(500); // Allow Vue to finish rendering tabs

    // Retry pattern for clicking variables tab (element can get detached during dialog transitions)
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const variablesTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');

        // Check if tab exists in DOM first
        const tabCount = await variablesTab.count();
        if (tabCount === 0) {
          testLogger.warn(`goToVariablesTab attempt ${attempt}: Variables tab not found in DOM, waiting...`);
          await this.page.waitForTimeout(1000);
          continue;
        }

        await variablesTab.waitFor({ state: "visible", timeout: 10000 });
        await this.page.waitForTimeout(200); // Brief pause to let DOM stabilize
        await variablesTab.scrollIntoViewIfNeeded();
        await variablesTab.click();
        return; // Success
      } catch (e) {
        testLogger.warn(`goToVariablesTab attempt ${attempt} failed: ${e.message}`);
        if (attempt === maxRetries) throw e;
        await this.page.waitForTimeout(1000); // Wait before retry
      }
    }
  }

  //Generate unique variable name
  variableName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //variable type: Query Values
  async addVariable(type, variableName, streamType, Stream, field) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();

    // Wait for the type option to be visible before clicking
    const typeOption = this.page.getByRole("option", { name: type });
    await typeOption.waitFor({ state: "visible", timeout: 10000 });
    await typeOption.click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
    await this.page
      .locator('[data-test="dashboard-variable-stream-type-select"]')
      .click();

    // Wait for the dropdown option to be visible before clicking
    const streamTypeOption = this.page.getByRole("option", { name: streamType });
    await streamTypeOption.waitFor({ state: "visible", timeout: 10000 });
    await streamTypeOption.click();

    // Click the stream selector to open and focus it
    const streamSelector = this.page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelector.click();

    // Wait for the dropdown to open
    await this.page.waitForSelector('[role="listbox"]', { state: 'visible', timeout: 10000 });

    // The stream dropdown supports search filtering via use-input
    // Type the stream name to filter the list using keyboard
    await this.page.keyboard.type(Stream, { delay: 50 });

    // Wait a moment for filtering to complete
    await this.page.waitForTimeout(500);

    // Wait for dropdown to have options available after filtering
    await this.page.waitForFunction(
      () => {
        const options = document.querySelectorAll('[role="option"]');
        return options.length > 0;
      },
      { timeout: 10000, polling: 100 }
    );

    // Select the stream from filtered dropdown options
    let streamSelected = false;

    // Strategy 1: Try exact match option
    try {
      const streamOption = this.page.getByRole("option", { name: Stream, exact: true });
      await streamOption.waitFor({ state: "visible", timeout: 5000 });
      await streamOption.click();
      streamSelected = true;
    } catch (e) {
      testLogger.warn(`Stream selection strategy 1 (exact match) failed for "${Stream}": ${e.message}`);
      // Strategy 2: Try partial match
      try {
        const streamOption = this.page.getByRole("option", { name: Stream, exact: false }).first();
        await streamOption.waitFor({ state: "visible", timeout: 5000 });
        await streamOption.click();
        streamSelected = true;
      } catch (e2) {
        testLogger.warn(`Stream selection strategy 2 (partial match) failed for "${Stream}": ${e2.message}`);
        // Strategy 3: Use keyboard navigation
        try {
          await this.page.keyboard.press('ArrowDown');
          await this.page.waitForTimeout(200);
          await this.page.keyboard.press('Enter');
          streamSelected = true;
        } catch (e3) {
          testLogger.warn(`Stream selection strategy 3 (keyboard) failed for "${Stream}": ${e3.message}`);
        }
      }
    }

    if (!streamSelected) {
      throw new Error(`Failed to select stream: ${Stream}`);
    }

    // Wait for field data to load after stream selection
    await this.page.waitForTimeout(1000);

    // Wait for the field select dropdown to be ready
    const fieldSelect = this.page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.waitFor({ state: "visible", timeout: 10000 });
    await fieldSelect.click();
    await fieldSelect.fill(field);

    // Wait for dropdown to have options available
    await this.page.waitForFunction(
      () => {
        const options = document.querySelectorAll('[role="option"]');
        return options.length > 0;
      },
      { timeout: 10000, polling: 100 }
    );

    // Try to select the field from dropdown - use multiple strategies (from dashboard-variables.js)
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
          fieldSelected = false;
        }
      }
    }

    if (!fieldSelected) {
      throw new Error(`Failed to select field: ${field}`);
    }
  }

  //select Constant type

  async selectConstantType(type, variableName, value) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
    await this.page
      .locator('[data-test="dashboard-variable-constant-value"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-constant-value"]')
      .fill(value);
  }

  //select Textbox type
  async selectTextType(type, variableName) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
  }

  //select Custom type
  async selectCustomType(type, variableName, label, value) {
    await this.page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.getByRole("option", { name: type }).click();
    await this.page.locator('[data-test="dashboard-variable-name"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name"]')
      .fill(variableName);
    await this.page.getByRole("button", { name: "Add Option" }).click();

    await this.page
      .locator('[data-test="dashboard-custom-variable-0-label"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-label"]')
      .fill(label);
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-value"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-value"]')
      .fill(value);
  }
  //add max record size
  async addMaxRecord(value) {
    await this.page
      .locator('[data-test="dashboard-variable-max-record-size"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-max-record-size"]')
      .fill(value);
  }

  //enable multi select
  async enableMultiSelect() {
    await this.page
      .locator('[data-test="dashboard-query_values-show_multiple_values"]')
      .click();
  }

  //enable default value
  async addCustomValue(value) {
    await this.page
      .locator(
        '[data-test="dashboard-multi-select-default-value-toggle-custom"]'
      )
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-custom-value-0"]')
      .click();
    await this.page
      .locator('[data-test="dashboard-variable-custom-value-0"]')
      .fill(value);
  }

  //save variable
  async saveVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-save-btn"]')
      .click();
  }

  //Cancel variable
  async cancelVariable() {
    await this.page
      .locator('[data-test="dashboard-variable-cancel-btn"]')
      .click();
  }

  //hide variable
  async hideVariable() {
    const toggle = this.page.locator('[data-test="dashboard-variable-hide_on_dashboard"]');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click({ force: true });
  }

  //close setting window
  async closeSettingWindow() {
    // Use multiple selectors to detect if settings dialog is open
    const settingsDialog = this.page.locator('[data-test="dashboard-settings-dialog"]').or(this.page.locator('.q-dialog'));
    const closeBtn = this.page.locator('[data-test="dashboard-settings-close-btn"]');

    // First, check if the dialog exists and is visible
    const dialogExists = await settingsDialog.isVisible().catch(() => false);

    if (!dialogExists) {
      // Dialog already closed, nothing to do
      return;
    }

    // Retry pattern for closing the dialog
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Wait for close button with a short timeout
        await closeBtn.waitFor({ state: "visible", timeout: 3000 });
        await closeBtn.click({ timeout: 2000 });

        // Wait for dialog to actually disappear
        await settingsDialog.waitFor({ state: "hidden", timeout: 5000 });

        // Wait for network to settle after closing
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        // Verify the dialog is really closed
        const stillVisible = await settingsDialog.isVisible().catch(() => false);
        if (!stillVisible) {
          return; // Success
        }
      } catch (error) {
        // Check if dialog is actually closed
        const stillVisible = await settingsDialog.isVisible().catch(() => false);
        if (!stillVisible) {
          // Dialog closed - success
          return;
        }

        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw error;
        }

        // Wait before retry
        await this.page.waitForTimeout(500);
      }
    }
  }

  // Update tab name in edit tab options//
  async updateDashboardTabName(oldTabName, updatedTabName) {
    const page = this.page;

    // Open Settings tab
    await page
      .locator('[data-test="dashboard-settings-tab-tab"]')
      .waitFor({ state: "visible" });

    // Locate the tab to be edited based on oldTabName
    const tabLocator = page
      .locator('[data-test="dashboard-tab-settings-drag"] div')
      .filter({ hasText: oldTabName });

    // Click Edit button for the tab
    await tabLocator
      .locator('[data-test="dashboard-tab-settings-tab-edit-btn"]')
      .click();

    // Click to enable name editing
    const nameEditLocator = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit"]'
    );
    await nameEditLocator.click();

    // Fill new tab name
    await nameEditLocator.fill(updatedTabName);
  }

  //save edited tab name
  async saveEditedtab() {
    await this.page
      .locator('[data-test="dashboard-tab-settings-tab-name-edit-save"]')
      .click();
  }

  // Delete tab in edit tab options//

  async deleteTab(oldTabName) {
    const page = this.page;

    // Open Settings tab
    await page
      .locator('[data-test="dashboard-settings-tab-tab"]')
      .waitFor({ state: "visible" });

    // Locate the tab to be deleted based on oldTabName
    const tabLocator = page
      .locator('[data-test="dashboard-tab-settings-drag"] div')
      .filter({ hasText: oldTabName });

    // Click delete button for the tab
    await tabLocator
      .locator('[data-test="dashboard-tab-settings-tab-delete-btn"]')
      .click();

    // Confirm deletion
    await page
      .locator('[data-test="confirm-button"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="confirm-button"]').click();
  }
}
