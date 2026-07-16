// metricsBuilderPage.js
// Page Object Model for PromQL Builder Mode UI interactions
// Covers: Label Filters, Operations, Options, Query Mode tabs, Add to Dashboard

export class MetricsBuilderPage {
    constructor(page) {
        this.page = page;

        // Query Mode Tab selectors
        this.sqlModeButton = '[data-test="dashboard-sql-query-type"]';
        this.promqlModeButton = '[data-test="dashboard-promql-query-type"]';
        this.builderModeButton = '[data-test="dashboard-builder-query-type"]';
        this.customModeButton = '[data-test="dashboard-custom-query-type"]';

        // Metric/Stream Selector (in the sidebar FieldList, not a separate MetricSelector component)
        this.streamSelector = '[data-test="index-dropdown-stream"]';
        this.fieldSearchInput = '[data-test="o-field-list-search-field"]';

        // Label Filter selectors
        this.addLabelFilterButton = '[data-test="promql-add-label-filter"]';
        this.labelSelect = '[data-test="promql-label-select"]';
        this.operatorSelect = '[data-test="promql-operator-select"]';
        this.valueSelect = '[data-test="promql-value-select"]';

        // Operations selectors
        this.addOperationButton = '[data-test="promql-add-operation"]';

        // Options selectors
        this.legendInput = '[data-test="dashboard-promql-builder-legend"]';
        this.stepValueInput = '[data-test="dashboard-promql-builder-step-value"]';
        this.queryTypeSelect = '[data-test="dashboard-promql-builder-query-type"]';

        // Run Query / Apply
        this.runQueryButton = '[data-test="metrics-apply"]';

        // Add to Dashboard dialog selectors
        // AddToDashboard.vue is now an ODrawer with parent slug `add-to-dashboard-dialog`.
        // Cancel/Add are the ODrawer footer secondary/primary buttons, not the old
        // metrics-schema-* buttons.
        this.addToDashboardButton = '[data-test="panel-editor-add-to-dashboard-btn"]';
        this.dashboardDialogTitle = '[data-test="add-to-dashboard-dialog"]';
        this.dashboardPanelTitleInput = '[data-test="metrics-new-dashboard-panel-title"]';
        this.dashboardCancelButton = '[data-test="add-to-dashboard-dialog"] [data-test="o-dialog-secondary-btn"]';
        this.dashboardAddButton = '[data-test="add-to-dashboard-dialog"] [data-test="o-dialog-primary-btn"]';

        // Confirm dialog for mode switching — ConfirmDialog.vue wraps ODialog with
        // hardcoded data-test="confirm-dialog"; the OK action is the ODialog primary
        // footer button after the dialog migration.
        this.confirmDialogOk = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.confirmDialogCancel = '[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ============== Hoisted locators (constructor-only) ==============
        // Mode buttons
        this.sqlModeBtn = page.locator(this.sqlModeButton);
        this.promqlModeBtn = page.locator(this.promqlModeButton);
        this.builderModeBtn = page.locator(this.builderModeButton);
        this.customModeBtn = page.locator(this.customModeButton);

        // Confirm dialog
        this.confirmOkBtn = page.locator(this.confirmDialogOk).first();

        // Field selectors
        this.streamSelectorInput = page.locator(this.streamSelector);
        this.fieldSearchEl = page.locator(this.fieldSearchInput);

        // Stream dropdown popover/options (OSelect)
        this.streamPopover = page.locator('[data-test="index-dropdown-stream-popover"]');
        this.streamOptions = page.locator('[data-test="index-dropdown-stream-option"]');
        // OSelect popover search input (Reka ListboxFilter) — `${parent}-search`
        this.streamSearchInput = page.locator('[data-test="index-dropdown-stream-search"]');

        // Label / operator / value popovers (OSelect)
        this.labelPopover = page.locator('[data-test="promql-label-select-popover"]');
        this.labelOptions = page.locator('[data-test="promql-label-select-option"]');
        this.operatorPopover = page.locator('[data-test="promql-operator-select-popover"]');
        this.operatorOptions = page.locator('[data-test="promql-operator-select-option"]');
        this.valuePopover = page.locator('[data-test="promql-value-select-popover"]');
        this.valueOptions = page.locator('[data-test="promql-value-select-option"]');

        this.labelSelectLast = page.locator(this.labelSelect).last();
        this.operatorSelectLast = page.locator(this.operatorSelect).last();
        this.valueSelectLast = page.locator(this.valueSelect).last();

        // Add filter / add operation buttons
        this.addLabelFilterBtn = page.locator(this.addLabelFilterButton);
        this.addOperationBtn = page.locator(this.addOperationButton);

        // Operation selector dialog
        this.operationDialog = page.locator('[data-test="operations-list-operation-selector-dialog"]');
        this.operationDialogSearchInput = this.operationDialog.locator('[data-test="operations-list-search-input"]');
        this.operationDialogCloseBtn = this.operationDialog.locator('[data-test="o-dialog-primary-btn"]');
        this.operationDialogOptions = this.operationDialog.locator('[data-test^="promql-operation-option-"]');
        this.operationDialogHeaders = this.operationDialog.locator('[data-test^="operations-list-category-"]');

        // Filter count: data-test starts with promql-label-filter- but no remove
        this.labelFilterChips = page.locator('[data-test^="promql-label-filter-"]:not([data-test*="remove"]):not([data-test*="menu"]):not([data-test*="popover"]):not([data-test*="option"])');
        this.operationChips = page.locator('[data-test^="promql-operation-"]:not([data-test*="remove"]):not([data-test*="drag"]):not([data-test*="param"]):not([data-test*="menu"]):not([data-test*="popover"]):not([data-test*="option"])');

        // Options fields
        this.legendEl = page.locator(this.legendInput);
        // Legend is an OCombobox — inner input uses `-input` suffix per OCombobox convention.
        this.legendFieldInput = page.locator('[data-test="dashboard-promql-builder-legend-input"]');
        this.stepValueEl = page.locator(this.stepValueInput);
        this.queryTypeEl = page.locator(this.queryTypeSelect);
        this.queryTypePopover = page.locator('[data-test="dashboard-promql-builder-query-type-popover"]');

        // Run query
        this.runQueryBtn = page.locator(this.runQueryButton).first();

        // Add to Dashboard
        this.addToDashboardBtn = page.locator(this.addToDashboardButton).first();
        this.dashboardDialogEl = page.locator(this.dashboardDialogTitle);
        this.dashboardPanelTitleEl = page.locator(this.dashboardPanelTitleInput);
        // OInput inner native input has the auto-derived `-field` data-test suffix.
        this.dashboardPanelTitleFieldEl = page.locator('[data-test="metrics-new-dashboard-panel-title-field"]');
        this.dashboardCancelBtn = page.locator(this.dashboardCancelButton);
        this.dashboardAddBtn = page.locator(this.dashboardAddButton);

        // Folder / dashboard / tab dropdowns in Add to Dashboard
        this.folderDropdown = page.locator('[data-test="index-dropdown-stream_type"]');
        this.folderPopover = page.locator('[data-test="index-dropdown-stream_type-popover"]');
        this.folderOptions = page.locator('[data-test="index-dropdown-stream_type-option"]');

        this.dashboardDropdown = page.locator('[data-test="dashboard-dropdown-dashboard-selection"]');
        this.dashboardDropdownPopover = page.locator('[data-test="dashboard-dropdown-dashboard-selection-popover"]');
        this.dashboardDropdownOptions = page.locator('[data-test="dashboard-dropdown-dashboard-selection-option"]');

        this.tabDropdown = page.locator('[data-test="dashboard-dropdown-tab-selection"]');
        this.tabDropdownPopover = page.locator('[data-test="dashboard-dropdown-tab-selection-popover"]');
        this.tabDropdownOptions = page.locator('[data-test="dashboard-dropdown-tab-selection-option"]');

        // New dashboard dialog (within Add-to-Dashboard drawer)
        this.newDashboardBtn = page.locator('[data-test="dashboard-dashboard-new-add"]');
        this.newDashboardNameInput = page.locator('[data-test="add-dashboard-name"]');
        this.newDashboardSubmitBtn = page.locator(
            '[data-test="dashboard-dashboard-add-dialog"] [data-test="o-dialog-primary-btn"]'
        );
        this.newDashboardDialogEl = page.locator('[data-test="dashboard-dashboard-add-dialog"]');

        // Monaco query preview editor
        this.queryEditorEl = page.locator('[data-test="dashboard-panel-query-editor"]').first();

        // Table chart (dashboard panel) — TenstackTable header data-tests are
        // `o2-table-th-{columnId}`; the wrapper div carries `dashboard-panel-table`
        // (moved from TenstackTable component to DOM element in TableRenderer.vue).
        // We also accept promql-table-chart so the locator works for both metrics
        // PromQL tables and dashboard panel tables.
        this.dashboardPanelTable = page.locator('[data-test="dashboard-panel-table"], [data-test="promql-table-chart"]').first();
        this.tableHeaderCells = page.locator('[data-test^="o2-table-th-"]:not([data-test*="-sort-"]):not([data-test*="-remove-"])');
        this.tableRows = page.locator('[data-test="dashboard-data-row"]');

        // Chart renderer
        this.chartRenderer = page.locator('[data-test="chart-renderer"]');

        // Menus
        this.menuLinkDashboards = page.locator('[data-test="menu-link-\\/dashboards-item"]');
        this.dashboardSearchInput = page.locator('[data-test="dashboard-search"]');
        this.dashboardSearchFieldInput = page.locator('[data-test="dashboard-search-field"]').first();
        this.confirmDeleteBtn = page.locator('[data-test="o-dialog-primary-btn"]');

        // Step value `-field` variant (OInput inner native input)
        this.stepValueFieldInput = page.locator('[data-test="dashboard-promql-builder-step-value-field"]');

        // MetricSelector component popover/option/field
        this.metricSelectorEl = page.locator('[data-test="metric-selector"]');
        this.metricSelectorPopover = page.locator('[data-test="metric-selector-popover"]');
        this.metricSelectorFieldInput = page.locator('[data-test="metric-selector-field"]').first();

        // Dashboard dropdown OInput inner input
        this.dashboardDropdownFieldInput = page.locator('[data-test="dashboard-dropdown-dashboard-selection-field"]').first();

        // New dashboard name input `-field` variant
        this.newDashboardNameFieldInput = page.locator('[data-test="add-dashboard-name-field"]').first();

        // OToast success / error
        this.toastSuccess = page.locator('[data-test-variant="success"]');
        this.toastError = page.locator('[data-test-variant="error"]');
    }

