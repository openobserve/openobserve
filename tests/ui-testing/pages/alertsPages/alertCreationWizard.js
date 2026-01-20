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
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);

        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.streamNameDropdown).click();

        try {
            await expect(this.page.getByText(`${streamName}`, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, retrying');
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
            await expect(this.page.getByText(`${streamName}`, { exact: true })).toBeVisible({ timeout: 5000 });
        }
        await this.page.getByText(`${streamName}`, { exact: true }).click();

        await expect(this.page.locator(this.locators.realtimeAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.realtimeAlertRadio).click();

        // ==================== STEP 2: CONDITIONS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(500);

        // Column selection with fallback to first available if specific column not found
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect.click();
        await this.page.waitForTimeout(500);

        let columnFound = false;
        const visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        const columnItems = await visibleMenu.locator('.q-item').allTextContents();
        testLogger.info('Available columns in dropdown', { columns: columnItems.slice(0, 10), requestedColumn: column });

        const columnOption = visibleMenu.locator('.q-item').filter({ hasText: column }).first();
        if (await columnOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await columnOption.click();
            columnFound = true;
        }

        if (!columnFound) {
            await visibleMenu.locator('.q-item').first().click();
            testLogger.info('Selected first available column (fallback)', { requestedColumn: column });
        }
        await this.page.waitForTimeout(500);

        await expect(this.page.locator(this.locators.operatorSelect).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.operatorSelect).first().click();
        await this.page.getByText('Contains', { exact: true }).click();

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill(value);

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // Set silence notification to 0 for immediate alerts
        const silenceInput = this.page.locator(this.locators.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Destination selection with fallback
        const destinationSection = this.page.locator('div.flex.items-start').filter({
            has: this.page.locator('span:has-text("Destination")')
        }).first();

        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });
        const destinationDropdown = destinationSection.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenu = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFound = false;
        const destOption = visibleDestMenu.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            destFound = true;
        }

        if (!destFound) {
            try {
                await this.commonActions.scrollAndFindOption(destinationName, 'template');
            } catch (scrollError) {
                await visibleDestMenu.locator('.q-item').first().click();
                testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
            }
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // ==================== SUBMIT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
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
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);

        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.streamNameDropdown).click();
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
        }
        await this.page.getByText(streamName, { exact: true }).click();

        await expect(this.page.locator(this.locators.realtimeAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.realtimeAlertRadio).click();

        // ==================== STEP 2: CONDITIONS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

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
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        const visibleMenuDefaults = this.page.locator('.q-menu:visible');
        await expect(visibleMenuDefaults.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await visibleMenuDefaults.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);

        const operatorSelect = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
        await operatorSelect.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // Set silence notification to 0 for immediate alerts
        const silenceInput = this.page.locator(this.locators.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Destination selection with fallback
        const destinationSection = this.page.locator('div.flex.items-start').filter({
            has: this.page.locator('span:has-text("Destination")')
        }).first();
        await destinationSection.waitFor({ state: 'visible', timeout: 10000 });
        const destinationDropdown = destinationSection.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenuDef = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenuDef.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFoundDef = false;
        const destOptionDef = visibleDestMenuDef.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOptionDef.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionDef.click();
            destFoundDef = true;
        }

        if (!destFoundDef) {
            await visibleDestMenuDef.locator('.q-item').first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.keyboard.press('Escape');

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // ==================== SUBMIT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert with defaults', { alertName: randomAlertName });

        // Wait for navigation back to alerts list
        await this.page.waitForLoadState('networkidle');
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
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting scheduled alert creation wizard', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);

        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.streamNameDropdown).click();

        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, retrying');
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        }
        await this.page.getByText(streamName, { exact: true }).click();

        await expect(this.page.locator(this.locators.scheduledAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.scheduledAlertRadio).click();

        // ==================== STEP 2: CONDITIONS (SQL) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        const sqlTab = this.page.locator('[data-test="tab-sql"]');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);

        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        const sqlEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.locators.viewLineLocator).first().click();
        await sqlEditor.fill('SELECT kubernetes_labels_name FROM "e2e_automate" where kubernetes_labels_name = \'ziox-querier\'');

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        // Close SQL editor dialog
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            if (await closeButton.isVisible({ timeout: 3000 })) {
                await closeButton.click();
            } else {
                await this.page.locator(this.locators.qDialogLocator).getByText('arrow_back_ios_new').click();
            }
        } catch (error) {
            testLogger.warn('Close button click failed, trying keyboard escape', { error: error.message });
            await this.page.keyboard.press('Escape');
        }
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // ==================== STEP 3: COMPARE WITH PAST ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // Add 30-minute time range comparison
        const addTimeRangeBtn = this.page.locator(this.locators.multiTimeRangeAddButton);
        if (await addTimeRangeBtn.isVisible({ timeout: 3000 })) {
            await addTimeRangeBtn.click();
            await this.page.waitForTimeout(1000);
            await this.page.locator('[data-test="date-time-btn"]').click();
            await this.page.locator('[data-test="date-time-relative-30-m-btn"]').click();
        }

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        const thresholdOperator = this.page.locator(this.locators.stepAlertConditionsQSelect).first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click();

        const thresholdInput = this.page.locator(this.locators.stepAlertConditionsNumberInput).first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');

        const periodInput = this.page.locator('input[type="number"]').nth(1);
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
        }

        // Destination selection with fallback
        const destinationRow = this.page.locator(this.locators.alertSettingsRow).filter({ hasText: /Destination/ });
        const destinationDropdown = destinationRow.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenuSql = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenuSql.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFoundSql = false;
        const destOptionSql = visibleDestMenuSql.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOptionSql.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionSql.click();
            destFoundSql = true;
        }

        if (!destFoundSql) {
            await visibleDestMenuSql.locator('.q-item').first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');

        // ==================== STEP 5: DEDUPLICATION (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // ==================== SUBMIT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
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
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Starting multi-condition alert creation', { alertName: randomAlertName });

        // ==================== STEP 1: ALERT SETUP ====================
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);

        // Select stream type (logs)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        // Select stream name
        await this.page.locator(this.locators.streamNameDropdown).click();
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
        }
        await this.page.getByText(streamName, { exact: true }).click();

        // Select Real-time alert type
        await this.page.locator(this.locators.realtimeAlertRadio).click();
        testLogger.info('Alert setup complete');

        // ==================== STEP 2: CONDITIONS (Multiple) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

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
        const columnSelect1 = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        const visibleMenu1 = this.page.locator('.q-menu:visible');
        await expect(visibleMenu1.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await visibleMenu1.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for first condition');

        const operatorSelect1 = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
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
        const columnSelect2 = this.page.locator(this.locators.conditionColumnSelect).nth(1).locator('.q-select');
        await columnSelect2.click();
        await this.page.waitForTimeout(500);
        const visibleMenu2 = this.page.locator('.q-menu:visible');
        await expect(visibleMenu2.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        // Use nth(1) if available, otherwise first - to get a different column
        const columnCount = await visibleMenu2.locator('.q-item').count();
        if (columnCount > 1) {
            await visibleMenu2.locator('.q-item').nth(1).click();
        } else {
            await visibleMenu2.locator('.q-item').first().click();
        }
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for second condition');

        const operatorSelect2 = this.page.locator(this.locators.operatorSelect).nth(1).locator('.q-select');
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

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // Set Silence Notification to 0 minutes
        const silenceInput = this.page.locator(this.locators.silenceNotificationInput);
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
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

        // Use visible menu selector for destination
        const visibleDestMenuMulti = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenuMulti.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFoundMulti = false;
        const destOptionMulti = visibleDestMenuMulti.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOptionMulti.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionMulti.click();
            destFoundMulti = true;
            testLogger.info('Selected destination via visible menu', { destinationName });
        }

        if (!destFoundMulti) {
            // Fallback: select first available destination
            await visibleDestMenuMulti.locator('.q-item').first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created multi-condition alert', { alertName: randomAlertName });

        // Wait for page to navigate back to alerts list after creation
        await this.page.waitForLoadState('networkidle');
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

        // ==================== STEP 1: ALERT SETUP ====================
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        await expect(this.page.getByText(this.locators.alertSetupText).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Add alert dialog opened');

        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.streamNameDropdown).click();
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
        }
        await this.page.getByText(streamName, { exact: true }).click();
        testLogger.info('Selected stream name', { streamName });

        // Select Scheduled alert type
        await expect(this.page.locator(this.locators.scheduledAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.scheduledAlertRadio).click();
        testLogger.info('Selected scheduled alert type');

        // ==================== STEP 2: CONDITIONS (SQL) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        const sqlTab = this.page.locator('[data-test="tab-sql"]');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to SQL tab');

        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened SQL Editor dialog');

        const sqlEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.locators.viewLineLocator).first().click();
        await sqlEditor.fill(`SELECT kubernetes_labels_name FROM "${streamName}" where kubernetes_labels_name = 'ziox-querier'`);
        testLogger.info('Entered SQL query');

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran SQL query');

        // Close dialog
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            if (await closeButton.isVisible({ timeout: 3000 })) {
                await closeButton.click();
            } else {
                await this.page.locator(this.locators.qDialogLocator).getByText('arrow_back_ios_new').click();
            }
        } catch (error) {
            testLogger.warn('Close button click failed, trying keyboard escape', { error: error.message });
            await this.page.keyboard.press('Escape');
        }
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Closed SQL Editor dialog');

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

        const thresholdOperator = this.page.locator(this.locators.stepAlertConditionsQSelect).first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click();
        testLogger.info('Set threshold operator: >=');

        const thresholdInput = this.page.locator(this.locators.stepAlertConditionsNumberInput).first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        const periodInput = this.page.locator('input[type="number"]').nth(1);
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
            testLogger.info('Set period: 15 minutes');
        }

        const destinationRow = this.page.locator(this.locators.alertSettingsRow).filter({ hasText: /Destination/ });
        const destinationDropdown = destinationRow.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Use visible menu selector for destination
        const visibleDestMenuDedup = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenuDedup.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFoundDedup = false;
        const destOptionDedup = visibleDestMenuDedup.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOptionDedup.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOptionDedup.click();
            destFoundDedup = true;
            testLogger.info('Selected destination via visible menu', { destinationName });
        }

        if (!destFoundDedup) {
            // Fallback: select first available destination
            await visibleDestMenuDedup.locator('.q-item').first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 5: DEDUPLICATION ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 5: Deduplication');

        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });
        testLogger.info('Deduplication step container visible');

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
            await this.page.keyboard.press('Escape');
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

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (skipping)');

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
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
        await this.page.waitForLoadState('networkidle');

        // Fill Step 1: Alert Setup
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).fill(alertName);

        // Select stream type (logs)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        // Select stream
        await this.page.locator(this.locators.streamNameDropdown).click();
        await this.page.waitForTimeout(500);
        await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        await this.page.getByText(streamName, { exact: true }).click();

        // Select real-time alert type
        await this.page.locator(this.locators.realtimeAlertRadio).click();

        // Navigate to Step 2: Conditions
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

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
        const columnSelect1 = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        const visibleMenuToggle = this.page.locator('.q-menu:visible');
        await expect(visibleMenuToggle.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await visibleMenuToggle.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);

        const operatorSelect1 = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
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
        const toggleBtn = this.page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        let toggleSuccessful = false;
        let message = '';

        if (await toggleBtn.isVisible({ timeout: 3000 })) {
            await toggleBtn.click();
            await this.page.waitForTimeout(500);

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

        // Cancel alert creation
        await this.page.locator(this.locators.alertBackButton).click();
        await this.page.waitForLoadState('networkidle');

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
        const chips = await fingerprintSelect.locator('.q-chip').allTextContents();

        return {
            timeWindowMinutes: timeWindowValue ? parseInt(timeWindowValue, 10) : null,
            fingerprintFields: chips
        };
    }

    getCurrentAlertName() {
        return this.currentAlertName;
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

        // ==================== STEP 1: ALERT SETUP ====================
        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle');
        await expect(this.page.getByText(this.locators.alertSetupText).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Add alert dialog opened');

        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (logs)
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: logs');

        // Select stream name
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.streamNameDropdown).click();
        try {
            await expect(this.page.getByText(streamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
        }
        await this.page.getByText(streamName, { exact: true }).click();
        testLogger.info('Selected stream name', { streamName });

        // Select Scheduled alert type
        await expect(this.page.locator(this.locators.scheduledAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.scheduledAlertRadio).click();
        testLogger.info('Selected scheduled alert type');

        // ==================== STEP 2: CONDITIONS (SQL) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        const sqlTab = this.page.locator('[data-test="tab-sql"]');
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to SQL tab');

        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened SQL Editor dialog');

        // Use SQL query that selects data matching our condition
        // Use same query format as working createScheduledAlertWithSQL method
        const sqlQuery = `SELECT ${column} FROM "${streamName}" WHERE ${column} = '${value}'`;
        const sqlEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.locators.viewLineLocator).first().click();
        await sqlEditor.fill(sqlQuery);
        testLogger.info('Entered SQL query', { sqlQuery });

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran SQL query');

        // Close dialog - use same approach as working createScheduledAlertWithSQL method
        // The close button may be intercepted by backdrop, so use Escape as fallback
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            if (await closeButton.isVisible({ timeout: 3000 })) {
                await closeButton.click();
            } else {
                await this.page.locator(this.locators.qDialogLocator).getByText('arrow_back_ios_new').click();
            }
        } catch (error) {
            testLogger.warn('Close button click failed, trying keyboard escape', { error: error.message });
            await this.page.keyboard.press('Escape');
        }
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // Verify SQL editor dialog is closed by waiting for it to be hidden
        const sqlEditorDialog = this.page.locator(this.locators.sqlEditorDialog);
        const dialogHidden = await sqlEditorDialog.isHidden({ timeout: 5000 }).catch(() => true);
        if (!dialogHidden) {
            testLogger.warn('SQL Editor dialog still visible, pressing Escape');
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(1000);
        }
        testLogger.info('Closed SQL Editor dialog');

        // ==================== STEP 3: COMPARE WITH PAST ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 3: Compare with Past');

        // Add time range comparison (same as working createScheduledAlertWithSQL method)
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

        // ==================== STEP 4: ALERT SETTINGS ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 4: Alert Settings');

        // First wait for the step container to be visible
        const stepContainer = this.page.locator(this.locators.stepAlertConditions);
        await stepContainer.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Step 4 container visible');

        const thresholdOperator = this.page.locator(this.locators.stepAlertConditionsQSelect).first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click();
        testLogger.info('Set threshold operator: >=');

        const thresholdInput = this.page.locator(this.locators.stepAlertConditionsNumberInput).first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 10000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        // Set shortest period (1 minute) for faster testing
        const periodInput = this.page.locator('input[type="number"]').nth(1);
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 5000 })) {
            await periodInput.fill('1');
            testLogger.info('Set period: 1 minute (shortest)');
        }

        const destinationRow = this.page.locator(this.locators.alertSettingsRow).filter({ hasText: /Destination/ });
        const destinationDropdown = destinationRow.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 10000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        // Use visible menu selector for destination
        const visibleDestMenu = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFound = false;
        const destOption = visibleDestMenu.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            destFound = true;
            testLogger.info('Selected destination via visible menu', { destinationName });
        }

        if (!destFound) {
            // Try scrolling to find the destination
            try {
                await this.commonActions.scrollAndFindOption(destinationName, 'template');
                testLogger.info('Found destination by scrolling', { destinationName });
            } catch (scrollError) {
                await visibleDestMenu.locator('.q-item').first().click();
                testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
            }
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');
        testLogger.info('Selected destination', { destinationName });

        // ==================== STEP 5: DEDUPLICATION ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 5: Deduplication');

        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });
        testLogger.info('Deduplication step container visible');

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
            await this.page.keyboard.press('Escape');
            testLogger.info('Configured fingerprint fields', { fields: fingerprintFields });
        }

        // Configure time window
        const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
        await timeWindowInput.waitFor({ state: 'visible', timeout: 5000 });
        await timeWindowInput.clear();
        await timeWindowInput.fill(String(timeWindowMinutes));
        testLogger.info('Set dedup time window', { minutes: timeWindowMinutes });

        // ==================== STEP 6: ADVANCED (Skip) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);
        testLogger.info('Navigated to Step 6: Advanced (skipping)');

        // ==================== SUBMIT ALERT ====================
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with deduplication for validation', { alertName: randomAlertName });

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

        // ==================== STEP 1: ALERT SETUP ====================
        // Wait for Add Alert button to be enabled (destinations need to load)
        const addAlertBtn = this.page.locator(this.locators.addAlertButton);
        await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });

        // If button is disabled, reload the page to fetch destinations
        if (await addAlertBtn.isDisabled()) {
            testLogger.info('Add Alert button disabled, reloading page to fetch destinations');
            await this.page.reload();
            await this.page.waitForLoadState('networkidle');
            await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });
        }

        await expect(addAlertBtn).toBeEnabled({ timeout: 15000 });
        await addAlertBtn.click();
        await this.page.waitForLoadState('networkidle');
        await expect(this.page.getByText(this.locators.alertSetupText).first()).toBeVisible({ timeout: 10000 });
        testLogger.info('Add alert dialog opened');

        await this.page.locator(this.locators.alertNameInput).fill(randomAlertName);
        testLogger.info('Filled alert name', { alertName: randomAlertName });

        // Select stream type (metrics) - IMPORTANT: Must be metrics for PromQL tab to appear
        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: 'metrics' })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: 'metrics' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Selected stream type: metrics');

        // Select metrics stream name
        await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.streamNameDropdown).click();

        try {
            await expect(this.page.getByText(metricsStreamName, { exact: true })).toBeVisible({ timeout: 5000 });
        } catch (e) {
            testLogger.warn('Stream dropdown options not visible after first click, retrying');
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(1000);
            await expect(this.page.getByText(metricsStreamName, { exact: true })).toBeVisible({ timeout: 5000 });
        }
        await this.page.getByText(metricsStreamName, { exact: true }).click();
        testLogger.info('Selected metrics stream name', { metricsStreamName });

        // Select Scheduled alert type
        await expect(this.page.locator(this.locators.scheduledAlertRadio)).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.scheduledAlertRadio).click();
        testLogger.info('Selected scheduled alert type');

        // ==================== STEP 2: CONDITIONS (PromQL) ====================
        await this.page.getByRole('button', { name: 'Continue' }).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Navigated to Step 2: Conditions');

        // Click PromQL tab (only visible for metrics streams)
        const promqlTab = this.page.locator('[data-test="tab-promql"]');
        await promqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await promqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to PromQL tab');

        // Open PromQL editor
        const viewEditorBtn = this.page.locator(this.locators.viewEditorButton);
        await viewEditorBtn.waitFor({ state: 'visible', timeout: 10000 });
        await viewEditorBtn.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info('Opened PromQL Editor dialog');

        // Enter PromQL query in the editor
        const promqlEditor = this.page.locator(this.locators.promqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.locators.viewLineLocator).first().click();
        await promqlEditor.fill(promqlQuery);
        testLogger.info('Entered PromQL query', { promqlQuery });

        // Run the query
        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        testLogger.info('Ran PromQL query');

        // Close PromQL editor dialog
        try {
            const closeButton = this.page.locator('[data-test="add-alert-back-btn"]').first();
            if (await closeButton.isVisible({ timeout: 3000 })) {
                await closeButton.click();
            } else {
                await this.page.locator(this.locators.qDialogLocator).getByText('arrow_back_ios_new').click();
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

        // *** BUG FIX TEST: Fill PromQL condition (Trigger if the value is) ***
        // This is the new field added by PR #9970 to fix bug #9967
        const promqlConditionRow = this.page.locator('.alert-settings-row').filter({ hasText: 'Trigger if the value is' });
        await promqlConditionRow.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('PromQL condition row is visible - bug fix verified');

        // Select operator for promql_condition
        const promqlOperatorSelect = promqlConditionRow.locator('.q-select').first();
        await promqlOperatorSelect.click();
        await this.page.waitForTimeout(500);
        // Select from the visible dropdown menu (not just any text on page)
        const visibleMenu = this.page.locator('.q-menu:visible');
        await visibleMenu.locator(`.q-item`).filter({ hasText: operator }).first().click();
        await this.page.waitForTimeout(300);
        testLogger.info('Set PromQL condition operator', { operator });

        // Set value for promql_condition
        // Note: The q-input has debounce="300", so we must wait after filling
        const promqlValueInput = promqlConditionRow.locator('input[type="number"]');
        await promqlValueInput.clear();
        await promqlValueInput.fill(String(conditionValue));
        await this.page.waitForTimeout(500); // Wait for debounce to complete (300ms + buffer)
        testLogger.info('Set PromQL condition value', { value: conditionValue });

        // Set threshold (still required for PromQL alerts)
        // IMPORTANT: For PromQL alerts, there are TWO sets of operator/value fields:
        // 1. First: PromQL condition (promql_condition.operator, promql_condition.value)
        // 2. Second: Threshold (trigger_condition.operator, trigger_condition.threshold)
        // Use nth(1) to target the SECOND q-select on the step (the threshold operator)
        const stepContainer = this.page.locator('.step-alert-conditions');
        const thresholdOperator = stepContainer.locator('.q-select').nth(1); // Second q-select is threshold
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        const visibleThresholdMenu = this.page.locator('.q-menu:visible');
        await visibleThresholdMenu.locator('.q-item').filter({ hasText: '>=' }).first().click();
        await this.page.waitForTimeout(300);
        testLogger.info('Set threshold operator: >=');

        // The threshold value input is the SECOND number input after promql value
        // But it shares a row with a "events" label, so we need to find the right one
        // Looking at the UI structure: promql value is first, threshold value is second
        const thresholdInput = stepContainer.locator('input[type="number"]').nth(1);
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');
        testLogger.info('Set threshold value: 1');

        // Set period - period input is third number input on the step
        const periodInput = stepContainer.locator('input[type="number"]').nth(2);
        await this.page.waitForTimeout(500);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('1');
            testLogger.info('Set period: 1 minute');
        }

        // Select destination
        const destinationRow = this.page.locator(this.locators.alertSettingsRow).filter({ hasText: /Destination/ });
        const destinationDropdown = destinationRow.locator('.q-select').first();
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });
        await destinationDropdown.click();
        await this.page.waitForTimeout(1000);

        const visibleDestMenu = this.page.locator('.q-menu:visible');
        await expect(visibleDestMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        let destFound = false;
        const destOption = visibleDestMenu.locator('.q-item').filter({ hasText: destinationName }).first();
        if (await destOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await destOption.click();
            destFound = true;
            testLogger.info('Selected destination via visible menu', { destinationName });
        }

        if (!destFound) {
            await visibleDestMenu.locator('.q-item').first().click();
            testLogger.warn('Selected first available destination (fallback)', { requestedDestination: destinationName });
        }
        await this.page.waitForTimeout(500);
        await this.page.keyboard.press('Escape');
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
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with PromQL query', { alertName: randomAlertName });

        return randomAlertName;
    }
}
