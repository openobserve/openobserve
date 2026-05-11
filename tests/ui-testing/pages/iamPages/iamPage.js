// iamPage.js
import { expect } from '@playwright/test';


export class IamPage {
    constructor(page) {
        this.page = page;
        this.iamPageMenu = page.locator('[data-test="menu-link-\\/iam-item"]');

        this.serviceAccountsLink = "//a[contains(@data-test,'service-accounts')]";

        this.addServiceAccountButton = "//span[text()='New service account']";

        this.emailInput = "//input[@aria-label='Email *']";

        this.firstNameInput = "//input[@aria-label='First Name']";

        this.submitButton = "//button[@type='submit']";

        this.closeDialogButton = "//div[@class='q-card']/div[1]/button/span/i[text()='close']";

        this.deleteButton = emailName => `//td[contains(.,'${emailName}')]/following-sibling::td//button[@data-test='service-accounts-delete']`;

        // After ODialog migration, ServiceAccountsList delete/refresh dialogs
        // use ODialog's built-in primary/secondary buttons. Only one dialog is
        // open at a time, so we target by the common slug rather than the
        // (different) parent slugs of delete vs. refresh dialogs.
        this.confirmOkButton = '[data-test="o-dialog-primary-btn"]';
        this.cancelButton = '[data-test="o-dialog-secondary-btn"]';

        this.refreshButton = emailName => `//td[contains(.,'${emailName}')]/following-sibling::td//button[@data-test='service-accounts-refresh']`;

        this.updateButton = emailName => `//td[contains(.,'${emailName}')]/following-sibling::td//button[@data-test='service-accounts-edit']`;

        // Removed deprecated alert reference - use specific alert verification in methods


    }

    async gotoIamPage() {
        await this.iamPageMenu.click();
    }


