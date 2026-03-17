// metricsBuilderPage.js
// Page Object Model for PromQL Builder Mode UI interactions
// Covers: Label Filters, Operations, Options, Query Mode tabs, Add to Dashboard

import { expect } from '@playwright/test';

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
        this.addToDashboardButton = 'button:has-text("Add To Dashboard"), button:has-text("Add to Dashboard")';
        this.dashboardDialogTitle = '[data-test="schema-title-text"]';
        this.dashboardPanelTitleInput = '[data-test="metrics-new-dashboard-panel-title"]';
        this.dashboardCancelButton = '[data-test="metrics-schema-cancel-button"]';
        this.dashboardAddButton = '[data-test="metrics-schema-update-settings-button"]';

        // Confirm dialog for mode switching
        this.confirmDialogOk = '.q-dialog .q-btn:has-text("OK"), .q-dialog .q-btn:has-text("Confirm"), .q-dialog .q-card__actions .q-btn--flat:last-child';
        this.confirmDialogCancel = '.q-dialog .q-btn:has-text("Cancel")';
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
            if (!classes.includes('selected')) {
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
                await this.page.waitForTimeout(500);
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
            return classes.includes('selected');
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
        await this.page.waitForTimeout(500);

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
        await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(500);
    }

    /**
     * Select a label name from the label filter dropdown
     * @param {string} labelName
     */
    async selectLabel(labelName) {
        const labelDropdown = this.page.locator(this.labelSelect).last();
        await labelDropdown.click();
        await this.page.waitForTimeout(300);

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
            await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(300);

        // Select from dropdown options
        const option = this.page.locator('.q-menu .q-item').filter({ hasText: operator }).first();
        if (await option.isVisible({ timeout: 3000 })) {
            await option.click();
            await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(300);

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
            await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(300);
    }

    // ===== Operations =====

    /**
     * Click the add operation button
     */
    async clickAddOperation() {
        const addBtn = this.page.locator(this.addOperationButton);
        await addBtn.click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Select an operation from the operation selector dialog
     * @param {string} operationName - e.g., "Rate", "Sum", "Avg"
     */
    async selectOperation(operationName) {
        // Wait for dialog to appear
        const dialog = this.page.locator('.q-dialog');
        await dialog.waitFor({ state: 'visible', timeout: 5000 });

        // Search for the operation
        const searchInput = dialog.locator('input').first();
        if (await searchInput.isVisible({ timeout: 2000 })) {
            await searchInput.fill(operationName);
            await this.page.waitForTimeout(500);
        }

        // Click on the operation item
        const opItem = dialog.locator(`.q-item:has-text("${operationName}")`).first();
        if (await opItem.isVisible({ timeout: 3000 })) {
            await opItem.click();
            await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(500);
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
        await this.page.waitForTimeout(500);

        // Find and fill the parameter input
        const paramInput = this.page.locator(`[data-test="promql-operation-param-${paramIndex}"]`).last();
        if (await paramInput.isVisible({ timeout: 3000 })) {
            const input = paramInput.locator('input').first();
            await input.clear();
            await input.fill(value);
            await this.page.waitForTimeout(300);
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
            await this.page.waitForTimeout(300);
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
            await this.page.waitForTimeout(300);
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
            await this.page.waitForTimeout(300);

            const label = queryType === 'range' ? 'Range' : 'Instant';
            const option = this.page.locator(`.q-menu .q-item:has-text("${label}")`).first();
            if (await option.isVisible({ timeout: 3000 })) {
                await option.click();
                await this.page.waitForTimeout(300);
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
        if (await addBtn.isVisible({ timeout: 5000 })) {
            await addBtn.click();
            await this.page.waitForTimeout(500);
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
            await this.page.waitForTimeout(300);
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
            await this.page.waitForTimeout(500);
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
        const options = this.page.locator('.q-menu .q-item');
        const count = await options.count();
        return count > 0;
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
}
