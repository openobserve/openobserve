// Copyright 2026 OpenObserve Inc.
//
// Page Object Model for Settings domain — form validation tests.
// Covers:
//   - OrganizationSettings (trace ID / span ID field names)
//   - OrgStorageEditor     (storage provider connection fields)
//   - DomainManagement     (domain restriction input)

export class SettingsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ────────────────────────────────────────────────────────
        this.settingsMenuLink = '[data-test="menu-link-/settings-item"]';

        // ── OrganizationSettings — OInput data-test derived selectors ─────────
        // The OInput wrapper for trace ID sits inside data-test="add-role-rolename-input-btn"
        // but the OInput component itself uses the auto-generated -field / -error suffix
        // on whatever data-test the parent div carries. Since no data-test is set on the
        // OInput element directly in OrganizationSettings.vue, we target the native <input>
        // inside the first/second .o2-input wrappers using the parent class selectors.
        // For robustness we use the surrounding div's class name as a scope selector and
        // locate the OInput -field and -error within it.
        this.traceIdInputField        = '[data-test="settings-org-trace-id-input-field"]';
        this.traceIdInputError        = '[data-test="settings-org-trace-id-input-error"]';
        this.spanIdInputField         = '[data-test="settings-org-span-id-input-field"]';
        this.spanIdInputError         = '[data-test="settings-org-span-id-input-error"]';
        // Save button in OrganizationSettings
        this.orgSettingsSaveBtn       = '[data-test="add-alert-submit-btn"]';

        // ── General settings (scrape interval) ───────────────────────────────
        // OInput data-test="general-settings-scrape-interval" → -field / -error
        this.scrapeIntervalField      = '[data-test="general-settings-scrape-interval-field"]';
        this.scrapeIntervalError      = '[data-test="general-settings-scrape-interval-error"]';
        this.generalSettingsSaveBtn   = '[data-test="dashboard-add-submit"]';

        // ── OrgStorageEditor — connection fields ─────────────────────────────
        // Provider cards (step 1)
        this.storageProviderAwsCard   = '[data-test="storage-settings-provider-card-AwsCredentials"]';
        this.storageProviderAzureCard = '[data-test="storage-settings-provider-card-AzureCredentials"]';
        this.storageProviderArnCard   = '[data-test="storage-settings-provider-card-AwsRoleArn"]';
        this.step1ContinueBtn         = '[data-test="step1-continue-btn"]';
        this.step1CancelBtn           = '[data-test="step1-cancel-btn"]';
        // Step 2 connection fields — OInput auto-generates -field / -error
        this.bucketNameField          = '[data-test="storage-settings-bucket-name-input-field"]';
        this.bucketNameError          = '[data-test="storage-settings-bucket-name-input-error"]';
        this.accessKeyField           = '[data-test="storage-settings-access-key-input-field"]';
        this.accessKeyError           = '[data-test="storage-settings-access-key-input-error"]';
        this.secretKeyField           = '[data-test="storage-settings-secret-key-input-field"]';
        this.secretKeyError           = '[data-test="storage-settings-secret-key-input-error"]';
        this.regionField              = '[data-test="storage-settings-region-input-field"]';
        this.regionError              = '[data-test="storage-settings-region-input-error"]';
        this.storageSubmitBtn         = '[data-test="storage-settings-submit-btn"]';
        this.storageBackBtn           = '[data-test="step2-back-btn"]';
        this.storageCancelBtn         = '[data-test="step2-cancel-btn"]';
        this.storageEditorBackBtn     = '[data-test="storage-settings-editor-back-btn"]';

        // ── DomainManagement — domain input ──────────────────────────────────
        // OInput for new domain — no explicit data-test on the OInput in DomainManagement.vue
        // so we target it via the .domain-input class which wraps the OInput component
        this.newDomainField           = '[data-test="domain-management-new-domain-input-field"]';
        this.newDomainError           = '[data-test="domain-management-new-domain-input-error"]';
        this.addDomainBtn             = '[data-test="domain-management-add-domain-btn"]';
        this.saveDomainChangesBtn     = '[data-test="domain-management-save-changes-btn"]';
        this.noDomainMessage          = '[data-test="domain-management-no-domain-message"]';
        this.domainRestrictionsTitle  = '[data-test="domain-management-domain-restrictions-title"]';
        this.claimParserTitle         = '[data-test="domain-management-claim-parser-title"]';

        // ── Toast notifications ───────────────────────────────────────────────
        this.toastSuccess             = '[data-test-variant="success"]';
        this.toastError               = '[data-test-variant="error"]';
        this.toastMessage             = '[data-test="o-toast-message"]';

        // ── Storage tab / add-storage button (OrgStorageEditor setup) ─────────
        this.storageTab               = '[data-test="storage-settings-tab"]';
        // The empty-state branch renders a "configure" button; an already-configured
        // org renders an "update" button. Either opens the OrgStorageEditor.
        this.addStorageBtnBase        = '[data-test="storage-settings-configure-btn"], [data-test="storage-settings-update-btn"]';

        // ── Domain Management tab ─────────────────────────────────────────────
        this.domainTab                = '[data-test="domain-management-tab"]';
        this.domainRestrictionsTitle2 = '[data-test="domain-management-domain-restrictions-title"]';

        // ── ModelPricingEditor ────────────────────────────────────────────────
        // OInput data-test="model-pricing-name-input" → -field / -error
        this.modelPricingNameField    = '[data-test="model-pricing-name-input-field"]';
        this.modelPricingNameError    = '[data-test="model-pricing-name-input-error"]';
        // OInput data-test="model-pricing-pattern-input" → -field / -error
        this.modelPricingPatternField = '[data-test="model-pricing-pattern-input-field"]';
        this.modelPricingPatternError = '[data-test="model-pricing-pattern-input-error"]';
        // Action buttons
        this.modelPricingSaveBtn      = '[data-test="model-pricing-editor-save-btn"]';
        this.modelPricingCancelBtn    = '[data-test="model-pricing-editor-cancel-btn"]';
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    async navigateToSettings(page) {
        await page.locator(this.settingsMenuLink).click();
    }

    /**
     * Navigate to the Settings > Organization Settings (log-details) tab.
     * The tab name varies by build; we click the nav item and wait for the save button.
     */
    async navigateToOrganizationSettings() {
        const org = process.env.ORGNAME || 'default';
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        await this.page.goto(`${base}/web/settings/organization?org_identifier=${org}`);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.locator(this.orgSettingsSaveBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Navigate to Settings > General.
     */
    async navigateToGeneralSettings() {
        await this.navigateToSettings(this.page);
        const generalTab = this.page.locator('[data-test="settings-general-tab"], [href*="general"], [data-test*="general"]');
        const found = await generalTab.count();
        if (found > 0) {
            await generalTab.first().click();
        }
        await this.page.locator(this.generalSettingsSaveBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    // ── OrganizationSettings helpers ─────────────────────────────────────────

    /**
     * Clear the trace ID field using keyboard (triple-click then Delete).
     */
    async clearTraceIdField() {
        const input = this.page.locator(this.traceIdInputField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await this.page.keyboard.press('Delete');
    }

    async fillTraceIdField(value) {
        const input = this.page.locator(this.traceIdInputField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await input.fill(value);
    }

    async fillSpanIdField(value) {
        const input = this.page.locator(this.spanIdInputField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await input.fill(value);
    }

    async clickOrgSettingsSave() {
        await this.page.locator(this.orgSettingsSaveBtn).click();
    }

    getTraceIdErrorLocator() {
        return this.page.locator(this.traceIdInputError).first();
    }

    getSpanIdErrorLocator() {
        return this.page.locator(this.spanIdInputError).first();
    }

    // ── General Settings helpers ─────────────────────────────────────────────

    async fillScrapeInterval(value) {
        const input = this.page.locator(this.scrapeIntervalField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await input.fill(String(value));
    }

    async clickGeneralSettingsSave() {
        await this.page.locator(this.generalSettingsSaveBtn).click();
    }

    getScrapeIntervalErrorLocator() {
        return this.page.locator(this.scrapeIntervalError);
    }

    // ── OrgStorageEditor helpers ──────────────────────────────────────────────

    /**
     * Select a provider card on step 1 and proceed to step 2.
     * @param {'aws'|'azure'|'arn'} provider
     */
    async selectProviderAndContinue(provider) {
        const cardMap = {
            aws: this.storageProviderAwsCard,
            azure: this.storageProviderAzureCard,
            arn: this.storageProviderArnCard,
        };
        await this.page.locator(cardMap[provider]).waitFor({ state: 'visible' });
        await this.page.locator(cardMap[provider]).click();
        await this.page.locator(this.step1ContinueBtn).click();
        await this.page.locator(this.storageSubmitBtn).waitFor({ state: 'visible' });
    }

    async fillBucketName(value) {
        const input = this.page.locator(this.bucketNameField);
        await input.waitFor({ state: 'visible' });
        await input.fill(value);
    }

    async fillAccessKey(value) {
        const input = this.page.locator(this.accessKeyField);
        await input.waitFor({ state: 'visible' });
        await input.fill(value);
    }

    async fillSecretKey(value) {
        const input = this.page.locator(this.secretKeyField);
        await input.waitFor({ state: 'visible' });
        await input.fill(value);
    }

    async clickStorageSubmit() {
        await this.page.locator(this.storageSubmitBtn).click();
    }

    getBucketNameErrorLocator() {
        return this.page.locator(this.bucketNameError);
    }

    getAccessKeyErrorLocator() {
        return this.page.locator(this.accessKeyError);
    }

    getSecretKeyErrorLocator() {
        return this.page.locator(this.secretKeyError);
    }

    // ── DomainManagement helpers ─────────────────────────────────────────────

    /**
     * Fill the new-domain input field.
     */
    async fillNewDomain(value) {
        const input = this.page.locator(this.newDomainField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await input.fill(value);
    }

    /**
     * Click the "Add Domain" button inside DomainManagement.
     * The button is adjacent to the domain input and has text "Add Domain".
     */
    async clickAddDomainBtn() {
        await this.page.locator(this.addDomainBtn).click();
    }

    async clickSaveDomainChanges() {
        await this.page.locator(this.saveDomainChangesBtn).click();
    }

    getDomainErrorLocator() {
        // The new-domain OInput surfaces its validation message via the -error span
        return this.page.locator(this.newDomainError);
    }

    getAddDomainBtnLocator() {
        return this.page.locator(this.addDomainBtn);
    }

    // ── Toast locators ────────────────────────────────────────────────────────

    getToastSuccessLocator() {
        return this.page.locator(this.toastSuccess);
    }

    getToastErrorLocator() {
        return this.page.locator(this.toastError);
    }

    // ── OrgStorageEditor setup locators ───────────────────────────────────────

    getStorageTabLocator() {
        return this.page.locator(this.storageTab);
    }

    getAddStorageBtnLocator() {
        return this.page.locator(this.addStorageBtnBase).first();
    }

    // Open the OrgStorageEditor from the Settings shell: select the storage tab,
    // wait for the storage settings route, then click whichever entry button
    // (configure for empty state / update for an already-configured org) is shown.
    async openStorageEditor() {
        // The storage editor is an ENTERPRISE-only feature — its tab/route only
        // exists on the enterprise build. Probe positively for the editor mounting
        // (step-1 continue button visible) and return a boolean so callers can gate
        // the suite to a clean SKIP on the OSS binary.
        try {
            const tab = this.page.locator(this.storageTab);
            await tab.waitFor({ state: 'visible', timeout: 15000 });
            await tab.click();
            await this.page.waitForURL('**/storage_settings**', { timeout: 10000 });
            const entryBtn = this.getAddStorageBtnLocator();
            await entryBtn.waitFor({ state: 'visible', timeout: 10000 });
            await entryBtn.click();
            await this.page.locator(this.step1ContinueBtn).waitFor({ state: 'visible', timeout: 10000 });
            return true;
        } catch {
            return false;
        }
    }

    getStep1ContinueBtnLocator() {
        return this.page.locator(this.step1ContinueBtn);
    }

    // ── DomainManagement setup locators ───────────────────────────────────────

    getDomainTabLocator() {
        return this.page.locator(this.domainTab);
    }

    // Domain Management is gated to the _meta org (visible: isEnt && meta in
    // settings/index.vue), so switch to the _meta org first, then open the tab.
    async navigateToDomainManagement() {
        // Domain Management is an ENTERPRISE-only feature — the tab/route only
        // mounts on the enterprise build (gated to the _meta org). Probe positively
        // for the domain-management signal (restrictions title visible) and return a
        // boolean so callers can gate the suite to a clean SKIP on the OSS binary.
        const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';
        await this.page.goto(`${baseUrl}/web/settings/general?org_identifier=_meta`);
        await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        try {
            const tab = this.page.locator(this.domainTab);
            await tab.waitFor({ state: 'visible', timeout: 15000 });
            await tab.click();
            await this.page.waitForURL('**/domain_management**', { timeout: 10000 });
            await this.page.locator(this.domainRestrictionsTitle2).waitFor({ state: 'visible', timeout: 10000 });
            return true;
        } catch {
            return false;
        }
    }

    getDomainRestrictionsTitleLocator() {
        return this.page.locator(this.domainRestrictionsTitle2);
    }

    getNoDomainMessageLocator() {
        return this.page.locator(this.noDomainMessage);
    }

    // Runtime-dynamic: the added domain card's name element
    getDomainNameLocator(domainName) {
        return this.page.locator(`[data-test="domain-management-domain-name-${domainName}"]`);
    }

    // ── ModelPricingEditor helpers ────────────────────────────────────────────

    /**
     * Navigate to Settings and open the Model Pricing section.
     * The section is expected to be on the General or AI settings tab.
     */
    async navigateToModelPricing() {
        await this.navigateToSettings(this.page);
        const modelPricingTab = this.page.locator('[data-test="model-pricing-tab"]');
        await modelPricingTab.waitFor({ state: 'visible', timeout: 10000 });
        await modelPricingTab.click();
        const addBtn = this.page.locator('[data-test="model-pricing-add-btn"]');
        await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        await addBtn.click();
        await this.page.locator(this.modelPricingSaveBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    async clearModelPricingName() {
        const input = this.page.locator(this.modelPricingNameField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await this.page.keyboard.press('Delete');
        await input.dispatchEvent('blur');
    }

    async fillModelPricingName(value) {
        const input = this.page.locator(this.modelPricingNameField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await input.fill(value);
        await input.dispatchEvent('blur');
    }

    async clearModelPricingPattern() {
        const input = this.page.locator(this.modelPricingPatternField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await this.page.keyboard.press('Delete');
        await input.dispatchEvent('blur');
    }

    async fillModelPricingPattern(value) {
        const input = this.page.locator(this.modelPricingPatternField);
        await input.waitFor({ state: 'visible' });
        await input.click({ clickCount: 3 });
        await input.fill(value);
        await input.dispatchEvent('blur');
    }

    async clickModelPricingSave() {
        await this.page.locator(this.modelPricingSaveBtn).click({ force: true });
    }

    async clickModelPricingCancel() {
        await this.page.locator(this.modelPricingCancelBtn).click();
    }

    getModelPricingNameFieldLocator() {
        return this.page.locator(this.modelPricingNameField);
    }

    getModelPricingNameErrorLocator() {
        return this.page.locator(this.modelPricingNameError);
    }

    getModelPricingPatternFieldLocator() {
        return this.page.locator(this.modelPricingPatternField);
    }

    getModelPricingPatternErrorLocator() {
        return this.page.locator(this.modelPricingPatternError);
    }

    getModelPricingSaveBtnLocator() {
        return this.page.locator(this.modelPricingSaveBtn);
    }

    getModelPricingCancelBtnLocator() {
        return this.page.locator(this.modelPricingCancelBtn);
    }
}
