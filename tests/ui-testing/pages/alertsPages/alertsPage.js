import { expect, test } from '@playwright/test';
import fs from 'fs';
import { CommonActions } from '../commonActions';

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
        this.selectAllCheckbox = '[data-test="alert-list-select-all-checkbox"]';
        this.moveAcrossFoldersButton = '[data-test="alert-list-move-across-folders-btn"]';
        this.folderDropdown = '[data-test="alerts-index-dropdown-stream_type"]';
        this.moveButton = '[data-test="alerts-folder-move"]';
        this.alertsMovedMessage = 'alerts Moved successfully';

        // Alert search and deletion locators
        this.alertSearchInput = '[data-test="alert-list-search-input"]';
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
        await Promise.race([
            this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 }),
            this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
        ]).catch(() => {
            console.log('Neither table nor no data message found, continuing...');
        });
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
        await this.page.waitForTimeout(1000); // Wait for alert creation form to load

        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        await this.page.waitForTimeout(1000); // Wait after filling alert name

        await this.page.locator(this.streamTypeDropdown).click();
        await this.page.waitForTimeout(2000); // Wait for stream type options to load
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000); // Wait after selecting stream type

        await this.page.locator(this.streamNameDropdown).click();
        await this.page.waitForTimeout(2000); // Wait for stream name options to load
        await this.page.getByText(`${streamName}`, { exact: true }).click();
        await this.page.waitForTimeout(1000); // Wait after selecting stream name

        await this.page.locator(this.realtimeAlertRadio).click();
        await this.page.waitForTimeout(1000); // Wait after selecting realtime alert

        await this.page.locator(this.alertDelayInput).click();
        await this.page.locator(this.alertDelayInput).getByLabel('').fill('0');
        await this.page.waitForTimeout(1000); // Wait after setting delay

        // Handle destination selection with scrolling
        await this.page.locator('[data-test="add-alert-destination-select"]').getByLabel('arrow_drop_down').click();
        await this.page.waitForTimeout(2000); // Wait for destination options to load
        
        // Use the common scroll function for destination
        await this.commonActions.scrollAndFindOption(destinationName, 'template');
        
        await this.page.waitForTimeout(1000); // Wait after selecting destination

        await this.page.locator(this.columnInput).click();
        await this.page.waitForTimeout(2000); // Wait for column options to load
        await this.page.waitForSelector(`[role="option"]:has-text("${column}")`);
        await this.page.getByRole('option', { name: column }).click();
        await this.page.waitForTimeout(1000); // Wait after selecting column

        await this.page.locator('[data-test="alert-conditions-operator-select"] div').filter({ hasText: '>' }).nth(3).click();
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.locator(this.valueInput).fill(value);
        await this.page.waitForTimeout(1000); // Wait after filling value

        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        console.log('Successfully created alert:', randomAlertName);

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
        console.log('Successfully updated alert:', alertName);
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
        console.log('Successfully cloned alert:', alertName);
    }

    async ensureFolderExists(folderName, description = '') {
        try {
            await this.page.getByText(folderName).waitFor({ timeout: 2000 });
            console.log('Folder exists:', folderName);
            return true;
        } catch (error) {
            await this.createFolder(folderName, description);
            console.log('Created folder:', folderName);
            return false;
        }
    }

    async moveAllAlertsToFolder(targetFolderName) {
        // Select all alerts
        await this.page.getByRole('row', { name: '# Name Owner Period Frequency' }).getByRole('checkbox').click();
        await expect(this.page.getByText(/Showing 1 - [12] of/).nth(1)).toBeVisible();

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
        
        console.log('Successfully moved alerts to folder:', targetFolderName);
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
        console.log('Button visible:', await dotButton.isVisible());
        console.log('Button enabled:', await dotButton.isEnabled());

        // 4. Force click the button
        await dotButton.click({ force: true });

        // Verify the click worked by checking for Delete option
        await expect(this.page.getByText(this.deleteFolderOption)).toBeVisible({ timeout: 3000 });

        // Continue with the rest of the deletion process
        await this.page.getByText(this.deleteFolderOption).click();
        await expect(this.page.getByText(this.deleteFolderConfirmText)).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.folderDeletedMessage)).toBeVisible();

        console.log('Successfully deleted folder:', folderName);
    }

    /**
     * Pauses an alert
     * @param {string} alertName - Name of the alert to pause
     */
    async pauseAlert(alertName) {
        await this.page.getByRole('row', { name: `01 ${alertName}` })
            .locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)
            .click();
        await this.page.getByRole('button', { name: 'start' }).click();
        await expect(this.page.getByText('Alert Paused Successfully')).toBeVisible();
    }

    /**
     * Resumes an alert
     * @param {string} alertName - Name of the alert to resume
     */
    async resumeAlert(alertName) {
        await this.page.getByRole('row', { name: `01 ${alertName}` })
            .locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)
            .click();
        await this.page.getByRole('button', { name: 'start' }).click();
        await expect(this.page.getByText('Alert Resumed Successfully')).toBeVisible();
    }

    /**
     * Delete alert by name
     * @param {string} alertName - Name of the alert to delete
     */
    async deleteAlertByRow(alertName) {
        const kebabButton = this.page.locator(`//button[@data-test='alert-list-${alertName}-more-options']`).first();
        await kebabButton.click();
        await this.page.waitForTimeout(1000);
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
        await Promise.race([
            this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 }),
            this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
        ]).catch(() => {
            console.log('Neither table nor no data message found, continuing...');
        });
    }

    /**
     * Verify search results count
     * @param {number} expectedCount - Expected number of results
     */
    async verifySearchResults(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText).nth(1)).toBeVisible();
    }

    async verifySearchResultsUIValidation(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText).nth(1)).toBeVisible({ timeout: 10000 });
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
        await this.page.waitForTimeout(1000);

        // Fill alert name
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        await this.page.waitForTimeout(1000);

        // Select stream type and name
        await this.page.locator(this.streamTypeDropdown).click();
        await this.page.waitForTimeout(2000);
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.streamNameDropdown).click();
        await this.page.waitForTimeout(2000);
        await this.page.getByText(streamName, { exact: true }).click();
        await this.page.waitForTimeout(1000);

        // Select scheduled alert radio
        await this.page.locator('[data-test="add-alert-scheduled-alert-radio"]').click();
        await this.page.waitForTimeout(1000);

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
        await this.page.waitForTimeout(2000); // Wait for destination options to load
        
        // Use the common scroll function
        await this.commonActions.scrollAndFindOption(destinationName, 'template');
        
        await this.page.waitForTimeout(1000); // Wait after selecting destination

        // Add time range
        await this.page.locator('[data-test="multi-time-range-alerts-add-btn"]').click();
        await this.page.locator('[data-test="date-time-btn"]').click();
        await this.page.locator('[data-test="date-time-relative-30-m-btn"]').click();

        // Add SQL query
        await this.page.getByRole('button', { name: 'View Editor' }).click();
        await this.page.locator('.cm-line').first().click();
        await this.page.locator('[data-test="scheduled-alert-sql-editor"]').getByRole('textbox', { name: 'Editor content' })
            .fill('SELECT name\n  FROM "auto_playwright_stream"\n  WHERE \n    gender = \'Male\'\n    AND age > 60\n    AND country IN (\'Germany\', \'Japan\', \'USA\')');
        await this.page.getByRole('button', { name: 'Run Query' }).click();
        await this.page.waitForTimeout(2000);

        // Close dialog
        await this.page.locator('div').filter({ hasText: /^closeAdd Conditions$/ }).locator('i').click();
        await this.page.waitForTimeout(1000);

        // Submit alert
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible();
        await expect(this.page.getByRole('cell', { name: '15 Mins' })).toBeVisible();
        console.log('Successfully created scheduled alert:', randomAlertName);

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
                
                console.log(`Successfully deleted alert instance ${attempts} of ${alertName}`);
            } catch (error) {
                console.log('No more instances found or error occurred:', error.message);
                alertExists = false;
            }
        }
        
        if (attempts > 0) {
            console.log(`Successfully deleted all ${attempts} instances of alert: ${alertName}`);
        } else {
            console.log(`No instances of alert found to delete: ${alertName}`);
        }
    }

    async cleanupDownloadedFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('Successfully deleted file:', filePath);
            }
        } catch (error) {
            console.error('Error deleting file:', error);
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
        const scheduledAlertsCount = await this.page.locator('div:nth-child(3) > .q-w-sm > .row > div > .text-h6').first().textContent();
        const realTimeAlertsCount = await this.page.locator('div:nth-child(3) > .q-w-sm > .row > div:nth-child(3) > .text-h6').textContent();
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
        await expect(this.page.getByText('Showing 1 - 1 of').nth(1)).toBeVisible();
        await this.page.locator('[data-test="tab-all"]').click();
        await expect(this.page.getByText('Showing 1 - 1 of').nth(1)).toBeVisible();
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
        console.log(`Alert count verification successful: Count increased from ${initial} to ${updated}`);
    }
} 