    async iamPageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();
    }

    async iamPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async iamPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async iamURLValidation() {

        await expect(this.page).toHaveURL(/iam/);

    }


    async iamPageServiceAccountsTab() {

        await this.page.locator('[data-test="iam-service-accounts-tab"]').click();

    }

    async iamPageAddServiceAccount() {

        await this.page.getByRole('button', { name: 'New service account' }).click();

    }


    async iamPageAddServiceAccountEmailValidation() {

        await this.page.getByRole('button', { name: 'Save' }).click();

        // Wait for validation alert and verify it contains the expected message
        await this.page.waitForSelector('div[role="alert"]', { state: 'visible', timeout: 10000 });
        const alertLocator = this.page.getByRole('alert').filter({ hasText: 'Please enter a valid email address' });
        await expect(alertLocator).toBeVisible({ timeout: 5000 });


    }

    async enterEmailServiceAccount(emailName) {

        await this.page.getByLabel('Email *').click();
        await this.page.getByLabel('Email *').fill(emailName);

    }

    async enterSameEmailServiceAccount() {

        await this.page.getByLabel('Email *').click();
        await this.page.getByLabel('Email *').fill(process.env["ZO_ROOT_USER_EMAIL"] || process.env["ALPHA1_USER_EMAIL"]);

    }

    async enterFirstLastNameServiceAccount() {


        await this.page.getByLabel('First Name').click();
        await this.page.getByLabel('First Name').fill('Test');
        await this.page.getByLabel('Last Name').click();
        await this.page.getByLabel('Last Name').fill('Auto');

    }

    async clickCancelServiceAccount() {

        await this.page.getByRole('button', { name: 'Cancel' }).click();


    }

    async clickSaveServiceAccount() {
        await this.page.getByRole('button', { name: 'Save' }).click();
    }


    async verifySuccessMessage(expectedMessage) {
        // Wait for alert to appear and verify the message
        await this.page.waitForSelector('div[role="alert"]', { state: 'visible', timeout: 10000 });
        
        // Find the alert that contains the expected message (instead of just checking the first one)
        const specificAlert = this.page.getByRole('alert').filter({ hasText: expectedMessage });
        
        // Verify the specific alert with our expected message is visible
        await expect(specificAlert).toBeVisible({ timeout: 5000 });
    }

    async validateServiceAccountToken() {

        await expect(this.page.getByRole('dialog')).toBeVisible();
        await expect(this.page.getByRole('dialog')).toContainText('Service Account Token');

    }

    async waitResEmailServiceAccount(emailName) {
        const orgName = process.env.ORGNAME || 'default';
        await this.page.waitForResponse(
            (response) =>
                response.url().includes(`/api/${orgName}/service_accounts/${emailName}`) && response.status() === 200
        );

    }

    async clickCopyToken() {

        // ODialog renders via reka-ui's DialogPortal, not a Quasar
        // #q-portal--dialog--N container, so scope by the token dialog's
        // own data-test attribute instead.
        await this.page.locator('[data-test="service-accounts-list-token-dialog"]').getByRole('button', { name: 'Copy Token' }).click();

    }



    async clickDownloadToken() {

        const downloadPromise = this.page.waitForEvent('download');

        await this.page.locator('[data-test="service-accounts-list-token-dialog"]').getByRole('button', { name: 'Download Token' }).click();

    }

    async clickServiceAccountPopUpClosed() {

        // The post-creation token popup is an ODialog. Close it via the
        // built-in × button scoped to the token dialog instance.
        await this.page.locator('[data-test="service-accounts-list-token-dialog"] [data-test="o-dialog-close-btn"]').click();

    }

    async reloadServiceAccountPage(emailName) {
        await this.page.reload();
        // Wait for the page to fully load including any system accounts
        await this.page.waitForLoadState('networkidle');
        // Allow time for service accounts table to populate
        await this.page.waitForTimeout(1000);
    }

    async deletedServiceAccount(emailName) {
        const deleteButtonLocator = this.page.locator(this.deleteButton(emailName));

        // First check if this is a system account that shouldn't be deleted
        const isSystemAccount = emailName.includes('o2-sre-agent');
        if (isSystemAccount) {
            throw new Error(`Cannot delete system account: ${emailName}. System accounts are protected.`);
        }

        // Wait for the delete button to be visible and enabled
        await deleteButtonLocator.waitFor({ state: 'visible', timeout: 30000 });

        // Verify the button is not disabled before clicking
        await expect(deleteButtonLocator).toBeEnabled();

        // Click the delete button
        await deleteButtonLocator.click({ force: true });
    }

    async requestServiceAccountOk(emailName) {
        // Wait for the confirmation button to be visible and click it
        await this.page.locator(this.confirmOkButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.confirmOkButton).click({ force: true });
        // Add some buffer wait, if necessary
        await this.page.waitForTimeout(2000);
    }



    async requestServiceAccountCancel() {
        // Wait for the cancel confirmation button to be visible and click it
        await this.page.locator(this.cancelButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.cancelButton).click({ force: true });

        // Add some buffer wait, if necessary
        await this.page.waitForTimeout(2000);


    }

    async updatedServiceAccount(emailName) {
        const updateButtonLocator = this.page.locator(this.updateButton(emailName));

        // First check if this is a system account that shouldn't be updated
        const isSystemAccount = emailName.includes('o2-sre-agent');
        if (isSystemAccount) {
            throw new Error(`Cannot update system account: ${emailName}. System accounts are protected.`);
        }

        // Wait for the update button to be visible and enabled
        await updateButtonLocator.waitFor({ state: 'visible', timeout: 30000 });

        // Verify the button is not disabled before clicking
        await expect(updateButtonLocator).toBeEnabled();

        // Click the update button
        await updateButtonLocator.click({ force: true });
        await expect(this.page.getByRole('dialog')).toContainText('Update Service Account');
    }

    async refreshServiceAccount(emailName) {
        const refreshButtonLocator = this.page.locator(this.refreshButton(emailName));
        // Wait for the refresh button to be visible
        await refreshButtonLocator.waitFor({ state: 'visible', timeout: 30000 });
        // Click the refresh button
        await refreshButtonLocator.click({ force: true });
    }

    async enterDescriptionSA() {
        const descriptionField = this.page.getByLabel('Description');
        await descriptionField.click();
        await descriptionField.fill('Description Details for Service Account');
    }


}
