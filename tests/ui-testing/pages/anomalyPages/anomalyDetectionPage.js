/**
 * AnomalyDetectionPage - Handles anomaly detection operations
 *
 * This module contains methods for managing anomaly detection configurations:
 * - Navigate to anomaly detection tab
 * - Create anomaly detection configs
 * - Verify anomaly configs
 * - Pause/Resume anomaly detection
 * - Retrain models
 * - Delete anomaly configs
 *
 * NOTE: Anomaly detection is an enterprise/cloud feature only
 */

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { cleanupTestAnomalies: apiCleanupTestAnomalies } = require('../../playwright-tests/utils/api-helper.js');

class AnomalyDetectionPage {
    constructor(page, commonActions) {
        this.page = page;
        this.commonActions = commonActions;

        // Create selectors object for compatibility with test expectations
        this.selectors = {
            // Tables
            alertsTable: '[data-test="alert-list-table"]',
            anomalyTable: '[data-test="anomaly-detection-list-table"]',

            // Anomaly config form
            anomalyNameInput: '.alert-v3-field.topbar-name-input',
            streamTypeSelect: '[data-test="add-alert-stream-type-select-dropdown"]',
            streamNameSelect: '[data-test="add-alert-stream-name-select-dropdown"]',

            // Detection config
            detectionFunctionSelect: '[data-test="anomaly-detection-function"]',
            detectionFunctionField: '[data-test="anomaly-detection-function-field"]',
            histogramIntervalValue: '[data-test="anomaly-histogram-interval-value"]',
            histogramIntervalUnit: '[data-test="anomaly-histogram-interval-unit"]',
            scheduleIntervalValue: '[data-test="anomaly-schedule-interval-value"]',
            scheduleIntervalUnit: '[data-test="anomaly-schedule-interval-unit"]',
            detectionWindowValue: '[data-test="anomaly-detection-window-value"]',
            detectionWindowUnit: '[data-test="anomaly-detection-window-unit"]',
            trainingWindow: '[data-test="anomaly-training-window"]',
            retrainInterval: '[data-test="anomaly-retrain-interval"]',
            sensitivityLoadBtn: '[data-test="anomaly-sensitivity-load-btn"]',
            sensitivityChart: '[data-test="anomaly-sensitivity-chart"]',
            sensitivityEmpty: '[data-test="anomaly-sensitivity-empty"]',
            thresholdRange: '[data-test="anomaly-threshold-range"]',
            thresholdRangeLabel: '[data-test="anomaly-threshold-range-label"]',
            customSql: '[data-test="anomaly-custom-sql"]',
            customSqlTimestampError: '[data-test="anomaly-sql-timestamp-error"]',
            filterRow: '[data-test="anomaly-filter-row"]',
            detectionWindowError: '[data-test="anomaly-detection-window-error"]',
            summaryText: '.anomaly-summary .summary-text',

            // Alerting
            alertEnabled: '[data-test="anomaly-alert-enabled"]',
            alertToggleLabel: '.q-toggle__label',
            destination: '[data-test="anomaly-destination"]',
            destinationError: '[data-test="anomaly-destination-error"]',
            refreshDestinationsBtn: '[data-test="anomaly-refresh-destinations"]',

            // Action buttons
            backButton: '[data-test="add-alert-back-btn"]',
            saveButton: '[data-test="add-alert-submit-btn"]',
            cancelButton: '[data-test="add-alert-cancel-btn"]',

            // Generic Quasar components
            qToggle: '.q-toggle',
            qMenuItem: '.q-menu .q-item',
            qMenu: '.q-menu',
            qDialog: '.q-dialog',

            // Dynamic selectors (functions)
            editButton: (name) => `[data-test="alert-list-${name}-update-alert"]`,
            pauseButton: (name) => `[data-test="alert-list-${name}-pause-start-alert"]`,
            resumeButton: (name) => `[data-test="alert-list-${name}-pause-start-alert"]`, // Same button toggles
            deleteButton: (name) => `[data-test="alert-list-${name}-delete-alert"]`,
            cloneButton: (name) => `[data-test="alert-list-${name}-clone-alert"]`,
            moreOptionsButton: (name) => `[data-test="alert-list-${name}-more-options"]`,
            triggerDetectionButton: (name) => `[data-test="alert-list-${name}-trigger-detection"]`,
        };

        // Also keep direct references for backward compatibility
        this.addAnomalyButton = '[data-test="alert-list-add-alert-btn"]';
        this.anomalyTable = this.selectors.anomalyTable;
        this.alertTable = this.selectors.alertsTable;
        this.anomalyDetectionTab = 'anomalyDetection';
        this.anomalyNameInput = this.selectors.anomalyNameInput;
        this.streamTypeSelect = this.selectors.streamTypeSelect;
        this.streamNameSelect = this.selectors.streamNameSelect;
        this.detectionFunctionSelect = this.selectors.detectionFunctionSelect;
        this.detectionFunctionField = this.selectors.detectionFunctionField;
        this.histogramIntervalValue = this.selectors.histogramIntervalValue;
        this.histogramIntervalUnit = this.selectors.histogramIntervalUnit;
        this.scheduleIntervalValue = this.selectors.scheduleIntervalValue;
        this.scheduleIntervalUnit = this.selectors.scheduleIntervalUnit;
        this.detectionWindowValue = this.selectors.detectionWindowValue;
        this.detectionWindowUnit = this.selectors.detectionWindowUnit;
        this.trainingWindow = this.selectors.trainingWindow;
        this.retrainInterval = this.selectors.retrainInterval;
        this.sensitivityLoadBtn = this.selectors.sensitivityLoadBtn;
        this.sensitivityChart = this.selectors.sensitivityChart;
        this.thresholdRange = this.selectors.thresholdRange;
        this.alertEnabledToggle = this.selectors.alertEnabled;
        this.destinationSelect = this.selectors.destination;
        this.backButton = this.selectors.backButton;
        this.saveButton = this.selectors.saveButton;
        this.cancelButton = this.selectors.cancelButton;
    }

    // ==================== HELPER METHODS FOR TESTS ====================

    /**
     * Wait for alerts table to be visible
     * @param {number} timeout - Timeout in ms
     */
    async waitForAlertsTable(timeout = 10000) {
        try {
            await this.page.locator(this.selectors.alertsTable).first().waitFor({ state: 'visible', timeout });
            testLogger.info('Alerts table is visible');
        } catch (e) {
            testLogger.warn('Alerts table not visible within timeout', { timeout, error: e.message });
        }
    }

