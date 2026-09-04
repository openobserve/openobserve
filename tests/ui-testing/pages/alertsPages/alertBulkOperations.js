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
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
     * @param {object} [options]
     * @param {string} [options.expectAlertName] - Name of an alert expected in the SOURCE folder.
     *   When provided, we wait for THAT row to render before selecting — this proves the source
     *   folder's own data has loaded (see race note below) and that we are not looking at a stale
     *   table left over from the previous folder.
     */
    async moveAllAlertsToFolder(targetFolderName, options = {}) {
        const { expectAlertName } = options;
        const headerCheckbox = this.page.locator(this.locators.headerCheckbox).first();
        const moveBtn = this.page.locator(this.locators.moveAcrossFoldersButton);
        await headerCheckbox.waitFor({ state: 'visible', timeout: 10000 });

        // ROOT CAUSE (alerts-e2e-flow:160 "Move drawer failed to open"):
        // AlertList.vue's getAlertsFn() runs `selectedAlerts.value = []` at the START of every
        // folder fetch. Switching to a freshly-created (uncached) folder kicks off that async
        // fetch, but navigateToFolder returns as soon as the tab is active + a table is on screen
        // — so clicking select-all can fire BEFORE the fetch resolves, and when it resolves it
        // WIPES the selection. The move-across-folders button is `v-if="selectedAlerts.length > 0"`
        // so it vanishes ("Move button disappeared before click attempt"). A CACHED folder serves
        // synchronously with no wipe — which is exactly why this historically failed attempt 1 and
        // passed attempt 2 (retry warmed the cache), and became permanent under parallel load
        // (slow listByFolderId => the wipe always lands after select-all). networkidle does not
        // catch it because streaming/websocket keeps connections open.
        // Fix: wait until the source folder's OWN data has settled (loading gone + the expected row
        // rendered) so the wipe has already happened, THEN select and confirm the selection sticks.

        // 1) Let the folder's load finish (getAlertsFn resolved) — best-effort, non-blocking.
        await this.page.locator('[data-test="alert-list-loading-alert"]')
            .waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});

        // 2) Wait for the source folder's own rows to render. Prefer the specific expected alert
        //    (proves right folder + settled data); fall back to any row when no name is given.
        if (expectAlertName) {
            await this.page.locator('[data-test^="o2-table-row-"]')
                .filter({ hasText: expectAlertName }).first()
                .waitFor({ state: 'visible', timeout: 20000 });
        } else {
            await this.page.locator('[data-test^="o2-table-row-"]').first()
                .waitFor({ state: 'visible', timeout: 20000 });
        }

        const toastDismissBtn = this.page.locator('button[aria-label="Dismiss notification"]');
        const moveDrawer = this.page.locator('[data-test="dashboard-move-to-another-folder-dialog"]');
        const scopedFolderDropdown = moveDrawer.locator(this.locators.folderDropdown);

        // 3) ATOMIC open: (re)select-all → click move → confirm the drawer opened — as ONE retried
        //    block. A late getAlertsFn resolve can still wipe selectedAlerts AFTER select-all
        //    (hiding the move button, which is v-if="selectedAlerts.length > 0"), so a fixed
        //    stability window is not enough. Instead we retry the WHOLE open until the drawer is
        //    up: the drawer is driven by its own `showMoveAlertDialog` ref and captures the
        //    selection at click time, so once it opens a later wipe cannot close it. Each
        //    iteration re-selects if the button vanished, so the operation only needs ONE click
        //    to land while the selection is valid — which it eventually does once the folder is
        //    cached and no further fetch fires. Also dismisses toasts that intercept the click.
        await expect(async () => {
            // Already open (from a prior iteration whose success check hadn't settled)? Done.
            if (await moveDrawer.isVisible().catch(() => false)
                && await scopedFolderDropdown.isVisible().catch(() => false)) {
                return;
            }
            // Toasts (folder-added, clone-validation errors) render over the button and eat clicks.
            let dc = await toastDismissBtn.count().catch(() => 0);
            while (dc > 0) {
                await toastDismissBtn.first().click({ force: true }).catch(() => {});
                await this.page.waitForTimeout(150);
                dc = await toastDismissBtn.count().catch(() => 0);
            }
            // Ensure the selection is present (re-tick if a fetch wiped it).
            if (!(await headerCheckbox.isChecked().catch(() => false))) {
                await headerCheckbox.click({ force: true });
            }
            await expect(moveBtn).toBeVisible({ timeout: 3000 });
            await moveBtn.click({ force: true, timeout: 5000 });
            await expect(moveDrawer).toBeVisible({ timeout: 5000 });
            await expect(scopedFolderDropdown).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 60000 });
        testLogger.info('Move drawer opened with a valid selection');

        await scopedFolderDropdown.click();
        await this.page.waitForTimeout(2000);

        await this.commonActions.scrollAndFindOption(targetFolderName, 'folder');

        // Click move button and verify success message.
        // The toast auto-dismisses after only 2s, so do NOT wait for networkidle
        // between the click and the toast check — it would burn the toast's lifetime.
        await this.page.locator(this.locators.moveButton).click();

        await expect(this.page.locator('[data-test-variant="success"] [data-test="o-toast-message"]').filter({ hasText: this.locators.alertsMovedMessage })).toBeVisible({ timeout: 15000 });
        testLogger.info('Move operation confirmed via success message');

        // Wait for UI to update
        await this.page.waitForTimeout(2000);

        // Verify the source folder is now empty by checking for "No data available"
        // This is the expected state after moving ALL alerts from a folder
        await expect(this.page.locator('[data-test="o2-empty-state"]')).toBeVisible({ timeout: 15000 });

        testLogger.info('Successfully moved alerts to folder', { targetFolderName });
    }

    /**
     * Delete all alerts in the current folder one by one
     */
    async deleteAllAlertsInFolder() {
        testLogger.info('Starting to delete all alerts in current folder');

        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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

            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
            const noData = await this.page.locator('[data-test="o2-empty-state"]').isVisible({ timeout: 1000 });
            if (noData) {
                testLogger.debug('No alerts found in folder');
                return 0;
            }
        } catch (e) {
            // Neither pagination nor empty state found
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

        const deleteOption = this.page.locator(`[data-test="alert-list-${alertName}-delete-alert"]`);

        try {
            await deleteOption.waitFor({ state: 'visible', timeout: 3000 });
        } catch (e) {
            testLogger.warn('Delete option not visible after first kebab click, retrying', { alertName });
            await kebabButton.click();
            await deleteOption.waitFor({ state: 'visible', timeout: 5000 });
        }

        await deleteOption.click();
        await this.page.locator(this.locators.confirmButton).click();
        await expect(this.page.locator('[data-test-variant="success"] [data-test="o-toast-message"]').filter({ hasText: this.locators.alertDeletedMessage })).toBeVisible();
        await this.page.waitForTimeout(1000);
    }
}
