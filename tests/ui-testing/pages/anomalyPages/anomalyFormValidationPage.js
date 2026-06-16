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
        // AlertList.vue uses alert-list-table for all tabs including anomalyDetection
        this.anomalyTable  = '[data-test="alert-list-table"]';

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

    /**
     * Navigate to Anomaly Detection tab.
     * Returns false on OSS builds where the tab is hidden by enterprise feature flag.
     */
    async navigateToAnomalyDetection() {
        testLogger.info('Navigating to Alerts > Anomaly Detection tab');
        await this.page.locator(this.alertsMenuLink).click();
        // Tab is only rendered when build_type !== "opensource" && isEnterprise === "true"
        const tab = this.page.locator(this.anomalyDetectionTab);
        const tabVisible = await tab.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
        if (!tabVisible) {
            testLogger.info('Anomaly Detection tab not available (OSS build) — skipping');
            return false;
        }
        await tab.click();
        await this.page.locator(this.anomalyTable).waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Anomaly Detection tab loaded');
        return true;
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
