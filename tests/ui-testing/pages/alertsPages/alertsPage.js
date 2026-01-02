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

            // View Mode Tabs (Alerts / Incidents) - VERIFIED from source code
            alertIncidentViewTabs: '[data-test="alert-incident-view-tabs"]',
            alertsViewTab: '[data-test="tab-alerts"]',
            incidentsViewTab: '[data-test="tab-incidents"]',

            // Incidents view locators
            incidentListTable: '[data-test="incident-list-table"]',
            incidentSearchInput: '[data-test="incident-search-input"]',

            // Import button
            alertImportButton: '[data-test="alert-import"]',

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

    // ==================== VIEW MODE TABS (ALERTS / INCIDENTS) ====================

    /**
     * Click the Alerts view tab
     */
    async clickAlertsTab() {
        testLogger.info('Clicking Alerts tab');
        await this.page.locator(this.locators.alertsViewTab).click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        testLogger.info('Switched to Alerts view');
    }

    /**
     * Click the Incidents view tab
     */
    async clickIncidentsTab() {
        testLogger.info('Clicking Incidents tab');
        await this.page.locator(this.locators.incidentsViewTab).click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        testLogger.info('Switched to Incidents view');
    }

    /**
     * Verify the view mode tabs are visible on page load
     */
    async expectViewModeTabsVisible() {
        testLogger.info('Verifying view mode tabs are visible');
        await expect(this.page.locator(this.locators.alertIncidentViewTabs)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.locators.alertsViewTab)).toBeVisible();
        await expect(this.page.locator(this.locators.incidentsViewTab)).toBeVisible();
        testLogger.info('View mode tabs verified');
    }

    /**
     * Verify Alerts view UI elements are visible
     */
    async expectAlertsViewElementsVisible() {
        testLogger.info('Verifying Alerts view elements');
        await expect(this.page.locator('[data-test="alert-list-table"]')).toBeVisible({ timeout: 10000 });
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
        await expect(this.page.locator('[data-test="alert-list-table"]')).not.toBeVisible();
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
}
