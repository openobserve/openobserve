/**
 * AlertCreationWizard - Handles all alert creation workflows
 *
 * V3 UI Revamp: The old multi-step wizard (Step 1→6 with "Continue" buttons)
 * has been replaced with a tab-based "V3 Single Pane of Glass" layout.
 * Two tabs: "Alert Rules" (conditions + settings) and "Advanced" (dedup + advanced).
 * Alert type (real-time/scheduled) is now a q-select dropdown, not radio buttons.
 * Save/Cancel buttons in footer instead of Continue/Back.
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

    // ==================== SHARED HELPERS ====================

    /**
     * Select alert type from the dropdown (V3 UI: q-select, not radio buttons)
     * @param {'Scheduled'|'Realtime'} type - Alert type to select
     */
    async _selectAlertType(type) {
        // Find the alert type q-select near the "Alert Type" label
        const typeSelectors = [
            '.alert-v3-inline-label:has-text("Alert Type") + .q-select input',
            '.alert-v3-inline-label:has-text("Alert Type") ~ div .q-select input',
            'input[aria-label="Alert Type"]',
            '.q-field__control:has-text("Realtime") input, .q-field__control:has-text("Scheduled") input',
        ];
        let selectInput = null;
        for (const sel of typeSelectors) {
            selectInput = this.page.locator(sel).first();
            if (await selectInput.isVisible({ timeout: 2000 }).catch(() => false)) break;
        }

        if (!selectInput || !(await selectInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Fallback: click the select by position (3rd q-select in the top bar area)
            testLogger.warn('Alert type select not found by label, using fallback selector');
            await this.page.locator('.alert-v3-field').first().click();
            await this.page.waitForTimeout(500);
            await this.page.getByRole('option', { name: type }).first().click();
            return;
        }

        await selectInput.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: type }).first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected alert type', { type });
    }

    /**
     * Select a stream from the stream name dropdown using keyboard filtering.
     */
    async selectStreamByName(streamName) {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await expect(this.page.locator(this.locators.streamNameDropdown)).toBeVisible({ timeout: 10000 });
            await this.page.locator(this.locators.streamNameDropdown).click();
            await this.page.waitForTimeout(500);
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
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(1000);

            if (attempt < maxRetries) {
                await this.page.locator('[data-test="add-alert-back-btn"]').click();
                await this.page.waitForTimeout(2000);
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.locator(this.locators.addAlertButton).click();
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);

                await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
                await this.page.locator(this.locators.alertNameInput).click();
                await this.page.locator(this.locators.alertNameInput).fill(this.currentAlertName);

                await this.page.locator(this.locators.streamTypeDropdown).click();
                await expect(this.page.getByRole('option', { name: 'logs' })).toBeVisible({ timeout: 10000 });
                await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);
            }
        }
        await this.page.getByText(streamName, { exact: true }).click();
    }

    /**
     * Fill in the basic alert setup fields (name, stream type, stream name, alert type)
     */
    async _fillBasicAlertSetup(alertName, streamName, streamType = 'logs', alertType = 'Realtime') {
        await expect(this.page.locator(this.locators.alertNameInput)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.locators.alertNameInput).click();
        await this.page.locator(this.locators.alertNameInput).fill(alertName);

        await this.page.locator(this.locators.streamTypeDropdown).click();
        await expect(this.page.getByRole('option', { name: streamType })).toBeVisible({ timeout: 10000 });
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        await this.selectStreamByName(streamName);
        await this._selectAlertType(alertType);
    }

    /**
     * Select a destination in the Alert Settings section (uses data-test="alert-destinations-select")
     * V3 UI: q-select with custom option template using data-test="alert-destination-option-{name}"
     * Uses input-typing to filter the dropdown for reliable option matching.
     * If destination is not found after retries, reloads the page to refresh data.
     */
    async _selectDestination(destinationName) {
        const destSelect = this.page.locator('[data-test="alert-destinations-select"]');
        await destSelect.waitFor({ state: 'visible', timeout: 10000 });

        // Try up to 3 attempts to find and select the destination
        for (let attempt = 1; attempt <= 3; attempt++) {
            // Click the destination select to open the dropdown
            await destSelect.click({ force: true });
            await this.page.waitForTimeout(800);

            // Type the destination name into the search/filter input to filter options
            const inputEl = destSelect.locator('input');
            if (await inputEl.isVisible({ timeout: 2000 }).catch(() => false)) {
                await inputEl.fill(destinationName);
                await this.page.waitForTimeout(1500);
            }

            // Use the custom option selector (V3: data-test="alert-destination-option-{name}")
            const optionSelector = `[data-test="alert-destination-option-${destinationName}"]`;
            const destOption = this.page.locator(optionSelector);
            const optionVisible = await destOption.isVisible({ timeout: 5000 }).catch(() => false);
            if (optionVisible) {
                await destOption.click();
                testLogger.info('Selected destination via V3 custom option', { destinationName, attempt });
                await this.page.keyboard.press('Escape').catch(() => {});
                return;
            }

            // Fallback: try clicking the option text directly
            const textOption = this.page.getByText(destinationName, { exact: true }).first();
            if (await textOption.isVisible({ timeout: 3000 }).catch(() => false)) {
                await textOption.click();
                testLogger.warn('Selected destination via text (fallback)', { destinationName, attempt });
                await this.page.keyboard.press('Escape').catch(() => {});
                return;
            }

            // Close dropdown before retry
            await this.page.keyboard.press('Escape').catch(() => {});
            await this.page.waitForTimeout(1000);
            testLogger.warn('Destination not found on attempt', { destinationName, attempt });

            // On second failure, reload the page to refresh cached data then reopen the wizard
            if (attempt === 2) {
                testLogger.info('Reloading page to refresh destination data', { destinationName });
                await this.page.reload();
                await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
                await this.page.waitForTimeout(2000);
                // Re-click Add Alert button to reopen the wizard
                const addBtn = this.page.locator('[data-test="add-alert-btn"]').first();
                if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                    await addBtn.click();
                    await this.page.waitForTimeout(2000);
                }
                await destSelect.waitFor({ state: 'visible', timeout: 10000 });
            }
        }

        // Last resort: type destination name and press Enter
        testLogger.warn('Could not find destination option after retries, trying last resort', { destinationName });
        await destSelect.click({ force: true });
        await this.page.waitForTimeout(500);
        const inputEl = destSelect.locator('input');
        if (await inputEl.isVisible({ timeout: 2000 }).catch(() => false)) {
            await inputEl.fill(destinationName);
            await this.page.waitForTimeout(1000);
            await this.page.keyboard.press('Enter');
            await this.page.waitForTimeout(500);
        }
        await this.page.keyboard.press('Escape').catch(() => {});
    }

    /**
     * Add and configure a condition in the conditions builder
     */
    async _addCondition(column, value, operator = 'Contains') {
        // Add condition button
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        const addCondBtn = this.page.locator(this.locators.addConditionButton).first();

        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else if (await addCondBtn.isVisible({ timeout: 3000 })) {
            await addCondBtn.click();
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Select column
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        const visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });

        if (column) {
            const columnOption = visibleMenu.locator('.q-item').filter({ hasText: column }).first();
            if (await columnOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                await columnOption.click();
            } else {
                await visibleMenu.locator('.q-item').first().click();
                testLogger.warn('Requested column not found, using first available', { requestedColumn: column });
            }
        } else {
            await visibleMenu.locator('.q-item').first().click();
        }
        await this.page.waitForTimeout(500);

        // Select operator
        const operatorSelect = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
        await operatorSelect.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText(operator, { exact: true }).click();
        await this.page.waitForTimeout(500);

        // Fill value
        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill(value);
        testLogger.info('Added condition', { column, operator, value });
    }

    // ==================== ALERT CREATION METHODS ====================

    /**
     * Create a real-time alert using V3 Single Pane of Glass UI
     * Flow: Fill setup → On Alert Rules tab: add condition + configure destination → Save
     */
    async createAlert(streamName, column, value, destinationName, randomValue) {
        const randomAlertName = 'Automation_Alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting alert creation', { alertName: randomAlertName });

        // Fill basic setup
        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Realtime');

        // Alert Rules tab is default — add condition
        await this._addCondition(column, value, 'Contains');

        // Alert settings (silence notification, destination) are on the same tab
        // Set silence to 0
        const silenceInput = this.page.locator('.silence-notification-input input');
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Select destination
        await this._selectDestination(destinationName);

        // Click Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a real-time alert with default/first available column
     */
    async createAlertWithDefaults(streamName, destinationName, randomValue) {
        const randomAlertName = 'Automation_Alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting alert creation with defaults', { alertName: randomAlertName });

        // Fill basic setup
        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Realtime');

        // Add condition with first available column
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else {
            await this.page.locator(this.locators.addConditionButton).first().click();
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Select first available column
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        const visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await visibleMenu.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);

        // Operator: Contains
        const operatorSelect = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
        await operatorSelect.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);

        // Value
        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');

        // Silence
        const silenceInput = this.page.locator('.silence-notification-input input');
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Destination
        await this._selectDestination(destinationName);

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created alert with defaults', { alertName: randomAlertName });

        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with SQL query using V3 UI
     * Flow: Fill setup → Alert Rules tab: SQL query + alert settings → Save
     */
    async createScheduledAlertWithSQL(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_scheduled_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting scheduled alert creation', { alertName: randomAlertName });

        // Fill basic setup with Scheduled alert type
        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Scheduled');

        // On Alert Rules tab, switch to SQL tab
        const sqlTab = this.page.locator(this.locators.tabSql);
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);

        // Open SQL editor dialog
        await this.page.locator('[data-test="step2-view-editor-btn"], button:has-text("View Editor")').first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Enter SQL query in Monaco editor
        const monacoEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type('SELECT kubernetes_labels_name FROM "e2e_automate" where kubernetes_labels_name = \'ziox-querier\'');

        // Run query
        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Close editor dialog
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
        await this.page.locator('#alert-editor-sql').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(500);

        // Alert Settings (on Alert Rules tab) — threshold/period/destination
        const stepContainer = this.page.locator('.step-alert-conditions');
        const thresholdOperator = stepContainer.locator('.q-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click({ force: true });

        const thresholdInput = stepContainer.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');

        // Period
        const periodInput = stepContainer.locator('input[type="number"]').nth(1);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
        }

        // Destination (uses data-test="alert-destinations-select" for scheduled too)
        await this._selectDestination(destinationName);

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a real-time alert with multiple conditions using AND operator
     * Flow: Fill setup → Alert Rules tab: add 2 conditions + destination → Save
     */
    async createAlertWithMultipleConditions(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_multicond_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Starting multi-condition alert creation', { alertName: randomAlertName });

        // Fill basic setup
        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Realtime');

        // Add first condition
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        const addCondBtn = this.page.locator(this.locators.addConditionButton).first();

        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
            testLogger.info('Clicked initial Add Condition button');
        } else if (await addCondBtn.isVisible({ timeout: 3000 })) {
            await addCondBtn.click();
            testLogger.info('Clicked Add Condition button');
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        // Configure first condition with first available column
        const columnSelect1 = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        let visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await visibleMenu.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for first condition');

        const operatorSelect1 = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
        await operatorSelect1.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');
        testLogger.info('Added first condition with Contains operator');

        // Add second condition
        await expect(this.page.locator(this.locators.addConditionButton).first()).toBeVisible({ timeout: 5000 });
        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).nth(1)).toBeVisible({ timeout: 10000 });
        testLogger.info('Second condition visible');

        // Configure second condition with second available column
        const columnSelect2 = this.page.locator(this.locators.conditionColumnSelect).nth(1).locator('.q-select');
        await columnSelect2.click();
        await this.page.waitForTimeout(500);
        visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        const columnCount = await visibleMenu.locator('.q-item').count();
        await (columnCount > 1 ? visibleMenu.locator('.q-item').nth(1) : visibleMenu.locator('.q-item').first()).click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected column for second condition');

        const operatorSelect2 = this.page.locator(this.locators.operatorSelect).nth(1).locator('.q-select');
        await operatorSelect2.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('option', { name: 'Contains', exact: true }).click();
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.conditionValueInput).nth(1).locator('input').fill('validation');
        testLogger.info('Added second condition with Contains operator');

        // Verify AND operator is shown between conditions
        await expect(this.page.getByText('AND', { exact: true }).first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Verified AND operator between conditions');

        // Alert settings (same tab)
        const silenceInput = this.page.locator('.silence-notification-input input');
        if (await silenceInput.isVisible({ timeout: 3000 })) {
            await silenceInput.fill('0');
        }

        // Select destination
        await this._selectDestination(destinationName);

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created multi-condition alert', { alertName: randomAlertName });

        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        return randomAlertName;
    }

    /**
     * Test condition operator toggle (AND to OR) during alert creation
     */
    async testConditionOperatorToggle(streamName, randomValue) {
        const alertName = 'auto_toggle_test_' + randomValue;

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Fill basic setup
        await this._fillBasicAlertSetup(alertName, streamName, 'logs', 'Realtime');

        // Add first condition
        const firstCondBtn = this.page.locator(this.locators.addFirstConditionButton);
        if (await firstCondBtn.isVisible({ timeout: 3000 })) {
            await firstCondBtn.click();
        } else {
            await this.page.locator(this.locators.addConditionButton).first().click();
        }
        await this.page.waitForTimeout(1000);

        await expect(this.page.locator(this.locators.conditionColumnSelect).first()).toBeVisible({ timeout: 10000 });

        const columnSelect1 = this.page.locator(this.locators.conditionColumnSelect).first().locator('.q-select');
        await columnSelect1.click();
        await this.page.waitForTimeout(500);
        let visibleMenu = this.page.locator('.q-menu:visible');
        await expect(visibleMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await visibleMenu.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);

        const operatorSelect1 = this.page.locator(this.locators.operatorSelect).first().locator('.q-select');
        await operatorSelect1.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');
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

        // Toggle operator to OR
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
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        return { toggleSuccessful, message };
    }

    /**
     * Create a scheduled alert with deduplication configuration
     * Flow: Setup → Alert Rules tab: SQL + settings → Advanced tab: dedup → Save
     */
    async createScheduledAlertWithDeduplication(streamName, destinationName, randomValue, dedupConfig = {}) {
        const randomAlertName = 'auto_dedup_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        testLogger.info('Creating scheduled alert with deduplication', {
            streamName, destinationName, alertName: randomAlertName, dedupConfig
        });

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Fill basic setup with Scheduled alert type
        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Scheduled');

        // Alert Rules tab: SQL query
        const sqlTab = this.page.locator(this.locators.tabSql);
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);

        await this.page.locator('[data-test="step2-view-editor-btn"], button:has-text("View Editor")').first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        const monacoEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type(`SELECT kubernetes_labels_name FROM "${streamName}" where kubernetes_labels_name = 'ziox-querier'`);

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Close editor with Escape — more reliable than button click which may leave portal open
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
        // Wait for editor dialog to fully close
        await this.page.locator('#alert-editor-sql').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Alert Settings (on Alert Rules tab) — threshold
        const stepContainer = this.page.locator('.step-alert-conditions');
        const thresholdOperator = stepContainer.locator('.q-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click({ force: true });

        const thresholdInput = stepContainer.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');

        const periodInput = stepContainer.locator('input[type="number"]').nth(1);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
        }

        // Small delay before destination selection to let editor close complete
        await this.page.waitForTimeout(1500);
        // Destination
        await this._selectDestination(destinationName);

        // Switch to Advanced tab for dedup
        await this.page.locator(this.locators.advancedTab).click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to Advanced tab for dedup');

        // Configure dedup
        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });
        testLogger.info('Deduplication section visible');

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
        }

        if (dedupConfig.timeWindowMinutes !== undefined) {
            const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
            await timeWindowInput.waitFor({ state: 'visible', timeout: 5000 });
            await timeWindowInput.clear();
            await timeWindowInput.fill(String(dedupConfig.timeWindowMinutes));
            testLogger.info('Set time window', { minutes: dedupConfig.timeWindowMinutes });
        }

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with deduplication', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with deduplication for validation testing
     */
    async createScheduledAlertWithDedupForValidation(streamName, column, value, destinationName, randomValue, dedupConfig = {}) {
        const randomAlertName = 'auto_dedup_val_' + randomValue;
        this.currentAlertName = randomAlertName;

        const timeWindowMinutes = dedupConfig.timeWindowMinutes || 5;
        const fingerprintFields = dedupConfig.fingerprintFields || [column];

        testLogger.info('Creating scheduled alert with deduplication for validation', {
            streamName, column, value, destinationName, alertName: randomAlertName,
            dedupConfig: { timeWindowMinutes, fingerprintFields }
        });

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Scheduled');

        // Alert Rules tab: SQL query
        const sqlTab = this.page.locator(this.locators.tabSql);
        await sqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await sqlTab.click();
        await this.page.waitForTimeout(1000);

        await this.page.locator('[data-test="step2-view-editor-btn"], button:has-text("View Editor")').first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        const sqlQuery = `SELECT ${column} FROM "${streamName}" WHERE ${column} = '${value}'`;
        const monacoEditor = this.page.locator(this.locators.sqlEditorDialog).locator('.monaco-editor').last();
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        await monacoEditor.click({ force: true });
        await this.page.waitForTimeout(500);
        await this.page.keyboard.type(sqlQuery);

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Close editor with Escape — more reliable than button click which may leave portal open
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
        // Wait for editor dialog to fully close
        await this.page.locator('#alert-editor-sql').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.info('Closed SQL Editor dialog');

        // Alert Settings (on Alert Rules tab)
        const stepContainer = this.page.locator('.step-alert-conditions');
        await stepContainer.waitFor({ state: 'visible', timeout: 10000 });

        const thresholdOperator = stepContainer.locator('.q-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        await this.page.getByText('>=', { exact: true }).click({ force: true });

        const thresholdInput = stepContainer.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 10000 });
        await thresholdInput.fill('1');

        // Set shortest period (1 minute) for faster testing
        const periodInput = stepContainer.locator('input[type="number"]').nth(1);
        if (await periodInput.isVisible({ timeout: 5000 })) {
            await periodInput.fill('1');
        }

        // Small delay before destination selection to let editor close complete
        await this.page.waitForTimeout(1500);
        // Destination
        await this._selectDestination(destinationName);

        // Switch to Advanced tab for dedup
        await this.page.locator(this.locators.advancedTab).click();
        await this.page.waitForTimeout(1000);

        const dedupContainer = this.page.locator(this.locators.stepDeduplication);
        await expect(dedupContainer).toBeVisible({ timeout: 5000 });
        testLogger.info('Deduplication section visible');

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
        }

        const timeWindowInput = this.page.locator(this.locators.stepDeduplicationTimeWindowInput);
        await timeWindowInput.waitFor({ state: 'visible', timeout: 5000 });
        await timeWindowInput.clear();
        await timeWindowInput.fill(String(timeWindowMinutes));
        testLogger.info('Set dedup time window', { minutes: timeWindowMinutes });

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with deduplication for validation', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with aggregation enabled in Builder mode
     */
    async createScheduledAlertWithAggregation(streamName, destinationName, randomValue) {
        const randomAlertName = 'auto_agg_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        testLogger.info('Creating scheduled alert with aggregation', {
            streamName, destinationName, alertName: randomAlertName
        });

        await this.page.locator(this.locators.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 })
            .catch(() => testLogger.debug('networkidle timeout after addAlert click — continuing'));

        await this._fillBasicAlertSetup(randomAlertName, streamName, 'logs', 'Scheduled');

        // Alert Rules tab: Builder mode (default) — add condition
        await this.page.locator(this.locators.addConditionButton).first().click();
        await this.page.waitForTimeout(500);

        // Select level column
        const columnSelect = this.page.locator(this.locators.conditionColumnSelect).first();
        await columnSelect.click();
        await this.page.waitForTimeout(500);
        const visibleMenu = this.page.locator('.q-menu:visible');
        const levelOption = visibleMenu.locator('.q-item').filter({ hasText: 'level' });
        await expect(levelOption.first()).toBeVisible({ timeout: 5000 });
        await levelOption.first().click();
        await this.page.waitForTimeout(500);

        await this.page.locator(this.locators.operatorSelect).first().click();
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.waitForTimeout(300);

        await this.page.locator(this.locators.conditionValueInput).first().locator('input').fill('test');
        testLogger.info('Added condition');

        // Toggle aggregation ON
        const queryConfigSection = this.page.locator('.step-query-config');
        const aggregationToggle = queryConfigSection.locator('.q-toggle').first();
        await aggregationToggle.waitFor({ state: 'visible', timeout: 5000 });
        await aggregationToggle.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Toggled aggregation ON');

        // Select first available group-by field
        const groupBySection = this.page.getByText('Group by').first().locator('..');
        const groupBySelect = groupBySection.locator('.q-select').first();
        await groupBySelect.waitFor({ state: 'visible', timeout: 5000 });
        await groupBySelect.click();
        await this.page.waitForTimeout(500);
        const groupByMenu = this.page.locator('.q-menu:visible');
        await expect(groupByMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await groupByMenu.locator('.q-item').first().click();
        await this.page.waitForTimeout(500);
        testLogger.info('Selected group-by field');

        // Configure aggregation threshold
        const aggThresholdSection = this.page.getByText('Alert If Any Groups').first().locator('..');
        const aggFunctionSelect = aggThresholdSection.locator('.q-select').first();
        await aggFunctionSelect.waitFor({ state: 'visible', timeout: 5000 });
        await aggFunctionSelect.click();
        await this.page.waitForTimeout(500);
        const functionMenu = this.page.locator('.q-menu:visible');
        await functionMenu.locator('.q-item').filter({ hasText: 'count' }).first().click();
        await this.page.waitForTimeout(300);
        testLogger.info('Selected aggregation function: count');

        const aggColumnSelect = aggThresholdSection.locator('.q-select').nth(1);
        await aggColumnSelect.click();
        await this.page.waitForTimeout(500);
        const aggColumnMenu = this.page.locator('.q-menu:visible');
        await expect(aggColumnMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
        await aggColumnMenu.locator('.q-item').first().click();
        await this.page.waitForTimeout(300);

        const aggOperatorSelect = aggThresholdSection.locator('.q-select').nth(2);
        await aggOperatorSelect.click();
        await this.page.waitForTimeout(500);
        const aggOperatorMenu = this.page.locator('.q-menu:visible');
        await aggOperatorMenu.locator('.q-item').filter({ hasText: '>=' }).first().click();
        await this.page.waitForTimeout(300);

        const aggValueInput = aggThresholdSection.locator('input[type="number"]').first();
        await aggValueInput.fill('1');
        await this.page.waitForTimeout(500);
        testLogger.info('Configured aggregation threshold');

        // Alert Settings (same tab) — threshold/period
        const stepContainer = this.page.locator('.step-alert-conditions');
        const thresholdOperator = stepContainer.locator('.q-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        const thresholdMenu = this.page.locator('.q-menu:visible');
        await thresholdMenu.locator('.q-item').filter({ hasText: '>=' }).first().click();
        await this.page.waitForTimeout(300);

        const thresholdInput = stepContainer.locator('input[type="number"]').first();
        await thresholdInput.fill('1');

        const periodInput = stepContainer.locator('input[type="number"]').nth(1);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
        }

        // Destination
        await this._selectDestination(destinationName);

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with aggregation', { alertName: randomAlertName });

        return randomAlertName;
    }

    /**
     * Create a scheduled alert with PromQL query for metrics streams
     */
    async createScheduledAlertWithPromQL(metricsStreamName, promqlQuery, destinationName, randomValue, promqlCondition = {}) {
        const randomAlertName = 'auto_promql_alert_' + randomValue;
        this.currentAlertName = randomAlertName;

        const operator = promqlCondition.operator || '>=';
        const conditionValue = promqlCondition.value !== undefined ? promqlCondition.value : 1;

        testLogger.info('Creating scheduled alert with PromQL query', {
            metricsStreamName, promqlQuery, destinationName, alertName: randomAlertName,
            promqlCondition: { operator, value: conditionValue }
        });

        // Wait for Add Alert button to be enabled
        const addAlertBtn = this.page.locator(this.locators.addAlertButton);
        await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });
        if (await addAlertBtn.isDisabled()) {
            testLogger.info('Add Alert button disabled, reloading page');
            await this.page.reload();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await addAlertBtn.waitFor({ state: 'visible', timeout: 10000 });
        }
        await expect(addAlertBtn).toBeEnabled({ timeout: 15000 });
        await addAlertBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Fill basic setup with metrics stream type and Scheduled
        await this._fillBasicAlertSetup(randomAlertName, metricsStreamName, 'metrics', 'Scheduled');

        // Alert Rules tab: PromQL tab
        const promqlTab = this.page.locator(this.locators.tabPromql);
        await promqlTab.waitFor({ state: 'visible', timeout: 10000 });
        await promqlTab.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Switched to PromQL tab');

        // Open PromQL editor
        await this.page.locator('[data-test="step2-view-editor-btn"], button:has-text("View Editor")').first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Enter PromQL query
        const promqlEditor = this.page.locator(this.locators.promqlEditorDialog).locator('.inputarea');
        await this.page.locator(this.locators.viewLineLocator).first().click();
        await promqlEditor.fill(promqlQuery);
        testLogger.info('Entered PromQL query', { promqlQuery });

        await this.page.locator(this.locators.runQueryButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
        await this.page.locator('#alert-editor-promql').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // PromQL trigger condition (in QueryConfig section)
        const queryConfigSection = this.page.locator('.step-query-config');
        const promqlConditionLabel = queryConfigSection.getByText('Trigger if the value is').first();
        await promqlConditionLabel.waitFor({ state: 'visible', timeout: 10000 });
        const promqlConditionRow = promqlConditionLabel.locator('..');

        const promqlOperatorSelect = promqlConditionRow.locator('.q-select').first();
        await promqlOperatorSelect.click();
        await this.page.waitForTimeout(500);
        const pmqlMenu = this.page.locator('.q-menu:visible');
        await pmqlMenu.locator('.q-item').filter({ hasText: operator }).first().click();
        await this.page.waitForTimeout(300);

        const promqlValueInput = promqlConditionRow.locator('input[type="number"]');
        await promqlValueInput.clear();
        await promqlValueInput.fill(String(conditionValue));
        await this.page.waitForTimeout(500);

        // Alert Settings (same tab) — threshold/period
        const stepContainer = this.page.locator('.step-alert-conditions');
        const thresholdOperator = stepContainer.locator('.q-select').first();
        await thresholdOperator.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdOperator.click();
        await this.page.waitForTimeout(500);
        const thresholdMenu = this.page.locator('.q-menu:visible');
        await thresholdMenu.locator('.q-item').filter({ hasText: '>=' }).first().click();
        await this.page.waitForTimeout(300);

        const thresholdInput = stepContainer.locator('input[type="number"]').first();
        await thresholdInput.waitFor({ state: 'visible', timeout: 5000 });
        await thresholdInput.fill('1');

        const periodInput = stepContainer.locator('input[type="number"]').nth(1);
        if (await periodInput.isVisible({ timeout: 3000 })) {
            await periodInput.fill('15');
        }

        // Destination
        await this._selectDestination(destinationName);

        // Save
        await this.page.locator(this.locators.alertSubmitButton).click();
        await expect(this.page.getByText(this.locators.alertSuccessMessage)).toBeVisible({ timeout: 30000 });
        testLogger.info('Successfully created scheduled alert with PromQL query', { alertName: randomAlertName });

        return randomAlertName;
    }

    // ==================== CONDITION OPERATIONS ====================

    async addConditionGroup() {
        const addGroupBtn = this.page.locator('[data-test="alert-conditions-add-condition-group-btn"]');
        await addGroupBtn.waitFor({ state: 'visible', timeout: 5000 });
        await addGroupBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Added condition group');
    }

    async toggleConditionOperator() {
        const toggleBtn = this.page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        await toggleBtn.waitFor({ state: 'visible', timeout: 5000 });
        await toggleBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Toggled condition operator');
    }

    async deleteCondition(index = 0) {
        const deleteBtn = this.page.locator('[data-test="alert-conditions-delete-condition-btn"]').nth(index);
        await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
        await deleteBtn.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Deleted condition', { index });
    }

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
}
