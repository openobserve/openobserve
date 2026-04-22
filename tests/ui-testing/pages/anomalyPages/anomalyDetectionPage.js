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

class AnomalyDetectionPage {
    constructor(page, commonActions) {
        this.page = page;
        this.commonActions = commonActions;

        // Selectors
        this.addAnomalyButton = '[data-test="alert-list-add-alert-btn"]';
        this.anomalyTable = '[data-test="anomaly-detection-list-table"]';
        this.alertTable = '[data-test="alert-list-table"]';

        // Tab/Navigation
        this.anomalyDetectionTab = 'anomalyDetection'; // tab value

        // Anomaly config form selectors
        this.anomalyNameInput = 'input[placeholder="Anomaly name"]';
        this.streamTypeSelect = '[data-test="add-alert-stream-type-select-dropdown"]';
        this.streamNameSelect = '[data-test="add-alert-stream-name-select-dropdown"]';

        // Detection config selectors
        this.detectionFunctionSelect = '[data-test="anomaly-detection-function"]';
        this.detectionFunctionField = '[data-test="anomaly-detection-function-field"]';
        this.histogramIntervalValue = '[data-test="anomaly-histogram-interval-value"]';
        this.histogramIntervalUnit = '[data-test="anomaly-histogram-interval-unit"]';
        this.scheduleIntervalValue = '[data-test="anomaly-schedule-interval-value"]';
        this.scheduleIntervalUnit = '[data-test="anomaly-schedule-interval-unit"]';
        this.detectionWindowValue = '[data-test="anomaly-detection-window-value"]';
        this.detectionWindowUnit = '[data-test="anomaly-detection-window-unit"]';
        this.trainingWindow = '[data-test="anomaly-training-window"]';
        this.retrainInterval = '[data-test="anomaly-retrain-interval"]';
        this.sensitivityLoadBtn = '[data-test="anomaly-sensitivity-load-btn"]';
        this.sensitivityChart = '[data-test="anomaly-sensitivity-chart"]';
        this.thresholdRange = '[data-test="anomaly-threshold-range"]';

        // Alerting selectors
        this.alertEnabledToggle = '[data-test="anomaly-alert-enabled"]';
        this.destinationSelect = '[data-test="anomaly-destination"]';

        // Action buttons
        this.backButton = '[data-test="add-alert-back-btn"]';
        this.saveButton = 'button:has-text("Save")';
        this.cancelButton = 'button:has-text("Cancel")';
    }

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
        await expect(this.page.locator(this.anomalyNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.anomalyNameInput).click();
        await this.page.locator(this.anomalyNameInput).fill(name);
        testLogger.info('Filled anomaly name', { name });
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
        await this.fillAnomalyName(name);
        await this.selectStreamType(streamType);
        await this.selectStreamName(streamName);

        // Configure detection (using test-optimized defaults)
        // Use short intervals for faster test execution (1-2 minute detection cycles)
        await this.configureDetectionFunction('count');
        await this.setHistogramInterval(1, 'minutes');  // 1-minute buckets
        await this.setScheduleInterval(1, 'minutes');   // Run detection every 1 minute (faster tests)
        await this.setDetectionWindow(1, 'hours');      // Look back 1 hour for anomalies

        // Load sensitivity and configure threshold
        await this.loadAndConfigureSensitivity();

        // Enable alerting
        if (destinationName) {
            await this.enableAlerting(destinationName);
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
        const anomalyRow = this.page.locator(`tr:has-text("${name}")`).first();
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
        const row = this.page.locator(`tr:has-text("${name}")`).first();
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

        // Check if it's currently running (has text-negative class)
        const classList = await pauseBtn.getAttribute('class');
        if (classList && classList.includes('text-negative')) {
            await pauseBtn.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Paused anomaly detection', { name });
        } else {
            testLogger.info('Anomaly already paused', { name });
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
            await resumeBtn.click();
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
