/**
 * AlertsPage - Main page object for Alerts module
 *
 * This is the main entry point for alert operations. It delegates to specialized modules:
 * - AlertCreationWizard: Creating different types of alerts
 * - AlertManagement: Update, clone, pause, resume, delete operations
 * - AlertBulkOperations: Bulk select, pause, move operations
 *
 * This file contains:
 * - All locators (shared with submodules)
 * - Folder operations
 * - UI validations
 * - Import/Export operations
 * - Verification methods
 */

import { expect } from '@playwright/test';
import fs from 'fs';
import { CommonActions } from '../commonActions';
import { AlertCreationWizard } from './alertCreationWizard.js';
import { AlertManagement } from './alertManagement.js';
import { AlertBulkOperations } from './alertBulkOperations.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertsPage {
    constructor(page) {
        this.page = page;
        this.commonActions = new CommonActions(page);

        this.locators = this._initializeLocators();

        this.creationWizard = new AlertCreationWizard(page, this.commonActions, this.locators);
        this.management = new AlertManagement(page, this.commonActions, this.locators);
        this.bulkOperations = new AlertBulkOperations(page, this.commonActions, this.locators);

        this._exposeLocators();
    }

    _initializeLocators() {
        return {
            // Alert related locators
            alertMenuItem: '[data-test="menu-link-\\/alerts-item"]',
            newFolderButton: '[data-test="dashboard-new-folder-btn"]',
            folderNameInput: '[data-test="dashboard-folder-add-name"]',
            folderDescriptionInput: '[data-test="dashboard-folder-add-description"]',
            folderSaveButton: '[data-test="dashboard-folder-add-save"]',
            folderCancelButton: '[data-test="dashboard-folder-add-cancel"]',
            noDataAvailableText: 'No data available',
            folderExistsError: 'Folder with this name already exists in this organization',
            folderMoreOptionsButton: '[data-test="dashboard-more-icon"]',
            deleteFolderOption: 'Delete',
            deleteFolderConfirmText: 'Delete Folder',
            folderDeletedMessage: 'Folder deleted successfully.',

            // Alert creation locators - Alerts 2.0 Wizard UI
            addAlertButton: '[data-test="alert-list-add-alert-btn"]',
            alertNameInput: '[data-test="add-alert-name-input"]',
            alertSubmitButton: '[data-test="add-alert-submit-btn"]',
            alertBackButton: '[data-test="add-alert-back-btn"]',

            // Step 1: Alert Setup selectors
            streamTypeDropdown: '[data-test="add-alert-stream-type-select-dropdown"]',
            streamNameDropdown: '[data-test="add-alert-stream-name-select-dropdown"]',
            realtimeAlertRadio: '[data-test="add-alert-realtime-alert-radio"]',
            scheduledAlertRadio: '[data-test="add-alert-scheduled-alert-radio"]',

            // Step 2: Query/Conditions selectors
            queryTabsContainer: '[data-test="step2-query-tabs"]',
            viewEditorButton: '[data-test="step2-view-editor-btn"]',
            conditionsTabsContainer: '[data-test="scheduled-alert-tabs"]',
            conditionColumnSelect: '[data-test="alert-conditions-select-column"]',
            operatorSelect: '[data-test="alert-conditions-operator-select"]',
            conditionValueInput: '[data-test="alert-conditions-value-input"]',
            addConditionButton: '[data-test="alert-conditions-add-condition-btn"]',
            addFirstConditionButton: '[data-test="alert-conditions-add-btn"]',
            addConditionGroupButton: '[data-test="alert-conditions-add-condition-group-btn"]',
            deleteConditionButton: '[data-test="alert-conditions-delete-condition-btn"]',
            columnInput: '[data-test="alert-conditions-select-column"]',
            valueInput: '[data-test="alert-conditions-value-input"]',

            // Step 3: Compare with Past (Scheduled only)
            multiTimeRangeAddButton: '[data-test="multi-time-range-alerts-add-btn"]',
            multiTimeRangeDeleteButton: '[data-test="multi-time-range-alerts-delete-btn"]',
            goToViewEditorButton: '[data-test="go-to-view-editor-btn"]',

            // Step 5: Deduplication (Scheduled only)
            stepDeduplication: '.step-deduplication',
            stepDeduplicationFingerprintSelect: '.step-deduplication .q-select',
            stepDeduplicationTimeWindowInput: '.step-deduplication input[type="number"]',

            // Step 6: Advanced settings
            contextAttributesAddButton: '[data-test="alert-variables-add-btn"]',
            contextAttributeKeyInput: '[data-test="alert-variables-key-input"]',
            contextAttributeValueInput: '[data-test="alert-variables-value-input"]',
            rowTemplateTextarea: '[data-test="add-alert-row-input-textarea"]',

            // Query Editor Dialog selectors
            sqlEditorDialog: '[data-test="scheduled-alert-sql-editor"]',
            promqlEditorDialog: '[data-test="scheduled-alert-promql-editor"]',
            vrlFunctionEditorDialog: '[data-test="scheduled-alert-vrl-function-editor"]',
            runQueryButton: '[data-test="alert-run-query-btn"]',
            generateQueryButton: '[data-test="alert-generate-query-btn"]',

            // Preview
            alertPreviewChart: '[data-test="alert-preview-chart"]',

            // Messages
            alertSuccessMessage: 'Alert saved successfully.',
            alertUpdatedMessage: 'Alert updated successfully.',
            alertClonedMessage: 'Alert Cloned Successfully',
            alertDeletedMessage: 'Alert deleted',
            alertSetupText: 'Alert Setup',
            deleteConfirmText: 'Are you sure you want to delete this alert?',
            deleteButtonText: 'Delete',
            containsOperatorText: 'Contains',
            arrowDropDownText: 'arrow_drop_down',

            // Clone dialog selectors
            cloneAlertTitle: '[data-test="clone-alert-title"]',
            cloneAlertName: '[data-test="to-be-clone-alert-name"]',
            cloneStreamType: '[data-test="to-be-clone-stream-type"]',
            cloneStreamName: '[data-test="to-be-clone-stream-name"]',
            cloneSubmitButton: '[data-test="clone-alert-submit-btn"]',
            cloneCancelButton: '[data-test="clone-alert-cancel-btn"]',
            pauseStartAlert: '[data-test="alert-list-{alertName}-pause-start-alert"]',

            // Alert management locators
            alertUpdateButton: '[data-test="alert-list-{alertName}-update-alert"]',
            alertCloneButton: '[data-test="alert-list-{alertName}-clone-alert"]',
            alertMoreOptions: '[data-test="alert-list-{alertName}-more-options"]',
            confirmButton: '[data-test="confirm-button"]',

            // Alert movement locators
            selectAllCheckboxRowName: '# Name Owner Period Frequency',
            moveAcrossFoldersButton: '[data-test="alert-list-move-across-folders-btn"]',
            folderDropdown: '[data-test="alerts-index-dropdown-stream_type"]',
            moveButton: '[data-test="alerts-folder-move"]',
            alertsMovedMessage: 'alerts Moved successfully',

            // Alert search and deletion locators
            alertSearchInput: '[data-test="alert-list-search-input"]',
            searchAcrossFoldersToggle: '[data-test="alert-list-search-across-folders-toggle"]',
            alertDeleteOption: 'Delete',

            // Sidebar menu items for navigation (Alerts and Incidents are now separate pages)
            alertMenuItem: '[data-test="menu-link-\\/alerts-item"]',
            incidentsMenuItem: '[data-test="menu-link-\\/incidents-item"]',

            // Incidents view locators
            incidentListTable: '[data-test="incident-list-table"]',
            incidentSearchInput: '[data-test="incident-search-input"]',
            incidentList: '[data-test="incident-list"]',
            incidentRow: '[data-test="incident-row"]',
            incidentAckButton: '[data-test="incident-ack-btn"]',
            incidentResolveButton: '[data-test="incident-resolve-btn"]',
            incidentReopenButton: '[data-test="incident-reopen-btn"]',
            incidentDetailTitle: '[data-test="incident-detail-title"]',
            incidentDetailCloseButton: '[data-test="incident-detail-close-btn"]',

            // Incident detail page locators
            incidentDetailPage: '[data-test="incident-detail-page"]',
            incidentDetailBackButton: '[data-test="incident-detail-back-btn"]',
            incidentRefreshButton: '[data-test="incident-refresh-btn"]',
            incidentsListTitle: '[data-test="incidents-list-title"]',

            // Alert triggers table locators (inside incident detail)
            alertTriggersTable: '[data-test="alert-triggers-table"]',
            triggersQTable: '[data-test="triggers-qtable"]',
            noTriggersMessage: '[data-test="no-triggers-message"]',
            alertNameCell: '[data-test="alert-name-cell"]',
            alertNameText: '[data-test="alert-name-text"]',
            firedAtCell: '[data-test="fired-at-cell"]',
            firedAtTimestamp: '[data-test="fired-at-timestamp"]',
            correlationReasonCell: '[data-test="correlation-reason-cell"]',
            correlationReasonBadge: '[data-test="correlation-reason-badge"]',

            // Incident detail — Overview tab locators
            relatedAlertsContainer: '.o2-incident-card-bg',
            relatedAlertItem: '[data-test="related-alert-item"], [class*="tw:py-2"][class*="tw:border-b"]',
            relatedAlertName: '[data-test="related-alert-name"], .tw\\:truncate.tw\\:block',
            relatedAlertCountText: '[data-test="related-alert-count"], [style*="width: 120px"]',
            severityBadge: '.q-badge',

            // Incident detail — tab selectors (Quasar q-tab)
            serviceGraphTab: '.q-tab[name="serviceGraph"]',
            logsTab: '.q-tab[name="logs"]',
            metricsTab: '.q-tab[name="metrics"]',
            tracesTab: '.q-tab[name="traces"]',

            // Incident detail — Service Graph content
            serviceGraphContainer: '.incident-service-graph',

            // Telemetry tab state selectors
            loadingSpinner: '.q-spinner-hourglass',

            // RCA Analysis locators (inside incident detail)
            rcaAnalysisContainer: '[data-test="rca-analysis-container"]',
            triggerRcaButton: '[data-test="trigger-rca-btn"]',
            rcaStreamContent: '[data-test="rca-stream-content"]',
            rcaExistingContent: '[data-test="rca-existing-content"]',
            rcaEmptyState: '[data-test="rca-empty-state"]',

            // Table of contents locators (inside incident detail)
            tocContainer: '[data-test="toc-container"]',

            // Import button
            alertImportButton: '[data-test="alert-import"]',

            // Page structure locators
            alertListPage: '[data-test="alert-list-page"]',
            alertListTable: '[data-test="alert-list-table"]',
            alertListSplitter: '[data-test="alert-list-splitter"]',
            loadingOverlay: '.fullscreen.bg-blue',

            // Table locators
            tableBodyRowWithIndex: 'tbody tr[data-index]',
            tableLocator: 'table',
            tableCheckbox: '.o2-table-checkbox',
            headerCheckbox: '[data-test="alert-list-table"] thead .o2-table-checkbox',

            // Alert settings inline locators
            silenceNotificationInput: '.silence-notification-input input',
            stepAlertConditions: '.step-alert-conditions',
            stepAlertConditionsQSelect: '.step-alert-conditions .q-select',
            stepAlertConditionsNumberInput: '.step-alert-conditions input[type="number"]',
            alertSettingsRow: '.alert-settings-row',
            viewLineLocator: '.view-line',
            qDialogLocator: '.q-dialog',

            // Home page alert count locators
            scheduledColumnLocator: '.column:has(.text-subtitle:text("Scheduled"))',
            realTimeColumnLocator: '.column:has(.text-subtitle:text("Real time"))',
            resultsCountLocator: '.results-count'
        };
    }

    _exposeLocators() {
        Object.keys(this.locators).forEach(key => {
            this[key] = this.locators[key];
        });
        this.currentFolderName = '';
        this.currentAlertName = '';
    }

    // ==================== DELEGATE TO CREATION WIZARD ====================

    get currentAlertName() {
        return this.creationWizard.currentAlertName || this._currentAlertName;
    }

    set currentAlertName(value) {
        this._currentAlertName = value;
        if (this.creationWizard) {
            this.creationWizard.currentAlertName = value;
        }
    }

    async createAlert(streamName, column, value, destinationName, randomValue) {
        const result = await this.creationWizard.createAlert(streamName, column, value, destinationName, randomValue);
        this.currentAlertName = result;
        return result;
    }

    async createAlertWithDefaults(streamName, destinationName, randomValue) {
        const result = await this.creationWizard.createAlertWithDefaults(streamName, destinationName, randomValue);
        this.currentAlertName = result;
        return result;
    }

    async createScheduledAlertWithSQL(streamName, destinationName, randomValue) {
        const result = await this.creationWizard.createScheduledAlertWithSQL(streamName, destinationName, randomValue);
        this.currentAlertName = result;
        return result;
    }

    async createAlertWithMultipleConditions(streamName, destinationName, randomValue) {
        const result = await this.creationWizard.createAlertWithMultipleConditions(streamName, destinationName, randomValue);
        this.currentAlertName = result;
        return result;
    }

    async createScheduledAlertWithDeduplication(streamName, destinationName, randomValue, dedupConfig = {}) {
        const result = await this.creationWizard.createScheduledAlertWithDeduplication(streamName, destinationName, randomValue, dedupConfig);
        this.currentAlertName = result;
        return result;
    }

    async createScheduledAlertWithDedupForValidation(streamName, column, value, destinationName, randomValue, dedupConfig = {}) {
        const result = await this.creationWizard.createScheduledAlertWithDedupForValidation(streamName, column, value, destinationName, randomValue, dedupConfig);
        this.currentAlertName = result;
        return result;
    }

    /**
     * Create a scheduled alert with PromQL query for metrics streams
     * Tests fix for bug #9967 - cannot save alert when selecting PromQL mode
     */
    async createScheduledAlertWithPromQL(metricsStreamName, promqlQuery, destinationName, randomValue, promqlCondition = {}) {
        const result = await this.creationWizard.createScheduledAlertWithPromQL(metricsStreamName, promqlQuery, destinationName, randomValue, promqlCondition);
        this.currentAlertName = result;
        return result;
    }

    async testConditionOperatorToggle(streamName, randomValue) {
        return this.creationWizard.testConditionOperatorToggle(streamName, randomValue);
    }

    async addConditionGroup() {
        return this.creationWizard.addConditionGroup();
    }

    async toggleConditionOperator() {
        return this.creationWizard.toggleConditionOperator();
    }

    async deleteCondition(index = 0) {
        return this.creationWizard.deleteCondition(index);
    }

    async verifyDeduplicationStepVisible() {
        return this.creationWizard.verifyDeduplicationStepVisible();
    }

    async getDeduplicationConfig() {
        return this.creationWizard.getDeduplicationConfig();
    }

    // ==================== DELEGATE TO MANAGEMENT ====================

    async updateAlert(alertName) {
        return this.management.updateAlert(alertName);
    }

    async cloneAlert(alertName, streamType, streamName) {
        return this.management.cloneAlert(alertName, streamType, streamName);
    }

    async pauseAlert(alertName) {
        return this.management.pauseAlert(alertName);
    }

    async resumeAlert(alertName) {
        return this.management.resumeAlert(alertName);
    }

    async deleteAlertByRow(alertName) {
        return this.management.deleteAlertByRow(alertName);
    }

    async searchAlert(alertName) {
        return this.management.searchAlert(alertName);
    }

    async searchAndDeleteAlert(alertName) {
        return this.management.searchAndDeleteAlert(alertName);
    }

    async deleteImportedAlert(alertName) {
        return this.management.deleteImportedAlert(alertName);
    }

    async triggerAlertManually(alertName) {
        return this.management.triggerAlertManually(alertName);
    }

    async openAlertHistoryDrawer(alertName) {
        return this.management.openAlertHistoryDrawer(alertName);
    }

    async getAlertHistoryStats() {
        return this.management.getAlertHistoryStats();
    }

    async closeAlertHistoryDrawer() {
        return this.management.closeAlertHistoryDrawer();
    }

    async verifyAlertTriggeredInHistory(alertName, expectedFiringCount = 1) {
        return this.management.verifyAlertTriggeredInHistory(alertName, expectedFiringCount);
    }

    async verifyAlertTriggerInValidationStream(alertName, validationStreamName, logsPage, waitTimeMs = 30000) {
        return this.management.verifyAlertTriggerInValidationStream(alertName, validationStreamName, logsPage, waitTimeMs);
    }

    // ==================== DELEGATE TO BULK OPERATIONS ====================

    async selectMultipleAlerts(alertNames) {
        return this.bulkOperations.selectMultipleAlerts(alertNames);
    }

    async bulkPauseAlerts() {
        return this.bulkOperations.bulkPauseAlerts();
    }

    async bulkUnpauseAlerts() {
        return this.bulkOperations.bulkUnpauseAlerts();
    }

    async verifyBulkPauseButtonVisible() {
        return this.bulkOperations.verifyBulkPauseButtonVisible();
    }

    async verifyBulkUnpauseButtonVisible() {
        return this.bulkOperations.verifyBulkUnpauseButtonVisible();
    }

    async getSelectedAlertsCount() {
        return this.bulkOperations.getSelectedAlertsCount();
    }

    async selectAllAlerts() {
        return this.bulkOperations.selectAllAlerts();
    }

    async pauseAllSelectedAlerts() {
        return this.bulkOperations.pauseAllSelectedAlerts();
    }

    async moveAllAlertsToFolder(targetFolderName) {
        return this.bulkOperations.moveAllAlertsToFolder(targetFolderName);
    }

    async deleteAllAlertsInFolder() {
        return this.bulkOperations.deleteAllAlertsInFolder();
    }

    async hasAlerts() {
        return this.bulkOperations.hasAlerts();
    }

    async getAlertCount() {
        return this.bulkOperations.getAlertCount();
    }

    async getAllAlertNames() {
        return this.bulkOperations.getAllAlertNames();
    }

    // ==================== FOLDER OPERATIONS ====================

    generateRandomString() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    generateFolderName() {
        return 'auto_' + this.generateRandomString();
    }

    getCurrentFolderName() {
        return this.currentFolderName;
    }

    async createFolder(folderName, description = '') {
        await this.page.locator(this.locators.newFolderButton).click();
        await this.page.locator(this.locators.folderNameInput).click();
        await this.page.locator(this.locators.folderNameInput).fill(folderName);

        if (description) {
            await this.page.locator(this.locators.folderDescriptionInput).click();
            await this.page.locator(this.locators.folderDescriptionInput).fill(description);
        }

        await this.page.locator(this.locators.folderSaveButton).click();
    }

    async verifyFolderCreated(folderName) {
        await expect(this.page.getByText(folderName)).toBeVisible();
    }

    async clickFolder(folderName) {
        await this.page.getByText(folderName).click();
    }

    async navigateToFolder(folderName) {
        await this.page.getByText(folderName).first().click();
        try {
            await Promise.race([
                this.page.locator(this.locators.tableLocator).waitFor({ state: 'visible', timeout: 30000 }),
                this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
            ]);
        } catch (error) {
            testLogger.error('Neither table nor no data message found after clicking folder', { folderName, error: error.message });
            throw new Error(`Failed to load folder content for "${folderName}": Neither table nor "No data available" message appeared`);
        }
    }

    async verifyNoDataAvailable() {
        await expect(this.page.getByText('No data available')).toBeVisible();
    }

    async verifyFolderExistsError() {
        await expect(this.page.getByText(this.locators.folderExistsError)).toBeVisible();
    }

    async cancelFolderCreation() {
        await this.page.locator(this.locators.folderCancelButton).click();
    }

    async ensureFolderExists(folderName, description = '') {
        try {
            await this.page.getByText(folderName).waitFor({ timeout: 2000 });
            testLogger.info('Folder exists', { folderName });
            return true;
        } catch (error) {
            await this.createFolder(folderName, description);
            testLogger.info('Created folder', { folderName });
            return false;
        }
    }

    async deleteFolder(folderName) {
        const folderRow = this.page.locator(`div.folder-item:has-text("${folderName}")`);
        await folderRow.hover();
        await this.page.waitForTimeout(500);

        const dotButton = this.page.locator(`div.folder-item:has-text("${folderName}") button.q-btn`);
        await dotButton.waitFor({ state: 'visible', timeout: 3000 });

        testLogger.info('Button state', {
            visible: await dotButton.isVisible(),
            enabled: await dotButton.isEnabled()
        });

        await dotButton.click({ force: true });

        await expect(this.page.getByText(this.locators.deleteFolderOption)).toBeVisible({ timeout: 3000 });

        await this.page.getByText(this.locators.deleteFolderOption).click();
        await expect(this.page.getByText(this.locators.deleteFolderConfirmText)).toBeVisible();
        await this.page.locator(this.locators.confirmButton).click();
        await expect(this.page.getByText(this.locators.folderDeletedMessage)).toBeVisible();

        testLogger.info('Successfully deleted folder', { folderName });
    }

    // ==================== VERIFICATION METHODS ====================

    async alertsURLValidation() {
        await expect(this.page).toHaveURL(/alerts/);
    }

    async verifyAlertCreated(alertName) {
        const nameToVerify = alertName || this.currentAlertName;

        // Wait for page to stabilize
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        // First try to find the alert directly (in case we're already on the right page)
        const alertCell = this.page.getByRole('cell', { name: nameToVerify }).first();
        const isDirectlyVisible = await alertCell.isVisible({ timeout: 5000 }).catch(() => false);

        if (!isDirectlyVisible) {
            // If not found, navigate to alerts page and search
            testLogger.info('Alert not immediately visible, navigating to alerts and searching', { alertName: nameToVerify });
            await this.page.locator(this.locators.alertMenuItem).click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);

            // Search for the alert
            await this.page.locator(this.locators.alertSearchInput).click();
            await this.page.locator(this.locators.alertSearchInput).fill(nameToVerify);
            await this.page.waitForTimeout(2000);
        }

        // Use a longer timeout since the alert list may take time to reload
        await expect(this.page.getByRole('cell', { name: nameToVerify }).first()).toBeVisible({ timeout: 30000 });
        await expect(this.page.locator(this.locators.pauseStartAlert.replace('{alertName}', nameToVerify)).first()).toBeVisible({ timeout: 10000 });
    }

    async verifySearchResults(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText)).toBeVisible();
    }

    async verifySearchResultsUIValidation(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText)).toBeVisible({ timeout: 10000 });
    }

    async verifyAlertCellVisible(alertName, timeout = 10000) {
        const alertCell = this.page.getByRole('cell', { name: alertName }).first();
        await expect(alertCell).toBeVisible({ timeout });
        testLogger.info('Verified alert cell is visible', { alertName });
    }

    async verifyAlertCounts() {
        const scheduledColumn = this.page.locator(this.locators.scheduledColumnLocator).first();
        const scheduledAlertsCount = await scheduledColumn.locator(this.locators.resultsCountLocator).textContent() || '0';

        const realTimeColumn = this.page.locator(this.locators.realTimeColumnLocator).first();
        const realTimeAlertsCount = await realTimeColumn.locator(this.locators.resultsCountLocator).textContent() || '0';

        return { scheduledAlertsCount, realTimeAlertsCount };
    }

    async verifyAlertCountIncreased(initialCount, newCount) {
        const initial = parseInt(initialCount);
        const updated = parseInt(newCount);
        expect(updated).toBeGreaterThan(initial);
        testLogger.info('Alert count verification successful', { initialCount: initial, updatedCount: updated });
    }

    // ==================== UI VALIDATIONS ====================

    async verifyInvalidAlertCreation() {
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill('a b c');
        await this.page.waitForTimeout(1000);

        await expect(this.page.getByText('Characters like :, ?, /, #,')).toBeVisible({ timeout: 10000 });
        testLogger.info('Invalid alert name validation working');

        // Close with robust handling for dialog backdrops
        await this._closeAlertWizard();
    }

    async verifyFieldRequiredValidation() {
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill('abc');

        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForTimeout(500);

        await expect(this.page.getByText('Field is required!')).toBeVisible({ timeout: 5000 });
        testLogger.info('Field required validation working');

        // Close with robust handling for dialog backdrops
        await this._closeAlertWizard();
    }

    /**
     * Helper method to close alert wizard with robust dialog handling
     * Handles cases where dialog backdrops may intercept clicks
     */
    async _closeAlertWizard() {
        // First dismiss any potential error dialogs or overlays
        await this.page.waitForTimeout(500);

        // Try pressing Escape first to dismiss any popups/tooltips
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        try {
            const backButton = this.page.locator(this.locators.alertBackButton).first();

            // Wait for button to be visible
            await backButton.waitFor({ state: 'visible', timeout: 5000 });

            // Try clicking with force to bypass potential overlays
            await backButton.click({ force: true, timeout: 10000 });
            testLogger.info('Closed alert wizard via back button');
        } catch (error) {
            testLogger.warn('Back button click failed, using keyboard escape', { error: error.message });
            // Multiple escapes to ensure we exit
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(300);
            await this.page.keyboard.press('Escape');
        }

        await this.page.waitForTimeout(500);
    }

    async verifyCloneAlertUIValidation(alertName) {
        await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.locators.cloneSubmitButton).click();
        await expect(this.page.getByText('Please select stream type')).toBeVisible({ timeout: 5000 });
        testLogger.info('Clone validation working - stream type required');

        await this.page.locator(this.locators.cloneCancelButton).click();
        await this.page.waitForTimeout(500);

        await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
        await this.page.waitForTimeout(1000);
        await this.page.locator(this.locators.alertBackButton).click();
        testLogger.info('Clone dialog cancel/back working');
    }

    async verifyTabContents() {
        await this.page.locator('[data-test="tab-scheduled"]').click();
        await expect(this.page.getByText('No data available')).toBeVisible();
        await this.page.locator('[data-test="tab-realTime"]').click();
        await expect(this.page.getByText('Showing 1 - 1 of')).toBeVisible();
        await this.page.locator('[data-test="tab-all"]').click();
        await expect(this.page.getByText('Showing 1 - 1 of')).toBeVisible();
    }

    async verifyFolderSearch(folderName) {
        await this.page.locator('[data-test="folder-search"]').click();
        await this.page.locator('[data-test="folder-search"]').fill(folderName);
        await expect(this.page.getByText(folderName)).toBeVisible();
        await this.page.getByRole('button', { name: 'Clear' }).click();
        await expect(this.page.locator('[data-test="dashboard-folder-tab-default"]').getByText('default')).toBeVisible();
    }

    // ==================== ALERTS / INCIDENTS NAVIGATION ====================
    // Alerts and Incidents are now separate pages accessible via sidebar menu

    /**
     * Navigate to Alerts page via sidebar menu
     */
    async navigateToAlertsPage() {
        testLogger.info('Navigating to Alerts page');
        await this.page.locator(this.locators.alertMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await this.waitForAlertListPageReady();
        testLogger.info('Navigated to Alerts page');
    }

    /**
     * Navigate to Incidents page via sidebar menu
     * Note: Incidents menu item depends on service_graph_enabled config from the server.
     * The menu item may take time to render while the config API response is processed.
     */
    async navigateToIncidentsPage() {
        testLogger.info('Navigating to Incidents page');
        // Wait for the incidents menu item to be available (may take time for config to load)
        await this.page.locator(this.locators.incidentsMenuItem).waitFor({ state: 'visible', timeout: 30000 });
        await this.page.locator(this.locators.incidentsMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await this.page.locator(this.locators.incidentList).waitFor({ state: 'visible', timeout: 30000 });
        testLogger.info('Navigated to Incidents page');
    }

    /**
     * Verify sidebar menu items are visible for navigation.
     * Note: The incidents menu item is an enterprise feature that depends on service_graph_enabled.
     * It may take time to render while waiting for the config API response.
     */
    async expectSidebarMenuItemsVisible() {
        testLogger.info('Verifying sidebar menu items are visible');
        // Alerts menu should be visible quickly
        await expect(this.page.locator(this.locators.alertMenuItem)).toBeVisible({ timeout: 10000 });
        // Incidents menu depends on config API - use longer timeout and waitFor pattern
        // The menu item is dynamically added after config loads with service_graph_enabled=true
        await this.page.locator(this.locators.incidentsMenuItem).waitFor({ state: 'visible', timeout: 30000 });
        await expect(this.page.locator(this.locators.incidentsMenuItem)).toBeVisible({ timeout: 5000 });
        testLogger.info('Sidebar menu items verified');
    }

    /**
     * Verify Alerts view UI elements are visible
     */
    async expectAlertsViewElementsVisible() {
        testLogger.info('Verifying Alerts view elements');
        await expect(this.page.locator(this.locators.alertListTable)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.locators.alertSearchInput)).toBeVisible();
        await expect(this.page.locator(this.locators.searchAcrossFoldersToggle)).toBeVisible();
        await expect(this.page.locator(this.locators.alertImportButton)).toBeVisible();
        await expect(this.page.locator(this.locators.addAlertButton)).toBeVisible();
        testLogger.info('Alerts view elements verified');
    }

    /**
     * Verify Incidents view UI elements are visible
     */
    async expectIncidentsViewElementsVisible() {
        testLogger.info('Verifying Incidents view elements');
        await expect(this.page.locator(this.locators.incidentListTable)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.locators.incidentSearchInput)).toBeVisible();
        testLogger.info('Incidents view elements verified');
    }

    /**
     * Verify Alerts-only elements are hidden in Incidents view
     */
    async expectAlertsOnlyElementsHidden() {
        testLogger.info('Verifying Alerts-only elements are hidden');
        await expect(this.page.locator(this.locators.alertListTable)).not.toBeVisible();
        await expect(this.page.locator(this.locators.searchAcrossFoldersToggle)).not.toBeVisible();
        await expect(this.page.locator(this.locators.alertImportButton)).not.toBeVisible();
        await expect(this.page.locator(this.locators.addAlertButton)).not.toBeVisible();
        testLogger.info('Alerts-only elements confirmed hidden');
    }

    /**
     * Verify Incidents-only elements are hidden in Alerts view
     */
    async expectIncidentsOnlyElementsHidden() {
        testLogger.info('Verifying Incidents-only elements are hidden');
        await expect(this.page.locator(this.locators.incidentListTable)).not.toBeVisible();
        await expect(this.page.locator(this.locators.incidentSearchInput)).not.toBeVisible();
        testLogger.info('Incidents-only elements confirmed hidden');
    }

    /**
     * Search in Alerts view
     */
    async searchInAlertsView(query) {
        testLogger.info(`Searching in Alerts view: ${query}`);
        const searchInput = this.page.locator(this.locators.alertSearchInput);
        await searchInput.click();
        await searchInput.clear();
        await searchInput.type(query);
        await this.page.waitForTimeout(500); // Wait for debounce
        testLogger.info('Search applied in Alerts view');
    }

    /**
     * Search in Incidents view
     */
    async searchInIncidentsView(query) {
        testLogger.info(`Searching in Incidents view: ${query}`);
        await this.page.locator(this.locators.incidentSearchInput).fill(query);
        await this.page.waitForTimeout(500); // Wait for debounce
        testLogger.info('Search applied in Incidents view');
    }

    /**
     * Wait for loading overlay to disappear
     */
    async waitForLoadingOverlayToDisappear() {
        const overlay = this.page.locator(this.locators.loadingOverlay);
        if (await overlay.isVisible().catch(() => false)) {
            await overlay.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        }
    }

    /**
     * Wait for alert list page to be ready
     */
    async waitForAlertListPageReady() {
        await this.page.locator(this.locators.alertListPage).waitFor({ state: 'visible', timeout: 30000 });
        await this.page.waitForTimeout(2000);
    }

    /**
     * Verify alert list table is visible
     */
    async expectAlertListTableVisible() {
        await expect(this.page.locator(this.locators.alertListTable)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify alert list table is hidden
     */
    async expectAlertListTableHidden() {
        await expect(this.page.locator(this.locators.alertListTable)).not.toBeVisible();
    }

    /**
     * Verify alert list splitter is visible
     */
    async expectAlertListSplitterVisible() {
        await expect(this.page.locator(this.locators.alertListSplitter)).toBeVisible();
    }

    /**
     * Verify search toggle is visible
     */
    async expectSearchAcrossFoldersToggleVisible() {
        await expect(this.page.locator(this.locators.searchAcrossFoldersToggle)).toBeVisible();
    }

    /**
     * Verify search toggle is hidden
     */
    async expectSearchAcrossFoldersToggleHidden() {
        await expect(this.page.locator(this.locators.searchAcrossFoldersToggle)).not.toBeVisible();
    }

    /**
     * Verify import button is visible
     */
    async expectImportButtonVisible() {
        await expect(this.page.locator(this.locators.alertImportButton)).toBeVisible();
    }

    /**
     * Verify import button is hidden
     */
    async expectImportButtonHidden() {
        await expect(this.page.locator(this.locators.alertImportButton)).not.toBeVisible();
    }

    /**
     * Verify add alert button is visible
     */
    async expectAddAlertButtonVisible() {
        await expect(this.page.locator(this.locators.addAlertButton)).toBeVisible();
    }

    /**
     * Verify add alert button is hidden
     */
    async expectAddAlertButtonHidden() {
        await expect(this.page.locator(this.locators.addAlertButton)).not.toBeVisible();
    }

    /**
     * Type in alert search input with sequential typing
     */
    async typeInAlertSearchInput(query) {
        const searchInput = this.page.locator(this.locators.alertSearchInput);
        await searchInput.click();
        await this.page.waitForTimeout(500);
        await searchInput.pressSequentially(query, { delay: 100 });
        await this.page.waitForTimeout(1000);
    }

    /**
     * Verify alert search input is focused
     */
    async expectAlertSearchInputFocused() {
        await expect(this.page.locator(this.locators.alertSearchInput)).toBeFocused();
    }

    /**
     * Verify incident search input has expected value
     */
    async expectIncidentSearchInputValue(expectedValue) {
        await expect(this.page.locator(this.locators.incidentSearchInput)).toHaveValue(expectedValue);
    }

    /**
     * Verify incident search input is visible
     */
    async expectIncidentSearchInputVisible() {
        await expect(this.page.locator(this.locators.incidentSearchInput)).toBeVisible({ timeout: 5000 });
        testLogger.info('Incident search input visible');
    }

    /**
     * Clear the incident search input and wait for results to refresh
     */
    async clearIncidentSearchInput() {
        testLogger.info('Clearing incident search input');
        const searchInput = this.page.locator(this.locators.incidentSearchInput);
        await searchInput.clear();
        await this.page.waitForTimeout(1500);
        testLogger.info('Cleared incident search input');
    }

    /**
     * Fill incident search with a query and wait for debounced results
     * @param {string} query - Search query to type
     */
    async fillIncidentSearch(query) {
        testLogger.info('Filling incident search', { query });
        const searchInput = this.page.locator(this.locators.incidentSearchInput);
        await searchInput.fill(query);
        await this.page.waitForTimeout(1500);
        testLogger.info('Filled incident search');
    }

    /**
     * Verify incident list table is visible
     */
    async expectIncidentListTableVisible() {
        await expect(this.page.locator(this.locators.incidentListTable)).toBeVisible({ timeout: 10000 });
    }

    // ==================== INCIDENT LIFECYCLE ACTIONS ====================

    /**
     * Check if any incidents exist in the table
     * @returns {Promise<boolean>} True if incidents exist
     */
    async hasIncidents() {
        const rows = this.page.locator(this.locators.incidentRow);
        const count = await rows.count();
        testLogger.info(`Found ${count} incidents in table`);
        return count > 0;
    }

    /**
     * Get incident count
     * @returns {Promise<number>} Number of incidents
     */
    async getIncidentCount() {
        const rows = this.page.locator(this.locators.incidentRow);
        return await rows.count();
    }

    /**
     * Get the first incident row
     * @returns {Locator} First incident row locator
     */
    getFirstIncidentRow() {
        return this.page.locator(this.locators.incidentRow).first();
    }

    /**
     * Click acknowledge button on first open incident.
     * Stores the row index so subsequent lifecycle checks target the same row.
     */
    async clickAcknowledgeOnFirstOpenIncident() {
        testLogger.info('Clicking acknowledge button on first open incident');
        // Find first row that has the ack button (status === 'open')
        const rowsWithAck = this.page.locator(`${this.locators.incidentRow}:has(${this.locators.incidentAckButton})`);
        await rowsWithAck.first().waitFor({ state: 'visible', timeout: 10000 });

        // Determine the index of this row among all incident rows
        const allRows = this.page.locator(this.locators.incidentRow);
        const allCount = await allRows.count();
        let targetIndex = 0;
        for (let i = 0; i < allCount; i++) {
            const hasAck = await allRows.nth(i).locator(this.locators.incidentAckButton).count();
            if (hasAck > 0) { targetIndex = i; break; }
        }
        this._lifecycleRowIndex = targetIndex;
        testLogger.info(`Target lifecycle row index: ${targetIndex}`);

        await allRows.nth(targetIndex).locator(this.locators.incidentAckButton).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked acknowledge button');
    }

    /**
     * Get the lifecycle target row (same row tracked through state transitions)
     */
    _getLifecycleRow() {
        const idx = this._lifecycleRowIndex ?? 0;
        return this.page.locator(this.locators.incidentRow).nth(idx);
    }

    /**
     * Click resolve button on the lifecycle target row
     */
    async clickResolveOnFirstIncident() {
        testLogger.info('Clicking resolve button on first incident');
        const row = this._getLifecycleRow();
        const resolveButton = row.locator(this.locators.incidentResolveButton);
        await resolveButton.waitFor({ state: 'visible', timeout: 10000 });
        await resolveButton.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked resolve button');
    }

    /**
     * Click reopen button on the lifecycle target row
     */
    async clickReopenOnFirstResolvedIncident() {
        testLogger.info('Clicking reopen button on first resolved incident');
        const row = this._getLifecycleRow();
        const reopenButton = row.locator(this.locators.incidentReopenButton);
        await reopenButton.waitFor({ state: 'visible', timeout: 10000 });
        await reopenButton.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked reopen button');
    }

    /**
     * Verify acknowledge button is visible on the lifecycle target row
     */
    async expectAcknowledgeButtonVisible() {
        await expect(this._getLifecycleRow().locator(this.locators.incidentAckButton)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify acknowledge button is hidden on the lifecycle target row
     */
    async expectAcknowledgeButtonHidden() {
        await expect(this._getLifecycleRow().locator(this.locators.incidentAckButton)).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify resolve button is visible on the lifecycle target row
     */
    async expectResolveButtonVisible() {
        await expect(this._getLifecycleRow().locator(this.locators.incidentResolveButton)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify resolve button is hidden on the lifecycle target row
     */
    async expectResolveButtonHidden() {
        await expect(this._getLifecycleRow().locator(this.locators.incidentResolveButton)).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify reopen button is visible on the lifecycle target row
     */
    async expectReopenButtonVisible() {
        await expect(this._getLifecycleRow().locator(this.locators.incidentReopenButton)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify reopen button is hidden on the lifecycle target row
     */
    async expectReopenButtonHidden() {
        await expect(this._getLifecycleRow().locator(this.locators.incidentReopenButton)).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Click on first incident row to open detail drawer
     */
    async clickFirstIncidentRow() {
        testLogger.info('Clicking first incident row to open drawer');
        const firstRow = this.page.locator(this.locators.incidentRow).first();
        await firstRow.waitFor({ state: 'visible', timeout: 10000 });
        await firstRow.click();
        await this.page.waitForTimeout(1000); // Wait for drawer to open
        testLogger.info('Clicked first incident row');
    }

    /**
     * Verify incident detail drawer is open (title visible)
     */
    async expectIncidentDrawerOpen() {
        testLogger.info('Verifying incident drawer is open');
        await expect(this.page.locator(this.locators.incidentDetailTitle)).toBeVisible({ timeout: 10000 });
        testLogger.info('Incident drawer is open');
    }

    /**
     * Close incident detail drawer
     */
    async closeIncidentDrawer() {
        testLogger.info('Closing incident drawer');
        const closeButton = this.page.locator(this.locators.incidentDetailCloseButton);
        await closeButton.waitFor({ state: 'visible', timeout: 5000 });
        await closeButton.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Closed incident drawer');
    }

    /**
     * Verify incident detail drawer is closed
     */
    async expectIncidentDrawerClosed() {
        await expect(this.page.locator(this.locators.incidentDetailTitle)).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify URL contains incident_id parameter
     */
    async expectUrlContainsIncidentId() {
        const url = this.page.url();
        expect(url).toContain('incident_id=');
        testLogger.info('URL contains incident_id parameter');
    }

    /**
     * Verify URL does not contain incident_id parameter
     */
    async expectUrlNotContainsIncidentId() {
        const url = this.page.url();
        expect(url).not.toContain('incident_id=');
        testLogger.info('URL does not contain incident_id parameter');
    }

    /**
     * Wait for incident status update notification
     */
    async waitForStatusUpdateNotification() {
        // The notification text varies, but we can check for the success notification
        await this.page.waitForTimeout(2000);
        testLogger.info('Waited for status update');
    }

    /**
     * Wait for incidents to load in the table
     */
    async waitForIncidentsToLoad() {
        testLogger.info('Waiting for incidents to load');
        await this.page.locator(this.locators.incidentListTable).waitFor({ state: 'visible', timeout: 30000 });
        // Wait a bit for data to populate
        await this.page.waitForTimeout(2000);
        testLogger.info('Incidents table loaded');
    }

    // ==================== INCIDENT DETAIL PAGE METHODS ====================

    /**
     * Get count of incident rows in the list
     * @returns {Promise<number>}
     */
    async getIncidentRowCount() {
        const rows = this.page.locator(this.locators.incidentRow);
        const count = await rows.count();
        testLogger.info('Incident row count', { count });
        return count;
    }

    /**
     * Click incident row by index (0-based)
     */
    async clickIncidentRowByIndex(index = 0) {
        testLogger.info('Clicking incident row', { index });
        const row = this.page.locator(this.locators.incidentRow).nth(index);
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked incident row', { index });
    }

    /**
     * Verify incident detail page is visible (full page, not drawer)
     */
    async expectIncidentDetailPageVisible() {
        await expect(this.page.locator(this.locators.incidentDetailPage)).toBeVisible({ timeout: 15000 });
        testLogger.info('Incident detail page visible');
    }

    /**
     * Get incident detail title text
     * @returns {Promise<string>}
     */
    async getIncidentDetailTitleText() {
        const titleEl = this.page.locator(this.locators.incidentDetailTitle);
        await titleEl.waitFor({ state: 'visible', timeout: 10000 });
        const text = await titleEl.textContent() || '';
        testLogger.info('Incident detail title', { text });
        return text.trim();
    }

    /**
     * Click the back button on incident detail to return to list
     */
    async clickIncidentDetailBackButton() {
        testLogger.info('Clicking incident detail back button');
        const backBtn = this.page.locator(this.locators.incidentDetailBackButton);
        await backBtn.waitFor({ state: 'visible', timeout: 5000 });
        await backBtn.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked back button');
    }

    /**
     * Wait for incident detail page to fully load
     */
    async waitForIncidentDetailToLoad() {
        testLogger.info('Waiting for incident detail to load');
        await this.page.locator(this.locators.incidentDetailPage).waitFor({ state: 'visible', timeout: 15000 });
        await this.page.waitForTimeout(2000);
        testLogger.info('Incident detail loaded');
    }

    /**
     * Click the "Alert Triggers" tab on the incident detail page.
     * The tab uses Quasar q-tab with name="alertTriggers".
     */
    async clickAlertTriggersTab() {
        testLogger.info('Clicking Alert Triggers tab');
        await this.page.locator('.q-tab[name="alertTriggers"], .q-tab:has-text("Alert Triggers")').first().click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked Alert Triggers tab');
    }

    /**
     * Verify alert triggers table is visible in detail view
     */
    async expectAlertTriggersTableVisible() {
        await expect(this.page.locator(this.locators.alertTriggersTable)).toBeVisible({ timeout: 10000 });
        testLogger.info('Alert triggers table visible');
    }

    /**
     * Get count of alert name cells in triggers table
     * @returns {Promise<number>}
     */
    async getAlertTriggerCount() {
        const cells = this.page.locator(this.locators.alertNameCell);
        const count = await cells.count();
        testLogger.info('Alert trigger count', { count });
        return count;
    }

    /**
     * Get all alert names from the triggers table
     * @returns {Promise<string[]>}
     */
    async getAlertNamesFromTriggersTable() {
        const nameElements = this.page.locator(this.locators.alertNameText);
        const count = await nameElements.count();
        const names = [];
        for (let i = 0; i < count; i++) {
            const text = await nameElements.nth(i).textContent() || '';
            names.push(text.trim());
        }
        testLogger.info('Alert names from triggers table', { names });
        return names;
    }

    /**
     * Verify fired-at timestamps are visible in triggers table
     */
    async expectFiredAtTimestampsVisible() {
        const timestamps = this.page.locator(this.locators.firedAtTimestamp);
        const count = await timestamps.count();
        expect(count).toBeGreaterThan(0);
        await expect(timestamps.first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Fired-at timestamps visible', { count });
    }

    /**
     * Verify correlation reason badges are visible
     * @returns {Promise<number>} count of badges found
     */
    async expectCorrelationReasonBadgesVisible() {
        const badges = this.page.locator(this.locators.correlationReasonBadge);
        const count = await badges.count();
        expect(count).toBeGreaterThan(0);
        await expect(badges.first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Correlation reason badges visible', { count });
        return count;
    }

    /**
     * Get all correlation reason badge texts
     * @returns {Promise<string[]>}
     */
    async getCorrelationReasonBadgeTexts() {
        const badges = this.page.locator(this.locators.correlationReasonBadge);
        const count = await badges.count();
        const texts = [];
        for (let i = 0; i < count; i++) {
            const text = await badges.nth(i).textContent() || '';
            texts.push(text.trim());
        }
        testLogger.info('Correlation badge texts', { texts });
        return texts;
    }

    // ==================== INCIDENT DETAIL — OVERVIEW TAB ====================

    /**
     * Get the Related Alerts container on the Overview tab.
     * Uses :has-text to distinguish from other .o2-incident-card-bg panels.
     */
    _getRelatedAlertsContainer() {
        return this.page.locator(`${this.locators.relatedAlertsContainer}:has-text("Related Alerts")`).first();
    }

    /**
     * Get Related Alerts from the Overview tab panel.
     * Returns array of { name, countText } objects.
     * @returns {Promise<Array<{name: string, countText: string}>>}
     */
    async getRelatedAlerts() {
        const container = this._getRelatedAlertsContainer();
        await container.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

        // Each alert item is in a row with border-b class
        const items = container.locator(this.locators.relatedAlertItem);
        const count = await items.count();
        const alerts = [];
        for (let i = 0; i < count; i++) {
            const name = await items.nth(i).locator(this.locators.relatedAlertName).textContent().catch(() => '') || '';
            const countText = await items.nth(i).locator(this.locators.relatedAlertCountText).textContent().catch(() => '') || '';
            alerts.push({ name: name.trim(), countText: countText.trim() });
        }
        testLogger.info('Related alerts', { count, alerts });
        return alerts;
    }

    /**
     * Verify Related Alerts section is visible and has at least one alert.
     * @returns {Promise<number>} count of related alerts
     */
    async expectRelatedAlertsVisible() {
        const container = this._getRelatedAlertsContainer();
        await expect(container).toBeVisible({ timeout: 10000 });
        // Count alert items inside the container
        const items = container.locator(this.locators.relatedAlertItem);
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
        testLogger.info('Related alerts visible', { count });
        return count;
    }

    /**
     * Get severity badge text from incident detail header.
     * Header has 3 badges: Status (icon=info), Severity (icon=warning), Alert Count (icon=notifications_active).
     * Quasar renders q-icon name as <i> text content, NOT as an HTML attribute.
     * We match the badge that contains a P1/P2/P3/P4 span.
     * @returns {Promise<string>} e.g. "P1", "P2", "P3", "P4"
     */
    async getSeverityBadgeText() {
        // Match the q-badge that contains P1, P2, P3, or P4 text
        const badge = this.page.locator(this.locators.severityBadge).filter({ hasText: /^.*P[1-4].*$/ });
        await badge.first().waitFor({ state: 'visible', timeout: 10000 });
        // Get just the span with the severity value (first span inside the inner div)
        const severitySpan = badge.first().locator('div span').first();
        const severity = await severitySpan.textContent() || '';
        testLogger.info('Severity badge text', { severity: severity.trim() });
        return severity.trim();
    }

    /**
     * Verify severity badge is visible and contains a valid severity value.
     */
    async expectSeverityBadgeVisible() {
        const badge = this.page.locator(this.locators.severityBadge).filter({ hasText: /P[1-4]/ });
        await expect(badge.first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Severity badge visible');
    }

    /**
     * Verify the current URL contains an incident path (/incidents/{id}).
     */
    async expectUrlContainsIncidentPath() {
        const url = this.page.url();
        expect(url).toMatch(/\/incidents\//);
        testLogger.info('URL contains incident path', { url });
    }

    // ==================== INCIDENT DETAIL — TAB NAVIGATION ====================

    /**
     * Tab name → visible label map for Quasar q-tab text-based fallback.
     * Quasar may or may not render name= as an HTML attribute.
     */
    static TAB_LABELS = {
        overview: 'Overview',
        incidentAnalysis: 'Incident Analysis',
        serviceGraph: 'Alert Graph',
        alertTriggers: 'Alert Triggers',
        logs: 'Logs',
        metrics: 'Metrics',
        traces: 'Traces',
    };

    /**
     * Click a tab on the incident detail page by its Quasar tab name.
     * Uses attribute selector with text-based fallback.
     * @param {string} tabName - One of: overview, incidentAnalysis, serviceGraph, alertTriggers, logs, metrics, traces
     */
    async clickIncidentDetailTab(tabName) {
        testLogger.info(`Clicking incident detail tab: ${tabName}`);
        const label = AlertsPage.TAB_LABELS[tabName] || tabName;
        const tab = this.page.locator(`.q-tab[name="${tabName}"], .q-tab:has-text("${label}")`);
        await tab.first().waitFor({ state: 'visible', timeout: 10000 });
        await tab.first().click();
        await this.page.waitForTimeout(1500);
        testLogger.info(`Clicked tab: ${tabName}`);
    }

    /**
     * Verify the service graph tab content rendered.
     * Tabs are v-if gated (no q-tab-panel wrapper). The serviceGraph tab
     * renders IncidentServiceGraph inside an absolute-positioned div.
     * Checks for the .incident-service-graph container OR the detail page
     * still being visible (confirming no crash).
     */
    async expectServiceGraphTabContentVisible() {
        const graph = this.page.locator(this.locators.serviceGraphContainer);
        const detailPage = this.page.locator(this.locators.incidentDetailPage);
        // Either the graph container rendered, or at minimum the detail page is still visible
        const graphVisible = await graph.isVisible({ timeout: 10000 }).catch(() => false);
        if (graphVisible) {
            testLogger.info('Service graph container visible');
            return;
        }
        // Graph not visible — verify detail page didn't crash
        await expect(detailPage).toBeVisible({ timeout: 5000 });
        testLogger.info('Service graph not rendered (empty/loading state), but detail page intact');
    }

    /**
     * Verify Service Graph container is visible after clicking the serviceGraph tab.
     */
    async expectServiceGraphVisible() {
        const graph = this.page.locator(this.locators.serviceGraphContainer);
        await expect(graph).toBeVisible({ timeout: 15000 });
        testLogger.info('Service graph container visible');
    }

    /**
     * Check if Service Graph container rendered (visible or empty state).
     * Returns true if graph is visible, false if empty/loading state.
     * Does not throw — both states are acceptable for test data.
     * @returns {Promise<boolean>}
     */
    async isServiceGraphRendered() {
        const graph = this.page.locator(this.locators.serviceGraphContainer);
        const isVisible = await graph.isVisible({ timeout: 10000 }).catch(() => false);
        testLogger.info('Service graph rendered', { isVisible });
        return isVisible;
    }

    /**
     * Check if a telemetry tab (logs/metrics/traces) loaded without errors.
     * After clicking the tab, the page shows one of:
     *   - Loading spinner
     *   - Content (TelemetryCorrelationDashboard)
     *   - Info/error state with icon
     * All are acceptable — an uncaught JS exception would be a failure.
     * @param {string} tabName - 'logs', 'metrics', or 'traces'
     * @returns {Promise<string>} state: 'loading' | 'content' | 'noData' | 'error'
     */
    async getTelemetryTabState(tabName) {
        // Wait for either loading spinner to disappear or content to appear
        await this.page.waitForTimeout(3000);

        // Check for loading spinner still active
        const spinner = this.page.locator(this.locators.loadingSpinner);
        if (await spinner.isVisible({ timeout: 1000 }).catch(() => false)) {
            testLogger.info(`Telemetry tab ${tabName}: still loading`);
            // Wait up to 30s for spinner to go away
            await spinner.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        }

        // Check for "No correlated" message (acceptable state)
        const noData = this.page.locator(`text=/No correlated ${tabName} found/i`);
        if (await noData.isVisible({ timeout: 2000 }).catch(() => false)) {
            testLogger.info(`Telemetry tab ${tabName}: no data`);
            return 'noData';
        }

        // Check for error icon (also acceptable — just means no correlation data)
        // Note: Quasar renders q-icon name as text content, not HTML attribute
        const errorIcon = this.page.locator('.q-icon:has-text("error_outline"), .q-icon:has-text("info_outline")');
        if (await errorIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
            testLogger.info(`Telemetry tab ${tabName}: info/error state`);
            return 'noData';
        }

        // Otherwise content loaded
        testLogger.info(`Telemetry tab ${tabName}: content visible`);
        return 'content';
    }

    /**
     * Verify the "no triggers" message is shown (for incidents with no alerts)
     */
    async expectNoTriggersMessage() {
        await expect(this.page.locator(this.locators.noTriggersMessage)).toBeVisible({ timeout: 5000 });
        testLogger.info('No triggers message visible');
    }

    /**
     * Verify RCA analysis container is visible in detail view
     */
    async expectRcaContainerVisible() {
        await expect(this.page.locator(this.locators.rcaAnalysisContainer)).toBeVisible({ timeout: 10000 });
        testLogger.info('RCA analysis container visible');
    }

    /**
     * Check if RCA has existing content or is in empty state
     * @returns {Promise<'content'|'empty'|'hidden'>}
     */
    async getRcaState() {
        const existing = this.page.locator(this.locators.rcaExistingContent);
        const empty = this.page.locator(this.locators.rcaEmptyState);

        if (await existing.isVisible({ timeout: 3000 }).catch(() => false)) {
            testLogger.info('RCA state: content');
            return 'content';
        }
        if (await empty.isVisible({ timeout: 3000 }).catch(() => false)) {
            testLogger.info('RCA state: empty');
            return 'empty';
        }
        testLogger.info('RCA state: hidden');
        return 'hidden';
    }

    /**
     * Verify TOC container is visible in incident detail
     */
    async expectTocContainerVisible() {
        await expect(this.page.locator(this.locators.tocContainer)).toBeVisible({ timeout: 10000 });
        testLogger.info('TOC container visible');
    }

    /**
     * Click refresh button on incidents list
     */
    async clickIncidentRefreshButton() {
        testLogger.info('Clicking incident refresh button');
        const refreshBtn = this.page.locator(this.locators.incidentRefreshButton);
        await refreshBtn.waitFor({ state: 'visible', timeout: 5000 });
        await refreshBtn.click();
        await this.page.waitForTimeout(2000);
        testLogger.info('Clicked refresh button');
    }

    /**
     * Verify incidents list title is visible
     */
    async expectIncidentsListTitleVisible() {
        await expect(this.page.locator(this.locators.incidentsListTitle)).toBeVisible({ timeout: 5000 });
        testLogger.info('Incidents list title visible');
    }

    // ==================== IMPORT/EXPORT OPERATIONS ====================

    async exportAlerts() {
        const headerCheckbox = this.page.locator('[data-test="alert-list-table"] thead .o2-table-checkbox').first();
        await headerCheckbox.waitFor({ state: 'visible', timeout: 10000 });
        await headerCheckbox.click();
        testLogger.info('Clicked select all checkbox for export');

        const downloadPromise = this.page.waitForEvent('download');
        await this.page.locator('[data-test="alert-list-export-alerts-btn"]').click();
        const download = await downloadPromise;
        await this.page.waitForTimeout(2000);
        await expect(this.page.getByText('Successfully exported')).toBeVisible({ timeout: 10000 });
        return download;
    }

    async importInvalidFile(filePath) {
        await this.page.locator('[data-test="alert-import"]').click();
        await expect(this.page.locator('[data-test="tab-import_json_file"]')).toBeVisible();
        await this.page.locator('[data-test="alert-import-json-file-input"]').setInputFiles(filePath);
        await this.page.locator('[data-test="alert-import-json-btn"]').click();
        await expect(this.page.getByText('Error importing Alert(s)')).toBeVisible();
    }

    async importValidFile(filePath) {
        await this.page.locator('[data-test="tab-import_json_file"]').click();
        await this.page.locator('[data-test="alert-import-json-file-input"]').setInputFiles(filePath);
        await this.page.locator('[data-test="alert-import-json-btn"]').click();
        await expect(this.page.getByRole('cell').filter({ hasText: this.currentAlertName }).first()).toBeVisible();
    }

    async cleanupDownloadedFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                testLogger.info('Successfully deleted file', { filePath });
            }
        } catch (error) {
            testLogger.error('Error deleting file', { filePath, error: error.message });
        }
    }

    // ==================== VALIDATION INFRASTRUCTURE ====================

    /**
     * Generate unique validation infrastructure names for parallel execution
     * @param {string} uniqueSuffix - Unique identifier for this test
     * @returns {{streamName: string, destinationName: string, templateName: string}}
     */
    getUniqueValidationNames(uniqueSuffix) {
        return {
            streamName: `alert_val_${uniqueSuffix}`,
            destinationName: `auto_dest_val_${uniqueSuffix}`,
            templateName: `auto_tmpl_val_${uniqueSuffix}`
        };
    }

    /**
     * Ensure validation infrastructure exists (template + destination)
     * Creates template and self-referential destination if they don't exist
     *
     * @param {Object} pm - PageManager instance
     * @param {string} uniqueSuffix - Unique suffix for parallel execution
     * @returns {Promise<{templateName: string, destinationName: string, streamName: string}>}
     */
    async ensureValidationInfrastructure(pm, uniqueSuffix) {
        const { streamName, destinationName, templateName } = this.getUniqueValidationNames(uniqueSuffix);

        testLogger.info('Ensuring validation infrastructure exists', { streamName, destinationName, templateName, uniqueSuffix });

        const baseUrl = process.env["ZO_BASE_URL"];
        const orgName = process.env["ORGNAME"];
        const validationDestinationUrl = `${baseUrl}/api/${orgName}/${streamName}/_json`;

        // Ensure validation template exists with proper JSON array format for ingestion API
        await pm.alertTemplatesPage.ensureValidationTemplateExists(templateName);
        testLogger.info('Validation template ready', { templateName });

        // Check if destination exists
        await pm.alertDestinationsPage.navigateToDestinations();
        await this.page.waitForTimeout(1000);

        const destinationFound = await pm.alertDestinationsPage.findDestinationAcrossPages(destinationName);

        if (!destinationFound) {
            // Generate Basic auth header
            const authHeader = this.commonActions.constructor.generateBasicAuthHeader(
                process.env["ZO_ROOT_USER_EMAIL"],
                process.env["ZO_ROOT_USER_PASSWORD"]
            );

            await pm.alertDestinationsPage.createDestinationWithHeaders(
                destinationName,
                validationDestinationUrl,
                templateName,
                { 'Authorization': authHeader }
            );
            testLogger.info('Created validation destination', {
                destinationName,
                url: validationDestinationUrl
            });
        } else {
            testLogger.info('Validation destination already exists', { destinationName });
        }

        return {
            templateName,
            destinationName,
            streamName
        };
    }

    /**
     * Verify alert trigger by checking validation stream
     * Ingests data, waits for alert processing, then verifies notification in validation stream
     *
     * @param {Object} pm - PageManager instance
     * @param {string} alertName - Name of the alert to verify
     * @param {string} sourceStreamName - Stream where data should be ingested to trigger alert
     * @param {string} triggerField - Field name that alert condition checks (default: 'job')
     * @param {string} triggerValue - Value that matches alert condition (default: 'test')
     * @param {number} waitTimeMs - Time to wait for alert processing (default: 30000ms)
     * @param {string} validationStreamName - Validation stream name for parallel execution
     * @returns {Promise<{found: boolean, logText: string|null}>}
     */
    async verifyAlertTrigger(pm, alertName, sourceStreamName, triggerField = 'job', triggerValue = 'test', waitTimeMs = 30000, validationStreamName) {
        testLogger.info('Starting alert trigger verification via validation stream', {
            alertName,
            sourceStreamName,
            triggerField,
            triggerValue,
            validationStream: validationStreamName
        });

        // Generate unique ID for this test
        const uniqueTestId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        // Ingest data that will trigger the alert
        await pm.commonActions.ingestTestDataWithUniqueId(
            sourceStreamName,
            uniqueTestId,
            triggerField,
            triggerValue
        );

        testLogger.info('Ingested test data, waiting for alert to fire...', { uniqueTestId });

        // Verify alert fired by checking validation stream
        const result = await this.verifyAlertTriggerInValidationStream(
            alertName,
            validationStreamName,
            pm.logsPage,
            waitTimeMs
        );

        return result;
    }

    /**
     * Verify scheduled alert trigger
     * Similar to verifyAlertTrigger but with longer wait time for scheduled alerts
     *
     * @param {Object} pm - PageManager instance
     * @param {string} alertName - Name of the alert to verify
     * @param {string} sourceStreamName - Stream where data should be ingested to trigger alert
     * @param {string} triggerField - Field name that alert condition checks
     * @param {string} triggerValue - Value that matches alert condition
     * @param {string} validationStreamName - Validation stream name for parallel execution
     * @returns {Promise<{found: boolean, logText: string|null}>}
     */
    async verifyScheduledAlertTrigger(pm, alertName, sourceStreamName, triggerField = 'job', triggerValue = 'test', validationStreamName) {
        // Scheduled alerts typically have 1-minute evaluation intervals
        // Wait longer for scheduled alerts (90 seconds)
        return this.verifyAlertTrigger(pm, alertName, sourceStreamName, triggerField, triggerValue, 90000, validationStreamName);
    }

    // ==================== BUG #9967 / PROMQL ALERT UI METHODS ====================
    // Methods for comprehensive testing of PromQL alert creation and validation
    // These support the Sentinel-compliant test pattern (no raw selectors in spec files)

    /**
     * Click the Add Alert button and wait for dialog
     */
    async clickAddAlertButton() {
        const addAlertBtn = this.page.locator(this.locators.addAlertButton);
        await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });
        await expect(addAlertBtn).toBeEnabled({ timeout: 15000 });
        await addAlertBtn.click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Clicked Add Alert button');
    }

    /**
     * Fill the alert name input
     */
    async fillAlertName(alertName) {
        await this.page.locator(this.locators.alertNameInput).fill(alertName);
        testLogger.info('Filled alert name', { alertName });
    }

    /**
     * Select stream type from dropdown
     */
    async selectStreamType(streamType) {
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type', { streamType });
    }

    /**
     * Select a metrics stream from dropdown with fallback to first available
     */
    async selectMetricsStream(streamName) {
        const streamDropdown = this.page.locator(this.locators.streamNameDropdown);
        await streamDropdown.click();

        const testStreamOption = this.page.getByText(streamName, { exact: true });
        try {
            await expect(testStreamOption).toBeVisible({ timeout: 5000 });
            await testStreamOption.click();
            testLogger.info('Selected metrics stream', { stream: streamName });
            return true;
        } catch (e) {
            // Retry: click dropdown again
            await streamDropdown.click();
            await this.page.waitForTimeout(1000);

            if (await testStreamOption.isVisible({ timeout: 3000 }).catch(() => false)) {
                await testStreamOption.click();
                testLogger.info('Selected metrics stream on retry', { stream: streamName });
                return true;
            } else {
                // Use first available metrics stream from dropdown
                const anyStreamOption = this.page.locator('.q-menu .q-item').first();
                if (await anyStreamOption.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await anyStreamOption.click();
                    testLogger.info('Using first available metrics stream');
                    return true;
                }
                testLogger.warn('No metrics streams available');
                return false;
            }
        }
    }

    /**
     * Select scheduled alert type
     */
    async selectScheduledAlertType() {
        await this.page.locator(this.locators.scheduledAlertRadio).click();
        testLogger.info('Selected scheduled alert type');
    }

    /**
     * Click the Continue button to advance wizard steps
     */
    async clickContinueButton() {
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
    }

    /**
     * Click the Back button to close alert wizard
     */
    async clickBackButton() {
        await this.page.locator(this.locators.alertBackButton).click();
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Click a specific step indicator in the wizard (0-indexed)
     */
    async clickStepIndicator(stepIndex) {
        const stepIndicator = this.page.locator('.q-stepper__tab').nth(stepIndex);
        await stepIndicator.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked step indicator', { stepIndex });
    }

    // ==================== QUERY TAB METHODS ====================

    /**
     * Expect PromQL tab to be visible
     */
    async expectPromqlTabVisible() {
        const promqlTab = this.page.locator('[data-test="tab-promql"]');
        await expect(promqlTab).toBeVisible({ timeout: 10000 });
        testLogger.info('PromQL tab is visible');
    }

    /**
     * Expect Custom tab to be visible
     */
    async expectCustomTabVisible() {
        const customTab = this.page.locator('[data-test="tab-custom"]');
        await expect(customTab).toBeVisible();
        testLogger.info('Custom tab is visible');
    }

    /**
     * Expect SQL tab to be visible
     */
    async expectSqlTabVisible() {
        const sqlTab = this.page.locator('[data-test="tab-sql"]');
        await expect(sqlTab).toBeVisible();
        testLogger.info('SQL tab is visible');
    }

    /**
     * Click PromQL tab
     */
    async clickPromqlTab() {
        await this.page.locator('[data-test="tab-promql"]').click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked PromQL tab');
    }

    /**
     * Click Custom tab
     */
    async clickCustomTab() {
        await this.page.locator('[data-test="tab-custom"]').click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked Custom tab');
    }

    // ==================== PROMQL CONDITION ROW METHODS ====================

    /**
     * Get the PromQL condition row locator
     */
    getPromqlConditionRow() {
        return this.page.locator(this.locators.alertSettingsRow).filter({ hasText: 'Trigger if the value is' });
    }

    /**
     * Expect PromQL condition row "Trigger if the value is" to be visible
     */
    async expectPromqlConditionRowVisible() {
        const promqlConditionRow = this.getPromqlConditionRow();
        await expect(promqlConditionRow).toBeVisible({ timeout: 10000 });
        testLogger.info('PromQL condition row is visible');
    }

    /**
     * Expect PromQL condition row NOT to be visible (for Custom mode)
     */
    async expectPromqlConditionRowNotVisible() {
        const promqlConditionRow = this.getPromqlConditionRow();
        await expect(promqlConditionRow).not.toBeVisible({ timeout: 5000 });
        testLogger.info('PromQL condition row is NOT visible');
    }

    /**
     * Expect operator dropdown to be visible in PromQL condition row
     */
    async expectOperatorDropdownVisible() {
        const promqlConditionRow = this.getPromqlConditionRow();
        const operatorDropdown = promqlConditionRow.locator('.q-select').first();
        await expect(operatorDropdown).toBeVisible();
        testLogger.info('Operator dropdown is visible');
    }

    /**
     * Expect value input to be visible in PromQL condition row
     */
    async expectValueInputVisible() {
        const promqlConditionRow = this.getPromqlConditionRow();
        const valueInput = promqlConditionRow.locator('input[type="number"]');
        await expect(valueInput).toBeVisible();
        testLogger.info('Value input is visible');
    }

    /**
     * Get the current value from the PromQL condition value input
     */
    async getPromqlConditionValue() {
        const promqlConditionRow = this.getPromqlConditionRow();
        const valueInput = promqlConditionRow.locator('input[type="number"]');
        await expect(valueInput).toBeVisible();
        const value = await valueInput.inputValue();
        testLogger.info('Retrieved PromQL condition value', { value });
        return value;
    }

    // ==================== ALERT LIST VERIFICATION ====================

    /**
     * Expect alert row to be visible in the list
     */
    async expectAlertRowVisible(alertName, timeout = 10000) {
        const alertRow = this.page.locator(`[data-test="alert-list-${alertName}-update-alert"]`);
        await expect(alertRow).toBeVisible({ timeout });
        testLogger.info('Alert row is visible', { alertName });
    }

    /**
     * Click the update button for a specific alert
     */
    async clickAlertUpdateButton(alertName) {
        const updateBtn = this.page.locator(`[data-test="alert-list-${alertName}-update-alert"]`);
        await updateBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked update button for alert', { alertName });
    }
}
