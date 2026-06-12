// Copyright 2026 OpenObserve Inc.

/**
 * DashboardsFormValidationPage
 *
 * Page Object Model for Dashboard domain form validation:
 *   - AddDashboard (hosted in dashboard-add-dialog)
 *   - AddFolder    (hosted in dashboard-folder-dialog)
 *   - AddTab       (hosted in dashboard-tab-settings-add-tab-dialog, accessed from within a dashboard)
 *
 * OInput/OFormInput convention:
 *   data-test="foo" → native <input> carries data-test="foo-field" (.fill())
 *                   → error span carries data-test="foo-error"
 *
 * ODialog built-in buttons are scoped to their dialog:
 *   [data-test="<dialog>"] [data-test="o-dialog-primary-btn"]
 *   [data-test="<dialog>"] [data-test="o-dialog-secondary-btn"]
 */
export class DashboardsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ────────────────────────────────────────────────────────
        this.dashboardsMenuLink = '[data-test="menu-link-/dashboards-item"]';

        // ── AddDashboard form ─────────────────────────────────────────────────
        // Trigger button on the Dashboards list page
        this.newDashboardBtn        = '[data-test="dashboard-new"]';
        // ODialog wrapper
        this.dashboardDialog        = '[data-test="dashboard-add-dialog"]';
        // OFormInput data-test="add-dashboard-name" → -field / -error
        this.dashboardNameInput     = '[data-test="add-dashboard-name-field"]';
        this.dashboardNameError     = '[data-test="add-dashboard-name-error"]';
        // ODialog primary/secondary buttons scoped to dialog
        this.dashboardSubmitBtn     = '[data-test="dashboard-add-dialog"] [data-test="o-dialog-primary-btn"]';
        this.dashboardCancelBtn     = '[data-test="dashboard-add-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── AddFolder form ────────────────────────────────────────────────────
        // Trigger: existing dashboard-folder page object; here we reference the
        // new-folder button via the same selector used in dashboard-folder.js.
        this.newFolderBtn           = '[data-test="dashboard-new-folder-btn"]';
        // ODialog wrapper
        this.folderDialog           = '[data-test="dashboard-folder-dialog"]';
        // OFormInput data-test="dashboard-folder-add-name" → -field / -error
        this.folderNameInput        = '[data-test="dashboard-folder-add-name-field"]';
        this.folderNameError        = '[data-test="dashboard-folder-add-name-error"]';
        // ODialog primary/secondary buttons scoped to dialog
        this.folderSubmitBtn        = '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-primary-btn"]';
        this.folderCancelBtn        = '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── AddTab form ───────────────────────────────────────────────────────
        // Trigger: the "+" tab button rendered by TabList.vue inside a dashboard
        this.addTabBtn              = '[data-test="dashboard-tab-add-btn"]';
        // ODialog wrapper (declared directly on AddTab.vue's ODialog)
        this.tabDialog              = '[data-test="dashboard-tab-settings-add-tab-dialog"]';
        // OFormInput data-test="dashboard-add-tab-name" → -field / -error
        this.tabNameInput           = '[data-test="dashboard-add-tab-name-field"]';
        this.tabNameError           = '[data-test="dashboard-add-tab-name-error"]';
        // ODialog primary/secondary buttons scoped to dialog
        this.tabSubmitBtn           = '[data-test="dashboard-tab-settings-add-tab-dialog"] [data-test="o-dialog-primary-btn"]';
        this.tabCancelBtn           = '[data-test="dashboard-tab-settings-add-tab-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── Dashboard list / navigation ───────────────────────────────────────
        // Tab-list container rendered once a dashboard is open
        this.tabListContainer       = '[data-test="dashboard-tab-list-container"]';

        // ── Toast ─────────────────────────────────────────────────────────────
        this.toastSuccess           = '[data-test="o-toast-success"]';

        // ── DrilldownPopup ────────────────────────────────────────────────────
        // OFormInput data-test="dashboard-config-panel-drilldown-name" → -field / -error
        this.drilldownNameInput     = '[data-test="dashboard-config-panel-drilldown-name-field"]';
        this.drilldownNameError     = '[data-test="dashboard-config-panel-drilldown-name-error"]';
        // Type selector buttons
        this.drilldownByDashboardBtn = '[data-test="dashboard-drilldown-by-dashboard-btn"]';
        this.drilldownByUrlBtn       = '[data-test="dashboard-drilldown-by-url-btn"]';
        this.drilldownByLogsBtn      = '[data-test="dashboard-drilldown-by-logs-btn"]';
        // URL input and its error
        this.drilldownUrlTextarea    = '[data-test="dashboard-drilldown-url-textarea"]';
        this.drilldownUrlError       = '[data-test="dashboard-drilldown-url-error-message"]';
        // Dashboard/tab/folder selects (OSelect convention)
        this.drilldownFolderSelect   = '[data-test="dashboard-drilldown-folder-select-popover"]';
        this.drilldownDashboardSelect = '[data-test="dashboard-drilldown-dashboard-select-popover"]';
        this.drilldownTabSelect      = '[data-test="dashboard-drilldown-tab-select-popover"]';

        // ── Dashboard Settings navigation ─────────────────────────────────────
        this.dashboardSettingsBtn   = '[data-test="dashboard-setting-btn"]';
        this.settingsVariablesTab   = '[data-test="dashboard-settings-variable-tab"]';
        this.variableAddBtn         = '[data-test="dashboard-variable-add-btn"]';

        // ── Variable Settings (Dashboard Settings > Variables) ────────────────
        // OFormInput data-test="dashboard-variable-name" → -field / -error
        this.variableNameInput      = '[data-test="dashboard-variable-name-field"]';
        this.variableNameError      = '[data-test="dashboard-variable-name-error"]';
        // OSelect data-test="dashboard-variable-type-select" → -popover / -error
        this.variableTypeSelectPopover = '[data-test="dashboard-variable-type-select-popover"]';
        this.variableTypeError      = '[data-test="dashboard-variable-type-select-error"]';
        // Action buttons
        this.variableCancelBtn      = '[data-test="dashboard-variable-cancel-btn"]';
        this.variableSaveBtn        = '[data-test="dashboard-variable-save-btn"]';

        // ── AddCondition (Panel config > Conditions tab) ──────────────────────
        // First condition row (index 0)
        this.conditionColumn0       = '[data-test="dashboard-add-condition-column-0"]';
        this.conditionCondition0    = '[data-test="dashboard-add-condition-condition-0"]';
        this.conditionValue         = '[data-test="dashboard-add-condition-value"]';
        this.conditionRemove        = '[data-test="dashboard-add-condition-remove"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async navigateToDashboards() {
        await this.page.locator(this.dashboardsMenuLink).click();
        await this.page.locator('[data-test="dashboard-table"]').waitFor({ state: 'visible', timeout: 15000 });
    }

    // ── AddDashboard helpers ──────────────────────────────────────────────────

    async openAddDashboardForm() {
        await this.page.locator(this.newDashboardBtn).click();
        await this.page.locator(this.dashboardDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillDashboardName(name) {
        await this.page.locator(this.dashboardNameInput).fill(name);
    }

    async submitDashboardForm() {
        await this.page.locator(this.dashboardSubmitBtn).click();
    }

    async cancelDashboardForm() {
        await this.page.locator(this.dashboardCancelBtn).click();
    }

    getDashboardDialogLocator() {
        return this.page.locator(this.dashboardDialog);
    }

    getDashboardNameInputLocator() {
        return this.page.locator(this.dashboardNameInput);
    }

    getDashboardNameErrorLocator() {
        return this.page.locator(this.dashboardNameError);
    }

    getDashboardSubmitBtnLocator() {
        return this.page.locator(this.dashboardSubmitBtn);
    }

    // ── AddFolder helpers ─────────────────────────────────────────────────────

    async openAddFolderForm() {
        await this.page.locator(this.newFolderBtn).click();
        await this.page.locator(this.folderDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillFolderName(name) {
        await this.page.locator(this.folderNameInput).fill(name);
    }

    async submitFolderForm() {
        await this.page.locator(this.folderSubmitBtn).click();
    }

    async cancelFolderForm() {
        await this.page.locator(this.folderCancelBtn).click();
    }

    getFolderDialogLocator() {
        return this.page.locator(this.folderDialog);
    }

    getFolderNameErrorLocator() {
        return this.page.locator(this.folderNameError);
    }

    getFolderSubmitBtnLocator() {
        return this.page.locator(this.folderSubmitBtn);
    }

    // ── AddTab helpers ────────────────────────────────────────────────────────

    async openAddTabForm() {
        await this.page.locator(this.addTabBtn).click();
        await this.page.locator(this.tabDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillTabName(name) {
        await this.page.locator(this.tabNameInput).fill(name);
    }

    async submitTabForm() {
        await this.page.locator(this.tabSubmitBtn).click();
    }

    async cancelTabForm() {
        await this.page.locator(this.tabCancelBtn).click();
    }

    getTabDialogLocator() {
        return this.page.locator(this.tabDialog);
    }

    getTabNameErrorLocator() {
        return this.page.locator(this.tabNameError);
    }

    getTabSubmitBtnLocator() {
        return this.page.locator(this.tabSubmitBtn);
    }

    // ── Dashboard list navigation helpers ────────────────────────────────────

    /**
     * Returns a locator for a dashboard row identified by its data-test-dashboard-name attribute.
     * @param {string} dashName
     */
    getDashboardByNameLocator(dashName) {
        return this.page.locator(`[data-test-dashboard-name="${dashName}"]`).first();
    }

    /**
     * Clicks into the dashboard row for dashName using its data-test-dashboard-name attribute.
     * Falls back gracefully — callers should check existence before calling if needed.
     * @param {string} dashName
     */
    async openDashboardByName(dashName) {
        await this.page.locator(`[data-test-dashboard-name="${dashName}"]`).first().click();
    }

    /**
     * Waits for the tab-list container to be visible after opening a dashboard.
     * @param {number} [timeout=15000]
     */
    async waitForTabListContainer(timeout = 15000) {
        await this.page.locator(this.tabListContainer).waitFor({ state: 'visible', timeout });
    }

    getTabListContainerLocator() {
        return this.page.locator(this.tabListContainer);
    }

    // ── DrilldownPopup helpers ────────────────────────────────────────────────

    async clickDrilldownByUrlBtn() {
        await this.page.locator(this.drilldownByUrlBtn).click();
    }

    async fillDrilldownUrl(url) {
        await this.page.locator(this.drilldownUrlTextarea).fill(url);
    }

    getDrilldownNameInputLocator() {
        return this.page.locator(this.drilldownNameInput);
    }

    getDrilldownNameErrorLocator() {
        return this.page.locator(this.drilldownNameError);
    }

    getDrilldownByDashboardBtnLocator() {
        return this.page.locator(this.drilldownByDashboardBtn);
    }

    getDrilldownByUrlBtnLocator() {
        return this.page.locator(this.drilldownByUrlBtn);
    }

    getDrilldownByLogsBtnLocator() {
        return this.page.locator(this.drilldownByLogsBtn);
    }

    getDrilldownUrlTextareaLocator() {
        return this.page.locator(this.drilldownUrlTextarea);
    }

    getDrilldownUrlErrorLocator() {
        return this.page.locator(this.drilldownUrlError);
    }

    // ── Variable Settings helpers ─────────────────────────────────────────────

    async fillVariableName(name) {
        await this.page.locator(this.variableNameInput).fill(name);
    }

    async openVariableTypeSelect() {
        await this.page.locator(this.variableTypeSelectPopover).click();
    }

    async clickVariableSave() {
        await this.page.locator(this.variableSaveBtn).click();
    }

    async clickVariableCancel() {
        await this.page.locator(this.variableCancelBtn).click();
    }

    getDashboardSettingsBtnLocator() {
        return this.page.locator(this.dashboardSettingsBtn);
    }

    getSettingsVariablesTabLocator() {
        return this.page.locator(this.settingsVariablesTab);
    }

    getVariableAddBtnLocator() {
        return this.page.locator(this.variableAddBtn);
    }

    getVariableNameInputLocator() {
        return this.page.locator(this.variableNameInput);
    }

    getVariableNameErrorLocator() {
        return this.page.locator(this.variableNameError);
    }

    getVariableTypeSelectPopoverLocator() {
        return this.page.locator(this.variableTypeSelectPopover);
    }

    getVariableTypeErrorLocator() {
        return this.page.locator(this.variableTypeError);
    }

    getVariableCancelBtnLocator() {
        return this.page.locator(this.variableCancelBtn);
    }

    getVariableSaveBtnLocator() {
        return this.page.locator(this.variableSaveBtn);
    }

    // ── AddCondition helpers ──────────────────────────────────────────────────

    getConditionColumn0Locator() {
        return this.page.locator(this.conditionColumn0);
    }

    getConditionCondition0Locator() {
        return this.page.locator(this.conditionCondition0);
    }

    getConditionValueLocator() {
        return this.page.locator(this.conditionValue);
    }

    getConditionRemoveLocator() {
        return this.page.locator(this.conditionRemove);
    }
}
