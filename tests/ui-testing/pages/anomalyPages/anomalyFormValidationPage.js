// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');

class AnomalyFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ─────────────────────────────────────────────────────
        this.alertsMenuLink = '[data-test="menu-link-\\/alerts-item"]';
        this.anomalyDetectionTab = '[data-test="tab-anomalyDetection"]';

        // ── Anomaly list ───────────────────────────────────────────────────
        this.addAnomalyBtn = '[data-test="alert-list-add-alert-btn"]';
        this.anomalyTable  = '[data-test="anomaly-detection-list-table"]';

        // ── Step 1 — stream selection ──────────────────────────────────────
        // OSelect: stream type dropdown
        this.streamTypeSelect  = '[data-test="add-alert-stream-type-select-dropdown"]';
        // OSelect: stream name dropdown
        this.streamNameSelect  = '[data-test="add-alert-stream-name-select-dropdown"]';
        // Next / Save / Cancel buttons shared across the wizard
        this.nextBtn    = '[data-test="add-alert-next-btn"]';
        this.saveBtn    = '[data-test="add-alert-submit-btn"]';
        this.cancelBtn  = '[data-test="add-alert-cancel-btn"]';

        // ── Step 2 — AnomalyDetectionConfig fields ─────────────────────────
        this.queryTabsToggle     = '[data-test="anomaly-query-tabs"]';
        this.detectionFunction   = '[data-test="anomaly-detection-function"]';
        this.detectionFunctionField = '[data-test="anomaly-detection-function-field"]';
        this.histogramIntervalValue = '[data-test="anomaly-histogram-interval-value"]';
        this.histogramIntervalUnit  = '[data-test="anomaly-histogram-interval-unit"]';
        this.detectionWindowValue   = '[data-test="anomaly-detection-window-value"]';
        this.detectionWindowUnit    = '[data-test="anomaly-detection-window-unit"]';
        this.detectionWindowError   = '[data-test="anomaly-detection-window-error"]';
        this.trainingWindow         = '[data-test="anomaly-training-window"]';
        this.customSqlEditor        = '[data-test="anomaly-custom-sql"]';
        this.customSqlTimestampError = '[data-test="anomaly-custom-sql-timestamp-alias-error"]';
    }

    // ── Navigation ─────────────────────────────────────────────────────────

    async navigateToAnomalyDetection() {
        testLogger.info('Navigating to Alerts > Anomaly Detection tab');
        await this.page.locator(this.alertsMenuLink).click();
        // Wait for alerts page to load
        await this.page.locator(this.anomalyDetectionTab).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.anomalyDetectionTab).click();
        await this.page.locator(this.anomalyTable).waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Anomaly Detection tab loaded');
    }

    async openAddAnomalyWizard() {
        testLogger.info('Opening Add Anomaly wizard');
        await this.page.locator(this.addAnomalyBtn).click();
        // Wait for step 1 (stream selection) to appear
        await this.page.locator(this.streamTypeSelect).waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Add Anomaly wizard opened');
    }

    async clickNext() {
        testLogger.info('Clicking Next in anomaly wizard');
        await this.page.locator(this.nextBtn).click();
    }

    async clickSave() {
        testLogger.info('Clicking Save in anomaly wizard');
        await this.page.locator(this.saveBtn).click();
    }

    async clickCancel() {
        testLogger.info('Clicking Cancel in anomaly wizard');
        await this.page.locator(this.cancelBtn).click();
    }

    // ── Locator getters ────────────────────────────────────────────────────

    getStreamTypeSelectLocator()     { return this.page.locator(this.streamTypeSelect); }
    getStreamNameSelectLocator()     { return this.page.locator(this.streamNameSelect); }
    getNextBtnLocator()              { return this.page.locator(this.nextBtn); }
    getSaveBtnLocator()              { return this.page.locator(this.saveBtn); }
    getCancelBtnLocator()            { return this.page.locator(this.cancelBtn); }
    getDetectionWindowErrorLocator() { return this.page.locator(this.detectionWindowError); }
    getCustomSqlTimestampErrorLocator() { return this.page.locator(this.customSqlTimestampError); }
    getQueryTabsLocator()            { return this.page.locator(this.queryTabsToggle); }
    getDetectionFunctionLocator()    { return this.page.locator(this.detectionFunction); }
    getAnomalyTableLocator()         { return this.page.locator(this.anomalyTable); }
}

module.exports = { AnomalyFormValidationPage };
