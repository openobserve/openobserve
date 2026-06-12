// Copyright 2026 OpenObserve Inc.

export class OnboardingFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── GetStarted form (rendered as dialog inside MainLayout) ────────────
        // OFormInput with data-test="onboarding-get-started-hear-about-us"
        // → OInput generates -field and -error sub-attributes
        this.hearAboutUsInput     = '[data-test="onboarding-get-started-hear-about-us-field"]';
        this.hearAboutUsError     = '[data-test="onboarding-get-started-hear-about-us-error"]';

        // OFormInput with data-test="onboarding-get-started-where-do-you-work"
        this.whereDoYouWorkInput  = '[data-test="onboarding-get-started-where-do-you-work-field"]';
        this.whereDoYouWorkError  = '[data-test="onboarding-get-started-where-do-you-work-error"]';

        // Agree checkbox and submit button
        this.agreeCheckbox        = '[data-test="onboarding-get-started-agree-checkbox"]';
        this.submitBtn            = '[data-test="onboarding-get-started-submit-btn"]';

        // ── AWS Marketplace form ──────────────────────────────────────────────
        // Route: /marketplace/aws/setup
        // OInput with data-test="aws-marketplace-org-name" → -field / -error
        this.awsOrgNameInput      = '[data-test="aws-marketplace-org-name-field"]';
        this.awsOrgNameError      = '[data-test="aws-marketplace-org-name-error"]';
        this.awsCreateLinkBtn     = '[data-test="aws-marketplace-create-link-btn"]';

        // ── Azure Marketplace form ────────────────────────────────────────────
        // Route: /marketplace/azure/register (redirects to setup after token is saved)
        // OInput with data-test="azure-marketplace-org-name" → -field / -error
        this.azureOrgNameInput    = '[data-test="azure-marketplace-org-name-field"]';
        this.azureOrgNameError    = '[data-test="azure-marketplace-org-name-error"]';
        this.azureCreateLinkBtn   = '[data-test="azure-marketplace-create-link-btn"]';
    }

    // ── GetStarted helpers ────────────────────────────────────────────────────

    async waitForGetStartedForm() {
        await this.page.locator(this.hearAboutUsInput).waitFor({ state: 'visible', timeout: 10000 });
    }

    async fillHearAboutUs(value) {
        await this.page.locator(this.hearAboutUsInput).fill(value);
    }

    async clearHearAboutUs() {
        await this.page.locator(this.hearAboutUsInput).clear();
    }

    async fillWhereDoYouWork(value) {
        await this.page.locator(this.whereDoYouWorkInput).fill(value);
    }

    async clearWhereDoYouWork() {
        await this.page.locator(this.whereDoYouWorkInput).clear();
    }

    async checkAgreeCheckbox() {
        await this.page.locator(this.agreeCheckbox).click();
    }

    async clickSubmit() {
        await this.page.locator(this.submitBtn).click();
    }

    /**
     * Trigger onBlur validation on both OFormInput fields by filling then
     * blurring without entering content.
     */
    async triggerEmptyValidationOnHearAboutUs() {
        await this.page.locator(this.hearAboutUsInput).click();
        await this.page.locator(this.hearAboutUsInput).blur();
    }

    async triggerEmptyValidationOnWhereDoYouWork() {
        await this.page.locator(this.whereDoYouWorkInput).click();
        await this.page.locator(this.whereDoYouWorkInput).blur();
    }

    // ── AWS Marketplace helpers ───────────────────────────────────────────────

    async navigateToAwsSetup() {
        await this.page.goto('/web/marketplace/aws/setup');
        await this.page.locator(this.awsCreateLinkBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    async fillAwsOrgName(value) {
        await this.page.locator(this.awsOrgNameInput).fill(value);
    }

    async clearAwsOrgName() {
        await this.page.locator(this.awsOrgNameInput).clear();
    }

    async clickAwsCreateLink() {
        await this.page.locator(this.awsCreateLinkBtn).click();
    }

    // ── Azure Marketplace helpers ─────────────────────────────────────────────

    async navigateToAzureSetupWithToken(token = 'test-azure-token') {
        // Azure setup page reads the token from sessionStorage
        await this.page.goto('/web/marketplace/azure/register');
        await this.page.evaluate((t) => sessionStorage.setItem('azure_marketplace_token', t), token);
        await this.page.reload();
        await this.page.locator(this.azureCreateLinkBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    async fillAzureOrgName(value) {
        await this.page.locator(this.azureOrgNameInput).fill(value);
    }

    async clearAzureOrgName() {
        await this.page.locator(this.azureOrgNameInput).clear();
    }

    async clickAzureCreateLink() {
        await this.page.locator(this.azureCreateLinkBtn).click();
    }

    // ── Locator getters for assertions ────────────────────────────────────────

    getHearAboutUsErrorLocator()   { return this.page.locator(this.hearAboutUsError); }
    getWhereDoYouWorkErrorLocator(){ return this.page.locator(this.whereDoYouWorkError); }
    getSubmitBtnLocator()          { return this.page.locator(this.submitBtn); }
    getAwsOrgNameInputLocator()    { return this.page.locator(this.awsOrgNameInput); }
    getAwsOrgNameErrorLocator()    { return this.page.locator(this.awsOrgNameError); }
    getAwsCreateLinkBtnLocator()   { return this.page.locator(this.awsCreateLinkBtn); }
    getAzureOrgNameInputLocator()  { return this.page.locator(this.azureOrgNameInput); }
    getAzureOrgNameErrorLocator()  { return this.page.locator(this.azureOrgNameError); }
    getAzureCreateLinkBtnLocator() { return this.page.locator(this.azureCreateLinkBtn); }
}