    // ============== Factory helpers for per-index locators ==============

    /**
     * Get label filter button at a given index
     * @param {number} index - 0-based index
     */
    getLabelFilterButton(index) {
        return this.page.locator(`[data-test="promql-label-filter-${index}"]`);
    }

    getLabelFilterRemoveBtn(index) {
        return this.page.locator(`[data-test="promql-label-filter-remove-${index}"]`);
    }

    getLabelFilterMenu(index) {
        return this.page.locator(`[data-test="promql-label-filter-${index}-menu"]`);
    }

    getOperationButton(index) {
        return this.page.locator(`[data-test="promql-operation-${index}"]`);
    }

    getOperationRemoveBtn(index) {
        return this.page.locator(`[data-test="promql-operation-remove-${index}"]`);
    }

    getOperationMenu(index) {
        return this.page.locator(`[data-test="promql-operation-${index}-menu"]`);
    }

    getOperationParam(index) {
        return this.page.locator(`[data-test="promql-operation-param-${index}"]`).last();
    }

    getOperationParamFieldInput(index) {
        return this.page.locator(`[data-test="promql-operation-param-${index}-field"]`).last();
    }

    getOperationParamPopover(index) {
        return this.page.locator(`[data-test="promql-operation-param-${index}-popover"]`);
    }

    getOperationParamOptions(index) {
        return this.page.locator(`[data-test="promql-operation-param-${index}-option"]`);
    }

    getOperationParamOptionByValue(index, value) {
        // OSelect option key — prefer data-test-value
        return this.page.locator(`[data-test="promql-operation-param-${index}-option"][data-test-value="${value}"]`).first();
    }

    getLabelOptionByValue(value) {
        return this.page.locator(`[data-test="promql-label-select-option"][data-test-value="${value}"]`).first();
    }

    getOperatorOptionByValue(value) {
        return this.page.locator(`[data-test="promql-operator-select-option"][data-test-value="${value}"]`).first();
    }

    getValueOptionByValue(value) {
        return this.page.locator(`[data-test="promql-value-select-option"][data-test-value="${value}"]`).first();
    }

    getPanelBarByTitle(title) {
        // PanelContainer exposes the panel title via `data-test-panel-title` attribute
        // on the container; the bar is the first descendant with `data-test="dashboard-panel-bar"`.
        return this.page.locator(`[data-test="dashboard-panel-container"][data-test-panel-title="${title}"] [data-test="dashboard-panel-bar"]`).first();
    }

    getPanelContainerByTitle(title) {
        // Panel container exposes title via `data-test-panel-title` attribute.
        return this.page.locator(`[data-test="dashboard-panel-container"][data-test-panel-title="${title}"]`).first();
    }

    getPanelDropdownByTitle(title) {
        return this.page.locator(`[data-test="dashboard-edit-panel-${title}-dropdown"]`).first();
    }

    getEditPanelMenuItem() {
        return this.page.locator('[data-test="dashboard-edit-panel"]');
    }

    getPanelNameInput() {
        return this.page.locator('[data-test="dashboard-panel-name-field"]');
    }

    getDashboardApplyBtn() {
        return this.page.locator('[data-test="dashboard-apply"]');
    }

    getDashboardDiscardBtn() {
        return this.page.locator('[data-test="dashboard-panel-discard"]');
    }

    getDashboardConfirmPrimaryBtn() {
        return this.page.locator('[data-test="o-dialog-primary-btn"]').first();
    }

    getEditStreamInput() {
        return this.page.locator('[data-test="index-dropdown-stream"]');
    }

    // ===== Query Mode Switching =====

    /**
     * Switch to PromQL query type
     */
    async switchToPromQLMode() {
        if (await this.promqlModeBtn.isVisible({ timeout: 3000 })) {
            await this.promqlModeBtn.click();
            await this.handleConfirmDialog();
            return true;
        }
        return false;
    }

    /**
     * Switch to Builder mode (as opposed to Custom)
     */
    async switchToBuilderMode() {
        if (await this.builderModeBtn.isVisible({ timeout: 3000 })) {
            const classes = await this.builderModeBtn.getAttribute('class') || '';
            const dataState = await this.builderModeBtn.getAttribute('data-state') || '';
            if (!classes.includes('selected') && dataState !== 'on') {
                await this.builderModeBtn.click();
                // Handle confirmation dialog if it appears
                await this.handleConfirmDialog();
            }
            return true;
        }
        return false;
    }

