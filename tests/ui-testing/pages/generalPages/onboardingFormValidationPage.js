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

    // NOTE: validation is revealed by submitting the form (clickSubmit), not by
    // blurring. The OForm foundation uses revalidateLogic (submit-then-change):
    // nothing validates until the first submit, after which it re-validates on
    // change. The Submit button is always enabled (the Zod schema gates the save),
    // so clicking it always triggers validation.

    // ── AWS Marketplace helpers ───────────────────────────────────────────────

    async navigateToAwsSetup() {
        await this.page.goto('/web/marketplace/aws/setup');
        await this.page.locator(this.awsCreateLinkBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Cloud-availability probe for the AWS Marketplace setup form.
     *
     * Navigates to the setup route, injects a fake marketplace token cookie so
     * the page renders the form, then waits for the Create & Link button (the
     * form's signal element). The AWS Marketplace onboarding route is only
     * registered on the enterprise/cloud binary — on the OSS build navigation
     * redirects away and the signal never appears.
     *
     * @returns {Promise<boolean>} true when the form mounted (cloud/enterprise),
     *          false on timeout (feature absent in the OSS build)
     */
    async probeAwsMarketplaceSetup() {
        await this.page.goto('/web/marketplace/aws/setup');
        await this.page.evaluate(() => {
            document.cookie = 'aws_marketplace_token=test_fv_aws_token_001; path=/';
        });
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
        try {
            await this.page.locator(this.awsCreateLinkBtn).waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch {
            return false;
        }
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

    /**
     * Cloud-availability probe for the Azure Marketplace setup form.
     *
     * Navigates to the register route, injects a fake marketplace token into
     * sessionStorage so the component renders the form, reloads, then waits for
     * the Create & Link button (the form's signal element). The Azure
     * Marketplace onboarding route is only registered on the enterprise/cloud
     * binary — on the OSS build navigation redirects away and the signal never
     * appears.
     *
     * @param {string} token  fake marketplace token to seed
     * @returns {Promise<boolean>} true when the form mounted (cloud/enterprise),
     *          false on timeout (feature absent in the OSS build)
     */
    async probeAzureMarketplaceSetup(token = 'test_fv_azure_token_001') {
        await this.page.goto('/web/marketplace/azure/register');
        await this.page.evaluate((t) => sessionStorage.setItem('azure_marketplace_token', t), token);
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
        try {
            await this.page.locator(this.azureCreateLinkBtn).waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch {
            return false;
        }
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
