import { expect } from '@playwright/test';

/**
 * Page Object for the Correlation Event Drawer.
 *
 * This is the "correlate-from-a-log" drawer surfaced from the Logs page: the
 * correlated-logs tab/table, the correlation event-header chips, the error
 * state, and the log-correlation entry button. Distinct from the Correlation
 * Settings screen (see CorrelationSettingsPage).
 */
export class CorrelationDrawerPage {
    constructor(page) {
        this.page = page;

        // ==================== Drawer Selectors ====================
        this.correlatedLogsTab = '[data-test="correlated-logs-tab"]';
        this.correlatedLogsTable = '[data-test="correlated-logs-table"]';
        this.correlatedMetricsTab = '[data-test="correlated-metrics-tab"]';
        // Chips render per matched dimension; match by data-test prefix.
        this.eventHeaderChips = '[data-test^="correlation-event-header"]';
        this.errorState = '[data-test="error-state"]';
        this.logCorrelationBtn = '[data-test="log-correlation-btn"]';
        // Logs result table (source of the correlate journey).
        this.logsResultTable = '[data-test="logs-search-result-logs-table"]';
        // Apply button on the editable DimensionFiltersBar.
        this.applyDimensionFiltersBtn = '[data-test="apply-dimension-filters"]';
    }

    // ==================== Getters (raw-selector relocation) ====================

    /**
     * Correlated logs tab locator (first match).
     * @returns {import('@playwright/test').Locator}
     */
    getCorrelatedLogsTab() {
        return this.page.locator(this.correlatedLogsTab).first();
    }

    /**
     * Correlated logs table locator (first match).
     * @returns {import('@playwright/test').Locator}
     */
    getCorrelatedLogsTable() {
        return this.page.locator(this.correlatedLogsTable).first();
    }

    /**
     * Correlation event-header chips locator (all matches).
     * @returns {import('@playwright/test').Locator}
     */
    getEventHeaderChips() {
        return this.page.locator(this.eventHeaderChips);
    }

    /**
     * Error-state locator (first match).
     * @returns {import('@playwright/test').Locator}
     */
    getErrorState() {
        return this.page.locator(this.errorState).first();
    }

    /**
     * Log-correlation entry button locator (first match).
     * @returns {import('@playwright/test').Locator}
     */
    getLogCorrelationBtn() {
        return this.page.locator(this.logCorrelationBtn).first();
    }

    /**
     * Event text (e.g. a dimension value) matched by visible text, non-exact.
     * @param {string} name - Text to match.
     * @returns {import('@playwright/test').Locator}
     */
    getEventTextByName(name) {
        return this.page.getByText(name, { exact: false });
    }

    /**
     * Correlated metrics tab locator (first match).
     * @returns {import('@playwright/test').Locator}
     */
    getCorrelatedMetricsTab() {
        return this.page.locator(this.correlatedMetricsTab).first();
    }

    /**
     * Logs result table rows (`tbody tr`).
     * @returns {import('@playwright/test').Locator}
     */
    getLogsResultTableRows() {
        return this.page.locator(`${this.logsResultTable} tbody tr`);
    }

    /**
     * Dimension-filter control for a given dimension key.
     * @param {string} key - Dimension key (e.g. "k8s-cluster").
     * @returns {import('@playwright/test').Locator}
     */
    getDimensionFilter(key) {
        return this.page.locator(`[data-test="dimension-filter-${key}"]`).first();
    }

    /**
     * Apply button on the editable DimensionFiltersBar (first match).
     * @returns {import('@playwright/test').Locator}
     */
    getApplyDimensionFiltersButton() {
        return this.page.locator(this.applyDimensionFiltersBtn).first();
    }

    /**
     * Role=option locator matched by name (string or RegExp).
     * @param {string|RegExp} name - Option accessible name.
     * @returns {import('@playwright/test').Locator}
     */
    getOptionByName(name) {
        return this.page.getByRole('option', { name });
    }
}
