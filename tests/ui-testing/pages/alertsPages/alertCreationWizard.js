/**
 * AlertCreationWizard - Handles all alert creation workflows
 *
 * This module contains methods for creating different types of alerts:
 * - Real-time alerts with conditions
 * - Scheduled alerts with SQL/PromQL queries
 * - Multi-condition alerts with AND/OR logic
 * - Alerts with deduplication configuration
 */

import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class AlertCreationWizard {
    constructor(page, commonActions, locators) {
        this.page = page;
        this.commonActions = commonActions;
        this.locators = locators;
        this.currentAlertName = '';
    }

    /**
     * Select a stream from the stream name dropdown using keyboard filtering.
     * The dropdown uses Quasar virtual scroll which only renders visible items.
     * Typing the stream name triggers QSelect's built-in filter to narrow results.
     */
    async selectStreamByName(streamName) {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(500);
            // Clear any previous text in the input
            await this.page.keyboard.press('Control+a');
            await this.page.keyboard.type(streamName, { delay: 30 });
            await this.page.waitForTimeout(1500);

            const streamOption = this.page.getByText(streamName, { exact: true });
            if (await streamOption.isVisible({ timeout: 5000 }).catch(() => false)) {
                await streamOption.click();
                testLogger.info('Stream selected successfully', { streamName, attempt });
                return;
            }

            testLogger.warn('Stream not visible in dropdown, retrying', { streamName, attempt, maxRetries });
            await this.page.locator('body').click({ position: { x: 10, y: 10 } });
            await this.page.waitForTimeout(1000);

            if (attempt < maxRetries) {
                // Navigate back and re-enter to force a fresh stream list fetch
                await this.page.locator('[data-test="add-alert-back-btn"]').click();
                await this.page.waitForTimeout(2000);
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.locator(this.locators.addAlertButton).click();
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);

                // Re-fill the alert name (it was lost when navigating back)
                await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
                await this.page.locator(this.locators.alertNameInput).click();
                await this.page.locator(this.locators.alertNameInputField).fill(this.currentAlertName);

                // Re-select stream type via OSelect popover pattern (§4)
                await this.page.locator(this.locators.streamTypeDropdown).click();
                await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
                await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);
            }
        }
        // Final attempt - if it still fails, throw the original error
        await this.page.getByText(streamName, { exact: true }).click();
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
        this.currentAlertName = randomAlertName;

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);

        // Select stream type via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Wait for stream list API call to complete after stream type selection
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });

        await this.selectStreamByName(streamName);

        // Select Real-time alert type via dropdown (v3 UI)
        await this._selectAlertType('Real-time');

        // ==================== STEP 2: CONDITIONS ====================
        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(500);

        // Column selection with fallback to first available if specific column not found
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect.click();
        await this.page.waitForTimeout(500);

        let columnFound = false;
        // Condition column dropdown is OSelect (Reka Listbox) post-migration.
        const menuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(menuItems.first()).toBeVisible({ timeout: 5000 });

        const columnItems = await menuItems.allTextContents();
        testLogger.info('Available columns in dropdown', { columns: columnItems.slice(0, 10), requestedColumn: column });

        const columnOption = menuItems.filter({ hasText: column }).first();
        if (await columnOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await columnOption.click();
            columnFound = true;
        }

        if (!columnFound) {
            await menuItems.first().click();
            testLogger.info('Selected first available column (fallback)', { requestedColumn: column });
        }
        await this.page.waitForTimeout(500);

        await expect(this.page.locator(this.locators.operatorSelect).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.operatorSelect).first().click();
        await this.page.getByText('Contains', { exact: true }).click();

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill(value);

        // ==================== ALERT SETTINGS ====================
        // Set silence notification to 0 for immediate alerts
        const silenceInput = this.page.locator(this.locators.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Destination selection with fallback
        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 10000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Destination dropdown is OSelect (Reka Listbox) post-migration.
        const destMenuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(destMenuItems.first()).toBeVisible({ timeout: 5000 });

        let destFound = false;
        const destOption = destMenuItems.filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            destFound = true;
        }

        if (!destFound) {
            try {
                await this.commonActions.scrollAndFindOption(destinationName, 'template');
            } catch (scrollError) {
                await destMenuItems.first().click();
                testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
            }
        }
        await this.page.waitForTimeout(500);
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });

        // ==================== SUBMIT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert', { alertName: randomAlertName });

        return randomAlertName;
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

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);

        // Select stream type via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });

        await this.selectStreamByName(streamName);

        // Select Real-time alert type via dropdown (v3 UI)
        await this._selectAlertType('Real-time');

        // ==================== STEP 2: CONDITIONS ====================
        // Add condition - different buttons may be visible depending on state
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else {
            await this.page.locator(this.locators.addConditionButton).first().click();
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Select first available column (more resilient than specific column)
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        const visibleMenuDefaultsItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleMenuDefaultsItems.first()).toBeVisible({ timeout: 5000 });
        await visibleMenuDefaultsItems.first().click();
        await this.page.waitForTimeout(500);

        const operatorSelect = this.page.locator(this.locators.operatorSelect).first();
        await operatorSelect.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');

        // ==================== ALERT SETTINGS ====================
        // Set silence notification to 0 for immediate alerts
        const silenceInput = this.page.locator(this.locators.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Destination selection with fallback
        const destinationSection = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });
        await destinationSection.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenuDefItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuDefItems.first()).toBeVisible({ timeout: 5000 });

        let destFoundDef = false;
        const destOptionDef = visibleDestMenuDefItems.filter({ hasText: destinationName }).first();
        if (await destOptionDef.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionDef.click();
            destFoundDef = true;
        }

        if (!destFoundDef) {
            await visibleDestMenuDefItems.first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });

        // Forcefully remove any remaining q-portal elements that intercept clicks
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => { el.style.display = 'none'; });
        }).catch(e => testLogger.warn('Failed to remove q-portal elements', { error: e.message }));
        await this.page.waitForTimeout(300);

        // ==================== SUBMIT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert with defaults', { alertName: randomAlertName });

        // Wait for navigation back to alerts list
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        return randomAlertName;
    }

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

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting scheduled alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);

        // Select stream type via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });

        await this.selectStreamByName(streamName);

        // Select Scheduled alert type via dropdown (v3 UI)
        await this._selectAlertType('Scheduled');
        testLogger.info('Selected scheduled alert type');

        // ==================== CONDITIONS (SQL) ====================
        // Switch to SQL tab (v3 UI — tabs, no wizard "Continue" buttons)
        const sqlTab = this.page.locator('[data-test="step2-query-tabs"] button:has-text("SQL")');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to SQL tab');

        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened SQL Editor dialog');

        // Get the Monaco editor (innermost .monaco-editor element)
        const monacoEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type('SELECT kubernetes_labels_name FROM "e2e_automate" where kubernetes_labels_name = \'ziox-querier\'');
        testLogger.info('Entered SQL query');

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran SQL query');

        // Close SQL Editor dialog.
        // The SQL Editor is now an ODrawer (reka-ui), opened via v-model:open="isOpen".
        // We first try clicking the back button (which calls closeDialog()), then press
        // Escape (reka-ui's standard way to close non-persistent dialogs).
        try {
            const closeButton = this.page.locator('[data-test="query-editor-dialog"] [data-test="add-alert-back-btn"]').first();
            await closeButton.waitFor({ state: 'visible', timeout: 5000 });
            await closeButton.click({ timeout: 5000 });
            testLogger.info('Clicked SQL Editor back button');
        } catch (error) {
            testLogger.warn('Back button click failed, using keyboard escape', { error: error.message });
        }
        // Close button for ODrawer / ODialog components (reka-ui).
        const queryEditorCloseBtn = this.page.locator('[data-test="o-dialog-close-btn"]').first();
        if (await queryEditorCloseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await queryEditorCloseBtn.click();
        }
        await this.page.waitForTimeout(500);

        // Wait for the ODrawer panel (data-test="query-editor-dialog") to fully unmount
        await this.page.locator('[data-test="query-editor-dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {
            testLogger.warn('Query editor dialog did not hide — clicking close again');
            this.page.locator('[data-test="o-dialog-close-btn"]').first().click().catch(() => {});
        });
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Aggressively clean up any portal overlays that may intercept pointer events.
        // Both Quasar (q-portal--dialog) and reka-ui (data-reka-dialog-overlay) portals
        // can linger after the dialog state is toggled off.
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal--dialog"]').forEach(el => { el.style.display = 'none'; });
            document.querySelectorAll('div[data-reka-dialog-overlay]').forEach(el => { el.style.display = 'none'; });
            document.querySelectorAll('div[data-reka-portalled]').forEach(el => { el.style.display = 'none'; });
        }).catch(e => testLogger.warn('Failed to remove portal overlays', { error: e.message }));
        await this.page.waitForTimeout(500);
        testLogger.info('Closed SQL Editor dialog — portal cleaned up');

        // ==================== ALERT SETTINGS ====================
        // SQL tab: threshold row uses data-test="alert-trigger-operator-select" (not alert-threshold-operator-select)
        // The visible "Alert if No. of events" row lives directly on the SQL query config panel.
        const thresholdSection = this.page.locator('.alert-condition-row').filter({ hasText: 'No. of events' }).first();
        await thresholdSection.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Threshold section visible');

        const thresholdOperator = thresholdSection.locator('.alert-v3-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click({ force: true });
        await this.page.locator('[data-test$="-popover"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        let operatorSelected = false;
        try {
            await this.page.getByRole('option', { name: '>=', exact: true }).click({ timeout: 5000 });
            operatorSelected = true;
        } catch {
            testLogger.warn('Role option not found, trying popover fallback');
        }
        if (!operatorSelected) {
            await this.page.locator('[data-test$="-popover"]').getByText('>=', { exact: true }).click({ timeout: 3000 });
        }
        testLogger.info('Set threshold operator: >=');

        // SQL threshold OInput has no data-test — scope to the section's number input
        const thresholdInput = thresholdSection.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        // Period
        const periodInput = this.page.locator('.period-input-container input[type="number"]');
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
            testLogger.info('Set period: 15 minutes');
        }

        // Destination selection using v3 data-test locator
        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenuSqlItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuSqlItems.first()).toBeVisible({ timeout: 5000 });

        let destFoundSql = false;
        const destOptionSql = visibleDestMenuSqlItems.filter({ hasText: destinationName }).first();
        if (await destOptionSql.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionSql.click();
            destFoundSql = true;
        }

        if (!destFoundSql) {
            await visibleDestMenuSqlItems.first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.waitForTimeout(500);
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        testLogger.info('Selected destination', { destinationName });

        // ==================== SUBMIT ====================
        // The submit button sits inside a scroll container that clips it from the viewport.
        // Playwright's force:true doesn't bypass scroll-container clipping, so we use a
        // native DOM click via evaluate() which has no viewport restrictions.
        await this.page.locator(this.locators.alertSubmitButton).waitFor({ state: 'attached', timeout: 10000 });
        await this.page.evaluate((selector) => {
            const btn = document.querySelector(selector);
            if (btn) btn.click();
        }, this.locators.alertSubmitButton);
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        await expect(this.page.getByRole('cell', { name: '15 Mins' }).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Successfully created scheduled alert', { alertName: randomAlertName });

        return randomAlertName;
    }

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
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting multi-condition alert creation', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);

        // Select stream type (logs) via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });

        // Select stream name
        await this.selectStreamByName(streamName);

        // Select Real-time alert type via dropdown (v3 UI)
        await this._selectAlertType('Real-time');
        testLogger.info('Alert setup complete');

        // ==================== CONDITIONS (Multiple) ====================
        // Add first condition
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        const addCondBtn = this.page.locator(this.locators.addConditionButton).first();

        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
            testLogger.info('Clicked initial Add Condition button');
        } else if (await addCondBtn.isVisible({ timeout: 3000 })) {
            await addCondBtn.click();
            testLogger.info('Clicked Add Condition button (conditions already exist)');
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('First condition visible');

        // Configure first condition using first available column
        const columnSelect1 = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        const visibleMenu1Items = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleMenu1Items.first()).toBeVisible({ timeout: 5000 });
        await visibleMenu1Items.first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for first condition');

        const operatorSelect1 = this.page.locator(this.locators.operatorSelect).first();
        await expect(operatorSelect1).toBeVisible({ timeout: 5000 });
        await operatorSelect1.click();
        await this.page.waitForTimeout(500);
        await expect(this.page.getByText('Contains', { exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(500);

        // Use 'test' as value - matches the log field from ingested validation data
        const valueInput1 = this.page.locator(this.locators.conditionValueInput).first().locator('input');
        await valueInput1.fill('test');
        testLogger.info('Added first condition with Contains operator');

        // Add second condition
        await expect(this.page.locator(this.locators.addConditionButton).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).nth(1)).toBeVisible({ timeout: 10000 });
        testLogger.info('Second condition visible');

        // Configure second condition using second available column
        const columnSelect2 = this.page.locator(this.locators.conditionColumnSelect).nth(1);
        await columnSelect2.click();
        await this.page.waitForTimeout(500);
        const visibleMenu2Items = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleMenu2Items.first()).toBeVisible({ timeout: 5000 });
        // Use nth(1) if available, otherwise first - to get a different column
        const columnCount = await visibleMenu2Items.count();
        if (columnCount > 1) {
            await visibleMenu2Items.nth(1).click();
        } else {
            await visibleMenu2Items.first().click();
        }
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for second condition');

        const operatorSelect2 = this.page.locator(this.locators.operatorSelect).nth(1);
        await expect(operatorSelect2).toBeVisible({ timeout: 5000 });
        await operatorSelect2.click();
        await this.page.waitForTimeout(500);
        await expect(this.page.getByRole('option', { name: 'Contains', exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);

        // Use 'validation' as value - matches the log field from ingested validation data
        const valueInput2 = this.page.locator(this.locators.conditionValueInput).nth(1).locator('input');
        await valueInput2.fill('validation');
        testLogger.info('Added second condition with Contains operator');

        // Verify AND operator is shown between conditions (default)
        await expect(this.page.getByText('AND', { exact: true }).first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Verified AND operator between conditions');

        // ==================== ALERT SETTINGS ====================
        // Set Silence Notification to 0 minutes
        const silenceInput = this.page.locator(this.locators.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Select destination for REAL-TIME alerts
        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 10000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Use popover selector for destination
        const visibleDestMenuMultiItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuMultiItems.first()).toBeVisible({ timeout: 5000 });

        let destFoundMulti = false;
        const destOptionMulti = visibleDestMenuMultiItems.filter({ hasText: destinationName }).first();
        if (await destOptionMulti.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionMulti.click();
            destFoundMulti = true;
            testLogger.info('Selected destination via popover', { destinationName });
        }

        if (!destFoundMulti) {
            // Fallback: select first available destination
            await visibleDestMenuMultiItems.first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        testLogger.info('Selected destination', { destinationName });

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created multi-condition alert', { alertName: randomAlertName });

        // Wait for page to navigate back to alerts list after creation
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with deduplication configuration
     * @param {string} streamName - Name of the stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     * @param {Object} dedupConfig - Deduplication configuration
     * @param {number} [dedupConfig.timeWindowMinutes] - Time window in minutes
     * @param {string[]} [dedupConfig.fingerprintFields] - Fields for fingerprinting
     */
    async createScheduledAlertWithDeduplication(streamName, destinationName, randomValue, dedupConfig = {}) {
        const randomAlertName = 'auto_dedup_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        testLogger.info('Creating scheduled alert with deduplication', {
            streamName,
            destinationName,
            alertName: randomAlertName,
            dedupConfig
        });

        // ==================== ALERT SETUP ====================
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Add alert dialog opened');

        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs) via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await this.selectStreamByName(streamName);
        testLogger.info('Selected stream name', { streamName });

        // Select Scheduled alert type via dropdown (v3 UI)
        await this._selectAlertType('Scheduled');
        testLogger.info('Selected scheduled alert type');

        // ==================== CONDITIONS (SQL) ====================
        const sqlTab = this.page.locator('[data-test="step2-query-tabs"] button:has-text("SQL")');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to SQL tab');

        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened SQL Editor dialog');

        // Get the Monaco editor (innermost .monaco-editor element)
        const monacoEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type(`SELECT kubernetes_labels_name FROM "${streamName}" where kubernetes_labels_name = 'ziox-querier'`);
        testLogger.info('Entered SQL query');

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran SQL query');

        // Close dialog — try back button, then close button
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            await closeButton.click({ force: true, timeout: 10000 });
        } catch (error) {
            testLogger.warn('Close button force-click failed, trying dialog close button', { error: error.message });
            const dialogCloseBtn = this.page.locator('[data-test="o-dialog-close-btn"]').first();
            if (await dialogCloseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await dialogCloseBtn.click();
            }
            await this.page.waitForTimeout(500);
        }
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Clean up residual q-portal dialog overlays from the closed SQL Editor,
        // scoped to already-hidden portals and the Monaco editor's portal specifically
        // so we don't hide any other legitimately open dialog.
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal--dialog"]').forEach(el => {
                const isHidden = el.getAttribute('aria-hidden') === 'true';
                const hasMonaco = el.querySelector('.monaco-editor');
                if (isHidden || hasMonaco) el.style.display = 'none';
            });
        }).catch(e => testLogger.warn('Failed to remove dialog portals', { error: e.message }));
        await this.page.waitForTimeout(300);

        testLogger.info('Closed SQL Editor dialog — portal cleaned up');

        // ==================== ALERT SETTINGS ====================
        // In v3 UI, threshold operator + input are in the Alert Rules tab ("Alert if No. of events *")
        const thresholdSection = this.page.locator('.alert-condition-row').filter({ hasText: 'No. of events' }).first();
        await thresholdSection.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Threshold section visible');

        const thresholdOperator = thresholdSection.locator('.alert-v3-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click({ force: true }).catch(async () => {
            testLogger.info('click failed, trying force click on main element');
            await thresholdOperator.click({ force: true });
        });
        // Wait for the dropdown menu to actually appear before selecting an option
        await this.page.locator('[data-test$="-popover"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        // Use role-based option selection (bypasses q-portal visibility issues)
        // Use a flag to track success so the fallback error isn't silently swallowed
        let operatorSelected = false;
        try {
            await this.page.getByRole('option', { name: '>=', exact: true }).click({ timeout: 5000 });
            operatorSelected = true;
        } catch {
            testLogger.warn('Role option not found, trying popover fallback');
        }
        if (!operatorSelected) {
            await this.page.locator('[data-test$="-popover"]').getByText('>=', { exact: true }).click({ timeout: 3000 });
        }
        testLogger.info('Set threshold operator: >=');

        const thresholdInput = thresholdSection.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        const periodInput = this.page.locator('.period-input-container input[type="number"]');
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
            testLogger.info('Set period: 15 minutes');
        }

        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Use popover selector for destination
        const visibleDestMenuDedupItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuDedupItems.first()).toBeVisible({ timeout: 5000 });

        let destFoundDedup = false;
        const destOptionDedup = visibleDestMenuDedupItems.filter({ hasText: destinationName }).first();
        if (await destOptionDedup.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionDedup.click();
            destFoundDedup = true;
            testLogger.info('Selected destination via popover', { destinationName });
        }

        if (!destFoundDedup) {
            // Fallback: select first available destination
            await visibleDestMenuDedupItems.first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.waitForTimeout(500);
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        testLogger.info('Selected destination', { destinationName });

        // ==================== DEDUPLICATION (Advanced tab) ====================
        await this._switchToAdvancedTab();

        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });
        testLogger.info('Deduplication container visible in Advanced tab');

        // Configure fingerprint fields if provided
        if (dedupConfig.fingerprintFields && dedupConfig.fingerprintFields.length > 0) {
            const fingerprintSelect = this.page.locator(this.locators.stepDeduplicationFingerprintSelect);
            await fingerprintSelect.waitFor({ state: 'visible', timeout: 5000 });

            for (const field of dedupConfig.fingerprintFields) {
                await fingerprintSelect.click();
                await this.page.waitForTimeout(500);
                await fingerprintSelect.locator('input').fill(field);
                await this.page.waitForTimeout(500);

                const fieldOption = this.page.getByRole('option', { name: field }).first();
                if (await fieldOption.isVisible({ timeout: 2000 })) {
                    await fieldOption.click();
                } else {
                    await this.page.keyboard.press('Enter');
                }
                await this.page.waitForTimeout(300);
            }
            await this.page.locator('body').click({ position: { x: 10, y: 10 } });
            testLogger.info('Configured fingerprint fields', { fields: dedupConfig.fingerprintFields });
        } else {
            testLogger.info('Skipping fingerprint fields (auto-detect)');
        }

        // Configure time window if provided
        if (dedupConfig.timeWindowMinutes !== undefined) {
            const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
            await timeWindowInput.waitFor({ state: 'visible', timeout: 5000 });
            await timeWindowInput.clear();
            await timeWindowInput.fill(String(dedupConfig.timeWindowMinutes));
            testLogger.info('Set time window', { minutes: dedupConfig.timeWindowMinutes });
        } else {
            testLogger.info('Skipping time window (auto-detect)');
        }

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with deduplication', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Test condition operator toggle (AND to OR) during alert creation
     * @param {string} streamName - Name of the stream
     * @param {string} randomValue - Random string for unique naming
     * @returns {Object} Result with toggleSuccessful and message
     */
    async testConditionOperatorToggle(streamName, randomValue) {
        const alertName = 'auto_toggle_test_' + randomValue;

        // Start creating an alert
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Fill Alert Setup
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInputField).fill(alertName);

        // Select stream type (logs) via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });

        // Select stream
        await this.selectStreamByName(streamName);

        // Select real-time alert type via dropdown (v3 UI)
        await this._selectAlertType('Real-time');

        // Add first condition
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else {
            await this.page.locator(this.locators.addConditionButton).first().click();
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Configure first condition
        const columnSelect1 = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        const visibleMenuToggleItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleMenuToggleItems.first()).toBeVisible({ timeout: 5000 });
        await visibleMenuToggleItems.first().click();
        await this.page.waitForTimeout(500);

        const operatorSelect1 = this.page.locator(this.locators.operatorSelect).first();
        await operatorSelect1.click();
        await this.page.waitForTimeout(500);
        await expect(this.page.getByText('Contains', { exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(500);

        const valueInput1 = this.page.locator(this.locators.conditionValueInput).first().locator('input');
        await valueInput1.fill('test');
        testLogger.info('Added first condition');

        // Add second condition
        await expect(this.page.locator(this.locators.addConditionButton).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).nth(1)).toBeVisible({ timeout: 10000 });
        testLogger.info('Added second condition');

        // Verify AND operator is visible (default)
        await expect(this.page.getByText('AND', { exact: true }).first()).toBeVisible();
        testLogger.info('Verified AND operator is default between conditions');

        // Try to toggle operator to OR
        // v3 UI may have different toggle mechanisms than v2:
        //   1. [data-test="alert-conditions-toggle-operator-btn"] (v2-style button)
        //   2. Clickable AND chip/label between condition rows (v3-style chip)
        //   3. Operator dropdown/select (v3-style q-select)
        let toggleSuccessful = false;
        let message = '';

        // Attempt 1: Try primary data-test toggle button (v2 fallback)
        const toggleBtn = this.page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        if (await toggleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await toggleBtn.click();
            await this.page.waitForTimeout(500);
            try {
                await expect(this.page.getByText('OR', { exact: true }).first()).toBeVisible({ timeout: 5000 });
                toggleSuccessful = true;
                message = 'Successfully toggled from AND to OR via data-test toggle button';
                testLogger.info(message);
            } catch (e) { /* fall through to next attempt */ }
        }

        // Attempt 2: Try clicking the AND text/chip directly (v3 UI — clickable chip)
        if (!toggleSuccessful) {
            try {
                const andLabel = this.page.getByText('AND', { exact: true }).first();
                if (await andLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await andLabel.click();
                    await this.page.waitForTimeout(500);
                    const orLabel = this.page.getByText('OR', { exact: true }).first();
                    if (await orLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
                        toggleSuccessful = true;
                        message = 'Successfully toggled from AND to OR via AND label click';
                        testLogger.info(message);
                    }
                }
            } catch (e) {
                testLogger.warn('AND label click fallback failed', { error: e.message });
            }
        }

        // Attempt 3: Try clicking on the operator area and selecting from popover
        if (!toggleSuccessful) {
            try {
                // TODO(data-test): step-conditions AND/OR operator toggle has no stable data-test in web/src/components/alerts/conditions/; add one to the operator toggle button to drop these class/text fallbacks.
                const operatorSelect = this.page.locator('.step-conditions .alert-conditions-operator, .step-conditions .condition-operator-toggle, .step-conditions [class*="operator-toggle"]').first();
                if (await operatorSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await operatorSelect.click();
                    await this.page.waitForTimeout(500);
                    // Check if a popover appeared with OR option
                    const orOption = this.page.locator('[data-test$="-popover"] [data-test$="-option"]').filter({ hasText: 'OR' }).first();
                    if (await orOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await orOption.click();
                        toggleSuccessful = true;
                        message = 'Successfully toggled via operator popover';
                        testLogger.info(message);
                    }
                }
            } catch (e) {
                testLogger.warn('Operator popover fallback failed', { error: e.message });
            }
        }

        if (!toggleSuccessful) {
            message = 'Toggle operator button not found in v3 UI - tried data-test, AND label, and operator dropdown selectors';
            testLogger.warn(message);
        }

        // Cancel alert creation
        await this.page.locator(this.locators.alertBackButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        return { toggleSuccessful, message };
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
     * Verify deduplication step is visible (only for scheduled alerts)
     */
    async verifyDeduplicationStepVisible() {
        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });

        const fingerprintSelect = this.page.locator(this.locators.stepDeduplicationFingerprintSelect);
        await expect(fingerprintSelect).toBeVisible({ timeout: 3000 });

        const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
        await expect(timeWindowInput).toBeVisible({ timeout: 3000 });

        testLogger.info('Deduplication step verified - all elements visible');
        return true;
    }

    /**
     * Get current deduplication configuration from the UI
     */
    async getDeduplicationConfig() {
        const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
        const timeWindowValue = await timeWindowInput.inputValue();

        const fingerprintSelect = this.page.locator(this.locators.stepDeduplicationFingerprintSelect);
        const chips = await fingerprintSelect.locator('[data-test*="chip"], [data-test*="badge"]').allTextContents();

        return {
            timeWindowMinutes: timeWindowValue ? parseInt(timeWindowValue, 10) : null,
            fingerprintFields: chips
        };
    }

    getCurrentAlertName() {
        return this.currentAlertName;
    }

    async _selectAlertType(typeName) {
        const alertTypeSelect = this.page.locator(this.locators.alertTypeSelect);
        await alertTypeSelect.waitFor({ state: 'visible', timeout: 5000 });
        await alertTypeSelect.click();
        await this.page.waitForTimeout(500);
        // Use flexible text matching — the option text is "Realtime" (no hyphen) in English locale
        // Map "Real-time" to "Realtime" for the dropdown display text
        const displayName = typeName === 'Real-time' ? 'Realtime' : typeName;
        const alertTypeOption = this.page.locator('[data-test$="-popover"] [data-test$="-option"]').filter({ hasText: displayName }).first();
        await alertTypeOption.waitFor({ state: 'visible', timeout: 5000 });
        await alertTypeOption.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected alert type', { typeName, displayName });
    }

    async _switchToTab(tabName) {
        // v3 UI: tabs are inner divs within the tab header bar (first child of .alert-v3-tabs)
        // e.g. <div>Alert Rules *</div> and <div>Advanced</div>
        const tab = this.page.locator('.alert-v3-tabs > div:first-child > div').filter({ hasText: tabName }).first();
        // Check if this tab is already active (has active-tab class)
        const isActive = await tab.evaluate(el => el.classList.contains('active-tab')).catch(() => false);
        if (isActive) {
            testLogger.info('Tab already active, skipping click', { tabName });
            return;
        }
        await tab.waitFor({ state: 'visible', timeout: 5000 });
        await tab.click({ force: true });
        await this.page.waitForTimeout(500);
        testLogger.info('Switched to tab', { tabName });
    }

    async _switchToAdvancedTab() {
        await this._switchToTab('Advanced');
    }

    async _switchToAlertRulesTab() {
        await this._switchToTab('Alert Rules');
    }

    /**
     * Create a scheduled alert with deduplication for validation testing
     * Uses custom columns (city) and configures for quick evaluation cycles
     * @param {string} streamName - Name of the stream (with custom columns)
     * @param {string} column - Column name for condition (e.g., 'city')
     * @param {string} value - Value for condition (e.g., 'bangalore')
     * @param {string} destinationName - Name of the destination (validation destination)
     * @param {string} randomValue - Random string for unique naming
     * @param {Object} dedupConfig - Deduplication configuration
     * @param {number} [dedupConfig.timeWindowMinutes] - Time window in minutes (default: 5)
     * @param {string[]} [dedupConfig.fingerprintFields] - Fields for fingerprinting (default: [column])
     */
    async createScheduledAlertWithDedupForValidation(streamName, column, value, destinationName, randomValue, dedupConfig = {}) {
        const randomAlertName = 'auto_dedup_val_' + randomValue;
        this.currentAlertName = randomAlertName;

        // Default dedup config for validation testing
        const timeWindowMinutes = dedupConfig.timeWindowMinutes || 5;
        const fingerprintFields = dedupConfig.fingerprintFields || [column];

        testLogger.info('Creating scheduled alert with deduplication for validation', {
            streamName,
            column,
            value,
            destinationName,
            alertName: randomAlertName,
            dedupConfig: { timeWindowMinutes, fingerprintFields }
        });

        // ==================== ALERT SETUP ====================
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Add alert dialog opened');

        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs) via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await this.selectStreamByName(streamName);
        testLogger.info('Selected stream name', { streamName });

        // Select Scheduled alert type via dropdown (v3 UI)
        await this._selectAlertType('Scheduled');
        testLogger.info('Selected scheduled alert type');

        // ==================== CONDITIONS (SQL) ====================
        const sqlTab = this.page.locator('[data-test="step2-query-tabs"] button:has-text("SQL")');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to SQL tab');

        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened SQL Editor dialog');

        // Use SQL query that selects data matching our condition
        const sqlQuery = `SELECT ${column} FROM "${streamName}" WHERE ${column} = '${value}'`;
        // Get the Monaco editor (innermost .monaco-editor element)
        const monacoEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type(sqlQuery);
        testLogger.info('Entered SQL query', { sqlQuery });

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran SQL query');

        // Close dialog — try back button, then close button
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            await closeButton.click({ force: true, timeout: 10000 });
        } catch (error) {
            testLogger.warn('Close button force-click failed, trying dialog close button', { error: error.message });
            const dialogCloseBtn = this.page.locator('[data-test="o-dialog-close-btn"]').first();
            if (await dialogCloseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await dialogCloseBtn.click();
            }
            await this.page.waitForTimeout(500);
        }
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Verify SQL editor dialog is closed by waiting for it to be hidden
        const sqlEditorDialog = this.page.locator(this.locators.sqlEditorDialog);
        const dialogHidden = await sqlEditorDialog.isHidden({ timeout: 5000 }).catch(() => true);
        if (!dialogHidden) {
            testLogger.warn('SQL Editor dialog still visible, clicking close button');
            await this.page.locator('[data-test="o-dialog-close-btn"]').first().click().catch(() => {});
            await this.page.waitForTimeout(1000);
        }
        testLogger.info('Closed SQL Editor dialog');

        // ==================== COMPARE WITH PAST (Advanced tab) ====================
        await this._switchToAdvancedTab();

        // Add time range comparison
        const addTimeRangeBtn = this.page.locator(this.locators.multiTimeRangeAddButton);
        if (await addTimeRangeBtn.isVisible({ timeout: 3000 })) {
            await addTimeRangeBtn.click();
            await this.page.waitForTimeout(1000);
            await this.page.locator('[data-test="date-time-btn"]').click();
            await this.page.locator('[data-test="date-time-relative-30-m-btn"]').click();
            testLogger.info('Added 30-minute time range comparison');
        } else {
            testLogger.info('Time range button not visible, skipping');
        }

        // ==================== ALERT SETTINGS (back in Alert Rules tab) ====================
        await this._switchToAlertRulesTab();

        // For SQL mode, the condition row shows "Alert if No. of events *" (not "matching logs")
        const thresholdSection = this.page.locator('.alert-condition-row').filter({ hasText: 'No. of events' }).first();
        const thresholdOperator = thresholdSection.locator('.alert-v3-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click({ force: true });
        await this.page.waitForTimeout(500);
        // Scope to visible popover to avoid strict mode violation (selected value + dropdown option)
        await this.page.locator('[data-test$="-popover"]').getByText('>=', { exact: true }).click();
        testLogger.info('Set threshold operator: >=');

        const thresholdInput = thresholdSection.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 10000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        // Set shortest period (1 minute) for faster testing
        const periodInput = this.page.locator('.period-input-container input[type="number"]');
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 5000 })) {
            await periodInput.fill('1');
            testLogger.info('Set period: 1 minute (shortest)');
        }

        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 10000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Use popover selector for destination
        const visibleDestMenuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuItems.first()).toBeVisible({ timeout: 5000 });

        let destFound = false;
        const destOption = visibleDestMenuItems.filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            destFound = true;
            testLogger.info('Selected destination via popover', { destinationName });
        }

        if (!destFound) {
            // Try scrolling to find the destination
            try {
                await this.commonActions.scrollAndFindOption(destinationName, 'template');
                testLogger.info('Found destination by scrolling', { destinationName });
            } catch (scrollError) {
                await visibleDestMenuItems.first().click();
                testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
            }
        }
        await this.page.waitForTimeout(500);
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        testLogger.info('Selected destination', { destinationName });

        // ==================== DEDUPLICATION (Advanced tab) ====================
        await this._switchToAdvancedTab();

        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });
        testLogger.info('Deduplication container visible in Advanced tab');

        // Configure fingerprint fields
        if (fingerprintFields && fingerprintFields.length > 0) {
            const fingerprintSelect = this.page.locator(this.locators.stepDeduplicationFingerprintSelect);
            await fingerprintSelect.waitFor({ state: 'visible', timeout: 5000 });

            for (const field of fingerprintFields) {
                await fingerprintSelect.click();
                await this.page.waitForTimeout(500);
                await fingerprintSelect.locator('input').fill(field);
                await this.page.waitForTimeout(500);

                const fieldOption = this.page.getByRole('option', { name: field }).first();
                if (await fieldOption.isVisible({ timeout: 2000 })) {
                    await fieldOption.click();
                } else {
                    await this.page.keyboard.press('Enter');
                }
                await this.page.waitForTimeout(300);
            }
            await this.page.locator('body').click({ position: { x: 10, y: 10 } });
            testLogger.info('Configured fingerprint fields', { fields: fingerprintFields });
        }

        // Configure time window
        const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
        await timeWindowInput.waitFor({ state: 'visible', timeout: 5000 });
        await timeWindowInput.clear();
        await timeWindowInput.fill(String(timeWindowMinutes));
        testLogger.info('Set dedup time window', { minutes: timeWindowMinutes });

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with deduplication for validation', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with aggregation enabled in Builder mode
     * PR #10470 moved aggregation from Step 4 (AlertSettings) to Step 2 (QueryConfig)
     *
     * Wizard flow: Step 1 (Setup) -> Step 2 (Conditions + Aggregation) -> Step 3 (Compare) -> Step 4 (Settings) -> Step 5 (Dedup) -> Step 6 (Advanced) -> Submit
     *
     * @param {string} streamName - Name of the log stream
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     */
    async createScheduledAlertWithAggregation(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_agg_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        testLogger.info('Creating scheduled alert with aggregation', {
            streamName, destinationName, alertName: randomAlertName
        });

        // ==================== ALERT SETUP ====================
        const addAlertBtn = this.page.locator(this.locators.addAlertButton);
        await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });

        // If button is disabled, reload the page to fetch destinations
        if (await addAlertBtn.isDisabled()) {
            testLogger.info('Add Alert button disabled, reloading page to fetch destinations');
            await this.page.reload();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });
        }

        await expect(addAlertBtn).toBeEnabled({ timeout: 15000 });
        await addAlertBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 })
            .catch(() => testLogger.debug('networkidle timeout after addAlert click — continuing'));

        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);

        // Select stream type (logs) via OSelect popover pattern (§4)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="logs"]`).click();
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });

        await this.selectStreamByName(streamName);

        // Select Scheduled alert type via dropdown (v3 UI)
        await this._selectAlertType('Scheduled');
        testLogger.info('Alert setup complete');

        // ==================== CONDITIONS + AGGREGATION (Alert Rules tab) ====================
        // Builder tab should be active by default for logs
        // Add a condition first
        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(500);

        // Select a known string column to avoid type_coercion errors
        // (picking an Int64 column like _timestamp with "Contains"/LIKE causes DataFusion errors)
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        const visibleMenuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        const levelOption = visibleMenuItems.filter({ hasText: 'level' });
        await expect(levelOption.first()).toBeVisible({ timeout: 5000 });
        await levelOption.first().click();
        await this.page.waitForTimeout(500);

        // Select operator
        await this.page.locator(this.locators.operatorSelect).first().click();
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(300);

        // Fill condition value
        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');
        testLogger.info('Added condition');

        // Aggregation is now controlled through function dropdown in v3 UI
        // The dropdown is in the first "Alert if *" condition row — click the function dropdown
        const alertIfSection = this.page.locator('.alert-condition-row').filter({ hasText: 'Alert if' }).first();
        const functionDropdown = alertIfSection.locator('.alert-v3-select').first();
        await functionDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await functionDropdown.click();
        await this.page.waitForTimeout(500);
        // Click a measure function (e.g., "count") to enable group-by and having threshold
        await this.page.locator('[data-test$="-popover"] [data-test$="-option"]').filter({ hasText: 'count' }).first().click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched from total_events to count (aggregation ON)');

        // In measure mode, the "Alert if" row adds a field selector ("count of [field]").
        // Must select a measure column or validateAndFocus() will reject with
        // "Column is required when using an aggregate function."
        // The field selector is the 2nd q-select in the "Alert if" row (after function dropdown)
        const measureColumnSelect = alertIfSection.locator('.alert-v3-select').nth(1);
        await measureColumnSelect.waitFor({ state: 'visible', timeout: 5000 });
        await measureColumnSelect.click();
        await this.page.waitForTimeout(500);
        const measureColumnMenuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(measureColumnMenuItems.first()).toBeVisible({ timeout: 5000 });
        await measureColumnMenuItems.first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected measure column for count aggregation');

        // In measure mode, the "Alert if" row shows a trigger condition:
        // "is [operator: conditionOperator] [value: conditionValue]"
        // conditionOperator defaults to '>=' but conditionValue is '' (empty) for new alerts.
        // Quasar validation rule requires non-empty value, so fill it explicitly.
        const alertIfTriggerValue = alertIfSection.locator('input[type="number"]').first();
        if (await alertIfTriggerValue.isVisible({ timeout: 3000 }).catch(() => false)) {
            await alertIfTriggerValue.fill('1');
            await this.page.waitForTimeout(300);
            testLogger.info('Set Alert-if trigger value to 1');
        }

        // Select first available group-by field
        // In v3, the Group By section begins with no q-select elements — the
        // `v-for` loop over `logGroupBy` only renders q-selects when entries exist.
        // Initially only the "+" add button (q-btn icon="add") is visible.
        const groupBySection = this.page.locator('.alert-condition-row').filter({ hasText: 'Group by' }).first();
        await groupBySection.waitFor({ state: 'visible', timeout: 5000 });
        // Click the "+" add button to create a group-by field entry
        const addGroupByBtn = groupBySection.locator('button:has(.OIcon:not(.OIcon--delete)), button[icon="add"], [data-test="group-by-add-btn"], button:has-text("add")').first();
        await addGroupByBtn.waitFor({ state: 'visible', timeout: 5000 });
        await addGroupByBtn.click();
        await this.page.waitForTimeout(800);
        // Now the q-select should be rendered by the v-for — select from it
        const groupBySelect = groupBySection.locator('.alert-v3-select').first();
        await groupBySelect.waitFor({ state: 'visible', timeout: 5000 });
        await groupBySelect.click();
        await this.page.waitForTimeout(500);
        const groupByMenuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(groupByMenuItems.first()).toBeVisible({ timeout: 5000 });
        await groupByMenuItems.first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected group-by field');

        // Configure aggregation threshold (v3 UI)
        // i18n key "alerts.queryConfig.havingGroups" renders as "Having groups"
        // In v3, "Having groups" section only has:
        //   1st q-select: operator (triggerOperator) with options ["=", "!=", ">=", ">", "<=", "<"]
        //   q-input: threshold value
        const aggThresholdSection = this.page.locator('.alert-condition-row').filter({ hasText: 'Having groups' }).first();
        // Operator q-select (first/only q-select in this section)
        const aggOperatorSelect = aggThresholdSection.locator('.alert-v3-select').first();
        await aggOperatorSelect.waitFor({ state: 'visible', timeout: 5000 });
        await aggOperatorSelect.click();
        await this.page.waitForTimeout(500);
        const aggOperatorMenuItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await aggOperatorMenuItems.filter({ hasText: '>=' }).first().click();
        await this.page.waitForTimeout(300);

        // Value input for aggregation threshold
        const aggValueInput = aggThresholdSection.locator('input[type="number"]').first();
        await aggValueInput.fill('1');
        await this.page.waitForTimeout(500);
        testLogger.info('Configured aggregation threshold');

        // ==================== ALERT SETTINGS ====================
        // In v3 measure mode (selectedFunction !== 'total_events'), the condition
        // operator/value was already set in the "Alert if" row above. No separate
        // trigger condition section exists below the Having groups section.

        // Period
        const periodInput = this.page.locator('.period-input-container input[type="number"]');
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
        }

        // Destination (v3 uses data-test locator)
        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenuAggItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuAggItems.first()).toBeVisible({ timeout: 5000 });

        const destOptionAgg = visibleDestMenuAggItems.filter({ hasText: destinationName }).first();
        if (await destOptionAgg.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionAgg.click();
        } else {
            await visibleDestMenuAggItems.first().click();
            testLogger.warn('Selected first available destination (fallback)');
        }
        await this.page.waitForTimeout(500);
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        testLogger.info('Configured alert settings');

        // Remaining advanced features (CompareWithPast, Dedup) are in Advanced tab
        // but we skip them for this test

        // ==================== SUBMIT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with aggregation', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with PromQL query for metrics streams
     * This tests the fix for bug #9967 - cannot save alert when selecting PromQL mode
     *
     * @param {string} metricsStreamName - Name of the metrics stream (e.g., 'e2e_test_cpu_usage')
     * @param {string} promqlQuery - PromQL query string (e.g., 'e2e_test_cpu_usage')
     * @param {string} destinationName - Name of the destination
     * @param {string} randomValue - Random string for unique naming
     * @param {Object} promqlCondition - PromQL condition config
     * @param {string} [promqlCondition.operator='>='] - Operator for promql condition
     * @param {number} [promqlCondition.value=1] - Value for promql condition
     */
    async createScheduledAlertWithPromQL(metricsStreamName, promqlQuery, destinationName, randomValue, promqlCondition = {}) {
        const randomAlertName = 'auto_promql_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        // Default promql condition values
        const operator = promqlCondition.operator || '>=';
        const conditionValue = promqlCondition.value !== undefined ? promqlCondition.value : 1;

        testLogger.info('Creating scheduled alert with PromQL query', {
            metricsStreamName,
            promqlQuery,
            destinationName,
            alertName: randomAlertName,
            promqlCondition: { operator, value: conditionValue }
        });

        // ==================== ALERT SETUP ====================
        // Wait for Add Alert button to be enabled (destinations need to load)
        const addAlertBtn = this.page.locator(this.locators.addAlertButton);
        await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });

        // If button is disabled, reload the page to fetch destinations
        if (await addAlertBtn.isDisabled()) {
            testLogger.info('Add Alert button disabled, reloading page to fetch destinations');
            await this.page.reload();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });
        }

        await expect(addAlertBtn).toBeEnabled({ timeout: 15000 });
        await addAlertBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Add alert dialog opened');

        await this.page.locator(this.locators.alertNameInputField).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (metrics) via OSelect popover pattern (§4) — IMPORTANT: Must be metrics for PromQL tab to appear
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.locator(this.locators.streamTypePopover)).toBeVisible({ timeout: 10000 });
        await this.page.locator(`${this.locators.streamTypeOption}[data-test-value="metrics"]`).click();
        // Wait for stream listing API to complete after type change
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        // Deterministic wait: stream-name dropdown becomes enabled once `formData.stream_type` is set (§10)
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeEnabled({ timeout: 10000 });
        testLogger.info('Selected stream type: metrics');

        // Select metrics stream name
        await this.selectStreamByName(metricsStreamName);
        testLogger.info('Selected metrics stream name', { metricsStreamName });

        // Select Scheduled alert type via dropdown (v3 UI)
        await this._selectAlertType('Scheduled');
        testLogger.info('Selected scheduled alert type');

        // ==================== CONDITIONS (PromQL) ====================
        // Click PromQL tab (only visible for metrics streams)
        const promqlTab = this.page.locator('[data-test="step2-query-tabs"] button:has-text("PromQL")');
        await promqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await promqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to PromQL tab');

        // Open PromQL editor
        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened PromQL Editor dialog');

        // Enter PromQL query in the editor (force-click to bypass portal dialog interception)
        const monacoEditor = this.page.locator(this.locators.promqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type(promqlQuery, { delay: 10 });
        testLogger.info('Entered PromQL query', { promqlQuery });

        // Run the query
        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran PromQL query');

        // Close PromQL editor dialog (ODrawer with data-test="query-editor-dialog")
        // Step 1: Click the back arrow button
        try {
            const backBtn = this.page.locator('[data-test="add-alert-back-btn"]').first();
            await backBtn.waitFor({ state: 'visible', timeout: 5000 });
            await backBtn.click({ force: true });
            testLogger.info('Clicked add-alert-back-btn to close PromQL editor');
        } catch (error) {
            testLogger.warn('Back button click failed, pressing Escape', { error: error.message });
        }
        // Step 2: Wait for the ODrawer to close (data-state transitions from "open" to "closed")
        await this.page.waitForFunction(() => {
            const drawer = document.querySelector('[data-test="query-editor-dialog"]');
            return !drawer || drawer.getAttribute('data-state') === 'closed';
        }, { timeout: 10000 }).catch(() => {
            testLogger.warn('ODrawer still open after back button, trying Escape key');
        });
        // Step 3: Press Escape as additional cleanup
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(500);
        // Step 4: Wait for any remaining overlay to be removed
        await this.page.waitForSelector('[data-o2-drawer][data-state="open"]', { state: 'hidden', timeout: 5000 }).catch(() => {});
        testLogger.info('Closed PromQL Editor dialog');

        // Fill PromQL trigger condition (in Alert Rules tab - QueryConfig.vue)
        // In v3 UI the label is "Alert if the value is *" (NOT "Trigger if the value is")
        const queryConfigSection = this.page.locator('.step-query-config');
        const promqlConditionLabel = queryConfigSection.getByText('Alert if the value').first();
        await promqlConditionLabel.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('PromQL trigger condition section visible in Alert Rules tab');

        // The outer flex container holds both the label div and controls div as siblings
        const promqlConditionRow = promqlConditionLabel.locator('..');

        // Select operator
        const promqlOperatorSelect = promqlConditionRow.locator('.alert-v3-select').first();
        await promqlOperatorSelect.click({ timeout: 10000 });
        await this.page.waitForTimeout(800);
        // Pick operator from the now-visible popover
        const visibleMenuPromqlItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleMenuPromqlItems.first()).toBeVisible({ timeout: 5000 });
        await visibleMenuPromqlItems.filter({ hasText: operator }).first().click();
        await this.page.waitForTimeout(300);
        testLogger.info('Set PromQL condition operator', { operator });

        // Set value (q-input has debounce="300")
        const promqlValueInput = promqlConditionRow.locator('input[type="number"]');
        await promqlValueInput.clear();
        await promqlValueInput.fill(String(conditionValue));
        await this.page.waitForTimeout(500);
        testLogger.info('Set PromQL condition value', { value: conditionValue });

        // ==================== ALERT SETTINGS ====================
        // In v3, the PromQL trigger condition is part of QueryConfig (set above)
        // No separate threshold section — just period and destination

        // Set period
        const periodInput = this.page.locator('.period-input-container input[type="number"]');
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
            testLogger.info('Set period: 15 minutes');
        }

        // Select destination (v3 uses data-test locator)
        const destinationDropdown = this.page.locator('[data-test="alert-destinations-select"]');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenuPromqlItems = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
        await expect(visibleDestMenuPromqlItems.first()).toBeVisible({ timeout: 5000 });

        let destFound = false;
        const destOption = visibleDestMenuPromqlItems.filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            destFound = true;
            testLogger.info('Selected destination via popover', { destinationName });
        }

        if (!destFound) {
            await visibleDestMenuPromqlItems.first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.waitForTimeout(500);
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        testLogger.info('Selected destination', { destinationName });

        // Remaining advanced features (CompareWithPast, Dedup) are in Advanced tab
        // but we skip them for this test

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        // OToast renders the message in 3 elements (sr-only ARIA span, sr-only title div,
        // visible message div) — scope to the visible `o-toast-message` data-test to avoid
        // strict-mode violation per AGENT_RULES §2.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: this.locators.alertSuccessMessage })
                .first()
        ).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with PromQL query', { alertName: randomAlertName });

        return randomAlertName;
    }
}
