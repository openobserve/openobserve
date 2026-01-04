/**
 * AlertBulkOperations - Handles bulk alert operations
 *
 * This module contains methods for bulk operations on alerts:
 * - Select multiple alerts
 * - Bulk pause/unpause
 * - Move alerts across folders
 * - Delete all alerts in a folder
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertBulkOperations {
    constructor(page, commonActions, locators) {
        this.page = page;
        this.commonActions = commonActions;
        this.locators = locators;
    }

    /**
     * Select multiple alerts by name
     * @param {string[]} alertNames - Array of alert names to select
     */
    async selectMultipleAlerts(alertNames) {
        // Wait for page to stabilize
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        for (const alertName of alertNames) {
            const alertRow = this.page.locator(`tr:has-text("${alertName}")`).first();
            const checkbox = alertRow.locator(this.locators.tableCheckbox);

            // Wait for alert to be visible with a longer timeout
            try {
                await checkbox.waitFor({ state: 'visible', timeout: 10000 });
            } catch (e) {
                // If alert not visible, try to search for it
                testLogger.info('Alert checkbox not immediately visible, searching...', { alertName });
                await this.page.locator(this.locators.alertSearchInput).click();
                await this.page.locator(this.locators.alertSearchInput).fill(alertName);
                await this.page.waitForTimeout(2000);
                await checkbox.waitFor({ state: 'visible', timeout: 10000 });
            }

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
        try {
            const selectedText = await this.page.locator('text=/\\d+ selected/i').textContent({ timeout: 3000 });
            const count = parseInt(selectedText.match(/(\d+)/)[1], 10);
            return count;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Select all alerts using the header checkbox
     */
    async selectAllAlerts() {
        const selectAllCheckbox = this.page.getByRole('row', { name: this.locators.selectAllCheckboxRowName }).getByRole('checkbox');
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
        await this.page.waitForTimeout(1000);
        testLogger.debug('Paused all selected alerts');
    }

    /**
     * Move all alerts in current folder to another folder
     * @param {string} targetFolderName - Target folder name
     */
    async moveAllAlertsToFolder(targetFolderName) {
        // Select all alerts using the header checkbox
        const headerCheckbox = this.page.locator(this.locators.headerCheckbox).first();
        await headerCheckbox.waitFor({ state: 'visible', timeout: 10000 });
        await headerCheckbox.click();
        testLogger.info('Clicked select all checkbox');

        await expect(this.page.getByText(/Showing \d+ - \d+ of/)).toBeVisible();

        // Click move across folders button
        await this.page.locator(this.locators.moveAcrossFoldersButton).click();

        // Handle folder selection with scrolling
        await this.page.locator(this.locators.folderDropdown).click();
        await this.page.waitForTimeout(2000);

        await this.commonActions.scrollAndFindOption(targetFolderName, 'folder');

        // Click move button and verify success message
        await this.page.locator(this.locators.moveButton).click();
        await this.page.waitForLoadState('networkidle');

        // The success message is the authoritative confirmation that the move succeeded
        await expect(this.page.getByText(this.locators.alertsMovedMessage)).toBeVisible({ timeout: 15000 });
        testLogger.info('Move operation confirmed via success message');

        // Wait for UI to update
        await this.page.waitForTimeout(2000);

        // Verify the source folder is now empty by checking for "No data available"
        // This is the expected state after moving ALL alerts from a folder
        await expect(this.page.getByText(this.locators.noDataAvailableText)).toBeVisible({ timeout: 15000 });

        testLogger.info('Successfully moved alerts to folder', { targetFolderName });
    }

    /**
     * Delete all alerts in the current folder one by one
     */
    async deleteAllAlertsInFolder() {
        testLogger.info('Starting to delete all alerts in current folder');

        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        let totalDeleted = 0;

        while (true) {
            const hasAny = await this.hasAlerts();
            if (!hasAny) {
                testLogger.info('No alerts found to delete', { totalDeleted });
                break;
            }

            let alertNames = await this.getAllAlertNames();
            if (alertNames.length === 0) {
                testLogger.info('No alert names found, stopping');
                break;
            }

            testLogger.info('Found alerts to delete in this batch', { count: alertNames.length, alertNames });

            for (const alertName of alertNames) {
                testLogger.debug('Deleting alert', { alertName });
                await this.deleteAlertByRow(alertName);
                totalDeleted++;
            }

            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(1000);
        }

        // Each deletion is already verified individually via alertDeletedMessage assertion
        // No additional verification needed - the loop ensures each alert was deleted
        testLogger.info('All alerts in folder deleted', { totalDeleted });
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
     * Get the current alert count from the pagination text
     * @returns {Promise<number>}
     */
    async getAlertCount() {
        try {
            const paginationText = await this.page.locator('text=/Showing \\d+ - \\d+ of/').textContent({ timeout: 3000 });
            const match = paginationText.match(/of (\d+)/);
            if (match) {
                const count = parseInt(match[1], 10);
                testLogger.debug('Current alert count', { count });
                return count;
            }
        } catch (e) {
            testLogger.debug('No pagination text found, checking for "No data available"');
        }

        try {
            const noData = await this.page.getByText('No data available').isVisible({ timeout: 1000 });
            if (noData) {
                testLogger.debug('No alerts found in folder');
                return 0;
            }
        } catch (e) {
            // Neither pagination nor "No data available" found
        }

        return 0;
    }

    /**
     * Get all alert names from the current page
     * @returns {Promise<string[]>}
     */
    async getAllAlertNames() {
        const alertNames = [];

        const moreOptionsButtons = await this.page.locator('[data-test*="alert-list-"][data-test*="-more-options"]').all();

        for (const button of moreOptionsButtons) {
            const dataTest = await button.getAttribute('data-test');
            const match = dataTest.match(/alert-list-(.+)-more-options/);
            if (match && match[1]) {
                alertNames.push(match[1]);
            }
        }

        testLogger.debug('Found alert names', { alertNames, count: alertNames.length });
        return alertNames;
    }

    /**
     * Delete alert by name (helper method for bulk operations)
     * @param {string} alertName - Name of the alert to delete
     */
    async deleteAlertByRow(alertName) {
        const kebabButton = this.page.locator(`[data-test="alert-list-${alertName}-more-options"]`).first();
        await kebabButton.waitFor({ state: 'visible', timeout: 5000 });
        await kebabButton.click();

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
}
