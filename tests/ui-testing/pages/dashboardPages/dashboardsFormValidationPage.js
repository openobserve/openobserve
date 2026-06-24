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
        this.toastSuccess           = '[data-test-variant="success"]';

        // ── DrilldownPopup ────────────────────────────────────────────────────
        // OFormInput data-test="dashboard-config-panel-drilldown-name" → -field / -error
        this.drilldownNameInput     = '[data-test="dashboard-config-panel-drilldown-name-field"]';
        this.drilldownNameError     = '[data-test="dashboard-config-panel-drilldown-name-error"]';
        // Add drilldown button (in config panel drilldown section)
        this.drilldownAddBtn        = '[data-test="dashboard-addpanel-config-drilldown-add-btn"]';
        // DrilldownPopUp dialog wrapper
        this.drilldownPopup         = '[data-test="dashboard-drilldown-popup"]';
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
        this.dashboardSettingsBtn    = '[data-test="dashboard-setting-btn"]';
        this.settingsGeneralTab      = '[data-test="dashboard-settings-general-tab"]';
        this.settingsVariablesTab    = '[data-test="dashboard-settings-variable-tab"]';
        this.variableAddBtn          = '[data-test="dashboard-variable-add-btn"]';

        // ── PanelLayoutSettings dialog ────────────────────────────────────────
        this.panelLayoutDrawer      = '[data-test="panel-layout-settings-drawer"]';
        this.panelLayoutHeightField = '[data-test="panel-layout-settings-height-input-field"]';
        this.panelLayoutHeightError = '[data-test="panel-layout-settings-height-input-error"]';
        this.panelLayoutSaveBtn     = '[data-test="panel-layout-settings-drawer"] [data-test="o-dialog-primary-btn"]';
        this.panelLayoutCancelBtn   = '[data-test="panel-layout-settings-drawer"] [data-test="o-dialog-secondary-btn"]';

        // ── AddCondition (panel editor Filters section) ───────────────────────
        this.addConditionAddBtn     = '[data-test="dashboard-add-condition-add"]';
        this.conditionColumn        = '[data-test="dashboard-add-condition-column-0"]';
        this.conditionCondition     = '[data-test="dashboard-add-condition-condition-0"]';
        this.conditionRemoveColumn  = '[data-test="dashboard-add-condition-remove-column-0"]';

        // ── AddAnnotation dialog ──────────────────────────────────────────────
        this.addAnnotationDialog    = '[data-test="add-annotation-dialog"]';
        this.annotationTitleField   = '[data-test="dashboard-add-annotation-title-input-field"]';
        this.annotationTitleError   = '[data-test="dashboard-add-annotation-title-input-error"]';
        this.annotationTextField    = '[data-test="dashboard-add-annotation-text-input-field"]';
        this.annotationPanelsPopover = '[data-test="dashboard-add-annotation-panels-select-popover"]';
        // Save/Cancel now use ODialog's built-in footer buttons (scoped to this dialog).
        this.annotationCancelBtn    = '[data-test="add-annotation-dialog"] [data-test="o-dialog-secondary-btn"]';
        this.annotationSaveBtn      = '[data-test="add-annotation-dialog"] [data-test="o-dialog-primary-btn"]';

        // ── GeneralSettings dialog ────────────────────────────────────────────
        this.generalSettingNameField     = '[data-test="dashboard-general-setting-name-field"]';
        this.generalSettingNameError     = '[data-test="dashboard-general-setting-name-error"]';
        this.generalSettingDescField     = '[data-test="dashboard-general-setting-description-field"]';
        this.generalSettingCancelBtn     = '[data-test="dashboard-general-setting-cancel-btn"]';
        this.generalSettingSaveBtn       = '[data-test="dashboard-general-setting-save-btn"]';

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

        // ── ConfigPanel (panel editor right sidebar) ──────────────────────────
        this.configPanelDescription  = '[data-test="dashboard-config-description"]';
        this.configPanelYAxisMin     = '[data-test="dashboard-config-y_axis_min"]';
        this.configPanelYAxisMax     = '[data-test="dashboard-config-y_axis_max"]';
        this.configPanelDecimals      = '[data-test="dashboard-config-decimals"]';
        this.configPanelDecimalsField = '[data-test="dashboard-config-decimals-field"]';
        this.configPanelDecimalsError = '[data-test="dashboard-config-decimals-error"]';
        this.configPanelLimit        = '[data-test="dashboard-config-limit"]';

        // ── BuildFieldPopUp ───────────────────────────────────────────────────
        this.buildFieldPopupContainer = '[data-test="dashboard-build-field-popup-container"]';
        this.buildFieldLabelInput     = '[data-test="dashboard-x-item-input-field"]';
        // Y-axis field chip: data-test="dashboard-y-item-${alias}" where alias = y_axis_1 for the first added field
        this.yAxisFieldChipFirst      = '[data-test="dashboard-y-item-y_axis_1"]';

        // ── AddPanel / PanelEditor toolbar ───────────────────────────────────
        // OInput data-test="dashboard-panel-name" → -field (fill), -error (error)
        this.panelNameField   = '[data-test="dashboard-panel-name-field"]';
        this.panelNameError   = '[data-test="dashboard-panel-name-error"]';
        this.panelSaveBtn     = '[data-test="dashboard-panel-save"]';
        this.panelDiscardBtn  = '[data-test="dashboard-panel-discard"]';
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
        return this.page.locator(`[data-test="dashboard-name-cell-${dashName}"]`).first();
    }

    /**
     * Clicks into the dashboard row for dashName.
     * @param {string} dashName
     */
    async openDashboardByName(dashName) {
        await this.page.locator(`[data-test="dashboard-name-cell-${dashName}"]`).first().click();
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

    getDrilldownAddBtnLocator() {
        return this.page.locator(this.drilldownAddBtn);
    }

    getDrilldownPopupLocator() {
        return this.page.locator(this.drilldownPopup);
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

    getSettingsGeneralTabLocator() {
        return this.page.locator(this.settingsGeneralTab);
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

    // ── PanelLayoutSettings helpers ───────────────────────────────────────────

    getPanelLayoutDrawerLocator() {
        return this.page.locator(this.panelLayoutDrawer);
    }

    getPanelLayoutHeightFieldLocator() {
        return this.page.locator(this.panelLayoutHeightField);
    }

    getPanelLayoutHeightErrorLocator() {
        return this.page.locator(this.panelLayoutHeightError);
    }

    getPanelLayoutSaveBtnLocator() {
        return this.page.locator(this.panelLayoutSaveBtn);
    }

    getPanelLayoutCancelBtnLocator() {
        return this.page.locator(this.panelLayoutCancelBtn);
    }

    // ── AddCondition helpers ──────────────────────────────────────────────────

    getAddConditionAddBtnLocator() {
        return this.page.locator(this.addConditionAddBtn);
    }

    getConditionColumnLocator() {
        return this.page.locator(this.conditionColumn);
    }

    getConditionConditionLocator() {
        return this.page.locator(this.conditionCondition);
    }

    getConditionRemoveColumnLocator() {
        return this.page.locator(this.conditionRemoveColumn);
    }

    // ── Dashboard list search (used to detect dashboards list is ready) ──────

    getDashboardSearchLocator() {
        return this.page.locator('[data-test="dashboard-search"]');
    }

    // ── Annotation button (on panel in view mode) ─────────────────────────────

    getAnnotationModeButtonLocator() {
        return this.page.locator('[data-test="panel-schema-renderer-annotation-button"]');
    }

    getPanelCanvasLocator() {
        return this.page.locator('[data-test="dashboard-panel-bar"]').first().locator('canvas').first();
    }

    // ── AddAnnotation helpers ─────────────────────────────────────────────────

    getAddAnnotationDialogLocator() {
        return this.page.locator(this.addAnnotationDialog);
    }

    getAnnotationTitleFieldLocator() {
        return this.page.locator(this.annotationTitleField);
    }

    getAnnotationTitleErrorLocator() {
        return this.page.locator(this.annotationTitleError);
    }

    getAnnotationTextFieldLocator() {
        return this.page.locator(this.annotationTextField);
    }

    getAnnotationPanelsPopoverLocator() {
        return this.page.locator(this.annotationPanelsPopover);
    }

    getAnnotationCancelBtnLocator() {
        return this.page.locator(this.annotationCancelBtn);
    }

    getAnnotationSaveBtnLocator() {
        return this.page.locator(this.annotationSaveBtn);
    }

    // ── GeneralSettings helpers ───────────────────────────────────────────────

    getGeneralSettingNameFieldLocator() {
        return this.page.locator(this.generalSettingNameField);
    }

    getGeneralSettingNameErrorLocator() {
        return this.page.locator(this.generalSettingNameError);
    }

    getGeneralSettingDescFieldLocator() {
        return this.page.locator(this.generalSettingDescField);
    }

    getGeneralSettingCancelBtnLocator() {
        return this.page.locator(this.generalSettingCancelBtn);
    }

    getGeneralSettingSaveBtnLocator() {
        return this.page.locator(this.generalSettingSaveBtn);
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

    // ── ConfigPanel helpers ───────────────────────────────────────────────────

    getConfigPanelDescriptionLocator() { return this.page.locator(this.configPanelDescription); }
    getConfigPanelYAxisMinLocator()     { return this.page.locator(this.configPanelYAxisMin); }
    getConfigPanelYAxisMaxLocator()     { return this.page.locator(this.configPanelYAxisMax); }
    getConfigPanelDecimalsLocator()      { return this.page.locator(this.configPanelDecimals); }
    getConfigPanelDecimalsFieldLocator() { return this.page.locator(this.configPanelDecimalsField); }
    getConfigPanelDecimalsErrorLocator() { return this.page.locator(this.configPanelDecimalsError); }
    getConfigPanelLimitLocator()         { return this.page.locator(this.configPanelLimit); }

    // ── BuildFieldPopUp helpers ───────────────────────────────────────────────

    getBuildFieldPopupContainerLocator(){ return this.page.locator(this.buildFieldPopupContainer); }
    getBuildFieldLabelInputLocator()    { return this.page.locator(this.buildFieldLabelInput); }
    getYAxisFieldChipFirstLocator()     { return this.page.locator(this.yAxisFieldChipFirst); }

    // ── AddPanel / PanelEditor helpers ────────────────────────────────────────

    getPanelNameFieldLocator()  { return this.page.locator(this.panelNameField); }
    getPanelNameErrorLocator()  { return this.page.locator(this.panelNameError); }
    getPanelSaveBtnLocator()    { return this.page.locator(this.panelSaveBtn); }
    getPanelDiscardBtnLocator() { return this.page.locator(this.panelDiscardBtn); }

    async fillPanelName(name) {
        const field = this.page.locator(this.panelNameField);
        await field.waitFor({ state: 'visible', timeout: 10000 });
        await field.click({ clickCount: 3 });
        await field.fill(name);
    }

    async clearPanelName() {
        const field = this.page.locator(this.panelNameField);
        await field.waitFor({ state: 'visible', timeout: 10000 });
        await field.click({ clickCount: 3 });
        await field.fill('');
    }
}
