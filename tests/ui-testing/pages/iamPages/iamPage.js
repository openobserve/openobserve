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

        // this.deleteButton = emailName => `//td[contains(text(),'${emailName}')]/following-sibling::td/button[@title='Delete Service Account']`;
        this.deleteButton = emailName => `//td[contains(text(),'${emailName}')]/following-sibling::td/button[@title='Delete Service Account']`;

        this.confirmOkButton = "//div[@class='q-card']/div[2]/button/span[text()='OK']";
        this.cancelButton = "//div[@class='q-card']/div[2]/button/span[text()='Cancel']";

        this.refreshButton = emailName => `//td[contains(text(),'${emailName}')]/following-sibling::td/button[@title='Refresh Service Token']`;

        this.updateButton = emailName => `//td[contains(text(),'${emailName}')]/following-sibling::td/button[@title='Update Service Account']`;

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
        await this.page.getByLabel('Email *').fill(process.env["ZO_ROOT_USER_EMAIL"]);

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

        await this.page.locator('#q-portal--dialog--2').getByRole('button', { name: 'Copy Token' }).click();
        // await this.page.locator('#q-portal--dialog--3').getByRole('button', { name: 'Copy Token' }).click();

    }



    async clickDownloadToken() {

        const downloadPromise = this.page.waitForEvent('download');

        await this.page.getByRole('button', { name: 'Download Token' }).click();

    }

    async clickServiceAccountPopUpClosed() {

        await this.page.locator('[data-test="sa-cancel-button"]').click();

    }

    async reloadServiceAccountPage(emailName) {

        await this.page.reload(); // Optional, if necessary
        // await this.page.locator('[data-test="iam-page"]').getByText('arrow_drop_down').click({ force: true });
        // await this.page.getByText('100').click({ force: true });

    }

    async deletedServiceAccount(emailName) {
        const deleteButtonLocator = this.page.locator(this.deleteButton(emailName));
        // Wait for the delete button to be visible
        await deleteButtonLocator.waitFor({ state: 'visible', timeout: 30000 });
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
        // Wait for the update button to be visible
        await updateButtonLocator.waitFor({ state: 'visible', timeout: 30000 });
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
