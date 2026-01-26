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
        const scheduledAlertsCount = await scheduledColumn.locator(this.locators.resultsCountLocator).textContent();

        const realTimeColumn = this.page.locator(this.locators.realTimeColumnLocator).first();
        const realTimeAlertsCount = await realTimeColumn.locator(this.locators.resultsCountLocator).textContent();

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
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.waitForAlertListPageReady();
        testLogger.info('Navigated to Alerts page');
    }

    /**
     * Navigate to Incidents page via sidebar menu
     */
    async navigateToIncidentsPage() {
        testLogger.info('Navigating to Incidents page');
        await this.page.locator(this.locators.incidentsMenuItem).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.locator(this.locators.incidentList).waitFor({ state: 'visible', timeout: 30000 });
        testLogger.info('Navigated to Incidents page');
    }

    /**
     * Verify sidebar menu items are visible for navigation
     */
    async expectSidebarMenuItemsVisible() {
        testLogger.info('Verifying sidebar menu items are visible');
        await expect(this.page.locator(this.locators.alertMenuItem)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.locators.incidentsMenuItem)).toBeVisible({ timeout: 10000 });
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
     * Click acknowledge button on first incident with "open" status
     */
    async clickAcknowledgeOnFirstOpenIncident() {
        testLogger.info('Clicking acknowledge button on first open incident');
        const ackButton = this.page.locator(this.locators.incidentAckButton).first();
        await ackButton.waitFor({ state: 'visible', timeout: 10000 });
        await ackButton.click();
        await this.page.waitForTimeout(1000); // Wait for status update
        testLogger.info('Clicked acknowledge button');
    }

    /**
     * Click resolve button on first incident
     */
    async clickResolveOnFirstIncident() {
        testLogger.info('Clicking resolve button on first incident');
        const resolveButton = this.page.locator(this.locators.incidentResolveButton).first();
        await resolveButton.waitFor({ state: 'visible', timeout: 10000 });
        await resolveButton.click();
        await this.page.waitForTimeout(1000); // Wait for status update
        testLogger.info('Clicked resolve button');
    }

    /**
     * Click reopen button on first resolved incident
     */
    async clickReopenOnFirstResolvedIncident() {
        testLogger.info('Clicking reopen button on first resolved incident');
        const reopenButton = this.page.locator(this.locators.incidentReopenButton).first();
        await reopenButton.waitFor({ state: 'visible', timeout: 10000 });
        await reopenButton.click();
        await this.page.waitForTimeout(1000); // Wait for status update
        testLogger.info('Clicked reopen button');
    }

    /**
     * Verify acknowledge button is visible on first incident
     */
    async expectAcknowledgeButtonVisible() {
        await expect(this.page.locator(this.locators.incidentAckButton).first()).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify acknowledge button is hidden (not visible)
     */
    async expectAcknowledgeButtonHidden() {
        await expect(this.page.locator(this.locators.incidentAckButton).first()).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify resolve button is visible on first incident
     */
    async expectResolveButtonVisible() {
        await expect(this.page.locator(this.locators.incidentResolveButton).first()).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify resolve button is hidden (not visible)
     */
    async expectResolveButtonHidden() {
        await expect(this.page.locator(this.locators.incidentResolveButton).first()).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify reopen button is visible on first incident
     */
    async expectReopenButtonVisible() {
        await expect(this.page.locator(this.locators.incidentReopenButton).first()).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify reopen button is hidden (not visible)
     */
    async expectReopenButtonHidden() {
        await expect(this.page.locator(this.locators.incidentReopenButton).first()).not.toBeVisible({ timeout: 5000 });
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
