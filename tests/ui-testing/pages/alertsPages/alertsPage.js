import { expect, test } from '@playwright/test';
import fs from 'fs';
import { CommonActions } from '../commonActions';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertsPage {
    constructor(page) {
        this.page = page;
        this.commonActions = new CommonActions(page);
        
        // Alert related locators
        this.alertMenuItem = '[data-test="menu-link-\\/alerts-item"]';
        this.newFolderButton = '[data-test="dashboard-new-folder-btn"]';
        this.folderNameInput = '[data-test="dashboard-folder-add-name"]';
        this.folderDescriptionInput = '[data-test="dashboard-folder-add-description"]';
        this.folderSaveButton = '[data-test="dashboard-folder-add-save"]';
        this.folderCancelButton = '[data-test="dashboard-folder-add-cancel"]';
        this.noDataAvailableText = 'No data available';
        this.folderExistsError = 'Folder with this name already exists in this organization';
        // Note: Folder more options button is accessed via dashboard-more-icon data-test in the folder row
        this.folderMoreOptionsButton = '[data-test="dashboard-more-icon"]';
        this.deleteFolderOption = 'Delete';
        this.deleteFolderConfirmText = 'Delete Folder';
        this.folderDeletedMessage = 'Folder deleted successfully.';

        // Alert creation locators - Alerts 2.0 Wizard UI
        this.addAlertButton = '[data-test="alert-list-add-alert-btn"]';
        this.alertNameInput = '[data-test="add-alert-name-input"]';  // Updated for Alerts 2.0
        this.alertSubmitButton = '[data-test="add-alert-submit-btn"]';
        this.alertBackButton = '[data-test="add-alert-back-btn"]';

        // Step 1: Alert Setup selectors
        this.streamTypeDropdown = '[data-test="add-alert-stream-type-select-dropdown"]';
        this.streamNameDropdown = '[data-test="add-alert-stream-name-select-dropdown"]';
        this.realtimeAlertRadio = '[data-test="add-alert-realtime-alert-radio"]';
        this.scheduledAlertRadio = '[data-test="add-alert-scheduled-alert-radio"]';

        // Step 2: Query/Conditions selectors
        this.queryTabsContainer = '[data-test="step2-query-tabs"]';
        this.viewEditorButton = '[data-test="step2-view-editor-btn"]';
        this.conditionsTabsContainer = '[data-test="scheduled-alert-tabs"]';
        this.conditionColumnSelect = '[data-test="alert-conditions-select-column"]';
        this.operatorSelect = '[data-test="alert-conditions-operator-select"]';
        this.conditionValueInput = '[data-test="alert-conditions-value-input"]';
        this.addConditionButton = '[data-test="alert-conditions-add-condition-btn"]';
        this.addFirstConditionButton = '[data-test="alert-conditions-add-btn"]';  // Button shown when no conditions exist
        this.addConditionGroupButton = '[data-test="alert-conditions-add-condition-group-btn"]';
        this.deleteConditionButton = '[data-test="alert-conditions-delete-condition-btn"]';
        this.columnInput = '[data-test="alert-conditions-select-column"]';  // Alias for backward compatibility
        this.valueInput = '[data-test="alert-conditions-value-input"]';  // Alias for backward compatibility

        // Step 3: Compare with Past (Scheduled only)
        this.multiTimeRangeAddButton = '[data-test="multi-time-range-alerts-add-btn"]';
        this.multiTimeRangeDeleteButton = '[data-test="multi-time-range-alerts-delete-btn"]';
        this.goToViewEditorButton = '[data-test="go-to-view-editor-btn"]';

        // Step 4: Alert Settings selectors
        this.createDestinationButton = '[data-test="create-destination-btn"]';
        // Note: Destination select is now a q-select without specific data-test in AlertSettings
        // Silence notification replaces delay for real-time alerts

        // Step 5: Deduplication (Scheduled only) - no specific data-test selectors yet

        // Step 6: Advanced settings
        this.contextAttributesAddButton = '[data-test="alert-variables-add-btn"]';
        this.contextAttributeKeyInput = '[data-test="alert-variables-key-input"]';
        this.contextAttributeValueInput = '[data-test="alert-variables-value-input"]';
        this.rowTemplateTextarea = '[data-test="add-alert-row-input-textarea"]';

        // Query Editor Dialog selectors
        this.sqlEditorDialog = '[data-test="scheduled-alert-sql-editor"]';
        this.promqlEditorDialog = '[data-test="scheduled-alert-promql-editor"]';
        this.vrlFunctionEditorDialog = '[data-test="scheduled-alert-vrl-function-editor"]';
        this.runQueryButton = '[data-test="alert-run-query-btn"]';
        this.generateQueryButton = '[data-test="alert-generate-query-btn"]';

        // Preview
        this.alertPreviewChart = '[data-test="alert-preview-chart"]';

        // Legacy selectors (deprecated but kept for reference during transition)
        this.alertDelayInput = '[data-test="add-alert-delay-input"]';  // Now "Silence Notification" in Step 4
        this.destinationSelect = '[data-test="add-alert-destination-select"]';  // Now in AlertSettings step

        // Messages
        this.alertSuccessMessage = 'Alert saved successfully.';
        this.alertUpdatedMessage = 'Alert updated successfully.';
        this.alertClonedMessage = 'Alert Cloned Successfully';
        this.alertDeletedMessage = 'Alert deleted';
        this.alertSetupText = 'Alert Setup';
        this.deleteConfirmText = 'Are you sure you want to delete this alert?';
        this.deleteButtonText = 'Delete';
        this.containsOperatorText = 'Contains';
        this.arrowDropDownText = 'arrow_drop_down';

        // Clone dialog selectors
        this.cloneAlertTitle = '[data-test="clone-alert-title"]';
        this.cloneAlertName = '[data-test="to-be-clone-alert-name"]';
        this.cloneStreamType = '[data-test="to-be-clone-stream-type"]';
        this.cloneStreamName = '[data-test="to-be-clone-stream-name"]';
        this.cloneSubmitButton = '[data-test="clone-alert-submit-btn"]';
        this.cloneCancelButton = '[data-test="clone-alert-cancel-btn"]';
        this.pauseStartAlert = '[data-test="alert-list-{alertName}-pause-start-alert"]';

        // Alert management locators
        this.alertUpdateButton = '[data-test="alert-list-{alertName}-update-alert"]';
        this.alertCloneButton = '[data-test="alert-list-{alertName}-clone-alert"]';
        this.alertMoreOptions = '[data-test="alert-list-{alertName}-more-options"]';
        this.confirmButton = '[data-test="confirm-button"]';

        // Alert movement locators
        this.selectAllCheckboxRowName = '# Name Owner Period Frequency';
        this.moveAcrossFoldersButton = '[data-test="alert-list-move-across-folders-btn"]';
        this.folderDropdown = '[data-test="alerts-index-dropdown-stream_type"]';
        this.moveButton = '[data-test="alerts-folder-move"]';
        this.alertsMovedMessage = 'alerts Moved successfully';

        // Alert search and deletion locators
        this.alertSearchInput = '[data-test="alert-list-search-input"]';
        this.searchAcrossFoldersToggle = '[data-test="alert-list-search-across-folders-toggle"]';
        this.alertDeleteOption = 'Delete';
        this.alertDeletedMessage = 'Alert deleted';

        // Alert graph/chart locators (for regression test Bug #9311)
        this.alertGraph = '[data-test="alert-graph"]';
        this.alertChart = '.alert-chart';

        // Table locators
        this.tableBodyRowWithIndex = 'tbody tr[data-index]';
        this.tableLocator = 'table';

        // Alert settings inline locators (moved from methods)
        this.silenceNotificationInput = '.silence-notification-input input';
        this.stepAlertConditions = '.step-alert-conditions';
        this.stepAlertConditionsQSelect = '.step-alert-conditions .q-select';
        this.stepAlertConditionsNumberInput = '.step-alert-conditions input[type="number"]';
        this.alertSettingsRow = '.alert-settings-row';
        this.viewLineLocator = '.view-line';
        this.qDialogLocator = '.q-dialog';

        // Home page alert count locators
        this.scheduledColumnLocator = '.column:has(.text-subtitle:text("Scheduled"))';
        this.realTimeColumnLocator = '.column:has(.text-subtitle:text("Real time"))';
        this.resultsCountLocator = '.results-count';

        // Store the generated folder name and alert name
        this.currentFolderName = '';
        this.currentAlertName = '';
    }

    async alertsURLValidation() {
        await expect(this.page).toHaveURL(/alerts/);
    }

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

    /** @param {string} folderName @param {string} [description] */
    async createFolder(folderName, description = '') {
        await this.page.locator(this.newFolderButton).click();
        await this.page.locator(this.folderNameInput).click();
        await this.page.locator(this.folderNameInput).fill(folderName);
        
        if (description) {
            await this.page.locator(this.folderDescriptionInput).click();
            await this.page.locator(this.folderDescriptionInput).fill(description);
        }
        
        await this.page.locator(this.folderSaveButton).click();
    }

    /** @param {string} folderName */
    async verifyFolderCreated(folderName) {
        await expect(this.page.getByText(folderName)).toBeVisible();
    }

    /** @param {string} folderName */
    async clickFolder(folderName) {
        await this.page.getByText(folderName).click();
    }

    /**
     * Navigate to a specific folder
     * @param {string} folderName - Name of the folder to navigate to
     */
    async navigateToFolder(folderName) {
        await this.page.getByText(folderName).first().click();
        // Wait for the folder content to load by checking for either the table or no data message
        try {
            await Promise.race([
                this.page.locator(this.tableLocator).waitFor({ state: 'visible', timeout: 30000 }),
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
        await expect(this.page.getByText(this.folderExistsError)).toBeVisible();
    }

    async cancelFolderCreation() {
        await this.page.locator(this.folderCancelButton).click();
    }

    /**
     * Create a real-time alert using Alerts 2.0 wizard UI
     * Wizard steps for real-time: Step 1 (Setup) -> Step 2 (Conditions) -> Step 4 (Settings) -> Step 6 (Advanced) -> Submit
     * @param {string} streamName - Name of the stream
     * @param {string} column - Column name for condition
     * @param {string} value - Value for condition
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     */
    async createAlert(streamName, column, value, destinationName, randomValue) {
        const randomAlertName = 'Automation_Alert_' + randomValue;
        this.currentAlertName = randomAlertName;  // Store the alert name

        // Click Add Alert button to start wizard
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        // Wait for the alert name input to be visible (Step 1)
        await expect(this.page.locator(this.alertNameInput)).toBeVisible({ timeout: 10000 });

        // Fill alert name
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs)
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await expect(this.page.locator(this.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.streamNameDropdown).click();

        // Check if stream options appear, if not click again
        try {
            await expect(this.page.getByText(`${streamName}`, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, retrying');
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
            await expect(this.page.getByText(`${streamName}`, { exact: true })).toBeVisible({ timeout: 5000 });
        }
        await this.page.getByText(`${streamName}`, { exact: true }).click();
        testLogger.info('Selected stream name', { streamName });

        // Select Real-time alert type
        await expect(this.page.locator(this.realtimeAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.realtimeAlertRadio).click();
        testLogger.info('Selected real-time alert type');

        // ==================== STEP 2: CONDITIONS ====================
        // Navigate to Step 2 by clicking Continue
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // First, click "Add Condition" button to add a new condition row
        // In Alerts 2.0, conditions start empty and need to be added
        await this.page.locator(this.addConditionButton).first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Added new condition row');

        // Add condition: Select column
        await this.page.locator(this.conditionColumnSelect).first().click();
        await expect(this.page.getByRole('option', { name: column })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: column }).click();
        testLogger.info('Selected column for condition', { column });

        // Select operator (Contains)
        await expect(this.page.locator(this.operatorSelect).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.operatorSelect).first().click();
        await this.page.getByText('Contains', { exact: true }).click();
        testLogger.info('Selected operator: Contains');

        // Fill value (the data-test is on the wrapper div, so we need to target the input inside)
        await this.page.locator(this.conditionValueInput).first().locator('input').fill(value);
        testLogger.info('Filled condition value', { value });

        // ==================== STEP 4: ALERT SETTINGS ====================
        // Navigate to Step 4 (skip Step 3 for real-time)
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // Set Silence Notification to 0 minutes
        // The silence notification input replaces the old delay input for real-time alerts
        const silenceInput = this.page.locator(this.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
            testLogger.info('Set silence notification to 0 minutes');
        }

        // Select destination for REAL-TIME alerts
        // Real-time alerts use a different layout than scheduled alerts - they don't have .alert-settings-row
        // Find the destination section by looking for the "Destination" text label, then find the q-select within the same container
        const destinationSection = this.page.locator('div.flex.items-start').filter({
            has: this.page.locator('span:has-text("Destination")')
        }).first();

        // Wait for the destination section to be visible
        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });

        // Find the q-select dropdown within the destination section
        const destinationDropdown = destinationSection.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Find and select the destination from the dropdown options
        const destinationOption = this.page.getByText(destinationName, { exact: true }).first();
        if (await destinationOption.isVisible({ timeout: 3000 })) {
            await destinationOption.click();
        } else {
            await this.commonActions.scrollAndFindOption(destinationName, 'destination');
        }
        await this.page.waitForTimeout(500);

        // Click outside to close dropdown
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 6: ADVANCED (Skip) ====================
        // Navigate to Step 6 by clicking Continue (we'll skip Advanced settings)
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (skipping)');

        // ==================== SUBMIT ALERT ====================
        // Click the Submit button
        await this.page.locator(this.alertSubmitButton).click();

        // Wait for success message
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    /** @param {string} alertName */
    async verifyAlertCreated(alertName) {
        const nameToVerify = alertName || this.currentAlertName;  // Use provided name or stored name
        await expect(this.page.getByRole('cell', { name: nameToVerify }).first()).toBeVisible();
        await expect(this.page.locator(this.pauseStartAlert.replace('{alertName}', nameToVerify)).first()).toBeVisible();
    }

    /**
     * Create a real-time alert with default/first available column using Alerts 2.0 wizard UI
     * This is more resilient than createAlert as it doesn't require a specific column name
     * @param {string} streamName - Name of the stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     */
    async createAlertWithDefaults(streamName, destinationName, randomValue) {
        const randomAlertName = 'Automation_Alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        // Click Add Alert button to start wizard
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs)
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await expect(this.page.locator(this.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.streamNameDropdown).click();
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
        }
        await this.page.getByText(streamName, { exact: true }).click();
        testLogger.info('Selected stream name', { streamName });

        // Select Real-time alert type
        await expect(this.page.locator(this.realtimeAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.realtimeAlertRadio).click();
        testLogger.info('Selected real-time alert type');

        // ==================== STEP 2: CONDITIONS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // Add condition - check which button is visible
        const firstCondBtn = this.page.locator(this.addFirstConditionButton);
        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else {
            await this.page.locator(this.addConditionButton).first().click();
        }
        await this.page.waitForTimeout(1000);

        // Wait for condition to appear
        await expect(this.page.locator(this.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Select first available column (flexible)
        const columnSelect = this.page.locator(this.conditionColumnSelect).first().locator('.q-select');
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        await expect(this.page.locator('.q-menu .q-item').first()).toBeVisible({ timeout: 5000 });
        await this.page.locator('.q-menu .q-item').first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected first available column');

        // Select operator (Contains)
        const operatorSelect = this.page.locator(this.operatorSelect).first().locator('.q-select');
        await operatorSelect.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected operator: Contains');

        // Fill value
        await this.page.locator(this.conditionValueInput).first().locator('input').fill('test');
        testLogger.info('Filled condition value: test');

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // Set Silence Notification to 0 minutes
        const silenceInput = this.page.locator(this.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
            testLogger.info('Set silence notification to 0 minutes');
        }

        // Select destination for REAL-TIME alerts
        const destinationSection = this.page.locator('div.flex.items-start').filter({
            has: this.page.locator('span:has-text("Destination")')
        }).first();
        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });
        const destinationDropdown = destinationSection.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const destinationOption = this.page.getByText(destinationName, { exact: true }).first();
        if (await destinationOption.isVisible({ timeout: 3000 })) {
            await destinationOption.click();
        } else {
            await this.commonActions.scrollAndFindOption(destinationName, 'destination');
        }
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (skipping)');

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert with defaults', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Update an existing alert using Alerts 2.0 wizard UI
     * Opens the alert edit wizard and modifies the operator condition
     * @param {string} alertName - Name of the alert to update
     */
    async updateAlert(alertName) {
        // Click the update/edit button for the alert
        await this.page.locator(this.alertUpdateButton.replace('{alertName}', alertName)).first().click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Opened alert for editing', { alertName });

        // Wait for wizard to load - Step 1 (Alert Setup) should be visible
        await expect(this.page.getByText(this.alertSetupText).first()).toBeVisible({ timeout: 10000 });
        await this.page.waitForTimeout(1000);

        // Navigate to Step 2 (Conditions) to update the operator
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // Click the operator dropdown and select new operator (change from Contains to =)
        const operatorDropdown = this.page.locator(this.operatorSelect).first();
        await expect(operatorDropdown).toBeVisible({ timeout: 5000 });
        await operatorDropdown.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('=', { exact: true }).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Changed operator from Contains to =');

        // Navigate through remaining steps to reach the last step (Submit is only enabled on last step)
        // For real-time alerts: Step 2 -> Step 4 -> Step 6 (last)
        // Navigate to Step 4 (Alert Settings)
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // Navigate to Step 6 (Advanced - last step for real-time alerts)
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (last step)');

        // Submit the updated alert (now on last step, button should be enabled)
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertUpdatedMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully updated alert', { alertName });
    }

    /** @param {string} alertName @param {string} streamType @param {string} streamName */
    async cloneAlert(alertName, streamType, streamName) {
        await this.page.locator(this.alertCloneButton.replace('{alertName}', alertName)).click();
        await expect(this.page.locator(this.cloneAlertTitle)).toBeVisible();
        await this.page.locator(this.cloneStreamType).click();
        await this.page.waitForTimeout(2000); // Wait for stream type options to load
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.locator(this.cloneStreamName).click();
        await this.page.getByText(streamName, { exact: true }).click();
        await this.page.locator(this.cloneSubmitButton).click();
        await expect(this.page.getByText(this.alertClonedMessage)).toBeVisible();
        testLogger.info('Successfully cloned alert', { alertName });
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

    async moveAllAlertsToFolder(targetFolderName) {
        // Select all alerts using the header checkbox in the alert list table
        // The header checkbox is in a q-th element with class o2-table-checkbox
        const headerCheckbox = this.page.locator('[data-test="alert-list-table"] thead .o2-table-checkbox').first();
        await headerCheckbox.waitFor({ state: 'visible', timeout: 10000 });
        await headerCheckbox.click();
        testLogger.info('Clicked select all checkbox');

        await expect(this.page.getByText(/Showing 1 - [12] of/)).toBeVisible();

        // Click move across folders button
        await this.page.locator(this.moveAcrossFoldersButton).click();

        // Handle folder selection with scrolling
        await this.page.locator(this.folderDropdown).click();
        await this.page.waitForTimeout(2000); // Wait for folder options to load
        
        // Use the common scroll function
        await this.commonActions.scrollAndFindOption(targetFolderName, 'folder');

        // Click move button and verify
        await this.page.locator(this.moveButton).click();
        
        // Wait for move operation to complete
        await this.page.waitForLoadState('networkidle');
        
        // Verify success message and empty state
        await expect(this.page.getByText(this.alertsMovedMessage)).toBeVisible();
        await expect(this.page.getByText(this.noDataAvailableText)).toBeVisible();
        
        testLogger.info('Successfully moved alerts to folder', { targetFolderName });
    }

    async deleteFolder(folderName) {
        // 1. Hover on the folder row to trigger the menu to appear
        const folderRow = this.page.locator(`div.folder-item:has-text("${folderName}")`);
        await folderRow.hover();
        await this.page.waitForTimeout(500); // Give time for hover effect to apply

        // 2. Wait for the 3-dot button to appear
        const dotButton = this.page.locator(`div.folder-item:has-text("${folderName}") button.q-btn`);
        await dotButton.waitFor({ state: 'visible', timeout: 3000 });

        // 3. Optional: Verify Playwright thinks it's visible and enabled
        testLogger.info('Button state', {
            visible: await dotButton.isVisible(),
            enabled: await dotButton.isEnabled()
        });

        // 4. Force click the button
        await dotButton.click({ force: true });

        // Verify the click worked by checking for Delete option
        await expect(this.page.getByText(this.deleteFolderOption)).toBeVisible({ timeout: 3000 });

        // Continue with the rest of the deletion process
        await this.page.getByText(this.deleteFolderOption).click();
        await expect(this.page.getByText(this.deleteFolderConfirmText)).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.folderDeletedMessage)).toBeVisible();

        testLogger.info('Successfully deleted folder', { folderName });
    }

    /**
     * Pauses an alert using Alerts 2.0 UI
     * In the new UI, the pause/start button is a direct toggle without a secondary dialog
     * @param {string} alertName - Name of the alert to pause
     */
    async pauseAlert(alertName) {
        // Click the pause/start toggle button for an ENABLED alert
        // In Alerts 2.0 UI:
        // - Enabled alerts have button with color="negative" (red pause icon) - clicking pauses
        // - Disabled/paused alerts have button with color="positive" (green play icon) - clicking resumes
        // The color prop adds text-negative or text-positive class to the button

        // Wait for page to stabilize (important after clone operation which adds new rows)
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        const alertSelector = `[data-test="alert-list-${alertName}-pause-start-alert"]`;
        const allButtons = this.page.locator(alertSelector);
        const buttonCount = await allButtons.count();
        testLogger.info('Found pause/start buttons for pause operation', { alertName, buttonCount });

        // Find the button with text-negative class (enabled alert, showing pause icon)
        let pauseButton = null;
        for (let i = 0; i < buttonCount; i++) {
            const btn = allButtons.nth(i);
            const classList = await btn.getAttribute('class');
            testLogger.debug(`Button ${i} class`, { classList });
            if (classList && classList.includes('text-negative')) {
                pauseButton = btn;
                testLogger.info('Found enabled alert button to pause', { buttonIndex: i });
                break;
            }
        }

        if (!pauseButton) {
            // Fallback to first button if class detection fails
            testLogger.warn('Could not find button with text-negative class, using first button');
            pauseButton = allButtons.first();
        }

        await expect(pauseButton).toBeVisible({ timeout: 5000 });
        await pauseButton.click();

        // Wait for success message
        await expect(this.page.getByText('Alert Paused Successfully')).toBeVisible({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Successfully paused alert', { alertName });
    }

    /**
     * Resumes an alert using Alerts 2.0 UI
     * In the new UI, the pause/start button is a direct toggle without a secondary dialog
     * @param {string} alertName - Name of the alert to resume
     */
    async resumeAlert(alertName) {
        // Click the pause/start toggle button for a PAUSED alert
        // In Alerts 2.0 UI:
        // - Enabled alerts have button with color="negative" (red pause icon) - clicking pauses
        // - Disabled/paused alerts have button with color="positive" (green play icon) - clicking resumes
        // The color prop adds text-negative or text-positive class to the button

        testLogger.info('Starting resumeAlert', { alertName });

        // Wait for page to stabilize after pause operation
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        const alertSelector = `[data-test="alert-list-${alertName}-pause-start-alert"]`;
        const allButtons = this.page.locator(alertSelector);
        const buttonCount = await allButtons.count();
        testLogger.info('Found pause/start buttons for resume operation', { alertName, buttonCount });

        // Find the button with text-positive class (paused alert, showing play icon)
        let resumeButton = null;
        for (let i = 0; i < buttonCount; i++) {
            const btn = allButtons.nth(i);
            const classList = await btn.getAttribute('class');
            testLogger.info(`Button ${i} class for resume`, { classList });
            if (classList && classList.includes('text-positive')) {
                resumeButton = btn;
                testLogger.info('Found paused alert button to resume', { buttonIndex: i });
                break;
            }
        }

        if (!resumeButton) {
            // Fallback to first button if class detection fails
            testLogger.warn('Could not find button with text-positive class, using first button');
            resumeButton = allButtons.first();
        }

        await expect(resumeButton).toBeVisible({ timeout: 10000 });
        await resumeButton.click();
        testLogger.info('Clicked resume button', { alertName });

        // Wait for success message
        await expect(this.page.getByText('Alert Resumed Successfully')).toBeVisible({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Successfully resumed alert', { alertName });
    }

    /**
     * Delete alert by name
     * @param {string} alertName - Name of the alert to delete
     */
    async deleteAlertByRow(alertName) {
        const kebabButton = this.page.locator(`[data-test="alert-list-${alertName}-more-options"]`).first();
        await kebabButton.waitFor({ state: 'visible', timeout: 5000 });
        await kebabButton.click();

        // Wait for delete option to appear, retry kebab click if needed
        try {
            await this.page.getByText('Delete', { exact: true }).waitFor({ state: 'visible', timeout: 3000 });
        } catch (e) {
            testLogger.warn('Delete option not visible after first kebab click, retrying', { alertName });
            await kebabButton.click();
            await this.page.getByText('Delete', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
        }

        await this.page.getByText('Delete', { exact: true }).click();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.alertDeletedMessage)).toBeVisible();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Search for alerts by name
     * @param {string} alertName - Name of the alert to search for
     */
    async searchAlert(alertName) {
        await this.page.locator(this.alertSearchInput).click();
        await this.page.locator(this.alertSearchInput).fill('');  // Clear the input first
        await this.page.locator(this.alertSearchInput).fill(alertName.toLowerCase());
        await this.page.waitForTimeout(2000); // Wait for search to complete

        // Wait for either search results or no data message
        try {
            await Promise.race([
                this.page.locator(this.tableLocator).waitFor({ state: 'visible', timeout: 30000 }),
                this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
            ]);
        } catch (error) {
            testLogger.error('Neither table nor no data message found after search', { alertName, error: error.message });
            throw new Error(`Failed to search for alert "${alertName}": Neither table nor "No data available" message appeared`);
        }
    }

    /**
     * Search for an alert and delete ALL instances of it across all folders
     * Used when cleaning up alerts that are blocking destination deletion
     * @param {string} alertName - Name of the alert to search and delete
     */
    async searchAndDeleteAlert(alertName) {
        testLogger.info('Searching for alert to delete across all folders', { alertName });

        // Navigate to alerts page (assuming we're coming from destinations)
        await this.page.locator(this.alertMenuItem).click();
        await this.page.waitForTimeout(2000);

        // Click "Search Across Folder" toggle - use force to bypass intercepting element
        await this.page.locator(this.searchAcrossFoldersToggle).locator('div').nth(1).click({ force: true });
        await this.page.waitForTimeout(500);

        // Search for the alert - use original case, not lowercase
        await this.page.locator(this.alertSearchInput).click();
        await this.page.locator(this.alertSearchInput).fill('');
        await this.page.locator(this.alertSearchInput).fill(alertName);
        await this.page.waitForTimeout(2000);

        // Delete all instances of this alert until search yields no results
        let deletedCount = 0;
        while (true) {
            try {
                // Check if alert exists in search results
                await this.page.getByRole('cell', { name: alertName }).first().waitFor({ state: 'visible', timeout: 3000 });
                testLogger.debug('Found alert instance, deleting', { alertName, instance: deletedCount + 1 });

                // Delete the alert directly (no need to pause)
                await this.deleteAlertByRow(alertName);
                deletedCount++;
                testLogger.debug('Deleted alert instance', { alertName, deletedCount });

                // Wait a bit for deletion to complete
                await this.page.waitForTimeout(1000);

                // The search should still be active, check if more instances exist
            } catch (e) {
                // No more instances found in search results
                testLogger.info('No more instances of alert found in search', { alertName, totalDeleted: deletedCount });
                break;
            }
        }

        if (deletedCount === 0) {
            testLogger.warn('Alert not found for deletion', { alertName });
        } else {
            testLogger.info('Successfully deleted all instances of alert', { alertName, totalDeleted: deletedCount });
        }
    }

    /**
     * Verify search results count
     * @param {number} expectedCount - Expected number of results
     */
    async verifySearchResults(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText)).toBeVisible();
    }

    async verifySearchResultsUIValidation(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Get the current alert count from the pagination text
     * @returns {Promise<number>} The total number of alerts
     */
    async getAlertCount() {
        try {
            // Wait for pagination text like "Showing 1 - 10 of 25"
            const paginationText = await this.page.locator('text=/Showing \\d+ - \\d+ of/').textContent({ timeout: 3000 });
            const match = paginationText.match(/of (\d+)/);
            if (match) {
                const count = parseInt(match[1], 10);
                testLogger.debug('Current alert count', { count });
                return count;
            }
        } catch (e) {
            // No pagination found, check if "No data available" is shown
            testLogger.debug('No pagination text found, checking for "No data available"');
        }

        // Check if "No data available" is shown
        try {
            const noData = await this.page.getByText('No data available').isVisible({ timeout: 1000 });
            if (noData) {
                testLogger.debug('No alerts found in folder');
                return 0;
            }
        } catch (e) {
            // Neither pagination nor "No data available" found
        }

        return 0; // Default to 0 if we can't determine
    }

    /**
     * Check if alerts exist in current view
     * @returns {Promise<boolean>}
     */
    async hasAlerts() {
        try {
            const count = await this.getAlertCount();
            return count > 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get all alert names from the current page
     * @returns {Promise<string[]>} Array of alert names
     */
    async getAllAlertNames() {
        const alertNames = [];

        // Find all rows with alert data
        const moreOptionsButtons = await this.page.locator('[data-test*="alert-list-"][data-test*="-more-options"]').all();

        for (const button of moreOptionsButtons) {
            const dataTest = await button.getAttribute('data-test');
            // Extract alert name from data-test="alert-list-{alertName}-more-options"
            const match = dataTest.match(/alert-list-(.+)-more-options/);
            if (match && match[1]) {
                alertNames.push(match[1]);
            }
        }

        testLogger.debug('Found alert names', { alertNames, count: alertNames.length });
        return alertNames;
    }

    /**
     * Select all alerts using the checkbox
     */
    async selectAllAlerts() {
        const selectAllCheckbox = this.page.getByRole('row', { name: this.selectAllCheckboxRowName }).getByRole('checkbox');
        await selectAllCheckbox.waitFor({ state: 'visible', timeout: 5000 });
        await selectAllCheckbox.click();
        testLogger.debug('Selected all alerts');
    }

    /**
     * Pause all selected alerts using the bulk pause button
     */
    async pauseAllSelectedAlerts() {
        const pauseButton = this.page.locator('[data-test="alert-list-pause-alerts-btn"]');
        await pauseButton.waitFor({ state: 'visible', timeout: 5000 });
        await pauseButton.click();
        await this.page.waitForTimeout(1000); // Wait for pause action to complete
        testLogger.debug('Paused all selected alerts');
    }

    /**
     * Delete all alerts in the current folder one by one
     * This method:
     * 1. Checks how many alerts exist
     * 2. Gets all alert names
     * 3. Deletes them one by one until none remain
     */
    async deleteAllAlertsInFolder() {
        testLogger.info('Starting to delete all alerts in current folder');

        // Wait for page to fully load and stabilize first
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        let totalDeleted = 0;

        // Keep looping until no more alerts found
        while (true) {
            // Check if there are any alerts
            const hasAny = await this.hasAlerts();
            if (!hasAny) {
                testLogger.info('No alerts found to delete', { totalDeleted });
                break;
            }

            // Get all alert names on current page
            let alertNames = await this.getAllAlertNames();
            if (alertNames.length === 0) {
                testLogger.info('No alert names found, stopping');
                break;
            }

            testLogger.info('Found alerts to delete in this batch', { count: alertNames.length, alertNames });

            // Delete all alerts from current page
            for (const alertName of alertNames) {
                testLogger.debug('Deleting alert', { alertName });
                await this.deleteAlertByRow(alertName);
                totalDeleted++;
            }

            // Wait for page to stabilize after deletions
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(1000);
        }

        // Final verification
        testLogger.info('Performing final verification');
        await this.page.waitForTimeout(1000);
        const finalHasAlerts = await this.hasAlerts();
        if (finalHasAlerts) {
            const remainingAlerts = await this.getAllAlertNames();
            testLogger.error('Alerts still exist after deletion!', { remainingAlerts });
            throw new Error(`Failed to delete all alerts. Remaining: ${remainingAlerts.join(', ')}`);
        }

        testLogger.info('Verification complete: All alerts in folder deleted', { totalDeleted });
    }

    /**
     * Create a scheduled alert with SQL query
     * @param {string} streamName - Name of the stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random value for unique naming
     */
    /**
     * Create a scheduled alert with SQL query using Alerts 2.0 wizard UI
     * Wizard steps for scheduled: Step 1 (Setup) -> Step 2 (Conditions/SQL) -> Step 3 (Compare) -> Step 4 (Settings) -> Step 5 (Dedup) -> Step 6 (Advanced) -> Submit
     * @param {string} streamName - Name of the stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     */
    async createScheduledAlertWithSQL(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_scheduled_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        // Click Add Alert button to start wizard
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting scheduled alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.alertNameInput)).toBeVisible({ timeout: 10000 });

        // Fill alert name
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs)
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await expect(this.page.locator(this.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.streamNameDropdown).click();

        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, retrying');
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        }
        await this.page.getByText(streamName, { exact: true }).click();
        testLogger.info('Selected stream name', { streamName });

        // Select Scheduled alert type (should be default, but explicitly select)
        await expect(this.page.locator(this.scheduledAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.scheduledAlertRadio).click();
        testLogger.info('Selected scheduled alert type');

        // ==================== STEP 2: CONDITIONS (SQL) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // For scheduled alerts, the default tab is "Custom". We need to switch to "SQL" tab
        // Tab selector: data-test="tab-sql"
        const sqlTab = this.page.locator('[data-test="tab-sql"]');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to SQL tab');

        // Click View Editor button to open SQL editor dialog
        const viewEditorBtn = this.page.locator(this.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened SQL Editor dialog');

        // Enter SQL query in the dialog
        const sqlEditor = this.page.locator(this.sqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.viewLineLocator).first().click();
        await sqlEditor.fill('SELECT kubernetes_labels_name FROM "e2e_automate" where kubernetes_labels_name = \'ziox-querier\'');
        testLogger.info('Entered SQL query');

        // Run the query
        await this.page.locator(this.runQueryButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran SQL query');

        // Close the SQL editor dialog
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            if (await closeButton.isVisible({ timeout: 3000 })) {
                await closeButton.click();
            } else {
                // Try alternative close
                await this.page.locator(this.qDialogLocator).getByText('arrow_back_ios_new').click();
            }
        } catch (error) {
            testLogger.warn('Close button click failed, trying keyboard escape', { error: error.message });
            await this.page.keyboard.press('Escape');
        }
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Closed SQL Editor dialog');

        // ==================== STEP 3: COMPARE WITH PAST ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 3: Compare with Past');

        // Add a multi-time range entry
        const addTimeRangeBtn = this.page.locator(this.multiTimeRangeAddButton);
        if (await addTimeRangeBtn.isVisible({ timeout: 3000 })) {
            await addTimeRangeBtn.click();
            await this.page.waitForTimeout(1000);

            // Select a relative time (30 minutes)
            await this.page.locator('[data-test="date-time-btn"]').click();
            await this.page.locator('[data-test="date-time-relative-30-m-btn"]').click();
            testLogger.info('Added 30-minute time range comparison');
        }

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // For scheduled alerts using SQL, the form has:
        // - Threshold section with operator dropdown and value input
        // - Period input
        // - Destinations dropdown

        // Set threshold (>= 1) - find the operator dropdown (first q-select in step 4)
        const thresholdOperator = this.page.locator(this.stepAlertConditionsQSelect).first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click();
        testLogger.info('Set threshold operator: >=');

        // Set threshold value - find the number input near threshold
        const thresholdInput = this.page.locator(this.stepAlertConditionsNumberInput).first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        // Set period to 15 minutes - look for the period section
        const periodInput = this.page.locator('input[type="number"]').nth(1); // Second number input is usually period
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
            testLogger.info('Set period: 15 minutes');
        }

        // Select destination - find the destination row by its label and then the q-select
        // The destination label is "Destination *" and the dropdown is in a sibling div
        const destinationRow = this.page.locator(this.alertSettingsRow).filter({ hasText: /Destination/ });
        const destinationDropdown = destinationRow.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Try to click the destination option
        const destinationOption = this.page.getByText(destinationName, { exact: true }).first();
        if (await destinationOption.isVisible({ timeout: 3000 })) {
            await destinationOption.click();
        } else {
            // Fallback: scroll and find
            await this.commonActions.scrollAndFindOption(destinationName, 'destination');
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape'); // Close dropdown
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 5: DEDUPLICATION (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 5: Deduplication (skipping)');

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (skipping)');

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        await expect(this.page.getByRole('cell', { name: '15 Mins' }).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Successfully created scheduled alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    async exportAlerts() {
        // Select all alerts using the header checkbox in the alert list table
        const headerCheckbox = this.page.locator('[data-test="alert-list-table"] thead .o2-table-checkbox').first();
        await headerCheckbox.waitFor({ state: 'visible', timeout: 10000 });
        await headerCheckbox.click();
        testLogger.info('Clicked select all checkbox for export');

        const downloadPromise = this.page.waitForEvent('download');
        await this.page.locator('[data-test="alert-list-export-alerts-btn"]').click();
        const download = await downloadPromise;
        await this.page.waitForTimeout(2000); // Wait for the export process to complete
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

    async deleteImportedAlert(alertName) {
        let alertExists = true;
        let attempts = 0;
        const maxAttempts = 10; // Set a reasonable maximum number of attempts

        while (alertExists && attempts < maxAttempts) {
            try {
                // Wait for any instance of the alert to be visible
                await this.page.getByRole('cell', { name: alertName }).first().waitFor({ timeout: 2000 });
                
                // Get all instances of the alert
                const alertRows = this.page.getByRole('row').filter({ hasText: alertName });
                const count = await alertRows.count();
                
                if (count === 0) {
                    alertExists = false;
                    break;
                }

                // Click the first instance's more options button
                await alertRows.first()
                    .locator(`[data-test="alert-list-${alertName}-more-options"]`).click();
                await this.page.waitForTimeout(1000); // Wait for menu to appear
                
                // Click delete and confirm
                await this.page.getByText('Delete').click();
                await this.page.waitForTimeout(1000); // Wait for confirmation dialog
                await this.page.locator('[data-test="confirm-button"]').click();
                await expect(this.page.getByText('Alert deleted')).toBeVisible();
                
                // Wait longer for the deletion to take effect and UI to update
                await this.page.waitForTimeout(3000);
                attempts++;
                
                testLogger.info('Successfully deleted alert instance', { attempts, alertName });
            } catch (error) {
                testLogger.info('No more instances found or error occurred', { error: error.message });
                alertExists = false;
            }
        }
        
        if (attempts > 0) {
            testLogger.info('Successfully deleted all instances of alert', { attempts, alertName });
        } else {
            testLogger.info('No instances of alert found to delete', { alertName });
        }
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

    /**
     * Verify that alert creation fails with invalid name (Alerts 2.0 wizard)
     */
    async verifyInvalidAlertCreation() {
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000); // Wait for wizard Step 1 to load

        // Enter invalid alert name with spaces
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill('a b c');
        await this.page.waitForTimeout(1000); // Wait for validation to trigger

        // Verify validation error message
        await expect(this.page.getByText('Characters like :, ?, /, #,')).toBeVisible({ timeout: 10000 });
        testLogger.info('Invalid alert name validation working');

        // Go back to alert list
        await this.page.locator(this.alertBackButton).click();
    }

    async verifyAlertCounts() {
        // Find the column containing "Scheduled" text and get the results-count sibling
        const scheduledColumn = this.page.locator(this.scheduledColumnLocator).first();
        const scheduledAlertsCount = await scheduledColumn.locator(this.resultsCountLocator).textContent();

        // Find the column containing "Real time" text and get the results-count sibling
        const realTimeColumn = this.page.locator(this.realTimeColumnLocator).first();
        const realTimeAlertsCount = await realTimeColumn.locator(this.resultsCountLocator).textContent();

        return { scheduledAlertsCount, realTimeAlertsCount };
    }

    /**
     * Verify clone alert UI validation (Alerts 2.0)
     * @param {string} alertName - Name of the alert to clone
     */
    async verifyCloneAlertUIValidation(alertName) {
        // Open clone dialog
        await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // Try to submit without selecting stream type
        await this.page.locator(this.cloneSubmitButton).click();
        await expect(this.page.getByText('Please select stream type')).toBeVisible({ timeout: 5000 });
        testLogger.info('Clone validation working - stream type required');

        // Cancel the clone
        await this.page.locator(this.cloneCancelButton).click();
        await this.page.waitForTimeout(500);

        // Open clone dialog again and cancel with back button
        await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
        await this.page.waitForTimeout(1000);
        await this.page.locator(this.alertBackButton).click();
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

    /**
     * Verify field required validation (Alerts 2.0 wizard)
     * In the new wizard, trying to navigate to next step without required fields shows validation
     */
    async verifyFieldRequiredValidation() {
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000); // Wait for wizard Step 1 to load

        // Fill only alert name, leave stream type/name empty
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill('abc');

        // Try to go to next step without selecting stream type
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForTimeout(500);

        // Check for validation error on stream type dropdown
        await expect(this.page.getByText('Field is required!')).toBeVisible({ timeout: 5000 });
        testLogger.info('Field required validation working');

        // Go back to alert list
        await this.page.locator(this.alertBackButton).click();
    }

    async verifyAlertCountIncreased(initialCount, newCount) {
        const initial = parseInt(initialCount);
        const updated = parseInt(newCount);
        expect(updated).toBeGreaterThan(initial);
        testLogger.info('Alert count verification successful', { initialCount: initial, updatedCount: updated });
    }

    /**
     * Verify alert cell is visible in the alert list table
     * @param {string} alertName - Name of the alert to verify
     * @param {number} timeout - Timeout in milliseconds (default 10000)
     */
    async verifyAlertCellVisible(alertName, timeout = 10000) {
        // Use getByRole to find cell by accessible name (no data-test attribute exists for alert name cell)
        const alertCell = this.page.getByRole('cell', { name: alertName }).first();
        await expect(alertCell).toBeVisible({ timeout });
        testLogger.info('Verified alert cell is visible', { alertName });
    }

    // ==================== PROMQL ALERTS ====================

    /**
     * Create a scheduled alert with PromQL query using Alerts 2.0 wizard UI
     * @param {string} streamName - Name of the metrics stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     */
    async createScheduledAlertWithPromQL(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_promql_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        // Click Add Alert button to start wizard
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting PromQL alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.alertNameInput)).toBeVisible({ timeout: 10000 });

        // Fill alert name
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (metrics)
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'metrics' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'metrics' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: metrics');

        // Select stream name
        await expect(this.page.locator(this.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.streamNameDropdown).click();

        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, retrying');
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        }
        await this.page.getByText(streamName, { exact: true }).click();
        testLogger.info('Selected stream name', { streamName });

        // Select Scheduled alert type
        await expect(this.page.locator(this.scheduledAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.scheduledAlertRadio).click();
        testLogger.info('Selected scheduled alert type');

        // ==================== STEP 2: CONDITIONS (PromQL) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // Switch to PromQL tab
        const promqlTab = this.page.locator('[data-test="tab-promql"]');
        await promqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await promqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to PromQL tab');

        // Click View Editor button to open PromQL editor dialog
        const viewEditorBtn = this.page.locator(this.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened PromQL Editor dialog');

        // Enter PromQL query in the dialog
        const promqlEditor = this.page.locator(this.promqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.viewLineLocator).first().click();
        await promqlEditor.fill(`sum(rate(${streamName}[5m]))`);
        testLogger.info('Entered PromQL query');

        // Run the query
        await this.page.locator(this.runQueryButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran PromQL query');

        // Close the PromQL editor dialog
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            if (await closeButton.isVisible({ timeout: 3000 })) {
                await closeButton.click();
            } else {
                await this.page.keyboard.press('Escape');
            }
        } catch (error) {
            testLogger.warn('Close button click failed, trying keyboard escape', { error: error.message });
            await this.page.keyboard.press('Escape');
        }
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Closed PromQL Editor dialog');

        // ==================== STEP 3: COMPARE WITH PAST (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 3: Compare with Past (skipping)');

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // Set threshold (>= 1)
        const thresholdOperator = this.page.locator(this.stepAlertConditionsQSelect).first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click();
        testLogger.info('Set threshold operator: >=');

        // Set threshold value
        const thresholdInput = this.page.locator(this.stepAlertConditionsNumberInput).first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        // Select destination
        const destinationRow = this.page.locator(this.alertSettingsRow).filter({ hasText: /Destination/ });
        const destinationDropdown = destinationRow.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const destinationOption = this.page.getByText(destinationName, { exact: true }).first();
        if (await destinationOption.isVisible({ timeout: 3000 })) {
            await destinationOption.click();
        } else {
            await this.commonActions.scrollAndFindOption(destinationName, 'destination');
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 5 & 6: Skip ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 5: Deduplication (skipping)');

        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (skipping)');

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created PromQL alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    // ==================== ADVANCED CONDITIONS ====================

    /**
     * Create a real-time alert with multiple conditions using AND/OR groups
     * @param {string} streamName - Name of the stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     */
    async createAlertWithMultipleConditions(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_multicond_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        // Click Add Alert button to start wizard
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting multi-condition alert creation', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);

        // Select stream type (logs)
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        // Select stream name
        await this.page.locator(this.streamNameDropdown).click();
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
        }
        await this.page.getByText(streamName, { exact: true }).click();

        // Select Real-time alert type
        await this.page.locator(this.realtimeAlertRadio).click();
        testLogger.info('Alert setup complete');

        // ==================== STEP 2: CONDITIONS (Multiple) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // Add first condition - check which button is visible
        const firstCondBtn = this.page.locator(this.addFirstConditionButton);
        const addCondBtn = this.page.locator(this.addConditionButton).first();

        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
            testLogger.info('Clicked initial Add Condition button');
        } else if (await addCondBtn.isVisible({ timeout: 3000 })) {
            await addCondBtn.click();
            testLogger.info('Clicked Add Condition button (conditions already exist)');
        }
        await this.page.waitForTimeout(1000);

        // Wait for condition column select to appear (this works for both FieldsInput and FilterCondition UI)
        await expect(this.page.locator(this.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('First condition visible');

        // Configure first condition - click the q-select inside the column container
        const columnSelect1 = this.page.locator(this.conditionColumnSelect).first().locator('.q-select');
        await columnSelect1.click();
        await this.page.waitForTimeout(500);

        // Wait for dropdown options and select first available field
        await expect(this.page.locator('.q-menu .q-item').first()).toBeVisible({ timeout: 5000 });
        await this.page.locator('.q-menu .q-item').first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for first condition');

        // Click operator select (inside the container)
        const operatorSelect1 = this.page.locator(this.operatorSelect).first().locator('.q-select');
        await expect(operatorSelect1).toBeVisible({ timeout: 5000 });
        await operatorSelect1.click();
        await this.page.waitForTimeout(500);

        // Select "Contains" operator (available options: =, !=, >=, <=, >, <, Contains, NotContains)
        await expect(this.page.getByText('Contains', { exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(500);

        // Fill value for first condition
        const valueInput1 = this.page.locator(this.conditionValueInput).first().locator('input');
        await valueInput1.fill('test1');
        testLogger.info('Added first condition with Contains operator');

        // Add second condition using "Add Condition" button (now it should be visible)
        await expect(this.page.locator(this.addConditionButton).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.addConditionButton).first().click();
        await this.page.waitForTimeout(1000);

        // Wait for second condition column select to appear
        await expect(this.page.locator(this.conditionColumnSelect).nth(1)).toBeVisible({ timeout: 10000 });
        testLogger.info('Second condition visible');

        // Configure second condition
        const columnSelect2 = this.page.locator(this.conditionColumnSelect).nth(1).locator('.q-select');
        await columnSelect2.click();
        await this.page.waitForTimeout(500);

        // Select second available field
        await expect(this.page.locator('.q-menu .q-item').first()).toBeVisible({ timeout: 5000 });
        await this.page.locator('.q-menu .q-item').nth(1).click();  // Select 2nd option to be different
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for second condition');

        const operatorSelect2 = this.page.locator(this.operatorSelect).nth(1).locator('.q-select');
        await expect(operatorSelect2).toBeVisible({ timeout: 5000 });
        await operatorSelect2.click();
        await this.page.waitForTimeout(500);
        // Use getByRole to specifically target the dropdown option, not text already displayed on page
        await expect(this.page.getByRole('option', { name: 'Contains', exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);

        // Fill value for second condition
        const valueInput2 = this.page.locator(this.conditionValueInput).nth(1).locator('input');
        await valueInput2.fill('test2');
        testLogger.info('Added second condition with Contains operator');

        // Verify AND operator is shown between conditions (default)
        await expect(this.page.getByText('AND', { exact: true }).first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Verified AND operator between conditions');

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // Set Silence Notification to 0 minutes
        const silenceInput = this.page.locator(this.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Select destination for REAL-TIME alerts
        // Real-time alerts use a different layout - find by "Destination" label
        const destinationSection = this.page.locator('div.flex.items-start').filter({
            has: this.page.locator('span:has-text("Destination")')
        }).first();
        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });

        const destinationDropdown = destinationSection.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const destinationOption = this.page.getByText(destinationName, { exact: true }).first();
        if (await destinationOption.isVisible({ timeout: 3000 })) {
            await destinationOption.click();
        } else {
            await this.commonActions.scrollAndFindOption(destinationName, 'destination');
        }
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created multi-condition alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Add a condition group (AND/OR) during alert creation in Step 2
     */
    async addConditionGroup() {
        const addGroupBtn = this.page.locator('[data-test="alert-conditions-add-condition-group-btn"]');
        await addGroupBtn.waitFor({ state: 'visible', timeout: 5000 });
        await addGroupBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Added condition group');
    }

    /**
     * Toggle the AND/OR operator for conditions
     */
    async toggleConditionOperator() {
        const toggleBtn = this.page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        await toggleBtn.waitFor({ state: 'visible', timeout: 5000 });
        await toggleBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Toggled condition operator');
    }

    /**
     * Delete a specific condition by index
     * @param {number} index - Index of the condition to delete (0-based)
     */
    async deleteCondition(index = 0) {
        const deleteBtn = this.page.locator('[data-test="alert-conditions-delete-condition-btn"]').nth(index);
        await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
        await deleteBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Deleted condition', { index });
    }

    /**
     * Test condition operator toggle (AND to OR) during alert creation
     * Creates a temporary alert wizard session to test the toggle functionality
     * @param {string} streamName - Name of the stream
     * @param {string} randomValue - Random string for unique naming
     * @returns {Object} Result with toggleSuccessful and message
     */
    async testConditionOperatorToggle(streamName, randomValue) {
        const alertName = 'auto_toggle_test_' + randomValue;

        // Start creating an alert
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');

        // Fill Step 1: Alert Setup
        await expect(this.page.locator(this.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.alertNameInput).fill(alertName);

        // Select stream type (logs)
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        // Select stream
        await this.page.locator(this.streamNameDropdown).click();
        await this.page.waitForTimeout(500);
        await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByText(streamName, { exact: true }).click();

        // Select real-time alert type
        await this.page.locator(this.realtimeAlertRadio).click();

        // Navigate to Step 2: Conditions
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // Add first condition - check which button is visible
        const firstCondBtn = this.page.locator(this.addFirstConditionButton);
        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else {
            await this.page.locator(this.addConditionButton).first().click();
        }
        await this.page.waitForTimeout(1000);

        // Wait for condition column select to appear
        await expect(this.page.locator(this.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Configure first condition - use q-select inside container
        const columnSelect1 = this.page.locator(this.conditionColumnSelect).first().locator('.q-select');
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        await expect(this.page.locator('.q-menu .q-item').first()).toBeVisible({ timeout: 5000 });
        await this.page.locator('.q-menu .q-item').first().click();
        await this.page.waitForTimeout(500);

        const operatorSelect1 = this.page.locator(this.operatorSelect).first().locator('.q-select');
        await operatorSelect1.click();
        await this.page.waitForTimeout(500);
        await expect(this.page.getByText('Contains', { exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(500);

        // Fill value for first condition
        const valueInput1 = this.page.locator(this.conditionValueInput).first().locator('input');
        await valueInput1.fill('test');
        testLogger.info('Added first condition');

        // Add second condition
        await expect(this.page.locator(this.addConditionButton).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.addConditionButton).first().click();
        await this.page.waitForTimeout(1000);

        // Wait for second condition column select to appear
        await expect(this.page.locator(this.conditionColumnSelect).nth(1)).toBeVisible({ timeout: 10000 });
        testLogger.info('Added second condition');

        // Verify AND operator is visible (default)
        await expect(this.page.getByText('AND', { exact: true }).first()).toBeVisible();
        testLogger.info('Verified AND operator is default between conditions');

        // Try to toggle operator to OR
        const toggleBtn = this.page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        let toggleSuccessful = false;
        let message = '';

        if (await toggleBtn.isVisible({ timeout: 3000 })) {
            await toggleBtn.click();
            await this.page.waitForTimeout(500);

            // Verify OR operator is now visible
            try {
                await expect(this.page.getByText('OR', { exact: true }).first()).toBeVisible({ timeout: 5000 });
                toggleSuccessful = true;
                message = 'Successfully toggled from AND to OR';
                testLogger.info(message);
            } catch (e) {
                message = 'Toggle clicked but OR operator not visible';
                testLogger.warn(message);
            }
        } else {
            message = 'Toggle operator button not visible, may need at least 2 conditions in same group';
            testLogger.warn(message);
        }

        // Cancel alert creation (go back to alert list)
        await this.page.locator(this.alertBackButton).click();
        await this.page.waitForLoadState('networkidle');

        return { toggleSuccessful, message };
    }

    // ==================== BULK OPERATIONS ====================

    /**
     * Select multiple alerts by name
     * @param {string[]} alertNames - Array of alert names to select
     */
    async selectMultipleAlerts(alertNames) {
        for (const alertName of alertNames) {
            // Find the row containing the alert and click its checkbox
            const alertRow = this.page.locator(`tr:has-text("${alertName}")`).first();
            const checkbox = alertRow.locator('.o2-table-checkbox');
            await checkbox.waitFor({ state: 'visible', timeout: 5000 });
            await checkbox.click();
            await this.page.waitForTimeout(300);
            testLogger.debug('Selected alert', { alertName });
        }
        testLogger.info('Selected multiple alerts', { count: alertNames.length });
    }

    /**
     * Bulk pause all selected alerts
     */
    async bulkPauseAlerts() {
        const pauseBtn = this.page.locator('[data-test="alert-list-pause-alerts-btn"]');
        await pauseBtn.waitFor({ state: 'visible', timeout: 5000 });
        await pauseBtn.click();
        await this.page.waitForTimeout(1000);

        // Wait for success messages - bulk operations show "Alerts paused successfully"
        await expect(this.page.getByText(/Alerts? paused successfully/i).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Bulk paused selected alerts');
    }

    /**
     * Bulk unpause all selected alerts
     */
    async bulkUnpauseAlerts() {
        const unpauseBtn = this.page.locator('[data-test="alert-list-unpause-alerts-btn"]');
        await unpauseBtn.waitFor({ state: 'visible', timeout: 5000 });
        await unpauseBtn.click();
        await this.page.waitForTimeout(1000);

        // Wait for success messages - bulk operations show "Alerts resumed successfully"
        await expect(this.page.getByText(/Alerts? resumed successfully/i).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Bulk unpaused selected alerts');
    }

    /**
     * Verify bulk pause button is visible when alerts are selected
     */
    async verifyBulkPauseButtonVisible() {
        const pauseBtn = this.page.locator('[data-test="alert-list-pause-alerts-btn"]');
        await expect(pauseBtn).toBeVisible({ timeout: 5000 });
        testLogger.info('Bulk pause button is visible');
    }

    /**
     * Verify bulk unpause button is visible when alerts are selected
     */
    async verifyBulkUnpauseButtonVisible() {
        const unpauseBtn = this.page.locator('[data-test="alert-list-unpause-alerts-btn"]');
        await expect(unpauseBtn).toBeVisible({ timeout: 5000 });
        testLogger.info('Bulk unpause button is visible');
    }

    /**
     * Get count of selected alerts from UI
     * @returns {Promise<number>} Number of selected alerts
     */
    async getSelectedAlertsCount() {
        // Look for text like "2 selected" or similar
        try {
            const selectedText = await this.page.locator('text=/\\d+ selected/i').textContent({ timeout: 3000 });
            const count = parseInt(selectedText.match(/(\d+)/)[1], 10);
            return count;
        } catch (e) {
            return 0;
        }
    }
} 