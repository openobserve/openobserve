// Dashboard Setting Page Object
// This class contains methods to interact with the dashboard settings page in OpenObserve.
// This includes changing the dashboard name, adding tabs, managing variables, and more.
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getTabSelector } = require('./dashboard-selectors.js');
const { selectStreamFromDropdown, selectFieldFromDropdown } = require('./dashboard-stream-field-utils.js');

export default class DashboardSetting {
  constructor(page) {
    this.page = page;
    this.setting = page.locator('[data-test="dashboard-setting-btn"]');
    this.addVariableBtn = page.locator(
      '[data-test="dashboard-add-variable-btn"]'
    );
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
    this.newName = page.locator('[data-test="dashboard-general-setting-name-field"]');
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
    this.deleteconfirmBtn = page.locator('[data-test="tabs-delete-popup-dialog"] [data-test="o-dialog-primary-btn"]');
    this.editName = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit"]'
    );
    this.fullScreen = page.locator('[data-test="dashboard-fullscreen-btn"]');
    this.tabName = page.locator('[data-test="dashboard-add-tab-name-field"]');
    this.saveTab = page.locator(
      '[data-test="dashboard-tab-settings-add-tab-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.closeSetting = page.locator(
      '[data-test="dashboard-settings-drawer"] [data-test="o-drawer-close-btn"]'
    );
    this.timeBtn = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');

