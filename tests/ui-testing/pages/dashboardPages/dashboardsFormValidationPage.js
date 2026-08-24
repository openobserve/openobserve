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
        // OFormTextarea convention: data-test="foo" -> error node "foo-error".
        // `dashboard-drilldown-url-error-message` does not exist in
        // DrilldownPopUp.vue, so the old selector could never resolve.
        this.drilldownUrlError       = '[data-test="dashboard-drilldown-url-textarea-error"]';
        // Dashboard/tab/folder selects (OSelect convention)
        this.drilldownFolderSelect   = '[data-test="dashboard-drilldown-folder-select-popover"]';
        this.drilldownDashboardSelect = '[data-test="dashboard-drilldown-dashboard-select-popover"]';
        this.drilldownTabSelect      = '[data-test="dashboard-drilldown-tab-select-popover"]';

        // ── Dashboard Settings navigation ─────────────────────────────────────
        this.dashboardSettingsBtn    = '[data-test="dashboard-setting-btn"]';
        this.settingsGeneralTab      = '[data-test="dashboard-settings-general-tab"]';
        this.settingsVariablesTab    = '[data-test="dashboard-settings-variable-tab"]';
        // App renders `dashboard-add-variable-btn` (VariableSettings.vue) — the
        // spec had the words transposed, so this never resolved.
        this.variableAddBtn          = '[data-test="dashboard-add-variable-btn"]';

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
        // Assert the SELECT, not its popover: OSelect only renders `-popover`
        // while the dropdown is open, so the "does the field render" tests were
        // waiting on a node that only exists after a click they never make.
        this.annotationPanelsPopover = '[data-test="dashboard-add-annotation-panels-select"]';
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
        // The y-axis field chip opens an ODropdown whose menu hosts
        // DynamicFunctionPopUp. There is no `build-field` markup in web/src at
        // all any more — the old container/label selectors below pointed at a
        // component that no longer exists, so both BuildFieldPopUp tests could
        // only ever time out. OInput puts the real <input> on the `-field` node.
        this.buildFieldPopupContainer = '[data-test="dynamic-function-popup-root"]';
        this.buildFieldLabelInput     = '[data-test="dynamic-function-popup-label-input-field"]';
        // Y-axis field chip: data-test="dashboard-y-item-${alias}" where alias = y_axis_1 for the first added field
        this.yAxisFieldChipFirst      = '[data-test="dashboard-y-item-y_axis_1"]';

        // ── AddPanel / PanelEditor toolbar ───────────────────────────────────
        // Panel name is an inline-edited title (OFormInlineEdit): -trigger opens
        // the editor, -input is the revealed field, -error is the validation msg.
        this.panelNameTrigger = '[data-test="dashboard-panel-name-trigger"]';
        this.panelNameField   = '[data-test="dashboard-panel-name-input"]';
        this.panelNameError   = '[data-test="dashboard-panel-name-error"]';
        this.panelSaveBtn     = '[data-test="dashboard-panel-save"]';
        this.panelDiscardBtn  = '[data-test="dashboard-panel-discard"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async navigateToDashboards() {
        await this.page.locator(this.dashboardsMenuLink).click();
        await this.page.locator('[data-test="dashboard-table"]').waitFor({ state: 'visible', timeout: 15000 });
    }

    /**
     * Wait until a dialog's form is actually interactive, not merely rendered.
     *
     * The dialog element becomes visible before OForm has seeded its fields and
     * before the ODialog primary button is wired to submit the form by id. A
     * submit issued in that window silently no-ops: the Zod schema never runs,
     * so no validation error is produced and the assertion that follows fails
     * with "element(s) not found" rather than anything describing the cause.
     *
     * Gating on the name input being present and enabled is the cheap proxy for
     * "the form mounted", and it is the difference between the two sibling
     * tests here — the one that happened to assert dialog visibility first
     * passed, the one that submitted immediately did not.
     *
     * @param {string} nameFieldSelector the form's `-field` input selector
     */
    async waitForDialogFormReady(nameFieldSelector) {
        await this.page.waitForFunction(
            (selector) => {
                const el = document.querySelector(selector);
                return !!el && !el.disabled && el.offsetParent !== null;
            },
            nameFieldSelector,
            { timeout: 10000 }
        );
    }

    // ── AddDashboard helpers ──────────────────────────────────────────────────

    async openAddDashboardForm() {
        await this.page.locator(this.newDashboardBtn).click();
        await this.page.locator(this.dashboardDialog).waitFor({ state: 'visible', timeout: 8000 });
        await this.waitForDialogFormReady(this.dashboardNameInput);
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
        await this.waitForDialogFormReady(this.folderNameInput);
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
        await this.waitForDialogFormReady(this.tabNameInput);
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
        // OFormTextarea wrapper carries the data-test; the real <textarea> is the
        // inner `-field` node. Filling the wrapper throws "Element is not an
        // <input>, <textarea>, <select> or [contenteditable]".
        await this.page
            .locator('[data-test="dashboard-drilldown-url-textarea-field"]')
            .fill(url);
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

    /**
     * Enter annotation mode on the first rendered panel.
     *
     * The annotation button is HOVER-REVEALED: PanelContainer.vue binds
     * :class="hoverRevealClass", which is "invisible pointer-events-none" until
     * the panel's own @mouseover sets isCurrentlyHoveredPanel. Waiting for the
     * button to be visible without hovering first can therefore only ever time
     * out — which is exactly what every annotation test was doing.
     *
     * It is also gated on the panel being a time series (checkIfPanelIsTimeSeries)
     * and on a chart type from the line/bar family, so the caller must have built
     * a panel that keeps its histogram(_timestamp) x-axis.
     */
    async enterAnnotationMode() {
        // The button is gated on extras.isTimeSeries, which is only set once the
        // chart data has been converted — so the chart has to have DRAWN first.
        // Verified against alpha: hovering immediately after the panel container
        // appears finds the button hidden; after the chart renders it is visible.
        const chart = this.page.locator('[data-test="chart-renderer"]').first();
        await chart.waitFor({ state: 'visible', timeout: 30000 });

        const panel = this.page.locator('[data-test="dashboard-panel-container"]').first();
        await panel.waitFor({ state: 'visible', timeout: 15000 });

        const btn = this.getAnnotationModeButtonLocator();
        // Re-hover on each attempt: the reveal is driven by the panel's own
        // @mouseover, and a re-render between hover and check drops it. The
        // settle after hovering matters — checking in the same tick as the hover
        // samples before Vue has applied the class swap.
        //
        // Budget generously: extras.isTimeSeries is only set once the query has
        // returned AND the data has been converted, which under parallel load on
        // a shared alpha is a good deal slower than it is on an idle box.
        for (let attempt = 1; attempt <= 15; attempt++) {
            await panel.hover().catch(() => {});
            await this.page.waitForTimeout(1000);
            if (await btn.isVisible().catch(() => false)) {
                await btn.click();
                return;
            }
        }

        // Distinguish the two failure modes instead of dying on a bare timeout:
        // absent from the DOM means the v-if gate (isTimeSeries / chart type)
        // never went true; present-but-hidden means the hover never registered.
        const domCount = await btn.count();
        throw new Error(
            `enterAnnotationMode: annotation button never became visible ` +
            `(matches in DOM: ${domCount}). ${domCount === 0
                ? 'Not rendered — the panel is not being treated as a time series yet.'
                : 'Rendered but hidden — the panel hover never revealed it.'}`
        );
    }

    /**
     * Open the AddAnnotation dialog by brushing across the chart.
     *
     * A plain click cannot do this. PanelSchemaRenderer routes annotation
     * creation through onDataZoom -> handleAddAnnotation, which is ECharts'
     * brush/zoom event, so it needs a horizontal DRAG. The old tests clicked the
     * canvas centre and then waited for a dialog that was never going to open.
     */
    async openAnnotationDialogByBrush() {
        const chart = this.page.locator('[data-test="chart-renderer"]').first();
        await chart.waitFor({ state: 'visible', timeout: 30000 });
        const box = await chart.boundingBox();
        if (!box) throw new Error('openAnnotationDialogByBrush: chart has no bounding box');

        const y = box.y + box.height / 2;
        await this.page.mouse.move(box.x + box.width * 0.3, y);
        await this.page.mouse.down();
        await this.page.mouse.move(box.x + box.width * 0.5, y, { steps: 15 });
        await this.page.mouse.move(box.x + box.width * 0.7, y, { steps: 15 });
        await this.page.mouse.up();

        await this.page
            .locator(this.addAnnotationDialog)
            .waitFor({ state: 'visible', timeout: 20000 });
    }

    getPanelCanvasLocator() {
        return this.page.locator('[data-test="dashboard-panel-bar"]').first().locator('canvas').first();
    }

    /**
     * Add a filter condition row in the panel editor's Filters section.
     *
     * `dashboard-add-condition-add` is NOT a plain "add" button — Group.vue makes
     * it the TRIGGER of an ODropdown offering "Add Condition" / "Add Group".
     * Clicking it only opens that menu, so a test that clicks it and then waits
     * for `dashboard-add-condition-column-0` waits for a row that was never asked
     * for. The condition is created by selecting the menu item.
     */
    async addConditionRow() {
        const trigger = this.page.locator(this.addConditionAddBtn);
        await trigger.waitFor({ state: 'visible', timeout: 15000 });
        await trigger.click();
        const item = this.page.locator('[data-test="dashboard-add-group-add-condition"]');
        await item.waitFor({ state: 'visible', timeout: 10000 });
        await item.click();

        // Adding a condition renders only a LABEL CHIP
        // (`dashboard-add-condition-label-${i}-${computedLabel}`). The column /
        // operator / value controls live in a popup that the chip opens, so
        // `dashboard-add-condition-column-0` does not exist until it is clicked.
        // Verified against alpha: straight after "Add Condition" the only nodes
        // present are the label, remove and add buttons.
        const label = this.page
            .locator('[data-test^="dashboard-add-condition-label-0"]')
            .first();
        await label.waitFor({ state: 'visible', timeout: 15000 });
        await label.click();
        await this.page
            .locator(this.conditionColumn0)
            .waitFor({ state: 'visible', timeout: 15000 });
    }

    /**
     * Switch the open condition popup to its "Condition" tab.
     *
     * The popup opens on the LIST tab. `dashboard-add-condition-value` lives
     * inside `<OTabPanel name="condition">`, so on the list tab it is not in the
     * DOM at all (probe against alpha: value count = 0 straight after opening).
     * `dashboard-add-condition-condition-0` is that tab's TRIGGER, not the value
     * control — asserting the two together only works once the tab is active.
     */
    async openConditionTab(index = 0) {
        const tab = this.page.locator(`[data-test="dashboard-add-condition-condition-${index}"]`);
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        await this.page
            .locator(this.conditionValue)
            .waitFor({ state: 'visible', timeout: 10000 });
    }

    /** DrilldownPopUp is an ODialog; its Add/Update button is the dialog primary. */
    getDrilldownSaveBtnLocator() {
        return this.page.locator(
            '[data-test="dashboard-drilldown-popup"] [data-test="o-dialog-primary-btn"]'
        );
    }

    /** Generic success toast (OToast stamps the variant on its root). */
    getSuccessToastLocator() {
        return this.page.locator(this.toastSuccess).first();
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

    // The name display trigger (always rendered) — use it as the "editor opened"
    // anchor. The `-input` only exists while editing, so it can't anchor setup.
    getPanelNameTriggerLocator() { return this.page.locator(this.panelNameTrigger); }
    getPanelNameFieldLocator()  { return this.page.locator(this.panelNameField); }
    getPanelNameErrorLocator()  { return this.page.locator(this.panelNameError); }
    getPanelSaveBtnLocator()    { return this.page.locator(this.panelSaveBtn); }
    getPanelDiscardBtnLocator() { return this.page.locator(this.panelDiscardBtn); }

    async fillPanelName(name) {
        // Open the inline editor via its trigger, then fill the revealed input.
        await this.page.locator(this.panelNameTrigger).click();
        const field = this.page.locator(this.panelNameField);
        await field.waitFor({ state: 'visible', timeout: 10000 });
        await field.fill(name);
    }

    async clearPanelName() {
        await this.page.locator(this.panelNameTrigger).click();
        const field = this.page.locator(this.panelNameField);
        await field.waitFor({ state: 'visible', timeout: 10000 });
        await field.fill('');
    }
}