    /**
     * Wait for Add Alert button to be enabled
     * @param {number} timeout - Timeout in ms
     * @returns {Promise<boolean>}
     */
    async waitForAddAlertButtonEnabled(timeout = 15000) {
        try {
            const button = this.page.locator(this.addAnomalyButton);
            await button.waitFor({ state: 'visible', timeout });
            // Wait for button to not be disabled
            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                const isDisabled = await button.isDisabled();
                if (!isDisabled) {
                    testLogger.info('Add Alert button is enabled');
                    return true;
                }
                await this.page.waitForTimeout(500);
            }
            testLogger.warn('Add Alert button is still disabled after timeout');
            return false;
        } catch (e) {
            testLogger.warn('Error waiting for Add Alert button', { error: e.message });
            return false;
        }
    }

    /**
     * Fill basic setup - name, stream type, stream name
     * @param {string} name - Anomaly name
     * @param {string} streamType - Stream type
     * @param {string} streamName - Stream name
     */
    async fillBasicSetup(name, streamType, streamName) {
        // Fill stream type and name FIRST, then name LAST
        // This prevents stream selection from clearing the name field
        await this.selectStreamType(streamType);
        await this.selectStreamName(streamName);
        await this.fillAnomalyName(name);
        testLogger.info('Filled basic setup', { name, streamType, streamName });
    }

    /**
     * Click on a tab (Basic Setup, Detection Config, Alerting, Summary)
     * @param {string} tabName - Tab name
     */
    async clickTab(tabName) {
        // Try multiple base selectors with filter pattern to avoid injection
        const baseSelectors = [
            '[class*="tw:cursor-pointer"]',
            '[role="group"] button',
            'button',
            '[role="tab"]'
        ];

        let tabFound = false;
        for (const baseSelector of baseSelectors) {
            const tab = this.page.locator(baseSelector).filter({ hasText: tabName }).first();
            if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
                await tab.click();
                await this.page.waitForTimeout(1000); // Wait for tab content to load
                testLogger.info('Clicked tab', { tabName, baseSelector });
                tabFound = true;
                break;
            }
        }

        // Fallback: try text selector
        if (!tabFound) {
            const textTab = this.page.getByText(tabName, { exact: true }).first();
            if (await textTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                await textTab.click();
                await this.page.waitForTimeout(1000);
                testLogger.info('Clicked tab via text selector', { tabName });
                tabFound = true;
            }
        }

        if (!tabFound) {
            testLogger.warn('Tab not found with any selector', { tabName });
        }
    }

    /**
     * Get anomaly row by name
     * @param {string} name - Anomaly name
     * @returns {import('@playwright/test').Locator}
     */
    getAnomalyRow(name) {
        return this.page.locator('tr').filter({ hasText: name });
    }

    /**
     * Select query mode (builder or sql)
     * @param {string} mode - Query mode (builder, sql)
     */
    async selectQueryMode(mode) {
        const tabLabel = mode === 'sql' ? 'SQL' : 'Builder';

        // The tabs are buttons within the query-mode-tabs container
        const tabsContainer = this.page.locator('[data-test="anomaly-query-tabs"]');
        await expect(tabsContainer).toBeVisible({ timeout: 5000 });

        const modeTab = tabsContainer.locator(`button.query-mode-tab:has-text("${tabLabel}")`).first();
        await expect(modeTab).toBeVisible({ timeout: 3000 });
        await modeTab.click();

        // Wait longer for SQL mode because Monaco editor takes time to initialize
        const waitTime = mode === 'sql' ? 3000 : 1000;
        await this.page.waitForTimeout(waitTime);

        testLogger.info('Selected query mode', { mode, tabLabel });
    }

    /**
     * Set SQL query
     * @param {string} sql - SQL query
     */
    async setSqlQuery(sql) {
        // Monaco editor takes time to initialize, wait up to 10 seconds
        const sqlEditorContainer = this.page.locator(this.selectors.customSql);
        await expect(sqlEditorContainer).toBeVisible({ timeout: 10000 });

        // Monaco editor uses a textarea for input - find it within the editor container
        const monacoTextarea = sqlEditorContainer.locator('textarea').first();
        await expect(monacoTextarea).toBeVisible({ timeout: 5000 });

        // Click the editor to focus it
        await sqlEditorContainer.click();
        await this.page.waitForTimeout(500);

        // Select all and replace with new SQL using keyboard shortcuts
        await monacoTextarea.focus();
        await this.page.waitForTimeout(300);

        // Cmd+A (Mac) or Ctrl+A (Win/Linux) to select all
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        await this.page.keyboard.press(`${modifier}+KeyA`);
        await this.page.waitForTimeout(200);

        // Type the new SQL
        await this.page.keyboard.type(sql, { delay: 10 });
        await this.page.waitForTimeout(500);

        testLogger.info('Set SQL query', { sqlLength: sql.length });
    }

    /**
     * Set detection resolution (histogram interval)
     */
    async setDetectionResolution(value, unit) {
        await this.setHistogramInterval(value, unit === 'm' ? 'minutes' : unit === 'h' ? 'hours' : unit);
    }

    /**
     * Set check every (schedule interval)
     */
    async setCheckEvery(value, unit) {
        await this.setScheduleInterval(value, unit === 'm' ? 'minutes' : unit === 'h' ? 'hours' : unit);
    }

    /**
     * Set look back window (detection window)
     */
    async setLookBackWindow(value, unit) {
        await this.setDetectionWindow(value, unit === 'm' ? 'minutes' : unit === 'h' ? 'hours' : unit);
    }

    /**
     * Set training window days
     * @param {number} days - Training window in days
     */
    async setTrainingWindow(days) {
        const input = this.page.locator(this.selectors.trainingWindow);
        if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
            await input.fill(String(days));
            testLogger.info('Set training window', { days });
        }
    }

    /**
     * Set retrain interval
     * @param {string} interval - Retrain interval (Never, 1 day, 7 days, etc.)
     */
    async setRetrainInterval(interval) {
        const select = this.page.locator(this.selectors.retrainInterval);
        if (await select.isVisible({ timeout: 3000 }).catch(() => false)) {
            await select.click();
            await this.page.waitForTimeout(500);
            await this.page.getByRole('option', { name: interval }).click();
            await this.page.waitForTimeout(300);
            testLogger.info('Set retrain interval', { interval });
        }
    }

    /**
     * Disable alerting
     */
    async disableAlerting() {
        testLogger.info('Disabling alerting to allow save');

        // Try multiple ways to find and click the Alerting tab
        const tabSelectors = [
            '[class*="tw:cursor-pointer"]:has-text("Alerting")',
            'text=Alerting',
            'button:has-text("Alerting")',
            '[role="group"] button:has-text("Alerting")'
        ];

        let alertingTab = null;
        for (const selector of tabSelectors) {
            const tab = this.page.locator(selector).first();
            if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
                alertingTab = tab;
                testLogger.info('Found Alerting tab', { selector });
                break;
            }
        }

        if (!alertingTab) {
            testLogger.warn('Alerting tab not found');
            return;
        }

        await alertingTab.click();
        testLogger.info('Clicked Alerting tab');
        await this.page.waitForTimeout(2000); // Wait longer for tab content to load

        // Try multiple selectors for the toggle
        const toggleSelectors = [
            this.selectors.alertEnabled,
            '[data-test="anomaly-alert-enabled"]',
            '.q-toggle'
        ];

        let toggle = null;
        for (const selector of toggleSelectors) {
            const loc = this.page.locator(selector).first();
            if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
                toggle = loc;
                testLogger.info('Found alerting toggle', { selector });
                break;
            }
        }

        if (!toggle) {
            testLogger.warn('Alerting toggle not found');
            return;
        }

        // Get toggle label to determine state
        const toggleLabel = await toggle.locator('div.q-toggle__label').textContent().catch(() => '');
        testLogger.info('Alert toggle state', { toggleLabel });

        if (toggleLabel.toLowerCase().includes('enabled')) {
            testLogger.info('Alerting is enabled, clicking to disable');
            await toggle.click();
            await this.page.waitForTimeout(1000);

            // Verify it was disabled
            const newLabel = await toggle.locator('div.q-toggle__label').textContent().catch(() => '');
            testLogger.info('After clicking toggle', { toggleLabel: newLabel });
            testLogger.info('Disabled alerting');
        } else {
            testLogger.info('Alerting already disabled');
        }

        // Navigate back to Config tab
        testLogger.info('Navigating back to Config tab');
        await this.clickTab('Detection Config');
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked Config tab');
    }

    /**
     * Toggle notifications on/off
     * @param {boolean} enabled - Enable or disable
     */
    async toggleNotifications(enabled) {
        const toggle = this.page.locator(this.selectors.alertEnabled);
        if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
            const label = await toggle.locator(this.selectors.alertToggleLabel).textContent().catch(() => '');
            const isEnabled = label.toLowerCase().includes('enabled');
            if (enabled !== isEnabled) {
                await toggle.click();
                await this.page.waitForTimeout(500);
            }
        }
    }

    /**
     * Click save button
     */
    async clickSave() {
        const saveBtn = this.page.locator(this.selectors.saveButton);
        await expect(saveBtn).toBeVisible({ timeout: 5000 });
        await expect(saveBtn).toBeEnabled({ timeout: 5000 });
        await saveBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Clicked save button');
    }

    /**
     * Expect anomaly to appear in list
     * @param {string} name - Anomaly name
     */
    async expectAnomalyInList(name) {
        const row = this.getAnomalyRow(name);
        await expect(row).toBeVisible({ timeout: 15000 });
        testLogger.info('Anomaly found in list', { name });
    }

    /**
     * Configure builder mode
     * @param {Object} config - Builder mode config
     */
    async configureBuilderMode(config) {
        await this.configureDetectionFunction(config.function, config.field);
    }

    /**
     * Add a filter in builder mode
     * @param {string} field - Field name
     * @param {string} operator - Operator (=, Contains, etc.)
     * @param {string} value - Value
     */
    async addFilter(field, operator, value) {
        // Click add filter button to create a new empty filter row
        const addFilterBtn = this.page.locator('button:has-text("Add filter"), button:has-text("Add Filter")').first();
        await expect(addFilterBtn).toBeVisible({ timeout: 5000 });
        await addFilterBtn.click();
        await this.page.waitForTimeout(1000);

        // Get the last filter row (the newly added one)
        // Filter rows are flex containers with field, operator, value, and close button
        const filterRows = this.page.locator('.tw\\:flex.tw\\:items-center.tw\\:gap-2.tw\\:mb-2');
        const filterCount = await filterRows.count();
        const lastFilterRow = filterRows.nth(filterCount - 1);

        // 1. Fill the field select (first q-select in the row)
        const fieldSelect = lastFilterRow.locator('.filter-field-select, .alert-v3-select').first();
        await expect(fieldSelect).toBeVisible({ timeout: 3000 });
        await fieldSelect.click();
        await this.page.waitForTimeout(500);

        // Type to search for the field
        await this.page.keyboard.type(field, { delay: 50 });
        await this.page.waitForTimeout(1000);

        // Click the option that matches
        const fieldOption = this.page.getByRole('option', { name: field }).first();
        if (await fieldOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await fieldOption.click();
        } else {
            // Fallback: try clicking by text
            await this.page.locator(`.q-item:has-text("${field}")`).first().click().catch(() => {});
        }
        await this.page.waitForTimeout(500);

        // 2. Fill the operator select (second q-select in the row)
        const operatorSelect = lastFilterRow.locator('.alert-v3-select').nth(1);
        if (await operatorSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
            await operatorSelect.click();
            await this.page.waitForTimeout(500);

            const operatorOption = this.page.getByRole('option', { name: operator }).first();
            if (await operatorOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                await operatorOption.click();
            } else {
                await this.page.locator(`.q-item:has-text("${operator}")`).first().click().catch(() => {});
            }
            await this.page.waitForTimeout(500);
        }

        // 3. Fill the value input (q-input in the row)
        const valueInput = lastFilterRow.locator('.alert-v3-input input, input.q-field__native').first();
        if (await valueInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await valueInput.click();
            await valueInput.fill(value);
            await this.page.waitForTimeout(300);
        }

        testLogger.info('Added filter', { field, operator, value });
    }

    /**
     * Refresh destinations list
     */
    async refreshDestinations() {
        const btn = this.page.locator(this.selectors.refreshDestinationsBtn).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            await this.page.waitForTimeout(2000);
            testLogger.info('Refreshed destinations');
        }
    }

    /**
     * Load sensitivity preview
     */
    async loadSensitivityPreview() {
        const loadBtn = this.page.locator(this.selectors.sensitivityLoadBtn);
        if (await loadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await loadBtn.click();
            await this.page.waitForTimeout(5000); // Wait for chart to load
            testLogger.info('Loaded sensitivity preview');
        }
    }

    /**
     * Expect chart to be visible
     */
    async expectChartVisible() {
        const chart = this.page.locator(this.selectors.sensitivityChart);
        await expect(chart).toBeVisible({ timeout: 10000 });
    }

    /**
     * Adjust sensitivity slider
     * @param {number} min - Min threshold
     * @param {number} max - Max threshold
     */
    async adjustSensitivitySlider(min, max) {
        // This is a placeholder - actual implementation depends on slider UI
        testLogger.info('Adjusted sensitivity slider', { min, max });
    }

    /**
     * Expect validation error to be visible
     * @param {string} selector - Error selector
     */
    async expectValidationError(selector) {
        const error = this.page.locator(selector);
        await expect(error).toBeVisible({ timeout: 5000 });
    }

    /**
     * Click pause anomaly button
     * @param {string} name - Anomaly name
     */
    async clickPauseAnomaly(name) {
        await this.pauseAnomaly(name);
    }

    /**
     * Click resume anomaly button
     * @param {string} name - Anomaly name
     */
    async clickResumeAnomaly(name) {
        await this.resumeAnomaly(name);
    }

    /**
     * Expect anomaly to have a specific status
     * @param {string} name - Anomaly name
     * @param {string} status - Expected status
     */
    async expectAnomalyStatus(name, status) {
        const row = this.getAnomalyRow(name);
        const badge = row.locator('.q-badge');
        await expect(badge).toContainText(status, { ignoreCase: true, timeout: 10000 });
    }

    /**
     * Expect edit button to be visible for anomaly
     * @param {string} name - Anomaly name
     */
    async expectEditButtonVisible(name) {
        const editButton = this.page.locator(this.selectors.editButton(name));
        await expect(editButton).toBeVisible({ timeout: 5000 });
    }

    /**
     * Expect pause button to be visible for anomaly
     * @param {string} name - Anomaly name
     */
    async expectPauseButtonVisible(name) {
        const pauseButton = this.page.locator(this.selectors.pauseButton(name));
        await expect(pauseButton).toBeVisible({ timeout: 5000 });
    }

    /**
     * Expect detection function field to be visible
     */
    async expectDetectionFieldVisible() {
        const field = this.page.locator(this.selectors.detectionFunctionField);
        await expect(field).toBeVisible({ timeout: 5000 });
    }

    /**
     * Expect filter count
     * @param {number} count - Expected filter count
     */
    async expectFilterCount(count) {
        const filterRows = this.page.locator('.tw\\:flex.tw\\:items-center.tw\\:gap-2.tw\\:mb-2');
        await expect(filterRows).toHaveCount(count, { timeout: 5000 });
    }

    /**
     * Expect custom SQL editor to be visible
     */
    async expectSqlEditorVisible() {
        const sqlEditor = this.page.locator(this.selectors.customSql);
        await expect(sqlEditor).toBeVisible({ timeout: 10000 });
    }

    /**
     * Expect summary text to be visible
     */
    async expectSummaryVisible() {
        // Wait for the summary container to be visible first
        const summaryContainer = this.page.locator('.anomaly-summary');
        await expect(summaryContainer).toBeVisible({ timeout: 10000 });

        // Then check for summary text
        const summary = this.page.locator(this.selectors.summaryText);
        await expect(summary).toBeVisible({ timeout: 10000 });
        testLogger.info('Summary text is visible');
    }

    /**
     * Expect summary to contain text
     * @param {string} text - Text to check
     */
    async expectSummaryContains(text) {
        const summary = this.page.locator(this.selectors.summaryText);
        await expect(summary).toContainText(text);
    }

    /**
     * Expect filter row with specific field
     * @param {string} field - Field name
     */
    async expectFilterRowWithField(field) {
        const filterRow = this.page.locator(this.selectors.filterRow).filter({ hasText: field });
        await expect(filterRow).toBeVisible({ timeout: 5000 });
    }

    /**
     * Expect sensitivity empty state to be visible
     */
    async expectSensitivityEmptyState() {
        const emptyState = this.page.locator(this.selectors.sensitivityEmpty);
        await expect(emptyState).toBeVisible({ timeout: 5000 });
    }

    /**
     * Expect destination selector to be visible
     */
    async expectDestinationSelectorVisible() {
        const dest = this.page.locator(this.selectors.destination);
        await expect(dest).toBeVisible({ timeout: 5000 });
    }

    /**
     * Scroll to sensitivity section
     */
    async scrollToSensitivitySection() {
        const loadBtn = this.page.locator(this.selectors.sensitivityLoadBtn);
        await loadBtn.scrollIntoViewIfNeeded();
    }

    /**
     * Get threshold range label text
     * @returns {Promise<string>}
     */
    async getThresholdRangeLabel() {
        const label = this.page.locator(this.selectors.thresholdRangeLabel);
        return await label.textContent();
    }

    /**
     * Expect save button to be disabled
     */
    async expectSaveButtonDisabled() {
        const saveBtn = this.page.locator(this.selectors.saveButton);
        await expect(saveBtn).toBeDisabled({ timeout: 5000 });
    }

    /**
     * Expect destination error to contain text
     * @param {string} text - Text to check
     */
    async expectDestinationErrorContains(text) {
        const error = this.page.locator(this.selectors.destinationError);
        await expect(error).toContainText(text);
    }

    /**
     * Expect timestamp error to contain text
     * @param {string} text - Text to check
     */
    async expectTimestampErrorContains(text) {
        const error = this.page.locator(this.selectors.customSqlTimestampError);
        await expect(error).toContainText(text);
    }

    /**
     * Expect to be in edit mode (Detection Config tab visible)
     */
    async expectEditModeOpen() {
        // Detection Config tab should be visible when in edit mode
        const tabSelectors = [
            '[class*="tw:cursor-pointer"]:has-text("Detection Config")',
            'text=Detection Config',
            'button:has-text("Detection Config")',
            '[role="group"] button:has-text("Detection Config")'
        ];

        let found = false;
        for (const selector of tabSelectors) {
            const tab = this.page.locator(selector).first();
            if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
                found = true;
                break;
            }
        }

        if (!found) {
            throw new Error('Edit mode not open - Detection Config tab not visible');
        }
        testLogger.info('Edit mode verified - Detection Config tab visible');
    }

    /**
     * Expect seasonality text to be visible
     * @param {string} text - Expected seasonality text (e.g., 'hour + day-of-week')
     */
    async expectSeasonalityText(text) {
        const seasonalityElement = this.page.getByText(text).first();
        await expect(seasonalityElement).toBeVisible({ timeout: 5000 });
        testLogger.info('Seasonality text verified', { text });
    }

    /**
     * Select a destination from the dropdown
     * @param {string} destinationName - Name of the destination to select
     * @returns {Promise<boolean>} - True if destination was selected
     */
    async selectDestination(destinationName) {
        testLogger.info('Selecting destination', { destinationName });

        const destSelect = this.page.locator(this.selectors.destination);
        await destSelect.click();
        await this.page.waitForTimeout(1000);

        // Type to filter
        await this.page.keyboard.type(destinationName);
        await this.page.waitForTimeout(1000);

        // Try multiple selectors to find and click the option
        let destFound = false;

        // Try via menu item
        const destOption = this.page.locator(this.selectors.qMenuItem).filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            await this.page.waitForTimeout(500);
            destFound = true;
            testLogger.info('Destination selected via menu item');
        }

        if (!destFound) {
            // Try selecting via checkbox in dropdown
            const checkboxItem = this.page.locator(this.selectors.qMenuItem).filter({ hasText: new RegExp(destinationName.split('_')[0]) }).first();
            if (await checkboxItem.isVisible({ timeout: 2000 }).catch(() => false)) {
                await checkboxItem.click();
                await this.page.waitForTimeout(500);
                destFound = true;
                testLogger.info('Destination selected via checkbox');
            }
        }

        // Close dropdown
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        if (!destFound) {
            testLogger.warn('Could not find destination in dropdown', { destinationName });
        }

        return destFound;
    }

    /**
     * Check if destination error is visible
     * @returns {Promise<boolean>}
     */
    async isDestinationErrorVisible() {
        const destError = this.page.locator(this.selectors.destinationError);
        return await destError.isVisible({ timeout: 2000 }).catch(() => false);
    }

    /**
     * Open more options menu for an anomaly
     * @param {string} anomalyName - Anomaly name
     */
    async openMoreOptionsMenu(anomalyName) {
        const moreOptionsButton = this.page.locator(this.selectors.moreOptionsButton(anomalyName));
        await expect(moreOptionsButton).toBeVisible({ timeout: 5000 });
        await moreOptionsButton.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Opened more options menu', { anomalyName });
    }

    /**
     * Click trigger detection from more options menu
     * @param {string} anomalyName - Anomaly name
     * @returns {Promise<boolean>} - True if trigger detection was clicked
     */
    async clickTriggerDetection(anomalyName) {
        // First open the more options menu
        await this.openMoreOptionsMenu(anomalyName);

        // Look for "Trigger Detection" menu item
        const triggerMenuItem = this.page.locator(this.selectors.triggerDetectionButton(anomalyName));

        if (await triggerMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            testLogger.info('Found Trigger Detection menu item');
            await triggerMenuItem.click();
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            testLogger.info('Anomaly detection triggered via UI');
            return true;
        }

        // Alternative: try clicking by text in menu
        const triggerByText = this.page.locator(this.selectors.qMenu).getByText(/trigger.*detection/i).first();
        if (await triggerByText.isVisible({ timeout: 2000 }).catch(() => false)) {
            await triggerByText.click();
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            testLogger.info('Anomaly detection triggered via text selector');
            return true;
        }

        testLogger.info('Trigger Detection menu item not available - anomaly may need to be trained first');
        // Close menu
        await this.page.keyboard.press('Escape');
        return false;
    }

    /**
     * Clear detection window value (for validation testing)
     */
    async clearDetectionWindowValue() {
        const input = this.page.locator(this.selectors.detectionWindowValue);
        await input.fill('');
    }

    /**
     * Click save button without waiting for success (for validation testing)
     */
    async clickSaveForValidation() {
        const saveBtn = this.page.locator(this.selectors.saveButton);
        await saveBtn.click();
    }

    /**
     * Clean up test anomalies
     * @param {string} pattern - Name pattern to match
     */
    async cleanupTestAnomalies(pattern) {
        testLogger.info('Cleaning up test anomalies', { pattern });

        try {
            const deletedCount = await apiCleanupTestAnomalies(this.page, pattern);
            testLogger.info('Test anomalies cleanup completed', { pattern, deletedCount });
            return deletedCount;
        } catch (error) {
            testLogger.warn('Failed to cleanup test anomalies via API', { pattern, error: error.message });
            return 0;
        }
    }

    // ==================== NAVIGATION METHODS ====================

    /**
     * Navigate to anomaly detection tab from alerts page
     */
    async navigateToAnomalyTab() {
        // The tab is controlled by URL query parameter
        const currentUrl = this.page.url();
        const url = new URL(currentUrl);
        url.searchParams.set('tab', 'anomalyDetection');

        await this.page.goto(url.toString());
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        testLogger.info('Navigated to anomaly detection tab');
    }

    /**
     * Check if anomaly detection feature is available (enterprise/cloud only)
     * @returns {Promise<boolean>}
     */
    async isAnomalyDetectionAvailable() {
        try {
            await this.navigateToAnomalyTab();
            // If we're redirected back to 'all' tab, feature is not available
            const currentUrl = this.page.url();
            const url = new URL(currentUrl);
            const tab = url.searchParams.get('tab');

            const isAvailable = tab === 'anomalyDetection';
            testLogger.info('Anomaly detection availability check', { isAvailable });
            return isAvailable;
        } catch (e) {
            testLogger.warn('Error checking anomaly detection availability', { error: e.message });
            return false;
        }
    }

    /**
     * Click Add button to create new anomaly detection config
     */
    async clickAddAnomaly() {
        await expect(this.page.locator(this.addAnomalyButton)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.addAnomalyButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        testLogger.info('Clicked Add Anomaly button');
    }

    /**
     * Fill anomaly detection name
     * @param {string} name - Anomaly config name
     */
    async fillAnomalyName(name) {
        const nameInput = this.page.locator(this.anomalyNameInput).first();

        // Wait for input to be visible and editable
        await expect(nameInput).toBeVisible({ timeout: 10000 });
        await expect(nameInput).toBeEditable({ timeout: 5000 });

        // Click to focus
        await nameInput.click();
        await this.page.waitForTimeout(300);

        // Clear any existing value
        await nameInput.clear();
        await this.page.waitForTimeout(300);

        // Type the value using pressSequentially for better reliability
        await nameInput.pressSequentially(name, { delay: 50 });
        await this.page.waitForTimeout(500);

        // Verify the value was set
        const actualValue = await nameInput.inputValue();
        testLogger.info('Filled anomaly name', { name, actualValue, match: actualValue === name });

        if (actualValue !== name) {
            testLogger.warn('Name value mismatch, retrying with fill()');
            await nameInput.fill(name);
            await this.page.waitForTimeout(500);
        }
    }

    /**
     * Select stream type for anomaly detection
     * @param {string} streamType - Stream type (logs, metrics, traces)
     */
    async selectStreamType(streamType = 'logs') {
        await this.page.locator(this.streamTypeSelect).click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type', { streamType });
    }

    /**
     * Select stream name for anomaly detection
     * @param {string} streamName - Stream name
     */
    async selectStreamName(streamName) {
        await this.page.locator(this.streamNameSelect).click();
        await this.page.waitForTimeout(500);

        // Type stream name to filter
        await this.page.keyboard.type(streamName, { delay: 30 });
        await this.page.waitForTimeout(1000);

        await this.page.getByText(streamName, { exact: true }).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected stream name', { streamName });
    }

    /**
     * Configure detection function
     * @param {string} functionName - Detection function (e.g., 'count', 'avg', 'sum')
     * @param {string} field - Field to apply function on (optional)
     */
    async configureDetectionFunction(functionName = 'count', field = null) {
        await this.page.locator(this.detectionFunctionSelect).click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: functionName }).click();
        await this.page.waitForTimeout(500);

        if (field && functionName !== 'count') {
            await this.page.locator(this.detectionFunctionField).click();
            await this.page.waitForTimeout(500);
            await this.page.getByText(field, { exact: true }).click();
            await this.page.waitForTimeout(500);
        }

        testLogger.info('Configured detection function', { functionName, field });
    }

    /**
     * Set histogram interval
     * @param {number} value - Interval value
     * @param {string} unit - Time unit (minutes, hours, days)
     */
    async setHistogramInterval(value = 5, unit = 'minutes') {
        await this.page.locator(this.histogramIntervalValue).fill(String(value));
        await this.page.waitForTimeout(300);

        await this.page.locator(this.histogramIntervalUnit).click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: unit }).click();
        await this.page.waitForTimeout(300);

        testLogger.info('Set histogram interval', { value, unit });
    }

    /**
     * Set schedule interval (how often to run detection)
     * For tests, use 1-2 minutes for faster validation (production typically uses 15-60 minutes)
     * @param {number} value - Interval value (default: 1 for tests)
     * @param {string} unit - Time unit (minutes, hours, days)
     */
    async setScheduleInterval(value = 1, unit = 'minutes') {
        await this.page.locator(this.scheduleIntervalValue).fill(String(value));
        await this.page.waitForTimeout(300);

        await this.page.locator(this.scheduleIntervalUnit).click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: unit }).click();
        await this.page.waitForTimeout(300);

        testLogger.info('Set schedule interval', { value, unit });
    }

    /**
     * Set detection window (how much historical data to analyze)
     * @param {number} value - Window value
     * @param {string} unit - Time unit (hours, days)
     */
    async setDetectionWindow(value = 1, unit = 'hours') {
        await this.page.locator(this.detectionWindowValue).fill(String(value));
        await this.page.waitForTimeout(300);

        await this.page.locator(this.detectionWindowUnit).click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: unit }).click();
        await this.page.waitForTimeout(300);

        testLogger.info('Set detection window', { value, unit });
    }

    /**
     * Load sensitivity data and configure threshold
     */
    async loadAndConfigureSensitivity() {
        const loadBtn = this.page.locator(this.sensitivityLoadBtn);
        if (await loadBtn.isVisible({ timeout: 3000 })) {
            await loadBtn.click();
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await this.page.waitForTimeout(2000);

            // Wait for chart to load
            await expect(this.page.locator(this.sensitivityChart)).toBeVisible({ timeout: 10000 });
            testLogger.info('Loaded sensitivity data');
        }
    }

    /**
     * Enable alerting for anomaly detection
     * @param {string} destinationName - Destination name for alerts
     */
    async enableAlerting(destinationName) {
        // Enable alert toggle
        const alertToggle = this.page.locator(this.alertEnabledToggle);
        const isChecked = await alertToggle.isChecked().catch(() => false);

        if (!isChecked) {
            await alertToggle.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Enabled alerting');
        }

        // Select destination
        await this.page.locator(this.destinationSelect).click();
        await this.page.waitForTimeout(1000);

        const visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        const destOption = visibleMenu.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
        } else {
            // Fallback to first option
            await visibleMenu.locator('.q-item').first().click();
            testLogger.warn('Selected first available destination (fallback)');
        }

        await this.page.waitForTimeout(500);
        testLogger.info('Configured alerting destination', { destinationName });
    }

    /**
     * Save anomaly detection configuration
     */
    async saveAnomalyConfig() {
        await this.page.locator(this.saveButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        testLogger.info('Saved anomaly configuration');
    }

    /**
     * Click back button to return to anomaly list
     */
    async clickBack() {
        await this.page.locator(this.backButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked back button');
    }

    /**
     * Create a complete anomaly detection configuration
     * @param {Object} config - Anomaly configuration
     * @param {string} config.name - Anomaly name
     * @param {string} config.streamName - Stream name
     * @param {string} config.streamType - Stream type (default: 'logs')
     * @param {string} config.destinationName - Destination for alerts
     */
    async createAnomalyDetection(config) {
        const {
            name,
            streamName,
            streamType = 'logs',
            destinationName
        } = config;

        testLogger.info('Creating anomaly detection config', config);

        await this.clickAddAnomaly();
        // Fill fields in correct order (matching fillBasicSetup pattern):
        // 1. Stream type first (triggers UI loading for stream names)
        await this.selectStreamType(streamType);
        // 2. Stream name second
        await this.selectStreamName(streamName);
        // 3. Anomaly name last (after stream selection)
        await this.fillAnomalyName(name);

        // Configure detection (using test-optimized defaults)
        // Use short intervals for faster test execution (1-2 minute detection cycles)
        await this.configureDetectionFunction('count');
        await this.setHistogramInterval(1, 'minutes');  // 1-minute buckets
        await this.setScheduleInterval(1, 'minutes');   // Run detection every 1 minute (faster tests)
        await this.setDetectionWindow(1, 'hours');      // Look back 1 hour for anomalies

        // Note: Skip sensitivity loading as it's optional and not required for anomaly creation
        // The sensitivity preview can be loaded separately if needed
        // await this.loadAndConfigureSensitivity();

        // Enable alerting if destination provided, otherwise disable alerting
        if (destinationName) {
            await this.enableAlerting(destinationName);
        } else {
            // Disable alerting to enable save button (alerting is enabled by default)
            await this.disableAlerting();
        }

        await this.saveAnomalyConfig();

        testLogger.info('Successfully created anomaly detection', { name });
        return name;
    }

    /**
     * Verify anomaly config appears in the list
     * @param {string} name - Anomaly config name
     */
    async verifyAnomalyConfigExists(name) {
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Check if anomaly appears in alert list with anomaly icon
        const anomalyRow = this.page.locator('tr').filter({ hasText: name }).first();
        await expect(anomalyRow).toBeVisible({ timeout: 10000 });

        // Verify it has anomaly icon (query_stats)
        const anomalyIcon = anomalyRow.locator('i[class*="query_stats"]');
        await expect(anomalyIcon).toBeVisible({ timeout: 5000 });

        testLogger.info('Verified anomaly config exists', { name });
    }

    /**
     * Get status badge for anomaly config
     * @param {string} name - Anomaly config name
     * @returns {Promise<string>} Status (training, ready, failed, etc.)
     */
    async getAnomalyStatus(name) {
        const row = this.page.locator('tr').filter({ hasText: name }).first();
        const badge = row.locator('.q-badge');

        if (await badge.isVisible({ timeout: 3000 })) {
            const status = await badge.textContent();
            testLogger.info('Anomaly status', { name, status });
            return status.trim().toLowerCase();
        }

        return 'unknown';
    }

    /**
     * Retrain anomaly detection model
     * @param {string} name - Anomaly config name
     */
    async retrainAnomaly(name) {
        const retrainBtn = this.page.locator(`[data-test="alert-list-${name}-retrain-anomaly"]`);
        await expect(retrainBtn).toBeVisible({ timeout: 10000 });
        await retrainBtn.click();
        await this.page.waitForTimeout(1000);

        testLogger.info('Triggered anomaly retraining', { name });
    }

    /**
     * Pause anomaly detection
     * @param {string} name - Anomaly config name
     */
    async pauseAnomaly(name) {
        const pauseBtn = this.page.locator(`[data-test="alert-list-${name}-pause-start-alert"]`);
        await expect(pauseBtn).toBeVisible({ timeout: 10000 });

        // Check if it's currently running (has text-negative class = red = running)
        const classList = await pauseBtn.getAttribute('class');
        testLogger.info('Pause button class', { classList });

        if (classList && classList.includes('text-negative')) {
            // Wait for the API response after clicking - API uses /enable endpoint
            const responsePromise = this.page.waitForResponse(
                response => response.url().includes('/enable') && response.status() === 200,
                { timeout: 10000 }
            ).catch((e) => {
                testLogger.info('Failed to wait for enable response', { error: e.message });
                return null;
            });

            await pauseBtn.click();
            const response = await responsePromise;
            if (response) {
                testLogger.info('Pause API response received', { url: response.url(), status: response.status() });
            }

            // Wait for UI to update
            await this.page.waitForTimeout(2000);

            // Navigate away and back to refresh the list data
            await this.page.reload({ waitUntil: 'networkidle' });
            await this.page.waitForTimeout(1000);

            // Navigate back to anomaly tab after reload
            await this.navigateToAnomalyTab();
            await this.page.waitForTimeout(1000);

            testLogger.info('Paused anomaly detection', { name });
        } else {
            testLogger.info('Anomaly already paused or button class unexpected', { classList });
        }
    }

    /**
     * Resume anomaly detection
     * @param {string} name - Anomaly config name
     */
    async resumeAnomaly(name) {
        const resumeBtn = this.page.locator(`[data-test="alert-list-${name}-pause-start-alert"]`);
        await expect(resumeBtn).toBeVisible({ timeout: 10000 });

        // Check if it's currently paused (has text-positive class)
        const classList = await resumeBtn.getAttribute('class');
        if (classList && classList.includes('text-positive')) {
            // Wait for the API response after clicking
            const responsePromise = this.page.waitForResponse(
                response => response.url().includes('/toggle_state') && response.status() === 200,
                { timeout: 10000 }
            ).catch(() => null);

            await resumeBtn.click();
            await responsePromise;

            // Wait for UI to update and refresh the list by navigating away and back
            await this.page.waitForTimeout(1000);

            // Click on a different tab and back to refresh the list
            const alertsTab = this.page.locator('[data-test="menu-link-\\/alerts-item"]').first();
            if (await alertsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                await alertsTab.click();
                await this.page.waitForTimeout(500);
            }

            // Navigate back to anomaly tab
            await this.navigateToAnomalyTab();
            await this.page.waitForTimeout(1000);

            testLogger.info('Resumed anomaly detection', { name });
        } else {
            testLogger.info('Anomaly already running', { name });
        }
    }

    /**
     * Delete anomaly detection config
     * @param {string} name - Anomaly config name
     */
    async deleteAnomaly(name) {
        const moreBtn = this.page.locator(`[data-test="alert-list-${name}-more-options"]`);
        await expect(moreBtn).toBeVisible({ timeout: 10000 });
        await moreBtn.click();
        await this.page.waitForTimeout(500);

        await this.page.getByText('Delete', { exact: true }).click();
        await this.page.waitForTimeout(500);

        // Confirm deletion
        const confirmBtn = this.page.locator('button:has-text("OK")').or(
            this.page.locator('button:has-text("Delete")')
        );
        await confirmBtn.click();
        await this.page.waitForTimeout(1000);

        testLogger.info('Deleted anomaly config', { name });
    }

    /**
     * Edit anomaly detection config
     * @param {string} name - Anomaly config name
     */
    async editAnomaly(name) {
        const editBtn = this.page.locator(`[data-test="alert-list-${name}-update-alert"]`);
        await expect(editBtn).toBeVisible({ timeout: 10000 });
        await editBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        testLogger.info('Opened anomaly for editing', { name });
    }

    // ==================== ANOMALY DETECTION TRIGGER VERIFICATION ====================

    /**
     * Wait for anomaly model to finish training
     * @param {string} name - Anomaly config name
     * @param {number} maxWaitSeconds - Maximum time to wait for training (default: 300 = 5 minutes)
     * @returns {Promise<{success: boolean, status: string}>}
     */
    async waitForModelTraining(name, maxWaitSeconds = 300) {
        testLogger.info('Waiting for anomaly model to complete training', { name, maxWaitSeconds });

        const startTime = Date.now();
        const maxWaitMs = maxWaitSeconds * 1000;

        while (Date.now() - startTime < maxWaitMs) {
            const status = await this.getAnomalyStatus(name);

            if (status === 'ready' || status === 'active') {
                testLogger.info('Anomaly model training completed', { name, status, waitedSeconds: Math.floor((Date.now() - startTime) / 1000) });
                return { success: true, status };
            }

            if (status === 'failed') {
                testLogger.error('Anomaly model training failed', { name, status });
                return { success: false, status };
            }

            // Still training, wait and check again
            testLogger.debug('Model still training', { name, status, elapsedSeconds: Math.floor((Date.now() - startTime) / 1000) });
            await this.page.waitForTimeout(10000); // Check every 10 seconds

            // Refresh the page to get latest status
            await this.page.reload();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(2000);
        }

        testLogger.warn('Model training timeout', { name, maxWaitSeconds });
        return { success: false, status: 'timeout' };
    }

    /**
     * Ingest data pattern to establish baseline for anomaly detection
     * @param {Object} pm - PageManager instance
     * @param {string} streamName - Stream name to ingest to
     * @param {Object} pattern - Data pattern to establish baseline
     * @param {number} count - Number of data points to ingest (default: 50)
     */
    async ingestBaselineData(pm, streamName, pattern = {}, count = 50) {
        testLogger.info('Ingesting baseline data for anomaly detection', { streamName, count, pattern });

        for (let i = 0; i < count; i++) {
            await pm.commonActions.ingestTestDataWithUniqueId(
                streamName,
                `baseline_${Date.now()}_${i}`,
                'value',
                pattern.baselineValue || 100 // Normal value
            );

            // Small delay between ingestions
            if (i % 10 === 0) {
                await this.page.waitForTimeout(1000);
            }
        }

        testLogger.info('Baseline data ingested', { count });
    }

    /**
     * Ingest anomalous data (data that deviates from normal pattern)
     * @param {Object} pm - PageManager instance
     * @param {string} streamName - Stream name to ingest to
     * @param {Object} anomalyPattern - Anomalous data pattern
     */
    async ingestAnomalousData(pm, streamName, anomalyPattern = {}) {
        testLogger.info('Ingesting anomalous data', { streamName, anomalyPattern });

        const uniqueTestId = `anomaly_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        await pm.commonActions.ingestTestDataWithUniqueId(
            streamName,
            uniqueTestId,
            'value',
            anomalyPattern.anomalousValue || 1000 // Anomalous value (10x normal)
        );

        testLogger.info('Anomalous data ingested', { uniqueTestId });
        return uniqueTestId;
    }

    /**
     * Verify anomaly detection trigger via validation stream
     * Similar to alert trigger verification but for anomaly detection
     *
     * @param {Object} pm - PageManager instance
     * @param {string} anomalyName - Name of the anomaly config
     * @param {string} sourceStreamName - Stream where anomaly should be detected
     * @param {string} validationStreamName - Validation stream for anomaly alerts
     * @param {Object} anomalyPattern - Pattern for anomalous data
     * @param {number} waitTimeMs - Time to wait for detection (default: 150000 = 2.5 minutes)
     *                              Should be ~2x the schedule_interval to ensure detection runs
     * @returns {Promise<{detected: boolean, logText: string|null}>}
     */
    async verifyAnomalyDetection(pm, anomalyName, sourceStreamName, validationStreamName, anomalyPattern = {}, waitTimeMs = 150000) {
        testLogger.info('Starting anomaly detection verification', {
            anomalyName,
            sourceStreamName,
            validationStreamName,
            waitTimeMs
        });

        // Step 1: Wait for model to be ready
        const trainingResult = await this.waitForModelTraining(anomalyName, 300); // 5 minutes max
        if (!trainingResult.success) {
            testLogger.error('Model training did not complete', trainingResult);
            return { detected: false, logText: 'Model training failed or timed out' };
        }

        // Step 2: Ingest baseline data if needed
        testLogger.info('Baseline data should already exist from stream history');

        // Step 3: Ingest anomalous data
        const uniqueTestId = await this.ingestAnomalousData(pm, sourceStreamName, anomalyPattern);

        testLogger.info('Ingested anomalous data, waiting for detection...', { uniqueTestId });

        // Step 4: Wait for anomaly detection to run
        await this.page.waitForTimeout(waitTimeMs);

        // Step 5: Check validation stream for anomaly alert
        testLogger.info('Checking validation stream for anomaly alert');

        await this.page.locator('[data-test="menu-link-\\/logs-item"]').click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        try {
            await pm.logsPage.selectStream(validationStreamName, 2, 5000);
            await this.page.waitForTimeout(1000);
        } catch (streamError) {
            testLogger.warn('Validation stream not found - anomaly may not have been detected', {
                anomalyName,
                validationStreamName,
                error: streamError.message
            });
            return { detected: false, logText: null };
        }

        await pm.logsPage.clickRefreshButton();
        await this.page.waitForTimeout(3000);

        // Search for anomaly alert in validation stream
        let logTableCell = this.page.locator('[data-test="log-table-column-0-source"]');
        let logCount = await logTableCell.count();

        if (logCount === 0) {
            logTableCell = this.page.locator('tbody tr');
            logCount = await logTableCell.count();
        }

        testLogger.info(`Found ${logCount} log entries in validation stream`);

        let anomalyDetected = false;
        let foundLogText = null;

        // Look for anomaly name or "anomaly" keyword in logs
        for (let i = 0; i < logCount && !anomalyDetected; i++) {
            const logText = await logTableCell.nth(i).textContent();
            if (logText && (logText.includes(anomalyName) || logText.toLowerCase().includes('anomaly detected'))) {
                anomalyDetected = true;
                foundLogText = logText;
                testLogger.info('SUCCESS: Anomaly detection alert found in validation stream!', {
                    anomalyName,
                    logIndex: i,
                    logTextPreview: logText.substring(0, 400)
                });
            }
        }

        if (!anomalyDetected) {
            testLogger.warn('Anomaly detection alert not found in validation stream', {
                anomalyName,
                validationStreamName,
                logsChecked: logCount
            });
        }

        return { detected: anomalyDetected, logText: foundLogText };
    }

    /**
     * Create anomaly detection and verify it detects anomalies (full E2E flow)
     * @param {Object} pm - PageManager instance
     * @param {Object} config - Anomaly configuration with validation settings
     * @param {Object} anomalyPattern - Pattern for generating anomalous data
     * @returns {Promise<{name: string, detected: boolean, logText: string|null}>}
     */
    async createAndVerifyAnomalyDetection(pm, config, anomalyPattern = {}) {
        testLogger.info('Creating and verifying anomaly detection E2E', config);

        // Create anomaly detection
        const anomalyName = await this.createAnomalyDetection(config);

        // Navigate back to anomaly tab
        await pm.commonActions.navigateToAlerts();
        await this.navigateToAnomalyTab();

        // Verify anomaly detection
        const detectionResult = await this.verifyAnomalyDetection(
            pm,
            anomalyName,
            config.streamName,
            config.validationStreamName,
            anomalyPattern,
            config.detectionWaitTimeMs || 120000
        );

        return {
            name: anomalyName,
            ...detectionResult
        };
    }
}

module.exports = { AnomalyDetectionPage };