    this.addTabCancel = page.locator(
      '[data-test="dashboard-tab-settings-add-tab-dialog"] [data-test="o-dialog-secondary-btn"]'
    );
    this.EditSave = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit-save"]'
    );
    // Tab name cells inside the OTable (one per tab row).
    this.tabNameCells = page.locator(
      '[data-test="dashboard-tab-settings-tab-name"]'
    );
    // Resolve a tab's OTable row from its name cell. The tabs table migrated
    // to OTable, so rows are `o2-table-row-{index}` — walk up to that row from
    // the name cell to reach its edit/delete actions.
    this.getTabRowByName = (tabName) =>
      page
        .locator(
          `[data-test="dashboard-tab-settings-tab-name"][data-test-tab-name="${tabName}"]`
        )
        .locator(`xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`);
  }

  //Dashboard Settings//
  //Generate unique dashboard name
  generateUniqueDashboardnewName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  //Open Dashboard Setting//
  async openSetting() {
    // Idempotent: if the settings ODrawer is already open, do nothing.
    // The settings UI is rendered as an ODrawer with a backdrop overlay; clicking
    // the dashboard-setting-btn while the drawer is open causes the overlay to
    // intercept the pointer and dismiss the drawer (onInteractOutside), so blindly
    // re-clicking after a save would close the drawer mid-test.
    const generalTab = this.page.locator('[data-test="dashboard-settings-general-tab"]');
    const alreadyOpen = await generalTab.isVisible().catch(() => false);
    if (alreadyOpen) {
      return;
    }

    await this.page.waitForSelector('[data-test="dashboard-setting-btn"]', {
      state: "visible",
      timeout: 15000,
    });
    await this.setting.click();
    // Wait for settings dialog to open - use more specific selector
    await generalTab.waitFor({ state: "visible", timeout: 10000 });
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Wait for all tabs to be rendered in the dialog
    // The dialog has General, Tab, and Variables tabs - wait for the container to stabilize
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Wait deterministically for the variables tab to mount (proxy for full tab render)
    await this.page.locator('[data-test="dashboard-settings-variable-tab"]').waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
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

    // The picker renders in a portal that mounts on click — clicking the option
    // in the same tick lands before it exists (or on a node still animating in).
    const relativeBtn = this.page.locator(
      `[data-test="date-time-relative-${date}-${time}-btn"]`
    );
    await relativeBtn.waitFor({ state: "visible", timeout: 10000 });
    await relativeBtn.click();
  }

  // Toast message locator scoped to a given text (assert visibility in the spec)
  getToastMessageByText(text) {
    return this.page
      .locator('[data-test="o-toast-message"]')
      .filter({ hasText: text });
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
    // The ODrawer animates out over a backdrop that still swallows pointer
    // events mid-transition, so a following click (e.g. the back button) can be
    // eaten. Wait for it to actually be gone.
    await this.page
      .locator('[data-test="dashboard-settings-drawer"]')
      .waitFor({ state: "hidden", timeout: 10000 })
      .catch(() => {});
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

  //Click the "Tab" settings tab (tabs management view)//
  async clickTabsSettingsTab() {
    await this.tab.click();
  }

  //Add new tab//
  async addTabSetting(tabnewName) {
    await this.tab.waitFor({ state: "visible" });
    await this.tab.click();
    // TabsSettings loads dashboard data async on mount; wait for the first
    // tab row (the default tab) to appear before clicking "Add Tab",
    // otherwise dashboardId is still undefined and the API call fails.
    await this.tabNameCells
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    await this.addtab.click();
    await this.tabName.waitFor({ state: "visible", timeout: 10000 });
    await this.tabName.fill(tabnewName);
  }

  //save new tab setting//
  async saveTabSetting() {
    await this.saveTab.click();
    // The dialog closes only once the tab has actually been created, so this is
    // the signal that the save landed — without it a caller can close the
    // settings drawer out from under an in-flight request and lose the tab.
    await this.page
      .locator('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .waitFor({ state: "hidden", timeout: 15000 })
      .catch(() => {});
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
    await this.addTabCancel.waitFor({ state: "visible", timeout: 10000 });
    await this.addTabCancel.click();
    await this.page
      .locator('[data-test="dashboard-tab-settings-add-tab-dialog"]')
      .waitFor({ state: "hidden", timeout: 10000 })
      .catch(() => {});
  }

  //Cancel edit tab name
  async cancelEditedtab() {
    const cancelBtn = this.page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit-cancel"]'
    );
    await cancelBtn.waitFor({ state: "visible", timeout: 10000 });
    await cancelBtn.click();
  }

  //Variables Settings
  //Open Variables tab

  // The variables tab click can be swallowed mid drawer-transition, leaving the
  // General tab showing. Callers then wait out their full timeout on a control
  // that was never going to render, so gate the tab switch on the variables panel
  // actually appearing — either its list (add-variable button) or, if a variable
  // form is already open, the form's name field.
  async waitForVariablesPanel(timeout = 5000) {
    await this.page
      .locator(
        '[data-test="dashboard-add-variable-btn"], [data-test="dashboard-variable-name-field"]'
      )
      .first()
      .waitFor({ state: "visible", timeout });
  }

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

    // Wait for dialog tabs to be fully loaded - the tabs are in a tabs container
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Retry pattern for clicking variables tab (element can get detached during dialog transitions)
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const variablesTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');

        // Check if tab exists in DOM first
        const tabCount = await variablesTab.count();
        if (tabCount === 0) {
          testLogger.warn(`openVariables attempt ${attempt}: Variables tab not found in DOM, waiting...`);
          await variablesTab.waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
          continue;
        }

        await variablesTab.waitFor({ state: "visible", timeout: 10000 });
        await variablesTab.scrollIntoViewIfNeeded();
        await variablesTab.click();
        await this.waitForVariablesPanel();
        return; // Success
      } catch (e) {
        testLogger.warn(`openVariables attempt ${attempt} failed: ${e.message}`);
        if (attempt === maxRetries) throw e;
        await this.page.locator('[data-test="dashboard-settings-variable-tab"]').waitFor({ state: "attached", timeout: 2000 }).catch(() => {});
      }
    }
  }

  // Navigate to Variables tab after opening settings
  async goToVariablesTab() {
    // Wait for dialog to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Retry pattern for clicking variables tab (element can get detached during dialog transitions)
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const variablesTab = this.page.locator('[data-test="dashboard-settings-variable-tab"]');

        // Check if tab exists in DOM first
        const tabCount = await variablesTab.count();
        if (tabCount === 0) {
          testLogger.warn(`goToVariablesTab attempt ${attempt}: Variables tab not found in DOM, waiting...`);
          await variablesTab.waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
          continue;
        }

        await variablesTab.waitFor({ state: "visible", timeout: 10000 });
        await variablesTab.scrollIntoViewIfNeeded();
        await variablesTab.click();
        await this.waitForVariablesPanel();
        return; // Success
      } catch (e) {
        testLogger.warn(`goToVariablesTab attempt ${attempt} failed: ${e.message}`);
        if (attempt === maxRetries) throw e;
        await this.page.locator('[data-test="dashboard-settings-variable-tab"]').waitFor({ state: "attached", timeout: 2000 }).catch(() => {});
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
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();

    // Wait for the type option to be visible before clicking
    await this.page.locator(`[data-test="dashboard-variable-type-select-popover"]`).waitFor({ state: "visible", timeout: 10000 });
    const typeValue = type.toLowerCase().replace(/\s+/g, '_');
    const typeOption = this.page.locator(`[data-test="dashboard-variable-type-select-option"][data-test-value="${typeValue}"]`);
    await typeOption.waitFor({ state: "visible", timeout: 10000 });
    await typeOption.click();
    await this.page.locator('[data-test="dashboard-variable-name-field"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-name-field"]')
      .fill(variableName);
    await this.page
      .locator('[data-test="dashboard-variable-stream-type-select"]')
      .click();

    // Wait for the stream-type dropdown option to be visible before clicking
    await this.page.locator(`[data-test="dashboard-variable-stream-type-select-popover"]`).waitFor({ state: "visible", timeout: 10000 });
    const streamTypeOption = this.page.locator(`[data-test="dashboard-variable-stream-type-select-option"][data-test-value="${streamType}"]`);
    await streamTypeOption.waitFor({ state: "visible", timeout: 10000 });
    await streamTypeOption.click();

    // Select Stream and Field using shared utilities
    await selectStreamFromDropdown(this.page, Stream);
    await selectFieldFromDropdown(this.page, field);
  }

  //select Constant type

  async selectConstantType(type, variableName, value) {
    await this.page
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.locator(`[data-test="dashboard-variable-type-select-popover"]`).waitFor({ state: "visible", timeout: 10000 });
    await this.#pickVariableType(type);
    await this.#fillVariableName(variableName);
    const constantValue = this.page.locator('[data-test="dashboard-variable-constant-value-field"]');
    await constantValue.waitFor({ state: "visible", timeout: 10000 });
    await constantValue.fill(value);
  }

  //select Textbox type
  async selectTextType(type, variableName) {
    await this.page
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.locator(`[data-test="dashboard-variable-type-select-popover"]`).waitFor({ state: "visible", timeout: 10000 });
    await this.#pickVariableType(type);
    await this.#fillVariableName(variableName);
  }

  //select Custom type
  async selectCustomType(type, variableName, label, value) {
    await this.page
      .locator('[data-test="dashboard-add-variable-btn"]')
      .waitFor({ state: "visible" });
    await this.page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="dashboard-variable-type-select"]')
      .click();
    await this.page.locator(`[data-test="dashboard-variable-type-select-popover"]`).waitFor({ state: "visible", timeout: 10000 });
    await this.#pickVariableType(type);
    await this.#fillVariableName(variableName);
    // Selecting "Custom" type auto-creates the first option row (index 0).
    // Do NOT click "Add Option" — that would add a second empty row and fail validation.
    await this.page
      .locator('[data-test="dashboard-custom-variable-0-label"]')
      .waitFor({ state: "visible", timeout: 10000 });
    await this.page.locator('[data-test="dashboard-custom-variable-0-label-field"]').fill(label);
    await this.page.locator('[data-test="dashboard-custom-variable-0-value-field"]').fill(value);
  }
  //add max record size
  async addMaxRecord(value) {
    const maxRecord = this.page.locator(
      '[data-test="dashboard-variable-max-record-size-field"]'
    );
    // Rendered only for query_values, and only once the type select has settled.
    await maxRecord.waitFor({ state: "visible", timeout: 10000 });
    await maxRecord.fill(value);
  }

  //enable multi select
  async enableMultiSelect() {
    const toggle = this.page.locator(
      '[data-test="dashboard-query_values-show_multiple_values"]'
    );
    await toggle.waitFor({ state: "visible", timeout: 10000 });
    await toggle.click();
  }

  //enable default value
  async addCustomValue(value) {
    const customToggle = this.page.locator(
      '[data-test="dashboard-multi-select-default-value-toggle-custom"]'
    );
    await customToggle.waitFor({ state: "visible", timeout: 10000 });
    await customToggle.click();
    const customValue = this.page.locator(
      '[data-test="dashboard-variable-custom-value-0-field"]'
    );
    // v-if'd on selectAllValueForMultiSelect === "custom", so it mounts only after the click above.
    await customValue.waitFor({ state: "visible", timeout: 10000 });
    await customValue.fill(value);
  }

  //save variable
  async saveVariable() {
    const saveBtn = this.page.locator(
      '[data-test="dashboard-variable-save-btn"]'
    );
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();
    // The form swaps back to the list only once the save lands; without this a caller
    // can close the settings drawer mid-request and lose the variable.
    await this.addVariableBtn
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
  }

  // Wait for the "Add Variable" button to be visible (variables list view)
  async waitForAddVariableBtnVisible() {
    await this.addVariableBtn.waitFor({ state: "visible" });
  }

  //Cancel variable
  async cancelVariable() {
    const cancelBtn = this.page.locator(
      '[data-test="dashboard-variable-cancel-btn"]'
    );
    await cancelBtn.waitFor({ state: "visible", timeout: 10000 });
    await cancelBtn.click();
    await this.addVariableBtn
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
  }

  //hide variable
  async hideVariable() {
    const toggle = this.page.locator('[data-test="dashboard-variable-hide_on_dashboard"]');
    // force:true skips actionability, so without this the click can land on a switch
    // that is still mounting and be swallowed.
    await toggle.waitFor({ state: "visible", timeout: 10000 });
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click({ force: true });
  }

  //close setting window
  async closeSettingWindow() {
    // The settings UI is now an ODrawer, scoped by data-test="dashboard-settings-drawer"
    const settingsDialog = this.page.locator('[data-test="dashboard-settings-drawer"]');
    const closeBtn = this.page.locator(
      '[data-test="dashboard-settings-drawer"] [data-test="o-drawer-close-btn"]'
    );

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

        // Wait for close button to be ready before retry
        await closeBtn.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
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
    const tabLocator = this.getTabRowByName(oldTabName);

    // Click Edit button for the tab
    await tabLocator
      .locator('[data-test="dashboard-tab-settings-tab-edit-btn"]')
      .click();

    // Click to enable name editing. The input is rendered only after the row
    // swaps into edit mode, so clicking in the same tick as the edit button
    // above lands on a node that does not exist yet.
    const nameEditLocator = page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit"]'
    );
    await nameEditLocator.waitFor({ state: "visible", timeout: 10000 });
    await nameEditLocator.click();

    // Fill new tab name
    await nameEditLocator.fill(updatedTabName);
  }

  //save edited tab name
  async saveEditedtab() {
    const saveBtn = this.page.locator(
      '[data-test="dashboard-tab-settings-tab-name-edit-save"]'
    );
    await saveBtn.waitFor({ state: "visible", timeout: 10000 });
    await saveBtn.click();
  }

  // Delete tab in edit tab options//

  async deleteTab(oldTabName) {
    const page = this.page;

    // Open Settings tab
    await page
      .locator('[data-test="dashboard-settings-tab-tab"]')
      .waitFor({ state: "visible" });

    // Locate the tab to be deleted based on oldTabName
    const tabLocator = this.getTabRowByName(oldTabName);

    // Click delete button for the tab
    await tabLocator
      .locator('[data-test="dashboard-tab-settings-tab-delete-btn"]')
      .click();

    // Confirm deletion
    await page
      .locator('[data-test="tabs-delete-popup-dialog"] [data-test="o-dialog-primary-btn"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="tabs-delete-popup-dialog"] [data-test="o-dialog-primary-btn"]').click();
  }

  // The popover being visible does not mean its items have rendered, so clicking an
  // option in the same tick as the popover check lands on a node that is not there yet.
  async #pickVariableType(type) {
    const typeOption = this.page.locator(
      `[data-test="dashboard-variable-type-select-option"][data-test-value="${type.toLowerCase()}"]`
    );
    await typeOption.waitFor({ state: "visible", timeout: 10000 });
    await typeOption.click();
  }

  // The name field is re-rendered by the type switch above, so a fill issued
  // immediately after it can be discarded by that re-render.
  async #fillVariableName(variableName) {
    const nameField = this.page.locator(
      '[data-test="dashboard-variable-name-field"]'
    );
    await nameField.waitFor({ state: "visible", timeout: 10000 });
    await nameField.fill(variableName);
    if ((await nameField.inputValue().catch(() => "")) !== variableName) {
      await nameField.fill(variableName);
    }
  }
}
