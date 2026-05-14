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
        this.fieldSearchInput = '[data-test="index-field-search-input"]';

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
        this.addToDashboardButton = '[data-test="panel-editor-add-to-dashboard-btn"], button:has-text("Add To Dashboard"), button:has-text("Add to Dashboard")';
        this.dashboardDialogTitle = '[data-test="add-to-dashboard-dialog"]';
        this.dashboardPanelTitleInput = '[data-test="metrics-new-dashboard-panel-title"]';
        this.dashboardCancelButton = '[data-test="add-to-dashboard-dialog"] [data-test="o-drawer-secondary-btn"]';
        this.dashboardAddButton = '[data-test="add-to-dashboard-dialog"] [data-test="o-drawer-primary-btn"]';

        // Confirm dialog for mode switching — ConfirmDialog.vue wraps ODialog with
        // hardcoded data-test="confirm-dialog"; the OK action is the ODialog primary
        // footer button after the dialog migration.
        this.confirmDialogOk = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.confirmDialogCancel = '[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]';
    }

    // ===== Query Mode Switching =====

    /**
     * Switch to PromQL query type
     */
    async switchToPromQLMode() {
        const promqlBtn = this.page.locator(this.promqlModeButton);
        if (await promqlBtn.isVisible({ timeout: 3000 })) {
            await promqlBtn.click();
            await this.page.waitForTimeout(500);
            return true;
        }
        return false;
    }

    /**
     * Switch to Builder mode (as opposed to Custom)
     */
    async switchToBuilderMode() {
        const builderBtn = this.page.locator(this.builderModeButton);
        if (await builderBtn.isVisible({ timeout: 3000 })) {
            const classes = await builderBtn.getAttribute('class') || '';
            const dataState = await builderBtn.getAttribute('data-state') || '';
            if (!classes.includes('selected') && dataState !== 'on') {
                await builderBtn.click();
                await this.page.waitForTimeout(500);

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
        const customBtn = this.page.locator(this.customModeButton);
        if (await customBtn.isVisible({ timeout: 3000 })) {
            const classes = await customBtn.getAttribute('class') || '';
            if (!classes.includes('selected')) {
                await customBtn.click();
                await this.page.waitForTimeout(500);
            }
            return true;
        }
        return false;
    }

    /**
     * Switch to SQL mode
     */
    async switchToSQLMode() {
        const sqlBtn = this.page.locator(this.sqlModeButton);
        if (await sqlBtn.isVisible({ timeout: 3000 })) {
            await sqlBtn.click();
            await this.page.waitForTimeout(500);
            return true;
        }
        return false;
    }

    /**
     * Handle confirmation dialog when switching modes
     */
    async handleConfirmDialog() {
        try {
            const okBtn = this.page.locator(this.confirmDialogOk).first();
            if (await okBtn.isVisible({ timeout: 2000 })) {
                await okBtn.click();
                await this.page.locator(this.confirmDialogOk).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        const selectorMap = {
            sql: this.sqlModeButton,
            promql: this.promqlModeButton,
            builder: this.builderModeButton,
            custom: this.customModeButton,
        };
        const btn = this.page.locator(selectorMap[mode]);
        if (await btn.isVisible({ timeout: 2000 })) {
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
        const input = this.page.locator(this.streamSelector);
        if (!await input.isVisible({ timeout: 5000 })) {
            return false;
        }

        // Click to focus and open dropdown
        await input.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Clear and type to filter
        await input.clear();
        await input.fill(metricName);
        await this.page.waitForTimeout(1000);

        // Select from dropdown options
        const option = this.page.locator('.q-menu .q-item, .q-virtual-scroll__content .q-item').filter({ hasText: metricName }).first();
        if (await option.isVisible({ timeout: 5000 })) {
            await option.click();
            await this.page.waitForTimeout(1500);
            return true;
        }

        // If no dropdown option, press Enter to confirm
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(1000);
        return true;
    }

    /**
     * Check if stream/metric selector is visible in the sidebar
     */
    async isMetricSelectorVisible() {
        return await this.page.locator(this.streamSelector).isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Get the currently selected stream/metric text
     */
    async getSelectedMetric() {
        const selector = this.page.locator(this.streamSelector);
        return await selector.locator('.q-field__native span, .q-field__native').textContent().catch(() => '');
    }

    // ===== Label Filter Operations =====

    /**
     * Click the add label filter button (+)
     */
    async clickAddLabelFilter() {
        const addBtn = this.page.locator(this.addLabelFilterButton);
        await addBtn.click();
        await this.page.locator(this.addLabelFilterButton).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    /**
     * Get label filter button at a given index
     * @param {number} index - 0-based index
     */
    getLabelFilterButton(index) {
        return this.page.locator(`[data-test="promql-label-filter-${index}"]`);
    }

    /**
     * Open label filter menu at index
     * @param {number} index - 0-based index
     */
    async openLabelFilterMenu(index) {
        const filterBtn = this.getLabelFilterButton(index);
        await filterBtn.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Select a label name from the label filter dropdown
     * @param {string} labelName
     */
    async selectLabel(labelName) {
        const labelDropdown = this.page.locator(this.labelSelect).last();
        await labelDropdown.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Type to filter
        const input = labelDropdown.locator('input').first();
        if (await input.isVisible({ timeout: 2000 })) {
            await input.fill(labelName);
            await this.page.waitForTimeout(1000);
        }

        // Select from dropdown options
        const option = this.page.locator('.q-menu .q-item').filter({ hasText: labelName }).first();
        if (await option.isVisible({ timeout: 5000 })) {
            await option.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Select an operator from the operator dropdown
     * @param {string} operator - one of: =, !=, =~, !~
     */
    async selectOperator(operator) {
        const operatorDropdown = this.page.locator(this.operatorSelect).last();
        await operatorDropdown.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Select from dropdown options
        const option = this.page.locator('.q-menu .q-item').filter({ hasText: operator }).first();
        if (await option.isVisible({ timeout: 3000 })) {
            await option.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Select a value from the value dropdown
     * @param {string} value
     */
    async selectValue(value) {
        const valueDropdown = this.page.locator(this.valueSelect).last();
        await valueDropdown.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Type to filter
        const input = valueDropdown.locator('input').first();
        if (await input.isVisible({ timeout: 2000 })) {
            await input.fill(value);
            await this.page.waitForTimeout(1000);
        }

        // Select from dropdown options
        const option = this.page.locator('.q-menu .q-item').filter({ hasText: value }).first();
        if (await option.isVisible({ timeout: 5000 })) {
            await option.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Remove a label filter at the given index
     * @param {number} index - 0-based index
     */
    async removeLabelFilter(index) {
        const removeBtn = this.page.locator(`[data-test="promql-label-filter-remove-${index}"]`);
        await removeBtn.click();
        await removeBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    /**
     * Get count of visible label filter items
     */
    async getLabelFilterCount() {
        // Count by matching data-test attributes starting with "promql-label-filter-" but not "remove"
        const filters = this.page.locator('[data-test^="promql-label-filter-"]:not([data-test*="remove"])');
        return await filters.count();
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

        // Close menu by pressing Escape
        await this.page.keyboard.press('Escape');
        await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    // ===== Operations =====

    /**
     * Click the add operation button
     */
    async clickAddOperation() {
        const addBtn = this.page.locator(this.addOperationButton);
        await addBtn.click();
        // Operation selector is now an ODialog (see OperationsList.vue) — wait on the
        // parent slug rather than the legacy `.q-dialog` wrapper.
        await this.page
            .locator('[data-test="operations-list-operation-selector-dialog"]')
            .waitFor({ state: 'visible', timeout: 5000 });
    }

    /**
     * Select an operation from the operation selector dialog
     * @param {string} operationName - e.g., "Rate", "Sum", "Avg"
     */
    async selectOperation(operationName) {
        // Wait for dialog to appear and fully render (expansion items are default-opened)
        const dialog = this.page.locator('[data-test="operations-list-operation-selector-dialog"]');
        await dialog.waitFor({ state: 'visible', timeout: 5000 });
        await this.page.waitForTimeout(300);

        // Do NOT fill the search input: typing triggers a Vue re-render that temporarily
        // collapses q-expansion-item sections, making items transiently invisible.
        // The full un-filtered list is already rendered with all sections expanded.

        // Find a clickable q-item inside expansion content whose primary label matches.
        // Structure: .q-expansion-item__content > .q-list > .q-item
        //              > .q-item__section > .q-item__label (op name, NOT caption)
        const opItem = dialog
            .locator('.q-expansion-item__content .q-item')
            .filter({
                has: this.page.locator('.q-item__label').filter({
                    hasText: new RegExp(`^\\s*${operationName}\\s*$`)
                })
            })
            .first();

        if (await opItem.isVisible({ timeout: 3000 })) {
            await opItem.click();
            await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }

        // Fallback: explicitly open all expansion sections, then retry
        const expansionHeaders = dialog.locator('.q-expansion-item__container > .q-item');
        const headerCount = await expansionHeaders.count();
        for (let i = 0; i < headerCount; i++) {
            await expansionHeaders.nth(i).click().catch(() => {});
        }
        await this.page.waitForTimeout(400);

        const opItemRetry = dialog
            .locator('.q-expansion-item__content .q-item')
            .filter({
                has: this.page.locator('.q-item__label').filter({
                    hasText: new RegExp(`^\\s*${operationName}\\s*$`)
                })
            })
            .first();

        if (await opItemRetry.isVisible({ timeout: 3000 })) {
            await opItemRetry.click();
            await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        const operations = this.page.locator('[data-test^="promql-operation-"]:not([data-test*="remove"]):not([data-test*="drag"]):not([data-test*="param"])');
        return await operations.count();
    }

    /**
     * Get operation text at index
     * @param {number} index
     */
    async getOperationText(index) {
        const opBtn = this.page.locator(`[data-test="promql-operation-${index}"]`);
        return await opBtn.textContent();
    }

    /**
     * Remove an operation at the given index
     * @param {number} index
     */
    async removeOperation(index) {
        const removeBtn = this.page.locator(`[data-test="promql-operation-remove-${index}"]`);
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
        // Open operation menu
        const opBtn = this.page.locator(`[data-test="promql-operation-${operationIndex}"]`);
        await opBtn.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Find and fill the parameter input
        const paramInput = this.page.locator(`[data-test="promql-operation-param-${paramIndex}"]`).last();
        if (await paramInput.isVisible({ timeout: 3000 })) {
            const input = paramInput.locator('input').first();
            await input.clear();
            await input.fill(value);
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
        const legendField = this.page.locator(this.legendInput);
        if (await legendField.isVisible({ timeout: 3000 })) {
            const input = legendField.locator('input').first();
            await input.clear();
            await input.fill(legend);
            return true;
        }
        return false;
    }

    /**
     * Set step value
     * @param {string} stepValue - e.g., "30s", "1m"
     */
    async setStepValue(stepValue) {
        const stepField = this.page.locator(this.stepValueInput);
        if (await stepField.isVisible({ timeout: 3000 })) {
            // data-test is directly on the <input> element, not a wrapper
            const tagName = await stepField.evaluate(el => el.tagName).catch(() => '');
            if (tagName === 'INPUT') {
                await stepField.click();
                await stepField.fill(stepValue);
            } else {
                const input = stepField.locator('input').first();
                await input.click();
                await input.fill(stepValue);
            }
            return true;
        }
        return false;
    }

    /**
     * Select query type (Range or Instant)
     * @param {'range'|'instant'} queryType
     */
    async selectQueryType(queryType) {
        const qtSelect = this.page.locator(this.queryTypeSelect);
        if (await qtSelect.isVisible({ timeout: 3000 })) {
            await qtSelect.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

            const label = queryType === 'range' ? 'Range' : 'Instant';
            const option = this.page.locator(`.q-menu .q-item:has-text("${label}")`).first();
            if (await option.isVisible({ timeout: 3000 })) {
                await option.click();
                await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                return true;
            }
        }
        return false;
    }

    /**
     * Check if Options section is visible (legend, step value, query type)
     */
    async isOptionsVisible() {
        const legend = await this.page.locator(this.legendInput).isVisible({ timeout: 2000 }).catch(() => false);
        const step = await this.page.locator(this.stepValueInput).isVisible({ timeout: 2000 }).catch(() => false);
        return legend || step;
    }

    // ===== Run Query =====

    /**
     * Click the Run Query / Apply button
     */
    async clickRunQuery() {
        const runBtn = this.page.locator(this.runQueryButton).first();
        await runBtn.click();
        await this.page.waitForTimeout(2000);
    }

    // ===== Add to Dashboard =====

    /**
     * Click Add to Dashboard button
     */
    async clickAddToDashboard() {
        const addBtn = this.page.locator(this.addToDashboardButton).first();
        if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await addBtn.click();
            // Wait for the "Add to Dashboard" side panel to fully load (matches visualise.js pattern)
            const sidePanelTitle = this.page.locator(this.dashboardDialogTitle);
            const panelOpened = await sidePanelTitle.waitFor({ state: 'visible', timeout: 10000 })
                .then(() => true)
                .catch(() => false);
            if (!panelOpened) {
                return false;
            }
            await sidePanelTitle.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Check if Add to Dashboard dialog is visible
     */
    async isDashboardDialogVisible() {
        return await this.page.locator(this.dashboardDialogTitle).isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Fill panel title in Add to Dashboard dialog
     * @param {string} title
     */
    async fillPanelTitle(title) {
        const titleInput = this.page.locator(this.dashboardPanelTitleInput);
        if (await titleInput.isVisible({ timeout: 3000 })) {
            // data-test may be directly on the <input> element
            const tagName = await titleInput.evaluate(el => el.tagName).catch(() => '');
            if (tagName === 'INPUT') {
                await titleInput.click();
                await titleInput.fill(title);
            } else {
                const input = titleInput.locator('input').first();
                await input.click();
                await input.fill(title);
            }
            return true;
        }
        return false;
    }

    /**
     * Click Cancel in Add to Dashboard dialog
     */
    async clickDashboardCancel() {
        const cancelBtn = this.page.locator(this.dashboardCancelButton);
        if (await cancelBtn.isVisible({ timeout: 3000 })) {
            await cancelBtn.click();
            await cancelBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Click Add in Add to Dashboard dialog
     */
    async clickDashboardAdd() {
        const addBtn = this.page.locator(this.dashboardAddButton);
        if (await addBtn.isVisible({ timeout: 3000 })) {
            await addBtn.click();
            await this.page.waitForTimeout(1000);
            return true;
        }
        return false;
    }

    // ===== Builder UI Visibility Checks =====

    /**
     * Check if the Builder mode UI elements are visible
     * (Label Filters section, Operations section, Options section)
     */
    async isBuilderUIVisible() {
        const labelFiltersVisible = await this.page.locator(this.addLabelFilterButton).isVisible({ timeout: 3000 }).catch(() => false);
        const operationsVisible = await this.page.locator(this.addOperationButton).isVisible({ timeout: 3000 }).catch(() => false);
        return labelFiltersVisible || operationsVisible;
    }

    /**
     * Check if the Add Label Filter button is visible
     */
    async isAddLabelFilterVisible() {
        return await this.page.locator(this.addLabelFilterButton).isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Check if the Add Operation button is visible
     */
    async isAddOperationVisible() {
        return await this.page.locator(this.addOperationButton).isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Check if label select dropdown has options loaded
     */
    async hasLabelOptions() {
        const menu = this.page.locator('.q-menu:visible').filter({ has: this.page.locator('.q-item') });
        const count = await menu.first().locator('.q-item').count();
        return count > 0;
    }

    /**
     * Get the MetricSelector component's q-select element
     */
    getMetricSelectorLocator() {
        return this.page.locator('[data-test="metric-selector"]');
    }

    /**
     * Check if MetricSelector component is visible (builder mode metric dropdown)
     */
    async isBuilderMetricSelectorVisible() {
        return await this.getMetricSelectorLocator().isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Select a metric from the MetricSelector dropdown (builder mode)
     * @param {string} metricName
     */
    async selectBuilderMetric(metricName) {
        const selector = this.getMetricSelectorLocator();
        if (!await selector.isVisible({ timeout: 5000 })) return false;

        await selector.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Type to filter
        const input = selector.locator('input').first();
        if (await input.isVisible({ timeout: 2000 })) {
            await input.fill(metricName);
            await this.page.waitForTimeout(1000);
        }

        // Select from dropdown options
        const option = this.page.locator('.q-menu .q-item').filter({ hasText: metricName }).first();
        if (await option.isVisible({ timeout: 5000 })) {
            await option.click();
            await this.page.waitForTimeout(1500);
            return true;
        }
        return false;
    }

    /**
     * Get the currently selected metric from MetricSelector
     */
    async getBuilderMetricValue() {
        const selector = this.getMetricSelectorLocator();
        // Try input value first (Quasar q-select with use-input)
        const input = selector.locator('input').first();
        if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
            return await input.inputValue().catch(() => '');
        }
        return await selector.textContent().catch(() => '');
    }

    /**
     * Get operation dialog categories (expansion panel labels)
     */
    async getOperationCategories() {
        const dialog = this.page.locator('[data-test="operations-list-operation-selector-dialog"]');
        if (!await dialog.isVisible({ timeout: 3000 }).catch(() => false)) return [];

        const headers = dialog.locator('.q-expansion-item .q-item__label');
        const count = await headers.count();
        const categories = [];
        for (let i = 0; i < count; i++) {
            const text = await headers.nth(i).textContent().catch(() => '');
            if (text.trim()) categories.push(text.trim());
        }
        return categories;
    }

    /**
     * Close operation selector dialog
     */
    async closeOperationDialog() {
        // OperationsList dialog now uses ODialog with primary button label "Close".
        const dialog = this.page.locator('[data-test="operations-list-operation-selector-dialog"]');
        const closeBtn = dialog.locator('[data-test="o-dialog-primary-btn"]');
        if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await closeBtn.click();
            await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Check if operation selector dialog is visible
     */
    async isOperationDialogVisible() {
        return await this.page
            .locator('[data-test="operations-list-operation-selector-dialog"]')
            .isVisible({ timeout: 2000 })
            .catch(() => false);
    }

    /**
     * Check if value dropdown is disabled (no label selected)
     */
    async isValueSelectDisabled() {
        const valueDropdown = this.page.locator(this.valueSelect).last();
        await valueDropdown.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
        const isDisabled = await valueDropdown.evaluate(el => {
            // Quasar q-select disabled detection: check the element and its ancestors/descendants
            // for disabled indicators
            const hasDisabledClass = (node) => {
                if (!node) return false;
                const cls = node.className || '';
                return cls.includes('q-field--disabled') || cls.includes('disabled');
            };
            // Check the element itself
            if (hasDisabledClass(el)) return true;
            // Check parent (q-field wrapper)
            if (hasDisabledClass(el.parentElement)) return true;
            // Check aria-disabled
            if (el.getAttribute('aria-disabled') === 'true') return true;
            // Check for disabled child elements (Quasar may nest q-field inside)
            if (el.querySelector('.q-field--disabled')) return true;
            // Check if the inner input/control is disabled
            const input = el.querySelector('input');
            if (input && input.disabled) return true;
            // Check computed pointer-events (Quasar disabled fields have pointer-events: none)
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
     * Sets up request interception, clicks Run Query, and returns the captured query.
     * @returns {Promise<string>} The PromQL query string from the request
     */
    async captureQueryFromRunRequest() {
        const requestPromise = this.page.waitForRequest(
            (req) => req.url().includes('/prometheus/api/v1/query_range') ||
                     req.url().includes('/prometheus/api/v1/query'),
            { timeout: 15000 }
        );

        // Click Run Query
        const runBtn = this.page.locator(this.runQueryButton).first();
        await runBtn.click();

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

        // Wait for response to complete
        await this.page.waitForTimeout(2000);
        return decodeURIComponent(query);
    }

    /**
     * Read the generated PromQL query text from the query preview area at the bottom.
     * The query preview is a Monaco editor visible in Builder mode (data-test="dashboard-panel-query-editor").
     * @returns {Promise<string>} The PromQL query string
     */
    async getQueryPreviewText() {
        const queryEditor = this.page.locator('[data-test="dashboard-panel-query-editor"]').first();
        if (await queryEditor.isVisible({ timeout: 5000 }).catch(() => false)) {
            // Read from Monaco editor's .view-lines
            const text = await queryEditor.locator('.view-lines').textContent().catch(() => '');
            return text.trim();
        }
        // Fallback: try any visible .view-lines in the query area
        const fallback = await this.page.locator('.view-lines').first().textContent().catch(() => '');
        return fallback.trim();
    }

    /**
     * Read the current builder UI state: metric, label filters, operations, and options.
     * Stays in Builder mode — no mode switching needed.
     * @returns {Promise<{metric: string, labelFilters: string[], operations: string[], legend: string, stepValue: string}>}
     */
    async verifyBuilderState() {
        const state = {};

        // 1. Read metric from stream selector
        const streamInput = this.page.locator(this.streamSelector);
        state.metric = await streamInput.inputValue().catch(() => '');

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
        const legendField = this.page.locator(this.legendInput);
        if (await legendField.isVisible({ timeout: 2000 }).catch(() => false)) {
            const legendInput = legendField.locator('input').first();
            state.legend = await legendInput.inputValue().catch(() => '');
        } else {
            state.legend = '';
        }

        const stepField = this.page.locator(this.stepValueInput);
        if (await stepField.isVisible({ timeout: 2000 }).catch(() => false)) {
            const tagName = await stepField.evaluate(el => el.tagName).catch(() => '');
            if (tagName === 'INPUT') {
                state.stepValue = await stepField.inputValue().catch(() => '');
            } else {
                state.stepValue = await stepField.locator('input').first().inputValue().catch(() => '');
            }
        } else {
            state.stepValue = '';
        }

        return state;
    }

    /**
     * Verify the table chart has rendered with data rows.
     * Checks for the q-table with headers and at least one data row.
     * @returns {Promise<{visible: boolean, rowCount: number, headers: string[]}>}
     */
    async getTableChartData() {
        const table = this.page.locator('[data-test="dashboard-panel-table"]');
        const visible = await table.isVisible({ timeout: 5000 }).catch(() => false);
        if (!visible) return { visible: false, rowCount: 0, headers: [] };

        // Get header texts
        const headers = [];
        const thElements = table.locator('thead th');
        const headerCount = await thElements.count().catch(() => 0);
        for (let i = 0; i < headerCount; i++) {
            const text = await thElements.nth(i).textContent().catch(() => '');
            if (text.trim()) headers.push(text.trim());
        }

        // Count data rows (TanStack dashboard mode uses data-test="dashboard-data-row")
        const rows = table.locator('[data-test="dashboard-data-row"], tbody tr');
        const rowCount = await rows.count().catch(() => 0);

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
            await this.page.waitForTimeout(500);
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
        const chartCanvas = this.page.locator('[data-test="chart-renderer"]');
        const tableRenderer = this.page.locator('[data-test="dashboard-panel-table"]');
        const chartVisible = await chartCanvas.isVisible({ timeout: 5000 }).catch(() => false);
        const tableVisible = await tableRenderer.isVisible({ timeout: 5000 }).catch(() => false);
        return chartVisible || tableVisible;
    }

    // ===== Add to Dashboard - Full Save Flow =====

    /**
     * Select a folder from the folder dropdown in Add to Dashboard dialog
     * @param {string} folderName - folder name to select (default: "default")
     */
    async selectDashboardFolder(folderName = 'default') {
        const folderDropdown = this.page.locator('[data-test="index-dropdown-stream_type"]');
        if (await folderDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
            await folderDropdown.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
            const option = this.page.locator('.q-menu .q-item').filter({ hasText: folderName }).first();
            if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                await option.click();
                await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        const dashDropdown = this.page.locator('[data-test="dashboard-dropdown-dashboard-selection"]');
        if (await dashDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
            await dashDropdown.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

            // Type to filter
            const input = dashDropdown.locator('input').first();
            if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
                await input.fill(dashboardName);
                await this.page.waitForTimeout(1000);
            }

            const option = this.page.locator('.q-menu .q-item').filter({ hasText: dashboardName }).first();
            if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                await option.click();
                await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        const tabDropdown = this.page.locator('[data-test="dashboard-dropdown-tab-selection"]');

        // Wait for the tab dropdown to become visible (it appears only after a dashboard is selected)
        if (!await tabDropdown.isVisible({ timeout: 8000 }).catch(() => false)) {
            return false;
        }

        // Wait for the tab list to auto-load and auto-select (SelectTabDropdown onMounted async fetch)
        await this.page.waitForTimeout(2000);

        // Click an empty area of the Add-to-Dashboard ODrawer panel to dismiss any
        // open Quasar menu from prior dropdowns (folder/dashboard). The previous
        // `schema-title-text` element was removed when AddToDashboard migrated to
        // ODrawer — the drawer's `data-test="add-to-dashboard-dialog"` slug is
        // safe to click because it's inside the drawer (so it doesn't trigger
        // interact-outside) but outside teleported q-menus.
        const drawerPanel = this.page.locator('[data-test="add-to-dashboard-dialog"]');
        if (await drawerPanel.isVisible({ timeout: 1000 }).catch(() => false)) {
            await drawerPanel.click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
            await this.page.waitForTimeout(300);
        }

        // Now click the tab dropdown normally
        await tabDropdown.click();
        await this.page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
        const option = this.page.locator('.q-menu .q-item').filter({ hasText: tabName }).first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.click();
            await this.page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        await this.page.locator(this.dashboardDialogTitle).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

        return true;
    }

    /**
     * Create a new dashboard from within the Add to Dashboard dialog.
     * Follows the proven pattern from visualise.js addPanelToNewDashboard:
     * waitFor visible+attached, click, then fill.
     * @param {string} dashboardName
     */
    async createNewDashboardInDialog(dashboardName) {
        const newDashBtn = this.page.locator('[data-test="dashboard-dashboard-new-add"]');
        await newDashBtn.waitFor({ state: 'visible', timeout: 10000 });
        await newDashBtn.waitFor({ state: 'attached', timeout: 5000 });
        await newDashBtn.click();

        // Wait for the "New dashboard" dialog name input to be fully ready
        const dashNameInput = this.page.locator('[data-test="add-dashboard-name"]');
        await dashNameInput.waitFor({ state: 'visible', timeout: 10000 });
        await dashNameInput.waitFor({ state: 'attached', timeout: 5000 });

        // Click then fill (Quasar q-input needs click to focus first)
        await dashNameInput.click();
        await dashNameInput.fill(dashboardName);

        // Submit dashboard creation — SelectDashboardDropdown wraps AddDashboard in an
        // ODrawer with `data-test="dashboard-dashboard-add-dialog"`, and the legacy
        // `dashboard-add-submit` button was removed in favour of the ODrawer footer
        // primary action (Save) which calls `addDashboardRef?.submit()`.
        const submitBtn = this.page.locator(
            '[data-test="dashboard-dashboard-add-dialog"] [data-test="o-drawer-primary-btn"]'
        );
        await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
        await submitBtn.click();

        // Wait for the inner "New dashboard" drawer to close (parent "Add to Dashboard"
        // drawer stays open and auto-selects the newly created dashboard).
        await this.page
            .locator('[data-test="dashboard-dashboard-add-dialog"]')
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch(() => {});
        await this.page.waitForTimeout(3000);
    }

    /**
     * Ensure a dashboard is selected in the Add to Dashboard dialog.
     * Checks if one is auto-selected, tries dropdown options, or creates a new one.
     * Follows the pattern from visualise.js addPanelToNewDashboard.
     * @returns {Promise<string>} The name of the selected/created dashboard
     */
    async ensureDashboardSelected() {
        const dashDropdown = this.page.locator('[data-test="dashboard-dropdown-dashboard-selection"]');
        await dashDropdown.waitFor({ state: 'visible', timeout: 5000 });

        // Wait for the dashboard list API to finish loading
        await this.page.waitForTimeout(2000);

        // Check if a dashboard is already auto-selected by reading the q-select's
        // displayed value. Quasar q-select (without use-input) renders the selected
        // option text inside .q-field__native > span.
        const hasSelectedValue = await dashDropdown.evaluate((el) => {
            const nativeSpans = el.querySelectorAll('.q-field__native > span');
            for (const span of nativeSpans) {
                const text = span.textContent?.trim();
                if (text && text.length > 0 && !text.includes('Select')) {
                    return text;
                }
            }
            return '';
        });

        if (hasSelectedValue) {
            return hasSelectedValue;
        }

        // No dashboard auto-selected — create a new one.
        // We skip opening the dropdown because when the list is empty,
        // the q-select shows a "No result" q-item that matches .q-menu .q-item
        // and pressing Escape to close the menu could close the parent dialog.
        // This matches the visualise.js pattern of always creating a fresh dashboard.
        const newDashName = `test_dash_${Date.now()}`;
        await this.createNewDashboardInDialog(newDashName);
        return newDashName;
    }

    // ===== Dashboard Verification & Cleanup =====

    /**
     * Navigate to dashboards list page
     */
    async navigateToDashboards() {
        const dashMenu = this.page.locator('[data-test="menu-link-\\/dashboards-item"]');
        await dashMenu.click();
        await this.page.waitForTimeout(2000);
    }

    /**
     * Verify a panel exists on the current dashboard page
     * @param {string} panelTitle
     */
    async isPanelVisibleOnDashboard(panelTitle) {
        const panel = this.page.locator(`[data-test="dashboard-panel-bar"]:has-text("${panelTitle}")`);
        return await panel.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Delete a dashboard by name from the dashboards list
     * @param {string} dashboardName
     */
    async deleteDashboard(dashboardName) {
        await this.navigateToDashboards();
        await this.page.waitForTimeout(1000);

        // Search for the dashboard
        const searchInput = this.page.locator('[data-test="dashboard-search"]');
        if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await searchInput.fill(dashboardName);
            await this.page.waitForTimeout(1000);
        }

        // Find the row and click delete
        const dashboardRow = this.page.locator('tr, .q-tr').filter({ hasText: dashboardName }).first();
        if (await dashboardRow.isVisible({ timeout: 5000 }).catch(() => false)) {
            const deleteBtn = dashboardRow.locator('[data-test="dashboard-delete"]');
            if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await deleteBtn.click();
                await this.page.locator('[data-test="confirm-button"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

                // Confirm deletion
                const confirmBtn = this.page.locator('[data-test="confirm-button"]');
                if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await confirmBtn.click();
                    await this.page.waitForTimeout(2000);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check for success notification (positive toast)
     */
    async hasSuccessNotification() {
        const notification = this.page.locator('.q-notification--standard.bg-positive, .q-notification:has-text("success"), .q-notification:has-text("added")');
        return await notification.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check for error notification (negative toast)
     */
    async hasErrorNotification() {
        const notification = this.page.locator('.q-notification--standard.bg-negative, .q-notification:has-text("Error"), .q-notification:has-text("error")');
        return await notification.isVisible({ timeout: 3000 }).catch(() => false);
    }
}

