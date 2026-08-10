/**
 * SloAlertsPanelPage — Page object for per-SLO alerts management
 *
 * Covers: SloAlertsPanel.vue (alerts list + add button) and
 * SloAlertForm.vue (inline create/edit form), plus SloAlertCondition.vue
 * (burn-rate / error-budget condition editor with preset cards).
 */
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class SloAlertsPanelPage {
    constructor(page) {
        this.page = page;

        // ---- Panel chrome ----
        this.panelRoot = '[data-test="slo-alerts-panel"]';
        this.addAlertButton = '[data-test="slo-alerts-add"]';
        this.alertsList = '[data-test="slo-alerts-list"]';
        this.emptyState = '[data-test="slo-alerts-empty"]';
        this.errorBanner = '[data-test="slo-alerts-error"]';

        // ---- Per-row ----
        this.alertRow = (alertId) => `[data-test="slo-alerts-row-${alertId}"]`;
        this.alertEditButton = (alertId) => `[data-test="slo-alerts-edit-${alertId}"]`;
        this.disabledTag = '[data-test="slo-alerts-disabled-tag"]';

        // ---- SLO alert form ----
        this.formRoot = '[data-test="slo-alert-form"]';
        this.formName = '[data-test="slo-alert-form-name"]';
        this.formDescription = '[data-test="slo-alert-form-description"]';
        this.formFrequency = '[data-test="slo-alert-form-frequency"]';
        this.formSilence = '[data-test="slo-alert-form-silence"]';
        this.formTargets = '[data-test="slo-alert-form-targets"]';
        this.formError = '[data-test="slo-alert-form-error"]';
        this.formCancelButton = '[data-test="slo-alert-form-cancel"]';
        this.formSubmitButton = '[data-test="slo-alert-form-submit"]';

        // ---- Condition editor ----
        this.conditionKindToggle = '[data-test="slos-sloalertcondition-kind"]';
        this.conditionKindBurnRate = '[data-test="slos-sloalertcondition-kind-burn_rate"]';
        this.conditionKindErrorBudget = '[data-test="slos-sloalertcondition-kind-error_budget"]';
        this.conditionPresetFast = '[data-test="slos-sloalertcondition-preset-fast"]';
        this.conditionPresetMid = '[data-test="slos-sloalertcondition-preset-mid"]';
        this.conditionPresetSlow = '[data-test="slos-sloalertcondition-preset-slow"]';
    }

    // ============================
    //  PANEL ACTIONS
    // ============================

    async clickAddAlert() {
        testLogger.info('Clicking "Add alert" in SLO alerts panel');
        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================
    //  FORM ACTIONS
    // ============================

    async clickBurnRateKind() {
        testLogger.info('Selecting burn-rate condition kind');
        await this.page.locator(this.conditionKindBurnRate).click();
    }

    async clickPresetFast() {
        testLogger.info('Clicking Fast burn preset');
        await this.page.locator(this.conditionPresetFast).click();
    }

    async clickPresetSlow() {
        testLogger.info('Clicking Slow burn preset');
        await this.page.locator(this.conditionPresetSlow).click();
    }

    async saveAlert() {
        testLogger.info('Saving SLO alert');
        await this.page.locator(this.formSubmitButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ============================
    //  EXPECTATIONS
    // ============================

    async expectFormVisible() {
        await expect(this.page.locator(this.formRoot)).toBeVisible({ timeout: 10000 });
    }

    async expectFormNameNotEmpty() {
        await expect(this.page.locator(this.formName)).toBeVisible({ timeout: 5000 });
        // Name is auto-derived; just verify it has content
        const nameEl = this.page.locator(`${this.formName} input`);
        const value = await nameEl.inputValue().catch(() => '');
        expect(value.length).toBeGreaterThan(0);
    }

    async expectFormNameValue(expectedValue) {
        const nameEl = this.page.locator(`${this.formName} input`);
        await expect(nameEl).toHaveValue(expectedValue, { timeout: 5000 });
    }

    async expectAlertInList(alertName) {
        const list = this.page.locator(this.alertsList);
        await expect(list).toBeVisible({ timeout: 10000 });
        await expect(list).toContainText(alertName, { timeout: 10000 });
    }

    async expectAlertNameUpdatedAfterPresetChanged(previousName) {
        // Assert that the name field value has changed from the previous value
        const nameEl = this.page.locator(`${this.formName} input`);
        const currentName = await nameEl.inputValue().catch(() => '');
        expect(currentName).not.toBe(previousName);
    }

    async getFormNameValue() {
        const nameEl = this.page.locator(`${this.formName} input`);
        return await nameEl.inputValue().catch(() => '');
    }

    // ============================
    //  ALERTS LIST SLO INTEGRATION
    //  (badge + link, on the main Alerts list page)
    // ============================

    /**
     * Get locator for the SLO badge on a specific alert row in the alerts list.
     * Only present when the alert is an SLO alert.
     */
    _sloBadgeLocator(alertName) {
        return this.page.locator(`[data-test="alert-list-${alertName}-slo-badge"]`);
    }

    /**
     * Get locator for the SLO link on a specific alert row in the alerts list.
     */
    _sloLinkLocator(alertName) {
        return this.page.locator(`[data-test="alert-list-${alertName}-slo-link"]`);
    }

    async expectSloBadgeVisible(alertName) {
        await expect(this._sloBadgeLocator(alertName)).toBeVisible({ timeout: 15000 });
    }

    async clickSloLink(alertName) {
        testLogger.info('Clicking SLO link on alert row', { alertName });
        await this._sloLinkLocator(alertName).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ============================
    //  SLO ALERTS PANEL LIST
    // ============================

    async expectAlertsListVisible() {
        await expect(this.page.locator(this.alertsList)).toBeVisible({ timeout: 15000 });
    }
}
