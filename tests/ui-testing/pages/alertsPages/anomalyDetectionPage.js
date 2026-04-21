/**
 * AnomalyDetectionPage - Page object for Anomaly Detection alerts
 *
 * This module handles all anomaly detection-specific operations:
 * - Creating anomaly detection alerts (Builder and SQL modes)
 * - Managing existing anomaly configs (edit, pause, resume, delete)
 * - Training operations (trigger, retry, cancel)
 * - Sensitivity configuration and preview
 * - Alert destination setup
 *
 * NOTE: Anomaly detection uses the same wizard container as regular alerts (AddAlert.vue)
 * but with specialized tabs and configuration options.
 */

import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class AnomalyDetectionPage {
    constructor(page, commonActions, locators) {
        this.page = page;
        this.commonActions = commonActions;
        this.locators = locators;
        this.currentAnomalyName = '';
    }

    // ========== LOCATORS (VERIFIED from source code) ==========

    get selectors() {
        return {
            // List view
            anomalyListTable: '[data-test="anomaly-detection-list-table"]',
            alertsTable: 'table, .q-table, [data-test="alert-list-table"]',
            anomalyRow: (name) => `tr:has-text("${name}")`,

            // Shared wizard selectors (from AddAlert.vue)
            backButton: '[data-test="add-alert-back-btn"]',
            streamTypeDropdown: '[data-test="add-alert-stream-type-select-dropdown"]',
            streamNameDropdown: '[data-test="add-alert-stream-name-select-dropdown"]',
            saveButton: '[data-test="add-alert-submit-btn"]', // Shows "Save & Train" or "Save"

            // Config tab - Query mode
            queryTabs: '[data-test="anomaly-query-tabs"]',

            // Config tab - Builder mode
            detectionFunction: '[data-test="anomaly-detection-function"]',
            detectionFunctionField: '[data-test="anomaly-detection-function-field"]',
            histogramIntervalValue: '[data-test="anomaly-histogram-interval-value"]',
            histogramIntervalUnit: '[data-test="anomaly-histogram-interval-unit"]',

            // Config tab - Schedule
            scheduleIntervalValue: '[data-test="anomaly-schedule-interval-value"]',
            scheduleIntervalUnit: '[data-test="anomaly-schedule-interval-unit"]',
            detectionWindowValue: '[data-test="anomaly-detection-window-value"]',
            detectionWindowUnit: '[data-test="anomaly-detection-window-unit"]',
            detectionWindowError: '[data-test="anomaly-detection-window-error"]',

            // Config tab - Training
            trainingWindow: '[data-test="anomaly-training-window"]',
            retrainInterval: '[data-test="anomaly-retrain-interval"]',

            // Config tab - Sensitivity
            thresholdRange: '[data-test="anomaly-threshold-range"]',
            thresholdRangeLabel: '[data-test="anomaly-threshold-range-label"]',
            sensitivityLoadBtn: '[data-test="anomaly-sensitivity-load-btn"]',
            sensitivityChart: '[data-test="anomaly-sensitivity-chart"]',
            sensitivityEmpty: '[data-test="anomaly-sensitivity-empty"]',

            // Config tab - SQL mode
            customSql: '[data-test="anomaly-custom-sql"]',
            customSqlTimestampError: '[data-test="anomaly-custom-sql-timestamp-alias-error"]',

            // Alerting tab
            alertEnabled: '[data-test="anomaly-alert-enabled"]',
            destination: '[data-test="anomaly-destination"]',
            destinationError: '[data-test="anomaly-destination-error"]',
            refreshDestinationsBtn: '.iconHoverBtn',
            alertToggleLabel: '.q-toggle__label',

            // Summary tab
            summaryScrollBtn: '[data-test="anomaly-summary-scroll-btn"]',
            summaryText: '.summary-text',

            // List operations - dynamic selectors
            editButton: (name) => `[data-test="alert-list-${name}-update-alert"]`,
            pauseButton: (name) => `[data-test="alert-list-${name}-pause-start-alert"]`,
            moreOptionsButton: (name) => `[data-test="alert-list-${name}-more-options"]`,
            triggerDetectionButton: (name) => `[data-test="alert-list-${name}-trigger-detection"]`,

            // Menu and dialog selectors
            qMenu: '.q-menu',
            qMenuItem: '.q-menu .q-item',
            qDialog: '.q-dialog',
            qToggle: '.q-toggle',
            qBadge: '.q-badge',

            // Filter row
            filterRow: '.alert-settings-row',
        };
    }

    // ========== NAVIGATION ==========

    /**
     * Navigate to anomaly detection list page
     * Anomaly detections are shown in the main alerts list page
     * They can be identified by their alert_type = 'anomaly'
     */
    async navigateToAnomalyList() {
        testLogger.info('Navigating to anomaly detection list (alerts page)');

        // Get org from environment
        const org = process.env.ORGNAME;
        if (!org) {
            throw new Error('ORGNAME environment variable is required for navigation');
        }

        // Navigate to alerts page - anomaly detections appear in the same list
        await this.page.goto(`/web/alerts/?org_identifier=${org}`);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Wait for alerts table to be visible
        await this.page.locator(this.selectors.alertsTable).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

        testLogger.info('Navigated to alerts list page');
    }

    /**
     * Click to start creating a new anomaly detection alert
     */
    async clickNewAnomaly() {
        testLogger.info('Starting new anomaly creation');
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    // ========== BASIC SETUP ==========

    /**
     * Fill basic anomaly detection info (name, stream type, stream name)
     * @param {string} name - Anomaly name
     * @param {string} streamType - Stream type ('logs', 'metrics', 'traces')
     * @param {string} streamName - Stream name
     */
    async fillBasicSetup(name, streamType, streamName) {
        testLogger.info('Filling basic anomaly setup', { name, streamType, streamName });
        this.currentAnomalyName = name;

        // Step 1: Select stream type first
        testLogger.info('Selecting stream type', { streamType });
        await this.page.locator(this.selectors.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: streamType })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: streamType }).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Step 2: Select stream name
        await this.selectStreamByName(streamName);

        // Step 3: Select "Anomaly Detection" as alert type
        // This will switch the UI to anomaly mode
        testLogger.info('Selecting Anomaly Detection alert type');

        // Find the alert type dropdown - it's in a div with "Alert Type" label
        // The dropdown shows current value (default: "Scheduled")
        const alertTypeContainer = this.page.locator('div').filter({ hasText: /^Alert Type/ }).first();
        await expect(alertTypeContainer).toBeVisible({ timeout: 5000 });

        // Click on the dropdown (it's a q-select showing "Scheduled" by default)
        const alertTypeSelect = alertTypeContainer.locator('.q-select, .alert-v3-field').first();
        await alertTypeSelect.click();
        await this.page.waitForTimeout(500);

        // Wait for dropdown menu to appear and select "Anomalies"
        // The option text is "Anomalies" (not "Anomaly Detection")
        const anomalyOption = this.page.locator('.q-menu .q-item').filter({ hasText: /anomalies/i }).first();
        await expect(anomalyOption).toBeVisible({ timeout: 5000 });

        await anomalyOption.click();
        await this.page.waitForTimeout(1000);

        // Step 4: Now fill the anomaly name (the input appears after selecting anomaly type)
        testLogger.info('Filling anomaly name', { name });
        const nameInput = this.page.locator('input[placeholder="Anomaly name"]');
        await expect(nameInput).toBeVisible({ timeout: 10000 });
        await nameInput.click();
        await nameInput.fill(name);
    }

    /**
     * Select stream from dropdown with keyboard filtering
     * (Reused from AlertCreationWizard pattern)
     */
    async selectStreamByName(streamName) {
        testLogger.info('Selecting stream', { streamName });

        await expect(this.page.locator(this.selectors.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.selectors.streamNameDropdown).click();
        await this.page.waitForTimeout(500);

        // Filter by typing
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.type(streamName, { delay: 30 });
        await this.page.waitForTimeout(1500);

        const streamOption = this.page.getByText(streamName, { exact: true });
        await expect(streamOption).toBeVisible({ timeout: 5000 });
        await streamOption.click();
        await this.page.waitForTimeout(500);
    }

    // ========== CONFIGURATION TAB ==========

    /**
     * Switch between Builder and SQL query modes
     * @param {'builder'|'sql'} mode - Query mode
     */
    async selectQueryMode(mode) {
        testLogger.info('Selecting query mode', { mode });
        const tabText = mode === 'builder' ? 'Builder' : 'SQL';
        await this.page.locator(this.selectors.queryTabs).getByText(tabText).click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Configure detection in Builder mode
     * @param {Object} config - Detection configuration
     * @param {string} config.function - Detection function (count, avg, sum, min, max, p50, p95, p99)
     * @param {string} [config.field] - Field to aggregate (required if function != 'count')
     * @param {Object} [config.filters] - Array of filters [{field, operator, value}]
     */
    async configureBuilderMode(config) {
        testLogger.info('Configuring builder mode', { config });

        // Add filters if provided
        if (config.filters && config.filters.length > 0) {
            for (const filter of config.filters) {
                await this.addFilter(filter.field, filter.operator, filter.value);
            }
        }

        // Select detection function
        await this.page.locator(this.selectors.detectionFunction).click();
        await this.page.getByRole('option', { name: config.function }).click();
        await this.page.waitForTimeout(300);

        // Select field if needed (not for 'count')
        if (config.function !== 'count' && config.field) {
            await expect(this.page.locator(this.selectors.detectionFunctionField)).toBeVisible();
            await this.page.locator(this.selectors.detectionFunctionField).click();
            await this.page.keyboard.type(config.field);
            await this.page.waitForTimeout(500);
            await this.page.getByText(config.field, { exact: true }).click();
        }
    }

    /**
     * Add a filter in builder mode
     * @param {string} field - Field name
     * @param {string} operator - Operator (=, !=, >, <, contains, etc.)
     * @param {string} value - Filter value
     */
    async addFilter(field, operator, value) {
        testLogger.info('Adding filter', { field, operator, value });

        // Click "Add filter" button
        await this.page.getByRole('button', { name: /add filter/i }).click();
        await this.page.waitForTimeout(500);

        // Get the last filter row - filters are in a flex container with q-select elements
        const filterRows = this.page.locator('.tw\\:flex.tw\\:items-center.tw\\:gap-2.tw\\:mb-2');
        const lastRow = filterRows.last();

        // Select field - first q-select in the row
        const fieldSelect = lastRow.locator('.q-select').first();
        await expect(fieldSelect).toBeVisible({ timeout: 5000 });
        await fieldSelect.click();
        await this.page.waitForTimeout(300);
        await this.page.keyboard.type(field);
        await this.page.waitForTimeout(500);
        await this.page.getByText(field, { exact: true }).first().click();
        await this.page.waitForTimeout(300);

        // Select operator - second q-select in the row
        const operatorSelect = lastRow.locator('.q-select').nth(1);
        await operatorSelect.click();
        await this.page.waitForTimeout(300);
        await this.page.getByText(operator, { exact: true }).first().click();
        await this.page.waitForTimeout(300);

        // Enter value if operator needs it
        if (!['is null', 'is not null'].includes(operator)) {
            const valueInput = lastRow.locator('input').last();
            await valueInput.fill(value);
        }
    }

    /**
     * Set SQL query in SQL mode
     * @param {string} sql - SQL query
     */
    async setSqlQuery(sql) {
        testLogger.info('Setting SQL query');
        // Monaco editor requires special handling
        const editor = this.page.locator(this.selectors.customSql);
        await expect(editor).toBeVisible({ timeout: 5000 });

        // Click to focus
        await editor.click();
        await this.page.waitForTimeout(500);

        // Clear existing
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Delete');
        await this.page.waitForTimeout(300);

        // Type new query
        await this.page.keyboard.type(sql, { delay: 10 });
        await this.page.waitForTimeout(500);
    }

    /**
     * Configure detection resolution (histogram interval)
     * @param {number} value - Interval value
     * @param {'m'|'h'} unit - Interval unit (minutes or hours)
     */
    async setDetectionResolution(value, unit) {
        testLogger.info('Setting detection resolution', { value, unit });

        await this.page.locator(this.selectors.histogramIntervalValue).fill(value.toString());

        // Close any open menus first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);

        await this.page.locator(this.selectors.histogramIntervalUnit).click();
        await this.page.waitForTimeout(200);
        const unitText = unit === 'm' ? 'Minutes' : 'Hours';
        await this.page.getByRole('option', { name: unitText }).first().click();
    }

    /**
     * Configure check every interval
     * @param {number} value - Interval value
     * @param {'m'|'h'} unit - Interval unit
     */
    async setCheckEvery(value, unit) {
        testLogger.info('Setting check every interval', { value, unit });

        await this.page.locator(this.selectors.scheduleIntervalValue).fill(value.toString());

        // Close any open menus first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);

        await this.page.locator(this.selectors.scheduleIntervalUnit).click();
        await this.page.waitForTimeout(200);
        const unitText = unit === 'm' ? 'Minutes' : 'Hours';
        await this.page.getByRole('option', { name: unitText }).first().click();
    }

    /**
     * Configure look back window
     * @param {number} value - Window value
     * @param {'m'|'h'} unit - Window unit
     */
    async setLookBackWindow(value, unit) {
        testLogger.info('Setting look back window', { value, unit });

        await this.page.locator(this.selectors.detectionWindowValue).fill(value.toString());

        // Close any open menus first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);

        await this.page.locator(this.selectors.detectionWindowUnit).click();
        await this.page.waitForTimeout(200);
        const unitText = unit === 'm' ? 'Minutes' : 'Hours';
        await this.page.getByRole('option', { name: unitText }).first().click();
    }

    /**
     * Set training window in days
     * @param {number} days - Number of days (>= 1)
     */
    async setTrainingWindow(days) {
        testLogger.info('Setting training window', { days });
        await this.page.locator(this.selectors.trainingWindow).fill(days.toString());
    }

    /**
     * Set retrain interval
     * @param {string} interval - Interval option ('Never', '1 day', '7 days', '14 days')
     */
    async setRetrainInterval(interval) {
        testLogger.info('Setting retrain interval', { interval });
        await this.page.locator(this.selectors.retrainInterval).click();
        await this.page.getByRole('option', { name: interval }).click();
    }

    /**
     * Load sensitivity preview chart
     */
    async loadSensitivityPreview() {
        testLogger.info('Loading sensitivity preview');
        await expect(this.page.locator(this.selectors.sensitivityLoadBtn)).toBeEnabled({ timeout: 5000 });
        await this.page.locator(this.selectors.sensitivityLoadBtn).click();

        // Wait for chart to load
        await this.page.waitForTimeout(2000);
        await expect(this.page.locator(this.selectors.sensitivityChart)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Adjust sensitivity slider
     * @param {number} min - Minimum threshold (0-100)
     * @param {number} max - Maximum threshold (0-100)
     */
    async adjustSensitivitySlider(min, max) {
        testLogger.info('Adjusting sensitivity slider', { min, max });

        // Q-range vertical slider requires special interaction
        // The slider has two handles that need to be dragged
        const slider = this.page.locator(this.selectors.thresholdRange);
        await expect(slider).toBeVisible();

        // Get slider bounds
        const sliderBox = await slider.boundingBox();

        // Calculate RELATIVE positions for dragTo (vertical slider, 0 at bottom, 100 at top)
        // For vertical slider: Y=0 is top (100%), Y=height is bottom (0%)
        // So to set value V%: relativeY = height * (1 - V/100)
        const minRelativeY = sliderBox.height * (1 - min / 100);
        const maxRelativeY = sliderBox.height * (1 - max / 100);
        const centerX = sliderBox.width / 2;

        // Drag handles
        const handles = slider.locator('.q-slider__thumb');

        // Bottom handle (min) - drag to min position
        const bottomHandle = handles.first();
        await bottomHandle.dragTo(slider, { targetPosition: { x: centerX, y: minRelativeY } });

        // Top handle (max) - drag to max position
        const topHandle = handles.last();
        await topHandle.dragTo(slider, { targetPosition: { x: centerX, y: maxRelativeY } });

        await this.page.waitForTimeout(500);

        // Verify label updated
        const label = await this.page.locator(this.selectors.thresholdRangeLabel).textContent();
        testLogger.info('Sensitivity range updated', { label });
    }

    // ========== ALERTING TAB ==========

    /**
     * Toggle notifications on/off
     * @param {boolean} enabled - Enable or disable notifications
     */
    async toggleNotifications(enabled) {
        testLogger.info('Toggling notifications', { enabled });

        const toggle = this.page.locator(this.selectors.alertEnabled);
        const currentState = await toggle.getAttribute('aria-checked') === 'true';

        if (currentState !== enabled) {
            await toggle.click();
            await this.page.waitForTimeout(500);
        }
    }

    /**
     * Select alert destinations
     * @param {string[]} destinations - Array of destination names
     */
    async selectDestinations(destinations) {
        testLogger.info('Selecting destinations', { destinations });

        await expect(this.page.locator(this.selectors.destination)).toBeVisible({ timeout: 5000 });

        for (const dest of destinations) {
            await this.page.locator(this.selectors.destination).click();
            await this.page.waitForTimeout(300);

            // Find and click the destination checkbox
            const destOption = this.page.locator('.q-item').filter({ hasText: dest }).first();
            await expect(destOption).toBeVisible({ timeout: 3000 });
            await destOption.click();

            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(300);
        }
    }

    /**
     * Click refresh destinations button
     */
    async refreshDestinations() {
        testLogger.info('Refreshing destinations');
        await this.page.getByRole('button', { name: 'Refresh destinations' }).click();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click "Add New Destination" button (opens new tab)
     */
    async clickAddNewDestination() {
        testLogger.info('Clicking add new destination');
        await this.page.getByRole('button', { name: 'Add New Destination' }).click();
        // Don't wait - new tab opens
    }

    /**
     * Disable alerting to allow saving without destination
     * Alerting is enabled by default, and requires a destination to save
     */
    async disableAlerting() {
        testLogger.info('Disabling alerting to allow save');

        // Close any open menus first
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        // Click Alerting tab
        const alertingTab = this.page.locator('div').filter({ hasText: /^Alerting/ }).first();
        await expect(alertingTab).toBeVisible({ timeout: 5000 });
        await alertingTab.click();
        await this.page.waitForTimeout(1000);

        // Find and toggle off the alert enabled switch
        const alertToggle = this.page.locator('[data-test="anomaly-alert-enabled"]');
        if (await alertToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
            await alertToggle.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Alerting disabled');
        } else {
            // Try alternative selector
            const toggleInner = this.page.locator('.q-toggle').filter({ hasText: /enabled/i }).first();
            if (await toggleInner.isVisible({ timeout: 2000 }).catch(() => false)) {
                await toggleInner.click();
                await this.page.waitForTimeout(500);
                testLogger.info('Alerting disabled via alternative selector');
            }
        }
    }

    // ========== NAVIGATION BETWEEN TABS ==========

    /**
     * Click tab by name
     * @param {'Detection Config'|'Alerting'|'Summary'} tabName - Tab name
     * Note: In anomaly mode, tabs are "Detection Config" and "Alerting"
     */
    async clickTab(tabName) {
        testLogger.info('Clicking tab', { tabName });

        // Wait for the tabs container to be ready first
        await this.page.waitForTimeout(1000);

        // Anomaly mode uses custom tab divs, not role="tab" elements
        // First, wait for the alert-v3-tabs container to be visible
        const tabsContainer = this.page.locator('.alert-v3-tabs');
        await expect(tabsContainer).toBeVisible({ timeout: 10000 });

        // Try multiple strategies to find the tab
        let tabElement = this.page.locator('.alert-v3-tabs div').filter({ hasText: new RegExp(`^${tabName}\\s*\\*?$`, 'i') }).first();

        if (!await tabElement.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Fallback: look for any clickable element with the tab text (with optional * for required)
            tabElement = this.page.getByText(new RegExp(`^${tabName}\\s*\\*?$`, 'i')).first();
        }

        if (!await tabElement.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Second fallback: exact text match
            tabElement = this.page.getByText(tabName, { exact: true }).first();
        }

        await expect(tabElement).toBeVisible({ timeout: 5000 });
        await tabElement.click();
        await this.page.waitForTimeout(500);
    }

    // ========== SAVE ==========

    /**
     * Click Save & Train button (create mode) or Save button (edit mode)
     */
    async clickSave() {
        testLogger.info('Clicking save button');

        // Check if save button is enabled before clicking
        const saveBtn = this.page.locator(this.selectors.saveButton);
        await expect(saveBtn).toBeEnabled({ timeout: 5000 });
        await saveBtn.click();
        await this.page.waitForTimeout(1000);

        // Wait for redirect to list or check for error message
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await this.page.waitForTimeout(3000);

        // Check if we're back on the list page (should see the alerts table)
        const alertsTable = this.page.locator('table, .q-table, [data-test="alert-list-table"]').first();
        if (!await alertsTable.isVisible({ timeout: 5000 }).catch(() => false)) {
            testLogger.warn('May not be on alerts list page after save');
            // Take screenshot for debugging
            await this.page.screenshot({ path: 'test-logs/anomaly-after-save.png', fullPage: true }).catch(() => {});
        }
    }

    /**
     * Click back button to cancel and return to list
     */
    async clickBack() {
        testLogger.info('Clicking back button');
        await this.page.locator(this.selectors.backButton).click();
        await this.page.waitForTimeout(1000);
    }

    // ========== LIST OPERATIONS ==========

    /**
     * Get anomaly row from list by name
     * @param {string} name - Anomaly name
     * @returns {Locator} Row locator
     */
    getAnomalyRow(name) {
        return this.page.locator(`tr:has-text("${name}")`).first();
    }

    /**
     * Click edit button for anomaly
     * @param {string} name - Anomaly name
     */
    async clickEditAnomaly(name) {
        testLogger.info('Clicking edit anomaly', { name });
        const row = this.getAnomalyRow(name);
        await row.locator('button[title="Edit"]').click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click pause button for anomaly
     * @param {string} name - Anomaly name
     */
    async clickPauseAnomaly(name) {
        testLogger.info('Clicking pause anomaly', { name });
        const row = this.getAnomalyRow(name);
        await row.locator('button[title="Pause"]').click();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click resume button for anomaly
     * @param {string} name - Anomaly name
     */
    async clickResumeAnomaly(name) {
        testLogger.info('Clicking resume anomaly', { name });
        const row = this.getAnomalyRow(name);
        await row.locator('button[title="Resume"]').click();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click retrain button for anomaly
     * @param {string} name - Anomaly name
     */
    async clickRetrainAnomaly(name) {
        testLogger.info('Clicking retrain anomaly', { name });
        const row = this.getAnomalyRow(name);
        await row.locator('button[title*="Training"]').click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Confirm retrain in dialog
     */
    async confirmRetrain() {
        testLogger.info('Confirming retrain');
        await this.page.getByRole('button', { name: 'Trigger Training' }).click();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Confirm retry training in dialog
     */
    async confirmRetryTraining() {
        testLogger.info('Confirming retry training');
        await this.page.getByRole('button', { name: 'Retry Training' }).click();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click stop training button for anomaly
     * @param {string} name - Anomaly name
     */
    async clickStopTraining(name) {
        testLogger.info('Clicking stop training', { name });
        const row = this.getAnomalyRow(name);
        await row.locator('button[title="Stop Training"]').click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Confirm stop training in dialog
     */
    async confirmStopTraining() {
        testLogger.info('Confirming stop training');
        await this.page.getByRole('button', { name: 'Stop Training' }).click();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Click delete button for anomaly
     * @param {string} name - Anomaly name
     */
    async clickDeleteAnomaly(name) {
        testLogger.info('Clicking delete anomaly', { name });
        const row = this.getAnomalyRow(name);
        await row.locator('button[title="Delete"]').click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Confirm delete in dialog
     */
    async confirmDelete() {
        testLogger.info('Confirming delete');
        await this.page.getByRole('button', { name: 'Delete' }).last().click();
        await this.page.waitForTimeout(1000);
    }

    // ========== ASSERTIONS ==========

    /**
     * Verify anomaly appears in list
     * @param {string} name - Anomaly name
     */
    async expectAnomalyInList(name) {
        testLogger.info('Verifying anomaly in list', { name });
        const row = this.getAnomalyRow(name);
        await expect(row).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify anomaly status
     * @param {string} name - Anomaly name
     * @param {string} status - Expected status (ready, training, failed, waiting, disabled)
     */
    async expectAnomalyStatus(name, status) {
        testLogger.info('Verifying anomaly status', { name, status });
        const row = this.getAnomalyRow(name);
        const badge = row.locator('.q-badge');
        await expect(badge).toContainText(status, { ignoreCase: true, timeout: 10000 });
    }

    /**
     * Verify validation error visible
     * @param {string} selector - Error selector
     */
    async expectValidationError(selector) {
        testLogger.info('Verifying validation error', { selector });
        await expect(this.page.locator(selector)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify sensitivity chart visible
     */
    async expectChartVisible() {
        testLogger.info('Verifying chart visible');
        await expect(this.page.locator(this.selectors.sensitivityChart)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify anomaly list table visible
     */
    async expectListTableVisible() {
        testLogger.info('Verifying list table visible');
        await expect(this.page.locator(this.selectors.anomalyListTable)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify anomaly NOT in list
     * @param {string} name - Anomaly name
     */
    async expectAnomalyNotInList(name) {
        testLogger.info('Verifying anomaly not in list', { name });
        const row = this.getAnomalyRow(name);
        await expect(row).not.toBeVisible({ timeout: 5000 });
    }

    // ========== API CLEANUP HELPERS ==========

    /**
     * Delete anomaly via API (for test cleanup)
     * @param {string} anomalyId - Anomaly ID to delete
     * @param {Object} config - API configuration { baseUrl, email, password, org }
     * @returns {Promise<boolean>} - True if deleted successfully
     */
    async deleteAnomalyViaApi(anomalyId, config) {
        testLogger.info('Deleting anomaly via API', { anomalyId });

        const authToken = Buffer.from(`${config.email}:${config.password}`).toString('base64');

        const result = await this.page.evaluate(async ({ url, authToken }) => {
            try {
                const resp = await fetch(url, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Basic ${authToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                return { status: resp.status, ok: resp.ok };
            } catch (e) {
                return { status: 0, ok: false, error: e.message };
            }
        }, {
            url: `${config.baseUrl}/api/${config.org}/anomaly_detection/${anomalyId}`,
            authToken
        });

        testLogger.info('Delete anomaly response', { anomalyId, status: result.status });
        return result.ok || result.status === 404; // 404 means already deleted
    }

    /**
     * List anomalies via API (for finding test anomalies to clean up)
     * @param {Object} config - API configuration { baseUrl, email, password, org }
     * @returns {Promise<Array>} - Array of anomaly objects
     */
    async listAnomaliesViaApi(config) {
        testLogger.info('Listing anomalies via API');

        const authToken = Buffer.from(`${config.email}:${config.password}`).toString('base64');

        const result = await this.page.evaluate(async ({ url, authToken }) => {
            try {
                const resp = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${authToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await resp.json().catch(() => ({}));
                return { status: resp.status, data };
            } catch (e) {
                return { status: 0, data: [], error: e.message };
            }
        }, {
            url: `${config.baseUrl}/api/${config.org}/anomaly_detection`,
            authToken
        });

        return result.data?.configs || result.data || [];
    }

    /**
     * Clean up test anomalies by name pattern
     * @param {string} namePattern - Pattern to match (e.g., 'E2E_Anomaly')
     * @param {Object} config - API configuration { baseUrl, email, password, org }
     */
    async cleanupTestAnomalies(namePattern, config) {
        testLogger.info('Cleaning up test anomalies', { namePattern });

        const anomalies = await this.listAnomaliesViaApi(config);
        const testAnomalies = anomalies.filter(a => a.name && a.name.includes(namePattern));

        testLogger.info(`Found ${testAnomalies.length} test anomalies to clean up`);

        for (const anomaly of testAnomalies) {
            const id = anomaly.anomaly_id || anomaly.id;
            if (id) {
                await this.deleteAnomalyViaApi(id, config);
            }
        }
    }

    // ========== COMPLETE WORKFLOWS ==========

    /**
     * Create a complete anomaly detection alert (Builder mode)
     * @param {Object} config - Full configuration
     * @param {string} config.name - Anomaly name
     * @param {string} config.streamType - Stream type
     * @param {string} config.streamName - Stream name
     * @param {Object} config.detection - Detection config
     * @param {Object} config.schedule - Schedule config
     * @param {Object} config.training - Training config
     * @param {Object} [config.alerting] - Alerting config
     */
    async createAnomalyDetection(config) {
        testLogger.info('Creating complete anomaly detection', { config });

        // Step 1: Basic setup
        await this.fillBasicSetup(config.name, config.streamType, config.streamName);

        // Step 2: Configure detection
        await this.clickTab('Detection Config');

        if (config.detection.mode === 'builder') {
            await this.selectQueryMode('builder');
            await this.configureBuilderMode(config.detection);
        } else {
            await this.selectQueryMode('sql');
            await this.setSqlQuery(config.detection.sql);
        }

        // Set intervals
        await this.setDetectionResolution(config.schedule.resolution.value, config.schedule.resolution.unit);
        await this.setCheckEvery(config.schedule.checkEvery.value, config.schedule.checkEvery.unit);
        await this.setLookBackWindow(config.schedule.lookBack.value, config.schedule.lookBack.unit);

        // Set training
        await this.setTrainingWindow(config.training.window);
        await this.setRetrainInterval(config.training.retrain);

        // Sensitivity (optional)
        if (config.sensitivity) {
            await this.loadSensitivityPreview();
            if (config.sensitivity.min !== undefined && config.sensitivity.max !== undefined) {
                await this.adjustSensitivitySlider(config.sensitivity.min, config.sensitivity.max);
            }
        }

        // Step 3: Alerting (optional)
        if (config.alerting && config.alerting.enabled) {
            await this.clickTab('Alerting');
            await this.toggleNotifications(true);
            await this.selectDestinations(config.alerting.destinations);
        }

        // Step 4: Save
        await this.clickSave();
    }
}
