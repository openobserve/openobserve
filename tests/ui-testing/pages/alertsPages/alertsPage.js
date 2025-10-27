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
        this.folderMoreOptionsButton = '//span[contains(text(),"{folderName}")]/../div/button/span[2]/i';
        this.deleteFolderOption = 'Delete';
        this.deleteFolderConfirmText = 'Delete Folder';
        this.folderDeletedMessage = 'Folder deleted successfully.';

        // Alert creation locators
        this.addAlertButton = '[data-test="alert-list-add-alert-btn"]';
        this.alertNameInput = '[data-test="add-alert-name-input row"]';
        this.alertSubmitButton = '[data-test="add-alert-submit-btn"]';
        this.streamTypeDropdown = '[data-test="add-alert-stream-type-select-dropdown"]';
        this.streamNameDropdown = '[data-test="add-alert-stream-name-select-dropdown"]';
        this.realtimeAlertRadio = '[data-test="add-alert-realtime-alert-radio"]';
        this.alertDelayInput = '[data-test="add-alert-delay-input"]';
        this.destinationSelect = '[data-test="add-alert-destination-select"]';
        this.columnInput = '[placeholder="Column"]';
        this.operatorSelect = '[data-test="alert-conditions-operator-select"]';
        this.valueInput = '[placeholder="Value"]';
        this.alertSuccessMessage = 'Alert saved successfully.';
        this.alertUpdatedMessage = 'Alert updated successfully.';
        this.alertClonedMessage = 'Alert Cloned Successfully';
        this.alertDeletedMessage = 'Alert deleted';
        this.alertSetupText = 'Alert Setup';
        this.deleteConfirmText = 'Are you sure you want to delete this alert?';
        this.deleteButtonText = 'Delete';
        this.containsOperatorText = 'Contains';
        this.arrowDropDownText = 'arrow_drop_down';
        this.cloneAlertTitle = '[data-test="clone-alert-title"]';
        this.cloneStreamType = '[data-test="to-be-clone-stream-type"]';
        this.cloneStreamName = '[data-test="to-be-clone-stream-name"]';
        this.cloneSubmitButton = '[data-test="clone-alert-submit-btn"]';
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
                this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 }),
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

    /** @param {string} streamName @param {string} column @param {string} value @param {string} destinationName @param {string} randomValue */
    async createAlert(streamName, column, value, destinationName, randomValue) {
        const randomAlertName = 'Automation_Alert_' + randomValue;
        this.currentAlertName = randomAlertName;  // Store the alert name

        await this.page.locator(this.addAlertButton).click();
        await expect(this.page.locator(this.alertNameInput)).toBeVisible();

        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        await expect(this.page.locator(this.alertNameInput)).toHaveValue(randomAlertName);

        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible();
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await expect(this.page.locator(this.streamNameDropdown)).toBeVisible();

        // Click stream dropdown
        await this.page.locator(this.streamNameDropdown).click();

        // Check if stream options appear, if not click twice more
        try {
            await expect(this.page.getByText(`${streamName}`, { exact: true })).toBeVisible({ timeout: 3000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, clicking twice more');
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.locator(this.streamNameDropdown).click();
            await expect(this.page.getByText(`${streamName}`, { exact: true })).toBeVisible();
        }

        await this.page.getByText(`${streamName}`, { exact: true }).click();
        await expect(this.page.locator(this.realtimeAlertRadio)).toBeVisible();

        await this.page.locator(this.realtimeAlertRadio).click();
        await expect(this.page.locator(this.alertDelayInput)).toBeVisible();

        await this.page.locator(this.alertDelayInput).click();
        await this.page.locator(this.alertDelayInput).getByLabel('').fill('0');
        await expect(this.page.locator(this.alertDelayInput).getByLabel('')).toHaveValue('0');

        // Handle destination selection with scrolling
        await this.page.locator('[data-test="add-alert-destination-select"]').getByLabel('arrow_drop_down').click();
        await this.page.waitForLoadState('networkidle');
        
        // Use the common scroll function for destination
        await this.commonActions.scrollAndFindOption(destinationName, 'template');
        await this.page.waitForLoadState('networkidle');

        await this.page.locator(this.columnInput).click();
        await expect(this.page.getByRole('option', { name: column })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: column }).click();
        await expect(this.page.locator('[data-test="alert-conditions-operator-select"]')).toBeVisible({ timeout: 10000 });

        await this.page.locator('[data-test="alert-conditions-operator-select"] div').filter({ hasText: '>' }).nth(3).click();
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.locator(this.valueInput).fill(value);
        await expect(this.page.locator(this.valueInput)).toHaveValue(value);

        await this.page.locator(this.alertSubmitButton).click();
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

    /** @param {string} alertName */
    async updateAlert(alertName) {
        // Use first() to get the first instance of the alert
        await this.page.locator(this.alertUpdateButton.replace('{alertName}', alertName)).first().click();
        await expect(this.page.getByText(this.alertSetupText)).toBeVisible();
        await this.page.waitForTimeout(1000); // Wait for form to load

        // Click the operator dropdown and select new operator
        await this.page.locator('[data-test="alert-conditions-operator-select"] div').filter({ hasText: 'Contains' }).nth(3).click();
        await this.page.getByText('=', { exact: true }).click();
        await this.page.waitForTimeout(1000); // Wait after selecting operator

        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertUpdatedMessage)).toBeVisible();
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
        // Select all alerts
        await this.page.getByRole('row', { name: '# Name Owner Period Frequency' }).getByRole('checkbox').click();
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
     * Pauses an alert
     * @param {string} alertName - Name of the alert to pause
     */
    async pauseAlert(alertName) {
        await this.page.getByRole('row', { name: `01 ${alertName}` })
            .locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)
            .click();

        // Wait for the button to be visible before clicking
        const startButton = this.page.getByRole('button', { name: 'start' });
        await startButton.waitFor({ state: 'visible', timeout: 5000 });
        await this.page.waitForTimeout(500);
        await startButton.click();

        await expect(this.page.getByText('Alert Paused Successfully')).toBeVisible({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Resumes an alert
     * @param {string} alertName - Name of the alert to resume
     */
    async resumeAlert(alertName) {
        // Check if page is still open before proceeding
        if (this.page.isClosed()) {
            throw new Error('Page is closed before resumeAlert could execute');
        }

        await this.page.getByRole('row', { name: `01 ${alertName}` })
            .locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)
            .click();

        // Wait for the button to be visible before clicking
        try {
            const startButton = this.page.getByRole('button', { name: 'start' });
            await startButton.waitFor({ state: 'visible', timeout: 10000 });
            await this.page.waitForTimeout(500);

            // Check again before clicking
            if (this.page.isClosed()) {
                throw new Error('Page closed after pause button click but before start button click');
            }

            await startButton.click();
            await expect(this.page.getByText('Alert Resumed Successfully')).toBeVisible({ timeout: 10000 });
        } catch (error) {
            testLogger.error('Error during resumeAlert', {
                error: error.message,
                pageClosed: this.page.isClosed(),
                alertName
            });
            throw error;
        }

        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Delete alert by name
     * @param {string} alertName - Name of the alert to delete
     */
    async deleteAlertByRow(alertName) {
        const kebabButton = this.page.locator(`//button[@data-test='alert-list-${alertName}-more-options']`).first();
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
                this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 }),
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
    async createScheduledAlertWithSQL(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_scheduled_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        await this.page.locator(this.addAlertButton).click();
        await expect(this.page.locator(this.alertNameInput)).toBeVisible();

        // Fill alert name
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        await expect(this.page.locator(this.alertNameInput)).toHaveValue(randomAlertName);

        // Select stream type and name
        await this.page.locator(this.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible();
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await expect(this.page.locator(this.streamNameDropdown)).toBeVisible();

        // Click stream dropdown
        await this.page.locator(this.streamNameDropdown).click();

        // Check if stream options appear, if not click twice more
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 3000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, clicking twice more');
            await this.page.locator(this.streamNameDropdown).click();
            await this.page.locator(this.streamNameDropdown).click();
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible();
        }

        await this.page.getByText(streamName, { exact: true }).click();
        await expect(this.page.locator('[data-test="add-alert-scheduled-alert-radio"]')).toBeVisible();

        // Select scheduled alert radio
        await this.page.locator('[data-test="add-alert-scheduled-alert-radio"]').click();
        await expect(this.page.locator('[data-test="scheduled-alert-threshold-operator-select"]')).toBeVisible({ timeout: 10000 });

        // Set threshold
        await this.page.locator('[data-test="scheduled-alert-threshold-operator-select"]').getByLabel('arrow_drop_down').click();
        await this.page.getByText('>=').click();
        await this.page.locator('[data-test="scheduled-alert-threshold-value-input"]').getByLabel('').fill('1');

        // Set period
        await this.page.locator('[data-test="scheduled-alert-period-input"]').getByLabel('').fill('15');

        // Set delay
        await this.page.locator(this.alertDelayInput).getByLabel('').fill('0');

        // Select destination with scrolling
        await this.page.locator(this.destinationSelect).getByLabel('arrow_drop_down').click();
        await this.page.waitForLoadState('networkidle');
        
        // Use the common scroll function
        await this.commonActions.scrollAndFindOption(destinationName, 'template');
        await this.page.waitForLoadState('networkidle');
        //here we are expanding the multi window section as because it is not expanded by default
        // Click on the Multi Window container to expand it
        await this.page.getByText('Multi WindowSet relative alerting system based on SQL query').click();
        // Add time range
        await this.page.locator('[data-test="multi-time-range-alerts-add-btn"]').click();
        await this.page.locator('[data-test="date-time-btn"]').click();
        await this.page.locator('[data-test="date-time-relative-30-m-btn"]').click();

        // Add SQL query
        await this.page.getByRole('button', { name: 'View Editor' }).click();
        await this.page.locator('.view-line').first().click();
        await this.page.locator('[data-test="scheduled-alert-sql-editor"]').locator('.inputarea')
            .fill('SELECT kubernetes_labels_name FROM "e2e_automate" where kubernetes_labels_name = \'ziox-querier\'');
        await this.page.getByRole('button', { name: 'Run Query' }).click();
        await this.page.waitForLoadState('networkidle');

        // Close dialog with enhanced error handling
        try {
            const closeButton = this.page.locator('[data-test*="dialog"], [role="dialog"]').getByText('arrow_back_ios_new');
            await expect(closeButton).toBeVisible({ timeout: 15000 });
            await closeButton.click({ timeout: 10000 });
        } catch (error) {
            testLogger.warn('Primary close button failed, trying alternative', { error: error.message });
            await this.page.waitForLoadState('networkidle');
            // Try alternative close methods
            const altCloseButton = this.page.locator('.q-dialog').getByText('arrow_back_ios_new');
            await expect(altCloseButton).toBeVisible({ timeout: 10000 });
            await altCloseButton.click({ timeout: 10000 });
        }
        await this.page.waitForLoadState('networkidle');

        // Submit alert
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible();
        await expect(this.page.getByRole('cell', { name: '15 Mins' })).toBeVisible();
        testLogger.info('Successfully created scheduled alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    async exportAlerts() {
        await this.page.getByRole('row', { name: '# Name Owner Period Frequency' }).getByRole('checkbox').click();
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

    async verifyInvalidAlertCreation() {
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForTimeout(1000); // Wait for dialog to load
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill('a b c');
        await this.page.waitForTimeout(1000); // Wait for validation to trigger
        await expect(this.page.getByText('Characters like :, ?, /, #,')).toBeVisible({ timeout: 10000 });
        await this.page.locator('[data-test="add-alert-back-btn"]').click();
    }

    async verifyAlertCounts() {
        const scheduledAlertsCount = await this.page.locator('div:has-text("Alerts") >> text=Scheduled').locator('xpath=following::*[1]').first().textContent();
        const realTimeAlertsCount = await this.page.locator('div:has-text("Alerts") >> text="Real time"').locator('xpath=following::*[1]').first().textContent();
        return { scheduledAlertsCount, realTimeAlertsCount };
    }

    async verifyCloneAlertUIValidation(alertName) {
        await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
        await this.page.locator('[data-test="clone-alert-submit-btn"]').click();
        await expect(this.page.getByText('Please select stream type')).toBeVisible();
        await this.page.locator('[data-test="clone-alert-cancel-btn"]').click();
        await this.page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
        await this.page.locator('[data-test="add-alert-back-btn"]').click();
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

    async verifyFieldRequiredValidation() {
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForTimeout(1000); // Wait for dialog to load
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill('abc');
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.locator('[data-test="add-alert-stream-type-select"]').getByText('Field is required!')).toBeVisible();
        await this.page.locator('[data-test="add-alert-back-btn"]').click();
    }

    async verifyAlertCountIncreased(initialCount, newCount) {
        const initial = parseInt(initialCount);
        const updated = parseInt(newCount);
        expect(updated).toBeGreaterThan(initial);
        testLogger.info('Alert count verification successful', { initialCount: initial, updatedCount: updated });
    }
} 