    /**
     * Switch to Custom mode
     */
    async switchToCustomMode() {
        if (await this.customModeBtn.isVisible({ timeout: 3000 })) {
            const classes = await this.customModeBtn.getAttribute('class') || '';
            const dataState = await this.customModeBtn.getAttribute('data-state') || '';
            if (!classes.includes('selected') && dataState !== 'on') {
                await this.customModeBtn.click();
                await this.handleConfirmDialog();
            }
            return true;
        }
        return false;
    }

    /**
     * Switch to SQL mode
     */
    async switchToSQLMode() {
        if (await this.sqlModeBtn.isVisible({ timeout: 3000 })) {
            await this.sqlModeBtn.click();
            await this.handleConfirmDialog();
            return true;
        }
        return false;
    }

    /**
     * Handle confirmation dialog when switching modes
     */
    async handleConfirmDialog() {
        try {
            if (await this.confirmOkBtn.isVisible({ timeout: 2000 })) {
                await this.confirmOkBtn.click();
                await this.confirmOkBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                return true;
            }
        } catch {
            // No dialog appeared
        }
        return false;
    }

    /**
     * Check if a mode button is currently selected
     * @param {'sql'|'promql'|'builder'|'custom'} mode
     */
    async isModeSelected(mode) {
        const btnMap = {
            sql: this.sqlModeBtn,
            promql: this.promqlModeBtn,
            builder: this.builderModeBtn,
            custom: this.customModeBtn,
        };
        const btn = btnMap[mode];
        if (await btn.isVisible({ timeout: 2000 })) {
            // OToggleGroupItem (Reka UI) signals active state via data-state="on".
            // Poll briefly because QueryTypeSelector mounts and initializes
            // `selectedButtonType` asynchronously after the page loads.
            const selected = await this.page.waitForFunction(
                (testId) => {
                    const el = document.querySelector(`[data-test="${testId}"]`);
                    if (!el) return null;
                    const cls = el.getAttribute('class') || '';
                    const ds = el.getAttribute('data-state') || '';
                    return cls.includes('selected') || ds === 'on';
                },
                {
                    sql: 'dashboard-sql-query-type',
                    promql: 'dashboard-promql-query-type',
                    builder: 'dashboard-builder-query-type',
                    custom: 'dashboard-custom-query-type',
                }[mode],
                { timeout: 3000 }
            ).then(h => h.jsonValue()).catch(() => null);
            if (selected === true) return true;
            const classes = await btn.getAttribute('class') || '';
            const dataState = await btn.getAttribute('data-state') || '';
            return classes.includes('selected') || dataState === 'on';
        }
        return false;
    }

    // ===== Metric/Stream Selector (sidebar) =====

    /**
     * Select a metric stream from the sidebar stream selector dropdown.
     * On the Metrics page, metric selection happens via the FieldList sidebar
     * (data-test="index-dropdown-stream" INPUT element).
     * @param {string} metricName
     */
    async selectMetric(metricName) {
        if (!await this.streamSelectorInput.isVisible({ timeout: 5000 })) {
            return false;
        }

        // Click to focus and open dropdown — FieldList stream picker is OSelect post-migration.
        await this.streamSelectorInput.click();
        await this.streamPopover.waitFor({ state: 'visible', timeout: 5000 });

        // OSelect popover search: Ctrl+A → Backspace → fill (via the ListboxFilter input)
        if (await this.streamSearchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await this.streamSearchInput.press('ControlOrMeta+a').catch(() => {});
            await this.streamSearchInput.press('Backspace').catch(() => {});
            await this.streamSearchInput.fill(metricName);
        }

        // Select from dropdown options
        const option = this.page.locator(`[data-test="index-dropdown-stream-option"][data-test-value="${metricName}"]`).first();
        if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
            await option.click();
            await this.streamPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }

