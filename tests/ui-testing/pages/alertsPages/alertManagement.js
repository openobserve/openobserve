/**
 * AlertManagement - Handles alert management operations
 *
 * This module contains methods for managing existing alerts:
 * - Update/Edit alerts
 * - Clone alerts
 * - Pause/Resume alerts
 * - Delete alerts
 * - Search alerts
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertManagement {
    constructor(page, commonActions, locators) {
        this.page = page;
        this.commonActions = commonActions;
        this.locators = locators;
    }

    /**
     * Update an existing alert using Alerts 2.0 wizard UI
     * Opens the alert edit wizard and modifies the operator condition
     * @param {string} alertName - Name of the alert to update
     */
    async updateAlert(alertName) {
        await this.page.locator(this.locators.alertUpdateButton.replace('{alertName}', alertName)).first().click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Opened alert for editing', { alertName });

        await expect(this.page.getByText(this.locators.alertSetupText).first()).toBeVisible({ timeout: 10000 });
        await this.page.waitForTimeout(1000);

        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // Change operator from Contains to = to verify update functionality
        const operatorDropdown = this.page.locator(this.locators.operatorSelect).first();
        await expect(operatorDropdown).toBeVisible({ timeout: 5000 });
        await operatorDropdown.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('=', { exact: true }).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Changed operator from Contains to =');

        // Real-time alerts wizard: Step 2 -> Step 4 -> Step 6 (last)
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 4: Alert Settings');

        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (last step)');

        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertUpdatedMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully updated alert', { alertName });
    }

    /**
     * Clone an existing alert
     * @param {string} alertName - Name of the alert to clone
     * @param {string} streamType - Stream type for the cloned alert
     * @param {string} streamName - Stream name for the cloned alert
     */
    async cloneAlert(alertName, streamType, streamName) {
        await this.page.locator(this.locators.alertCloneButton.replace('{alertName}', alertName)).click();
        await expect(this.page.locator(this.locators.cloneAlertTitle)).toBeVisible();
        await this.page.locator(this.locators.cloneStreamType).click();
        await this.page.waitForTimeout(2000);
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.locator(this.locators.cloneStreamName).click();
        await this.page.getByText(streamName, { exact: true }).click();
        await this.page.locator(this.locators.cloneSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertClonedMessage)).toBeVisible();
        testLogger.info('Successfully cloned alert', { alertName });
    }

    /**
     * Pause an alert using Alerts 2.0 UI
     * @param {string} alertName - Name of the alert to pause
     */
    async pauseAlert(alertName) {
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
            testLogger.warn('Could not find button with text-negative class, using first button');
            pauseButton = allButtons.first();
        }

        await expect(pauseButton).toBeVisible({ timeout: 5000 });
        await pauseButton.click();

        await expect(this.page.getByText('Alert Paused Successfully')).toBeVisible({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Successfully paused alert', { alertName });
    }

    /**
     * Resume an alert using Alerts 2.0 UI
     * @param {string} alertName - Name of the alert to resume
     */
    async resumeAlert(alertName) {
        testLogger.info('Starting resumeAlert', { alertName });

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
            testLogger.warn('Could not find button with text-positive class, using first button');
            resumeButton = allButtons.first();
        }

        await expect(resumeButton).toBeVisible({ timeout: 10000 });
        await resumeButton.click();
        testLogger.info('Clicked resume button', { alertName });

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

        // Wait for delete option, retry if needed
        try {
            await this.page.getByText('Delete', { exact: true }).waitFor({ state: 'visible', timeout: 3000 });
        } catch (e) {
            testLogger.warn('Delete option not visible after first kebab click, retrying', { alertName });
            await kebabButton.click();
            await this.page.getByText('Delete', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
        }

        await this.page.getByText('Delete', { exact: true }).click();
        await this.page.locator(this.locators.confirmButton).click();
        await expect(this.page.getByText(this.locators.alertDeletedMessage)).toBeVisible();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Search for alerts by name
     * @param {string} alertName - Name of the alert to search for
     */
    async searchAlert(alertName) {
        await this.page.locator(this.locators.alertSearchInput).click();
        await this.page.locator(this.locators.alertSearchInput).fill('');
        await this.page.locator(this.locators.alertSearchInput).fill(alertName.toLowerCase());
        await this.page.waitForTimeout(2000);

        // Wait for either search results or no data message
        try {
            await Promise.race([
                this.page.locator(this.locators.tableLocator).waitFor({ state: 'visible', timeout: 30000 }),
                this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
            ]);
        } catch (error) {
            testLogger.error('Neither table nor no data message found after search', { alertName, error: error.message });
            throw new Error(`Failed to search for alert "${alertName}": Neither table nor "No data available" message appeared`);
        }
    }

    /**
     * Search for an alert and delete ALL instances of it across all folders
     * @param {string} alertName - Name of the alert to search and delete
     */
    async searchAndDeleteAlert(alertName) {
        testLogger.info('Searching for alert to delete across all folders', { alertName });

        await this.page.locator(this.locators.alertMenuItem).click();
        await this.page.waitForTimeout(2000);

        await this.page.locator(this.locators.searchAcrossFoldersToggle).locator('div').nth(1).click({ force: true });
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.alertSearchInput).click();
        await this.page.locator(this.locators.alertSearchInput).fill('');
        await this.page.locator(this.locators.alertSearchInput).fill(alertName);
        await this.page.waitForTimeout(2000);

        let deletedCount = 0;
        while (true) {
            try {
                await this.page.getByRole('cell', { name: alertName }).first().waitFor({ state: 'visible', timeout: 3000 });
                testLogger.debug('Found alert instance, deleting', { alertName, instance: deletedCount + 1 });

                await this.deleteAlertByRow(alertName);
                deletedCount++;
                testLogger.debug('Deleted alert instance', { alertName, deletedCount });

                await this.page.waitForTimeout(1000);
            } catch (e) {
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
     * Delete imported alert (handles multiple instances)
     * @param {string} alertName - Name of the alert to delete
     */
    async deleteImportedAlert(alertName) {
        let alertExists = true;
        let attempts = 0;
        const maxAttempts = 10;

        while (alertExists && attempts < maxAttempts) {
            try {
                await this.page.getByRole('cell', { name: alertName }).first().waitFor({ timeout: 2000 });

                const alertRows = this.page.getByRole('row').filter({ hasText: alertName });
                const count = await alertRows.count();

                if (count === 0) {
                    alertExists = false;
                    break;
                }

                await alertRows.first()
                    .locator(`[data-test="alert-list-${alertName}-more-options"]`).click();
                await this.page.waitForTimeout(1000);

                await this.page.getByText('Delete').click();
                await this.page.waitForTimeout(1000);
                await this.page.locator('[data-test="confirm-button"]').click();
                await expect(this.page.getByText('Alert deleted')).toBeVisible();

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

    /**
     * Trigger an alert manually from the alert list's more options menu
     * @param {string} alertName - Name of the alert to trigger
     * @returns {Promise<boolean>} - True if trigger was successful
     */
    async triggerAlertManually(alertName) {
        testLogger.info('Triggering alert manually', { alertName });

        let alertCell = this.page.getByRole('cell', { name: alertName }).first();
        let isVisible = await alertCell.isVisible({ timeout: 3000 }).catch(() => false);

        if (!isVisible) {
            const orgName = process.env["ORGNAME"] || 'default';
            const alertsUrl = `/web/alerts?org_identifier=${orgName}`;
            await this.page.goto(alertsUrl);
            await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
            await this.page.waitForTimeout(2000);
            testLogger.info('Navigated to alerts page');

            await this.searchAlert(alertName);
            await this.page.waitForTimeout(2000);

            alertCell = this.page.getByRole('cell', { name: alertName }).first();
        }

        await alertCell.waitFor({ state: 'visible', timeout: 15000 });
        testLogger.info('Found alert cell', { alertName });

        const alertRow = alertCell.locator('xpath=ancestor::tr');
        const moreOptionsBtn = alertRow.locator('button').filter({ has: this.page.locator('[name="more_vert"], .q-icon') }).last();
        await moreOptionsBtn.waitFor({ state: 'visible', timeout: 5000 });
        await moreOptionsBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked more options menu');

        // Note: The menu text is just "Trigger" (from i18n key alerts.triggerAlert)
        const triggerOption = this.page.getByText('Trigger', { exact: true }).first();
        await triggerOption.waitFor({ state: 'visible', timeout: 5000 });
        await triggerOption.click();
        testLogger.info('Clicked Trigger option');

        // Wait for notification to appear
        await this.page.waitForTimeout(2000);

        // Check for success notification
        const successNotification = this.page.getByText('Alert triggered successfully');
        const isSuccess = await successNotification.isVisible({ timeout: 5000 }).catch(() => false);

        if (isSuccess) {
            testLogger.info('Alert trigger success notification received');
            return true;
        }

        // Check for error notification - can be "Failed to trigger alert" or "Error sending notification..."
        const errorNotification = this.page.getByText(/Failed to trigger|Error sending notification/i);
        const isError = await errorNotification.isVisible({ timeout: 2000 }).catch(() => false);

        if (isError) {
            const errorText = await errorNotification.textContent().catch(() => 'Unknown error');
            testLogger.error('Alert trigger failed - error notification shown', { errorText });
            return false;
        }

        // Check for any other notification content
        const notification = this.page.locator('.q-notification');
        const hasNotification = await notification.isVisible({ timeout: 2000 }).catch(() => false);
        if (hasNotification) {
            const notificationText = await notification.textContent().catch(() => 'Unable to get text');
            testLogger.warn('Found notification but not success/error match', { notificationText });
            // If notification contains "success" text, consider it success
            if (notificationText.toLowerCase().includes('success')) {
                testLogger.info('Notification contains success - treating as successful');
                return true;
            }
        } else {
            testLogger.warn('No notification found at all after trigger');
        }

        return false;
    }

    /**
     * Open the alert history drawer for a specific alert
     * @param {string} alertName - Name of the alert
     */
    async openAlertHistoryDrawer(alertName) {
        testLogger.info('Opening alert history drawer', { alertName });

        await this.searchAlert(alertName);
        await this.page.waitForTimeout(1000);

        const alertRow = this.page.locator(`tr:has-text("${alertName}")`).first();
        await alertRow.waitFor({ state: 'visible', timeout: 10000 });

        const alertNameCell = alertRow.locator('td').nth(1);
        await alertNameCell.click();
        await this.page.waitForTimeout(1500);

        await expect(this.page.getByText('Alert History', { exact: false }).first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Alert history drawer opened');
    }

    /**
     * Get alert history stats from the drawer
     * @returns {Promise<{totalEvaluations: number, firingCount: number}>}
     */
    async getAlertHistoryStats() {
        let totalEvaluations = 0;
        let firingCount = 0;

        try {
            const totalText = await this.page.locator('text=Total Evaluations').locator('..').locator('div.tw-text-xl').textContent({ timeout: 5000 });
            totalEvaluations = parseInt(totalText, 10) || 0;
        } catch (e) {
            testLogger.warn('Could not get total evaluations');
        }

        try {
            const firingText = await this.page.locator('text=Firing').locator('..').locator('div.tw-text-xl').textContent({ timeout: 5000 });
            firingCount = parseInt(firingText, 10) || 0;
        } catch (e) {
            testLogger.warn('Could not get firing count');
        }

        testLogger.info('Alert history stats', { totalEvaluations, firingCount });
        return { totalEvaluations, firingCount };
    }

    /**
     * Close the alert history drawer
     */
    async closeAlertHistoryDrawer() {
        const closeBtn = this.page.locator('[data-test="alert-history-drawer-close-btn"]');
        if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Closed alert history drawer');
        }
    }

    /**
     * Verify alert was triggered by checking the alert history
     * @param {string} alertName - Name of the alert
     * @param {number} expectedFiringCount - Expected minimum firing count
     * @returns {Promise<boolean>} - True if firing count meets expectation
     */
    async verifyAlertTriggeredInHistory(alertName, expectedFiringCount = 1) {
        await this.openAlertHistoryDrawer(alertName);
        const stats = await this.getAlertHistoryStats();
        await this.closeAlertHistoryDrawer();

        const triggered = stats.firingCount >= expectedFiringCount;
        testLogger.info('Alert trigger verification', {
            alertName,
            expectedFiringCount,
            actualFiringCount: stats.firingCount,
            triggered
        });
        return triggered;
    }

    /**
     * Verify alert trigger via validation stream (self-referential approach)
     * @param {string} alertName - Name of the alert to search for
     * @param {string} validationStreamName - Name of the validation stream
     * @param {Object} logsPage - Instance of LogsPage for stream selection
     * @param {number} waitTimeMs - Time to wait for alert processing
     * @returns {Promise<{found: boolean, logText: string|null}>}
     */
    async verifyAlertTriggerInValidationStream(alertName, validationStreamName, logsPage, waitTimeMs = 30000) {
        testLogger.info('Verifying alert trigger in validation stream', { alertName, validationStreamName, waitTimeMs });

        await this.page.waitForTimeout(waitTimeMs);

        await this.page.locator('[data-test="menu-link-\\/logs-item"]').click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        try {
            await logsPage.selectStream(validationStreamName, 2, 5000);
            await this.page.waitForTimeout(1000);
        } catch (streamError) {
            testLogger.warn('Validation stream not found - alert likely did not fire', {
                alertName,
                validationStreamName,
                error: streamError.message
            });
            // Try to clean up UI state, but don't fail if browser is closed
            try {
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);
            } catch (cleanupError) {
                // Browser may already be closed due to timeout - ignore
            }
            return { found: false, logText: null };
        }

        await logsPage.clickRefreshButton();
        await this.page.waitForTimeout(3000);

        let logTableCell = this.page.locator('[data-test="log-table-column-0-source"]');
        let logCount = await logTableCell.count();

        if (logCount === 0) {
            logTableCell = this.page.locator('tbody tr');
            logCount = await logTableCell.count();
        }

        testLogger.info(`Found ${logCount} log entries in validation stream`);

        let alertFound = false;
        let foundLogText = null;

        for (let i = 0; i < logCount && !alertFound; i++) {
            const logText = await logTableCell.nth(i).textContent();
            if (logText && logText.includes(alertName)) {
                alertFound = true;
                foundLogText = logText;
                testLogger.info('SUCCESS: Alert notification found in validation stream!', {
                    alertName,
                    logIndex: i,
                    logTextPreview: logText.substring(0, 400)
                });
            }
        }

        if (!alertFound) {
            testLogger.warn('Alert notification not found in validation stream', {
                alertName,
                validationStreamName,
                logsChecked: logCount
            });
        }

        return { found: alertFound, logText: foundLogText };
    }
}
