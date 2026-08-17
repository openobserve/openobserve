// Copyright 2026 OpenObserve Inc.
//
// Page Object Model for the Settings > LLM Providers surface (online evals).
// Covers the ProviderFormPage (create/edit) and the LlmProvidersSettings list.
//
// Enterprise/cloud-only: the `llm_providers` route is only pushed when the build
// is enterprise or cloud (useManagementRoutes.ts), and the settings tab is gated
// by `(isEnt || isCloud) && online_evals_enabled`. navigateToLlmProviders() probes
// positively for the page mount and returns a boolean so callers can gate to a
// clean SKIP on the OSS binary (mirrors navigateToModelPricing).

export class LlmProvidersPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── List / shell ─────────────────────────────────────────────────────
        this.settingsRoot = '[data-test="llm-providers-settings"]';
        this.addProviderBtn = '[data-test="llm-providers-add-btn"]';
        this.providersTable = '[data-test="llm-providers-table"]';
        this.emptyState = '[data-test="llm-providers-empty-state"]';

        // ── Provider form (create/edit) ──────────────────────────────────────
        // OFormInput forwards data-test to the wrapper; the real <input> carries
        // the `-field` suffix (OInput). OFormSelect forwards to the wrapper, with
        // `-trigger`, `-option` (per option, plus data-test-value) suffixes.
        this.formTitle = '[data-test="provider-form-title"]';
        this.nameField = '[data-test="provider-form-name-input-field"]';
        this.typeSelectTrigger = '[data-test="provider-form-type-select-trigger"]';
        this.typeSelectOptionBase = '[data-test="provider-form-type-select-option"]';
        this.endpointField = '[data-test="provider-form-endpoint-input-field"]';
        this.defaultModelField = '[data-test="provider-form-default-model-input-field"]';
        this.apiKeyField = '[data-test="provider-form-api-key-input-field"]';
        this.saveBtn = '[data-test="provider-form-save-btn"]';
        this.cancelBtn = '[data-test="provider-form-cancel-btn"]';
        this.backBtn = '[data-test="provider-form-back-btn"]';

        // The API-key "required" `*` marker is a conditional span with no data-test.
        // It renders only in create mode for openai/deepseek/anthropic. It lives in
        // the API Key label row (div.text-text-heading containing the "API Key" text),
        // so scope the `*` span to that row. (Recommended upstream fix: give it
        // data-test="provider-form-api-key-required"; fallback selector used here.)
        this.apiKeyRequiredMarker =
            'div.text-text-heading:has-text("API Key") span.text-status-error-text';

        // ── Toast notifications (same audit pattern as the settings POM) ─────
        this.toastSuccess = '[data-test-variant="success"]';
        this.toastError = '[data-test-variant="error"]';

        // ── Confirm dialog (provider delete) ─────────────────────────────────
        this.confirmDialog = '[data-test="confirm-dialog"]';
        this.confirmDialogOkBtn = '[data-test="o-dialog-primary-btn"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    /**
     * Navigate directly to Settings > LLM Providers and wait for the page mount.
     * Enterprise/cloud-only: on the OSS binary the route does not exist, so the
     * mount signal never appears and this returns false for a clean SKIP.
     * @returns {Promise<boolean>}
     */
    async navigateToLlmProviders() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        try {
            await this.page.goto(`${base}/web/settings/llm_providers?org_identifier=${org}`, {
                timeout: 60000,
            });
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await this.page
                .locator(this.settingsRoot)
                .waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch {
            return false;
        }
    }

    // ── List / form chrome ────────────────────────────────────────────────────

    async clickAddProvider() {
        const addBtn = this.page.locator(this.addProviderBtn);
        await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        await addBtn.click();
        await this.page.locator(this.formTitle).waitFor({ state: 'visible', timeout: 10000 });
    }

    async clickCancel() {
        const cancelBtn = this.page.locator(this.cancelBtn);
        await cancelBtn.waitFor({ state: 'visible', timeout: 10000 });
        await cancelBtn.click();
        await this.page.locator(this.formTitle).waitFor({ state: 'hidden', timeout: 10000 });
    }

    getAddProviderBtnLocator() {
        return this.page.locator(this.addProviderBtn);
    }

    getFormTitleLocator() {
        return this.page.locator(this.formTitle);
    }

    // ── Provider type select ──────────────────────────────────────────────────

    async openProviderTypeSelect() {
        await this.page.locator(this.typeSelectTrigger).click();
        await this.page
            .locator(this.typeSelectOptionBase)
            .first()
            .waitFor({ state: 'visible', timeout: 10000 });
    }

    async selectProviderType(value) {
        await this.page.locator(this.typeSelectTrigger).click();
        const option = this.page.locator(
            `${this.typeSelectOptionBase}[data-test-value="${value}"]`,
        );
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();
    }

    getProviderTypeTriggerLocator() {
        return this.page.locator(this.typeSelectTrigger);
    }

    getProviderTypeOptionLocator(value) {
        return this.page.locator(`${this.typeSelectOptionBase}[data-test-value="${value}"]`);
    }

    // ── Form fields ───────────────────────────────────────────────────────────

    async fillName(value) {
        const input = this.page.locator(this.nameField);
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(value);
    }

    async fillEndpoint(value) {
        const input = this.page.locator(this.endpointField);
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(value);
    }

    async fillDefaultModel(value) {
        const input = this.page.locator(this.defaultModelField);
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(value);
    }

    async fillApiKey(value) {
        const input = this.page.locator(this.apiKeyField);
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(value);
    }

    getApiKeyFieldLocator() {
        return this.page.locator(this.apiKeyField);
    }

    async clickSave() {
        await this.page.locator(this.saveBtn).click();
    }

    // ── API-key required marker ───────────────────────────────────────────────

    getApiKeyRequiredMarkerLocator() {
        return this.page.locator(this.apiKeyRequiredMarker);
    }

    // ── List rows ─────────────────────────────────────────────────────────────

    getProviderRowNameLocator(name) {
        return this.page.locator(this.providersTable).getByText(name, { exact: true });
    }

    async clickEditProvider(name) {
        const editBtn = this.page.locator(`[data-test="llm-providers-${name}-edit-btn"]`);
        await editBtn.waitFor({ state: 'visible', timeout: 10000 });
        await editBtn.click();
        await this.page.locator(this.formTitle).waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Delete a provider via the list row's delete action + confirm dialog.
     * Best-effort cleanup helper — callers wrap it in try/catch.
     */
    async deleteProvider(name) {
        await this.navigateToLlmProviders();
        const deleteBtn = this.page.locator(`[data-test="llm-providers-${name}-delete-btn"]`);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();
        const okBtn = this.page.locator(`${this.confirmDialog} ${this.confirmDialogOkBtn}`);
        await okBtn.waitFor({ state: 'visible', timeout: 5000 });
        await okBtn.click();
        await this.page
            .locator(`[data-test="llm-providers-${name}-delete-btn"]`)
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch(() => {});
    }

    // ── Toast locators ────────────────────────────────────────────────────────

    getToastSuccessLocator() {
        return this.page.locator(this.toastSuccess);
    }

    getToastErrorLocator() {
        return this.page.locator(this.toastError);
    }
}