        // If no dropdown option, press Enter to confirm
        await this.page.keyboard.press('Enter');
        await this.streamPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        return true;
    }

    /**
     * Check if stream/metric selector is visible in the sidebar
     */
    async isMetricSelectorVisible() {
        return await this.streamSelectorInput.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Get the currently selected stream/metric text.
     * OSelect surfaces the active selection via `data-test-selected-label` and
     * `data-test-selected-value` attributes on the trigger button.
     */
    async getSelectedMetric() {
        return await this.getStreamSelectedValue();
    }

    /**
     * Read the selected metric/stream value from the OSelect trigger's data-test
     * attributes. OSelect exposes `data-test-selected-value` /
     * `data-test-selected-label` on the inner PopoverTrigger (data-test
     * `${parent}-trigger`). Falls back to inputValue() for legacy q-select.
     */
    async getStreamSelectedValue() {
        const wrapper = this.streamSelectorInput;
        if (!await wrapper.isVisible({ timeout: 3000 }).catch(() => false)) return '';
        // Read from the inner PopoverTrigger
        const trigger = this.page.locator('[data-test="index-dropdown-stream-trigger"]');
        if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
            // OSelect populates these attrs once the model-value resolves; the
            // metrics page auto-selects a metric on mount asynchronously, so
            // poll briefly until at least one is non-empty.
            const value = await this.page.waitForFunction(
                () => {
                    const tr = document.querySelector('[data-test="index-dropdown-stream-trigger"]');
                    if (!tr) return null;
                    const v = tr.getAttribute('data-test-selected-value') || '';
                    const l = tr.getAttribute('data-test-selected-label') || '';
                    return (v && v.length > 0) ? v : ((l && l.length > 0) ? l : null);
                },
                { timeout: 5000 }
            ).then(handle => handle.jsonValue()).catch(() => null);
            if (value) return value;
            const dtValue = await trigger.getAttribute('data-test-selected-value').catch(() => null);
            if (dtValue && dtValue.length > 0) return dtValue;
            const dtLabel = await trigger.getAttribute('data-test-selected-label').catch(() => null);
            if (dtLabel && dtLabel.length > 0) return dtLabel;
        }
        // Fallback to wrapper attribute (in case data-test forwards) or inputValue
        const dtVal2 = await wrapper.getAttribute('data-test-selected-value').catch(() => null);
        if (dtVal2 && dtVal2.length > 0) return dtVal2;
        return await wrapper.inputValue().catch(() => '');
    }

    // ===== Label Filter Operations =====

    /**
     * Click the add label filter button (+)
     */
    async clickAddLabelFilter() {
        await this.addLabelFilterBtn.click();
        await this.addLabelFilterBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    /**
     * Open label filter menu at index. LabelFilterEditor chip menu is now an ODropdown.
     * @param {number} index - 0-based index
     */
    async openLabelFilterMenu(index) {
        const filterBtn = this.getLabelFilterButton(index);
        await filterBtn.click();
        await this.getLabelFilterMenu(index).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    /**
     * Select a label name from the label filter dropdown.
     * @param {string} labelName
     */
    async selectLabel(labelName) {
        await this.labelSelectLast.click();
        await this.labelPopover.waitFor({ state: 'visible', timeout: 5000 });

        // OSelect popover search: Ctrl+A → Backspace → fill (ListboxFilter → `${parent}-search`)
        const popoverSearch = this.page.locator('[data-test="promql-label-select-search"]').first();
        if (await popoverSearch.isVisible({ timeout: 1000 }).catch(() => false)) {
            await popoverSearch.press('ControlOrMeta+a').catch(() => {});
            await popoverSearch.press('Backspace').catch(() => {});
            await popoverSearch.fill(labelName);
        }

        const option = this.getLabelOptionByValue(labelName);
        if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
            await option.click();
            await this.labelPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Select an operator from the operator dropdown
     * @param {string} operator - one of: =, !=, =~, !~
     */
    async selectOperator(operator) {
        await this.operatorSelectLast.click();
        await this.operatorPopover.waitFor({ state: 'visible', timeout: 5000 });

        const option = this.getOperatorOptionByValue(operator);
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.click();
            await this.operatorPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Select a value from the value dropdown
     * @param {string} value
     */
    async selectValue(value) {
        await this.valueSelectLast.click();
        await this.valuePopover.waitFor({ state: 'visible', timeout: 5000 });

        // OSelect popover search: Ctrl+A → Backspace → fill (ListboxFilter → `${parent}-search`)
        const popoverSearch = this.page.locator('[data-test="promql-value-select-search"]').first();
        if (await popoverSearch.isVisible({ timeout: 1000 }).catch(() => false)) {
            await popoverSearch.press('ControlOrMeta+a').catch(() => {});
            await popoverSearch.press('Backspace').catch(() => {});
            await popoverSearch.fill(value);
        }

        const option = this.getValueOptionByValue(value);
        if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
            await option.click();
            await this.valuePopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Remove a label filter at the given index
     * @param {number} index - 0-based index
     */
    async removeLabelFilter(index) {
        const removeBtn = this.getLabelFilterRemoveBtn(index);
        await removeBtn.click();
        await removeBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    /**
     * Get count of visible label filter items
     */
    async getLabelFilterCount() {
        return await this.labelFilterChips.count();
    }

    /**
     * Get the text of a label filter button
     * @param {number} index
     */
    async getLabelFilterText(index) {
        const filterBtn = this.getLabelFilterButton(index);
        return await filterBtn.textContent();
    }

    /**
     * Add a complete label filter (label + operator + value)
     * @param {string} labelName
     * @param {string} operator
     * @param {string} value
     */
    async addCompleteLabelFilter(labelName, operator, value) {
        await this.clickAddLabelFilter();
        const filterCount = await this.getLabelFilterCount();
        const newIndex = filterCount - 1;

        // Open the new filter menu
        await this.openLabelFilterMenu(newIndex);

        // Select label
        await this.selectLabel(labelName);

        // Select operator
        await this.selectOperator(operator);

        // Select value
        await this.selectValue(value);

        // Close menu by pressing Escape — LabelFilterEditor chip menu = ODropdown post-migration
        await this.page.keyboard.press('Escape');
        await this.getLabelFilterMenu(newIndex).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    // ===== Operations =====

    /**
     * Click the add operation button
     */
    async clickAddOperation() {
        await this.addOperationBtn.click();
        // Operation selector is now an ODialog (see OperationsList.vue) — wait on the
        // parent slug rather than the legacy `.q-dialog` wrapper.
        await this.operationDialog.waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Select an operation from the operation selector dialog
     * @param {string} operationName - e.g., "Rate", "Sum", "Avg"
     */
    async selectOperation(operationName) {
        // Wait for dialog to appear and fully render (expansion items are default-opened)
        await this.operationDialog.waitFor({ state: 'visible', timeout: 5000 });

        // Do NOT fill the search input: typing triggers a Vue re-render that temporarily
        // collapses q-expansion-item sections, making items transiently invisible.
        // The full un-filtered list is already rendered with all sections expanded.

        // Find an operation option by data-test-value (preferred)
        const opItem = this.operationDialog.locator(`[data-test^="promql-operation-option-"][data-test-value="${operationName}"]`).first();
        if (await opItem.isVisible({ timeout: 3000 }).catch(() => false)) {
            await opItem.click();
            await this.operationDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }

        // Fallback: match by data-test suffix (lowercased)
        const opItemAlt = this.operationDialog.locator(`[data-test="promql-operation-option-${operationName.toLowerCase()}"]`).first();
        if (await opItemAlt.isVisible({ timeout: 3000 }).catch(() => false)) {
            await opItemAlt.click();
            await this.operationDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }

        return false;
    }

    /**
     * Add an operation by name
     * @param {string} operationName
     */
    async addOperation(operationName) {
        await this.clickAddOperation();
        return await this.selectOperation(operationName);
    }

    /**
     * Get count of visible operations
     */
    async getOperationCount() {
        return await this.operationChips.count();
    }

    /**
     * Remove every operation currently in the builder, leaving an empty list.
     *
     * The panel editor SEEDS the selected metric's default query, and in Builder
     * mode that seed carries its operations with it — a gauge lands as
     * `avg(metric{})` (one `Avg` chip), a counter as `sum(rate(metric{}[5m]))`
     * (two chips). See `applyPromqlSeed` in web/src/utils/dashboard/promqlSeed.ts,
     * driven by `useDefaultPanelFields`. The builder therefore does NOT open empty
     * on the metrics page, and specs that build a query from scratch have to strip
     * the seed first or every count/query-text assertion is off by the seed.
     *
     * @returns {Promise<number>} the operation count after clearing (0 on success)
     */
    async clearOperations(timeout = 10000) {
        // The seed is written by the stream watcher once the metric auto-selection
        // resolves, so wait for that before counting — otherwise we can clear an
        // empty list and have the seeded chips appear right after.
        await this.getStreamSelectedValue();
        await this.operationChips.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});

        // Remove from the tail: the chips are indexed, so deleting the last one is
        // the only removal whose own remove button is guaranteed to disappear —
        // deleting index 0 of many just shifts the rest down and `removeOperation`
        // would sit out its full hidden-state timeout on a button that is still there.
        const deadline = Date.now() + timeout;
        let count = await this.getOperationCount();
        while (count > 0 && Date.now() < deadline) {
            await this.removeOperation(count - 1);
            count = await this.getOperationCount();
        }
        return count;
    }

    /**
     * Get operation text at index
     * @param {number} index
     */
    async getOperationText(index) {
        const opBtn = this.getOperationButton(index);
        return await opBtn.textContent();
    }

    /**
     * Remove an operation at the given index
     * @param {number} index
     */
    async removeOperation(index) {
        const removeBtn = this.getOperationRemoveBtn(index);
        await removeBtn.click();
        await removeBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    /**
     * Open operation menu and set a parameter value
     * @param {number} operationIndex
     * @param {number} paramIndex
     * @param {string} value
     */
    async setOperationParam(operationIndex, paramIndex, value) {
        // Open operation menu — OperationsList chip menu is ODropdown post-migration
        const opBtn = this.getOperationButton(operationIndex);
        await opBtn.click();
        await this.getOperationMenu(operationIndex).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

        // Find and fill the parameter input — prefer the OInput `-field` variant
        const paramFieldInput = this.page.locator(`[data-test="promql-operation-param-${paramIndex}-field"]`).last();
        if (await paramFieldInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await paramFieldInput.press('ControlOrMeta+a').catch(() => {});
            await paramFieldInput.press('Backspace').catch(() => {});
            await paramFieldInput.fill(value);
            return true;
        }
        const paramInput = this.getOperationParam(paramIndex);
        if (await paramInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await paramInput.press('ControlOrMeta+a').catch(() => {});
            await paramInput.press('Backspace').catch(() => {});
            await paramInput.fill(value);
            return true;
        }
        return false;
    }

    // ===== Options =====

    /**
     * Set legend value
     * @param {string} legend
     */
    async setLegend(legend) {
        if (await this.legendEl.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Prefer the OCombobox `-input` variant (Reka ComboboxInput renders native input)
            const fieldInput = this.legendFieldInput;
            if (await fieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
                await fieldInput.click();
                await fieldInput.press('ControlOrMeta+a').catch(() => {});
                await fieldInput.press('Backspace').catch(() => {});
                await fieldInput.fill(legend);
                return true;
            }
            // Fallback: descend into the wrapper to find the native input child
            // (covers cases where Reka's ComboboxInput rendered the native input
            // without forwarding the explicit `-input` data-test).
            const nestedInput = this.legendEl.locator('xpath=.//input').first();
            if (await nestedInput.isVisible({ timeout: 1500 }).catch(() => false)) {
                await nestedInput.click();
                await nestedInput.press('ControlOrMeta+a').catch(() => {});
                await nestedInput.press('Backspace').catch(() => {});
                await nestedInput.fill(legend);
                return true;
            }
            // Else, the data-test is on the input element directly
            const tagName = await this.legendEl.evaluate(el => el.tagName).catch(() => '');
            if (tagName === 'INPUT') {
                await this.legendEl.press('ControlOrMeta+a').catch(() => {});
                await this.legendEl.press('Backspace').catch(() => {});
                await this.legendEl.fill(legend);
                return true;
            }
        }
        return false;
    }

    /**
     * Read the legend input value (OCombobox `-input` or fallback to nested input).
     * Returns '' if no fillable input is present.
     */
    async getLegendValue() {
        if (await this.legendFieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            return await this.legendFieldInput.inputValue().catch(() => '');
        }
        const nestedInput = this.legendEl.locator('xpath=.//input').first();
        if (await nestedInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            return await nestedInput.inputValue().catch(() => '');
        }
        return await this.legendEl.inputValue().catch(() => '');
    }

    /**
     * Read the step-value input value (OInput `-field` or fallback to nested input).
     * Spec callers used to read `stepValueEl.inputValue()` directly — that fails
     * because the wrapper is a <div>, not an <input>. Use this helper instead.
     */
    async getStepValue() {
        if (await this.stepValueFieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            return await this.stepValueFieldInput.inputValue().catch(() => '');
        }
        const nestedInput = this.stepValueEl.locator('xpath=.//input').first();
        if (await nestedInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            return await nestedInput.inputValue().catch(() => '');
        }
        return await this.stepValueEl.inputValue().catch(() => '');
    }

    /**
     * Set step value
     * @param {string} stepValue - e.g., "30s", "1m"
     */
    async setStepValue(stepValue) {
        if (await this.stepValueEl.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Prefer OInput `-field` variant
            if (await this.stepValueFieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
                await this.stepValueFieldInput.click();
                await this.stepValueFieldInput.press('ControlOrMeta+a').catch(() => {});
                await this.stepValueFieldInput.press('Backspace').catch(() => {});
                await this.stepValueFieldInput.fill(stepValue);
                return true;
            }
            // Fallback: descend into the wrapper to find the native input child
            const nestedInput = this.stepValueEl.locator('xpath=.//input').first();
            if (await nestedInput.isVisible({ timeout: 1500 }).catch(() => false)) {
                await nestedInput.click();
                await nestedInput.press('ControlOrMeta+a').catch(() => {});
                await nestedInput.press('Backspace').catch(() => {});
                await nestedInput.fill(stepValue);
                return true;
            }
            // data-test is directly on the <input> element
            const tagName = await this.stepValueEl.evaluate(el => el.tagName).catch(() => '');
            if (tagName === 'INPUT') {
                await this.stepValueEl.click();
                await this.stepValueEl.fill(stepValue);
                return true;
            }
            return false;
        }
        return false;
    }

    /**
     * Select query type (Range or Instant)
     * @param {'range'|'instant'} queryType
     */
    async selectQueryType(queryType) {
        if (await this.queryTypeEl.isVisible({ timeout: 3000 }).catch(() => false)) {
            await this.queryTypeEl.click();
            await this.queryTypePopover.waitFor({ state: 'visible', timeout: 5000 });

            const valueKey = queryType === 'range' ? 'range' : 'instant';
            const option = this.page.locator(`[data-test="dashboard-promql-builder-query-type-option"][data-test-value="${valueKey}"]`).first();
            if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                await option.click();
                await this.queryTypePopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                return true;
            }
            // Fallback: legacy Range/Instant capitalised values
            const altOption = this.page.locator(`[data-test="dashboard-promql-builder-query-type-option"][data-test-value="${queryType === 'range' ? 'Range' : 'Instant'}"]`).first();
            if (await altOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                await altOption.click();
                await this.queryTypePopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                return true;
            }
        }
        return false;
    }

    /**
     * Check if Options section is visible (legend, step value, query type)
     */
    async isOptionsVisible() {
        const legend = await this.legendEl.isVisible({ timeout: 2000 }).catch(() => false);
        const step = await this.stepValueEl.isVisible({ timeout: 2000 }).catch(() => false);
        return legend || step;
    }

    // ===== Run Query =====

    /**
     * Click the Run Query / Apply button
     */
    async clickRunQuery() {
        await this.runQueryBtn.click();
        await this.runQueryBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    /**
     * Wait deterministically for a query response (PromQL endpoints)
     */
    async waitForQueryResponse(timeout = 15000) {
        return this.page.waitForResponse(
            (resp) => /\/prometheus\/api\/v1\/query(_range)?/.test(resp.url()),
            { timeout }
        ).catch(() => null);
    }

    // ===== Add to Dashboard =====

    /**
     * Click Add to Dashboard button
     */
    async clickAddToDashboard() {
        if (await this.addToDashboardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await this.addToDashboardBtn.click();
            // Wait for the "Add to Dashboard" side panel to fully load (matches visualise.js pattern)
            const panelOpened = await this.dashboardDialogEl.waitFor({ state: 'visible', timeout: 10000 })
                .then(() => true)
                .catch(() => false);
            if (!panelOpened) {
                return false;
            }
            await this.dashboardDialogEl.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Check if Add to Dashboard dialog is visible
     */
    async isDashboardDialogVisible() {
        return await this.dashboardDialogEl.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Fill panel title in Add to Dashboard dialog
     * @param {string} title
     */
    async fillPanelTitle(title) {
        // Prefer OInput `-field` variant
        if (await this.dashboardPanelTitleFieldEl.isVisible({ timeout: 3000 }).catch(() => false)) {
            await this.dashboardPanelTitleFieldEl.press('ControlOrMeta+a').catch(() => {});
            await this.dashboardPanelTitleFieldEl.press('Backspace').catch(() => {});
            await this.dashboardPanelTitleFieldEl.fill(title);
            return true;
        }
        if (await this.dashboardPanelTitleEl.isVisible({ timeout: 3000 }).catch(() => false)) {
            // data-test may be directly on the <input> element
            const tagName = await this.dashboardPanelTitleEl.evaluate(el => el.tagName).catch(() => '');
            if (tagName === 'INPUT') {
                await this.dashboardPanelTitleEl.click();
                await this.dashboardPanelTitleEl.fill(title);
                return true;
            }
        }
        return false;
    }

    /**
     * Click Cancel in Add to Dashboard dialog
     */
    async clickDashboardCancel() {
        if (await this.dashboardCancelBtn.isVisible({ timeout: 3000 })) {
            await this.dashboardCancelBtn.click();
            await this.dashboardCancelBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Click Add in Add to Dashboard dialog
     */
    async clickDashboardAdd() {
        if (!await this.dashboardAddBtn.isVisible({ timeout: 3000 })) return false;
        // Add-to-Dashboard primary button is disabled until folder + dashboard
        // + tab are picked; poll until the disabled state clears, otherwise the
        // click is a no-op and the drawer never closes.
        const enabled = await this.page.waitForFunction(
            () => {
                const btn = document.querySelector('[data-test="add-to-dashboard-dialog"] [data-test="o-dialog-primary-btn"]');
                if (!btn) return false;
                if (btn.hasAttribute('disabled')) return false;
                if (btn.getAttribute('aria-disabled') === 'true') return false;
                if (btn.getAttribute('data-disabled') !== null) return false;
                return true;
            },
            { timeout: 5000 }
        ).then(() => true).catch(() => false);
        if (!enabled) return false;
        await this.dashboardAddBtn.click();
        await this.dashboardDialogEl.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        return true;
    }

    // ===== Builder UI Visibility Checks =====

    /**
     * Check if the Builder mode UI elements are visible
     * (Label Filters section, Operations section, Options section)
     */
    async isBuilderUIVisible() {
        const labelFiltersVisible = await this.addLabelFilterBtn.isVisible({ timeout: 3000 }).catch(() => false);
        const operationsVisible = await this.addOperationBtn.isVisible({ timeout: 3000 }).catch(() => false);
        return labelFiltersVisible || operationsVisible;
    }

    /**
     * Check if the Add Label Filter button is visible
     */
    async isAddLabelFilterVisible() {
        return await this.addLabelFilterBtn.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Check if the Add Operation button is visible
     */
    async isAddOperationVisible() {
        return await this.addOperationBtn.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Check if label select dropdown has options loaded
     */
    async hasLabelOptions() {
        return (await this.labelOptions.count()) > 0;
    }

    /**
     * Get the MetricSelector component locator
     */
    getMetricSelectorLocator() {
        return this.metricSelectorEl;
    }

    /**
     * Per-value MetricSelector option factory.
     */
    getMetricSelectorOptionByValue(value) {
        return this.page.locator(`[data-test="metric-selector-option"][data-test-value="${value}"]`).first();
    }

    /**
     * Check if MetricSelector component is visible (builder mode metric dropdown)
     */
    async isBuilderMetricSelectorVisible() {
        return await this.metricSelectorEl.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Select a metric from the MetricSelector dropdown (builder mode)
     * @param {string} metricName
     */
    async selectBuilderMetric(metricName) {
        if (!await this.metricSelectorEl.isVisible({ timeout: 5000 })) return false;

        await this.metricSelectorEl.click();
        // MetricSelector uses OSelect (Reka Listbox)
        await this.metricSelectorPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

        // OSelect popover search: Ctrl+A → Backspace → fill via -field
        if (await this.metricSelectorFieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            await this.metricSelectorFieldInput.press('ControlOrMeta+a').catch(() => {});
            await this.metricSelectorFieldInput.press('Backspace').catch(() => {});
            await this.metricSelectorFieldInput.fill(metricName);
        }

        const option = this.getMetricSelectorOptionByValue(metricName);
        if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
            await option.click();
            await this.metricSelectorPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Get the currently selected metric from MetricSelector
     */
    async getBuilderMetricValue() {
        if (await this.metricSelectorFieldInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            return await this.metricSelectorFieldInput.inputValue().catch(() => '');
        }
        return await this.metricSelectorEl.textContent().catch(() => '');
    }

    /**
     * Get operation dialog categories (expansion panel labels)
     */
    async getOperationCategories() {
        if (!await this.operationDialog.isVisible({ timeout: 3000 }).catch(() => false)) return [];

        const count = await this.operationDialogHeaders.count();
        const categories = [];
        for (let i = 0; i < count; i++) {
            const text = await this.operationDialogHeaders.nth(i).textContent().catch(() => '');
            if (text.trim()) categories.push(text.trim());
        }
        return categories;
    }

    /**
     * Get operation dialog search input (used by spec; routes via PO).
     */
    getOperationSearchInput() {
        return this.operationDialogSearchInput;
    }

    /**
     * Count visible operation options inside the dialog.
     */
    async getOperationOptionCount() {
        return await this.operationDialogOptions.count();
    }

    /**
     * Set the operation search query (OSelect popover pattern: Ctrl+A → Backspace → fill).
     * Falls back to the dialog `input` field input if `-field` variant is not present.
     * @param {string} query
     */
    async setOperationSearch(query) {
        const fieldInput = this.operationDialog.locator('[data-test="operations-list-search-input-field"]').first();
        if (await fieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            await fieldInput.press('ControlOrMeta+a').catch(() => {});
            await fieldInput.press('Backspace').catch(() => {});
            if (query) await fieldInput.fill(query);
            return;
        }
        if (await this.operationDialogSearchInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            await this.operationDialogSearchInput.press('ControlOrMeta+a').catch(() => {});
            await this.operationDialogSearchInput.press('Backspace').catch(() => {});
            if (query) await this.operationDialogSearchInput.fill(query);
        }
    }

    /**
     * Wait until the operation option count converges to the predicate. Used by the
     * search test to avoid sleeps.
     */
    async waitForOperationOptionCount(predicate, timeout = 5000) {
        await this.page.waitForFunction(
            (fn) => {
                const els = document.querySelectorAll('[data-test="operations-list-operation-selector-dialog"] [data-test^="promql-operation-option-"]');
                // eslint-disable-next-line no-new-func
                const matchFn = new Function('count', `return (${fn})(count);`);
                return matchFn(els.length);
            },
            predicate.toString(),
            { timeout }
        ).catch(() => {});
    }

    /**
     * Close operation selector dialog
     */
    async closeOperationDialog() {
        // OperationsList dialog now uses ODialog with primary button label "Close".
        if (await this.operationDialogCloseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await this.operationDialogCloseBtn.click();
            await this.operationDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Check if operation selector dialog is visible
     */
    async isOperationDialogVisible() {
        return await this.operationDialog
            .isVisible({ timeout: 2000 })
            .catch(() => false);
    }

    /**
     * Check if value dropdown is disabled (no label selected)
     */
    async isValueSelectDisabled() {
        await this.valueSelectLast.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
        const isDisabled = await this.valueSelectLast.evaluate(el => {
            // OSelect post-migration: the PopoverTrigger button (`-trigger`) is
            // the element that carries the disabled state when `:disabled` is
            // set on the OSelect. We also check ancestor data-disabled, native
            // disabled attr, and the legacy q-field--disabled class for safety.
            const hasDisabledClass = (node) => {
                if (!node) return false;
                const cls = node.className || '';
                return cls.includes('q-field--disabled') || cls.includes('disabled');
            };
            // Find the OSelect trigger inside the wrapper (post-migration) — the
            // disabled flag binds to the PopoverTrigger button.
            const trigger = el.querySelector('[data-test$="-trigger"]');
            if (trigger) {
                if (trigger.hasAttribute('disabled')) return true;
                if (trigger.getAttribute('data-disabled') !== null) return true;
                if (trigger.getAttribute('aria-disabled') === 'true') return true;
                const cls = trigger.className || '';
                if (cls.includes('data-[disabled]') || cls.includes('cursor-not-allowed') || cls.includes('disabled:')) {
                    // class-based hint only; rely on actual attrs below
                }
            }
            if (hasDisabledClass(el)) return true;
            if (hasDisabledClass(el.parentElement)) return true;
            if (el.getAttribute('aria-disabled') === 'true') return true;
            if (el.getAttribute('data-disabled') === 'true') return true;
            if (el.querySelector('[aria-disabled="true"]')) return true;
            if (el.querySelector('[data-disabled]')) return true;
            const input = el.querySelector('input');
            if (input && input.disabled) return true;
            const style = window.getComputedStyle(el);
            if (style.pointerEvents === 'none') return true;
            return false;
        }).catch(() => false);
        return isDisabled;
    }

    // ===== Query Verification =====

    /**
     * Capture the PromQL query from the API request when Run Query is clicked.
     * Stays in Builder mode — no mode switching needed.
     * @returns {Promise<string>} The PromQL query string from the request
     */
    async captureQueryFromRunRequest() {
        const requestPromise = this.page.waitForRequest(
            (req) => req.url().includes('/prometheus/api/v1/query_range') ||
                     req.url().includes('/prometheus/api/v1/query'),
            { timeout: 15000 }
        );

        // Click Run Query
        await this.runQueryBtn.click();

        const request = await requestPromise;
        const url = new URL(request.url(), 'http://localhost');
        let query = url.searchParams.get('query') || '';

        // If query is not in URL params, check POST body
        if (!query) {
            try {
                const postData = request.postData();
                if (postData) {
                    const body = JSON.parse(postData);
                    query = body.query || '';
                }
            } catch {
                // not JSON body
            }
        }

        // Wait for the corresponding response so the chart renders before assertions
        await this.waitForQueryResponse(15000);
        return decodeURIComponent(query);
    }

    /**
     * Read the generated PromQL query text from the query preview area at the bottom.
     * The query preview is a Monaco editor visible in Builder mode (data-test="dashboard-panel-query-editor").
     * @returns {Promise<string>} The PromQL query string
     */
    async getQueryPreviewText() {
        if (!await this.queryEditorEl.isVisible({ timeout: 5000 }).catch(() => false)) {
            return '';
        }
        // Read directly from the Monaco model via window.monaco
        const text = await this.queryEditorEl.evaluate(() => {
            try {
                const editors = window.monaco?.editor?.getEditors?.() || [];
                for (const ed of editors) {
                    const model = ed.getModel?.();
                    if (model) {
                        const val = model.getValue?.();
                        if (val && val.length > 0) return val;
                    }
                }
            } catch (_e) {
                // ignore
            }
            return '';
        }).catch(() => '');
        return (text || '').trim();
    }

    /**
     * Read the current builder UI state: metric, label filters, operations, and options.
     * Stays in Builder mode — no mode switching needed.
     * @returns {Promise<{metric: string, labelFilters: string[], operations: string[], legend: string, stepValue: string}>}
     */
    async verifyBuilderState() {
        const state = {};

        // 1. Read metric from stream selector (OSelect — use the trigger's
        //    `data-test-selected-value` attribute, not inputValue() on the
        //    wrapper div).
        state.metric = await this.getStreamSelectedValue();

        // 2. Read label filter chip texts
        const filterCount = await this.getLabelFilterCount();
        state.labelFilters = [];
        for (let i = 0; i < filterCount; i++) {
            const chipText = await this.getLabelFilterText(i);
            state.labelFilters.push(chipText.trim());
        }

        // 3. Read operation chip texts
        const opCount = await this.getOperationCount();
        state.operations = [];
        for (let i = 0; i < opCount; i++) {
            const opText = await this.getOperationText(i);
            state.operations.push(opText.trim());
        }

        // 4. Read options
        if (await this.legendEl.isVisible({ timeout: 2000 }).catch(() => false)) {
            state.legend = await this.getLegendValue();
        } else {
            state.legend = '';
        }

        if (await this.stepValueEl.isVisible({ timeout: 2000 }).catch(() => false)) {
            state.stepValue = await this.getStepValue();
        } else {
            state.stepValue = '';
        }

        return state;
    }

    /**
     * Verify the table chart has rendered with data rows.
     * Checks for the table with headers and at least one data row.
     *
     * The PromQL table chart races between the query response and the row
     * render — the data API can return rows that haven't yet hydrated into
     * `[data-test="dashboard-data-row"]` DOM nodes when we read. Poll for up
     * to 15s for either rows OR the table-loading indicator to settle to a
     * stable count, so we never measure a mid-render zero.
     *
     * @returns {Promise<{visible: boolean, rowCount: number, headers: string[]}>}
     */
    async getTableChartData() {
        const visible = await this.dashboardPanelTable.isVisible({ timeout: 5000 }).catch(() => false);
        if (!visible) return { visible: false, rowCount: 0, headers: [] };

        // Wait for the table to settle (rows hydrated, or loading complete) BEFORE counting.
        // Loading attribute `data-test-loading="false"` on `o2-table` signals query completion.
        await this.page.locator('[data-test="o2-table"][data-test-loading="false"]')
            .first()
            .waitFor({ state: 'attached', timeout: 15000 })
            .catch(() => {});

        // `data-test-loading="false"` is not enough on its own: switching the chart
        // type re-mounts the panel, so a table left over from the previous render is
        // already attached and "not loading" while the new one has yet to hydrate its
        // rows — we would measure that stale, empty table. Wait for the first row to
        // actually exist. Times out quietly when the query legitimately has no data,
        // leaving the caller's rowCount assertion to fail on the real state.
        await this.tableRows.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});

        // Get header texts via the data-test header cells
        const headers = [];
        const headerCount = await this.tableHeaderCells.count().catch(() => 0);
        for (let i = 0; i < headerCount; i++) {
            const text = await this.tableHeaderCells.nth(i).textContent().catch(() => '');
            if (text.trim()) headers.push(text.trim());
        }

        // Count data rows
        const rowCount = await this.tableRows.count().catch(() => 0);

        return { visible, rowCount, headers };
    }

    // ===== Chart Type Switching =====

    /**
     * Select a chart type by clicking its icon
     * @param {string} chartType - e.g., 'line', 'bar', 'table', 'area', 'scatter', 'h-bar', 'stacked', 'h-stacked', 'pie', 'donut', 'heatmap', 'gauge'
     */
    async selectChartType(chartType) {
        const chartItem = this.page.locator(`[data-test="selected-chart-${chartType}-item"]`);
        if (await chartItem.isVisible({ timeout: 3000 }).catch(() => false)) {
            await chartItem.click();
            return true;
        }
        return false;
    }

    /**
     * Check if a chart type item is visible
     * @param {string} chartType
     */
    async isChartTypeVisible(chartType) {
        return await this.page.locator(`[data-test="selected-chart-${chartType}-item"]`).isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Check if the chart/table rendered after query
     */
    async isChartRendered() {
        // Check for chart-renderer canvas or table-renderer
        const chartVisible = await this.chartRenderer.isVisible({ timeout: 5000 }).catch(() => false);
        const tableVisible = await this.dashboardPanelTable.isVisible({ timeout: 5000 }).catch(() => false);
        return chartVisible || tableVisible;
    }

    // ===== Add to Dashboard - Full Save Flow =====

    /**
     * Select a folder from the folder dropdown in Add to Dashboard dialog
     * @param {string} folderName - folder name to select (default: "default")
     */
    async selectDashboardFolder(folderName = 'default') {
        if (await this.folderDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
            await this.folderDropdown.click();
            await this.folderPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
            const option = this.page.locator(`[data-test="index-dropdown-stream_type-option"][data-test-value="${folderName}"]`).first();
            if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                await option.click();
                await this.folderPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                return true;
            }
        }
        return false;
    }

    /**
     * Select a dashboard from the dashboard dropdown in Add to Dashboard dialog
     * @param {string} dashboardName
     */
    async selectDashboardInDialog(dashboardName) {
        if (await this.dashboardDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
            await this.dashboardDropdown.click();
            await this.dashboardDropdownPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

            // OSelect popover search: Ctrl+A → Backspace → fill
            if (await this.dashboardDropdownFieldInput.isVisible({ timeout: 1500 }).catch(() => false)) {
                await this.dashboardDropdownFieldInput.press('ControlOrMeta+a').catch(() => {});
                await this.dashboardDropdownFieldInput.press('Backspace').catch(() => {});
                await this.dashboardDropdownFieldInput.fill(dashboardName);
            }

            const option = this.page.locator(`[data-test="dashboard-dropdown-dashboard-selection-option"][data-test-value="${dashboardName}"]`).first();
            if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                await option.click();
                await this.dashboardDropdownPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                return true;
            }
        }
        return false;
    }

    /**
     * Select a tab from the tab dropdown in Add to Dashboard dialog
     * @param {string} tabName
     */
    async selectDashboardTab(tabName = 'Default') {
        // Wait for the tab dropdown to become visible (it appears only after a dashboard is selected)
        if (!await this.tabDropdown.isVisible({ timeout: 8000 }).catch(() => false)) {
            return false;
        }

        // Wait for the tab list to auto-load via dashboard dropdown popover hidden state
        await this.dashboardDropdownPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

        // Click an empty area of the Add-to-Dashboard ODrawer panel to dismiss any
        // open menu from prior dropdowns (folder/dashboard).
        if (await this.dashboardDialogEl.isVisible({ timeout: 1000 }).catch(() => false)) {
            await this.dashboardDialogEl.click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
        }

        // Now click the tab dropdown normally
        await this.tabDropdown.click();
        await this.tabDropdownPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        const option = this.page.locator(`[data-test="dashboard-dropdown-tab-selection-option"][data-test-value="${tabName}"]`).first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.click();
            await this.tabDropdownPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Complete the Add to Dashboard save flow: folder, dashboard, tab, title, submit
     * @param {object} options
     * @param {string} options.folderName
     * @param {string} options.dashboardName
     * @param {string} options.tabName
     * @param {string} options.panelTitle
     */
    async saveToDashboard({ folderName = 'default', dashboardName, tabName = 'Default', panelTitle }) {
        // Click Add to Dashboard button
        const addClicked = await this.clickAddToDashboard();
        if (!addClicked) return false;

        // Wait for dialog
        const dialogVisible = await this.isDashboardDialogVisible();
        if (!dialogVisible) return false;

        // Select folder
        await this.selectDashboardFolder(folderName);

        // Select dashboard
        if (dashboardName) {
            await this.selectDashboardInDialog(dashboardName);
        }

        // Select tab
        await this.selectDashboardTab(tabName);

        // Fill panel title
        await this.fillPanelTitle(panelTitle);

        // Click Add button to save
        await this.clickDashboardAdd();
        await this.dashboardDialogEl.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

        return true;
    }

    /**
     * Create a new dashboard from within the Add to Dashboard dialog.
     * Follows the proven pattern from visualise.js addPanelToNewDashboard:
     * waitFor visible+attached, click, then fill.
     * @param {string} dashboardName
     */
    async createNewDashboardInDialog(dashboardName) {
        await this.newDashboardBtn.waitFor({ state: 'visible', timeout: 10000 });
        await this.newDashboardBtn.waitFor({ state: 'attached', timeout: 5000 });
        await this.newDashboardBtn.click();

        // Wait for the "New dashboard" dialog name input to be fully ready
        await this.newDashboardNameInput.waitFor({ state: 'visible', timeout: 10000 });
        await this.newDashboardNameInput.waitFor({ state: 'attached', timeout: 5000 });

        // Prefer the OInput `-field` variant
        if (await this.newDashboardNameFieldInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await this.newDashboardNameFieldInput.click();
            await this.newDashboardNameFieldInput.fill(dashboardName);
        } else {
            // Click then fill on the wrapper
            await this.newDashboardNameInput.click();
            await this.newDashboardNameInput.fill(dashboardName);
        }

        // Submit dashboard creation — SelectDashboardDropdown wraps AddDashboard in an
        // ODrawer with `data-test="dashboard-dashboard-add-dialog"`, and the legacy
        // `dashboard-add-submit` button was removed in favour of the ODrawer footer
        // primary action (Save) which calls `addDashboardRef?.submit()`.
        await this.newDashboardSubmitBtn.waitFor({ state: 'visible', timeout: 5000 });
        await this.newDashboardSubmitBtn.click();

        // Wait for the inner "New dashboard" drawer to close (parent "Add to Dashboard"
        // drawer stays open and auto-selects the newly created dashboard).
        await this.newDashboardDialogEl
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch(() => {});
    }

    /**
     * Ensure a dashboard is selected in the Add to Dashboard dialog.
     * Checks if one is auto-selected, tries dropdown options, or creates a new one.
     * Follows the pattern from visualise.js addPanelToNewDashboard.
     * @returns {Promise<string>} The name of the selected/created dashboard
     */
    async ensureDashboardSelected() {
        await this.dashboardDropdown.waitFor({ state: 'visible', timeout: 5000 });

        // OSelect surfaces the active selection via `data-test-selected-label` and
        // `data-test-selected-value` on the trigger button.
        const dtValue = await this.dashboardDropdown.getAttribute('data-test-selected-value').catch(() => null);
        const dtLabel = await this.dashboardDropdown.getAttribute('data-test-selected-label').catch(() => null);
        const candidate = (dtValue && dtValue.length > 0) ? dtValue : ((dtLabel && dtLabel.length > 0) ? dtLabel : '');
        if (candidate && !candidate.includes('Select')) {
            return candidate;
        }

        // No dashboard auto-selected — create a new one.
        const newDashName = `test_dash_${Date.now()}`;
        await this.createNewDashboardInDialog(newDashName);
        return newDashName;
    }

    // ===== Dashboard Verification & Cleanup =====

    /**
     * Navigate to dashboards list page
     */
    async navigateToDashboards() {
        await this.menuLinkDashboards.click();
        await this.dashboardSearchInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }

    /**
     * Verify a panel exists on the current dashboard page
     * @param {string} panelTitle
     */
    async isPanelVisibleOnDashboard(panelTitle) {
        return await this.getPanelBarByTitle(panelTitle).isVisible({ timeout: 10000 }).catch(() => false);
    }

    /**
     * Delete a dashboard by name from the dashboards list
     * @param {string} dashboardName
     */
    async deleteDashboard(dashboardName) {
        await this.navigateToDashboards();

        // Search for the dashboard via OInput field
        if (await this.dashboardSearchFieldInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await this.dashboardSearchFieldInput.press('ControlOrMeta+a').catch(() => {});
            await this.dashboardSearchFieldInput.press('Backspace').catch(() => {});
            await this.dashboardSearchFieldInput.fill(dashboardName);
        } else if (await this.dashboardSearchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await this.dashboardSearchInput.fill(dashboardName);
        }

        // Find the row via per-row data-test pattern (dashboard-name-cell-<name> or similar)
        const dashboardRow = this.page.locator(`[data-test="dashboard-name-cell-${dashboardName}"]`).first();
        if (await dashboardRow.isVisible({ timeout: 5000 }).catch(() => false)) {
            // Walk up to the OTable row and click delete
            const deleteBtn = dashboardRow.locator(`xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]//*[@data-test='dashboard-delete']`).first();
            if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await deleteBtn.click();
                await this.confirmDeleteBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                if (await this.confirmDeleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await this.confirmDeleteBtn.click();
                    await this.confirmDeleteBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check for success notification (OToast)
     */
    async hasSuccessNotification() {
        return await this.toastSuccess.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check for error notification (OToast)
     */
    async hasErrorNotification() {
        return await this.toastError.isVisible({ timeout: 3000 }).catch(() => false);
    }
}
