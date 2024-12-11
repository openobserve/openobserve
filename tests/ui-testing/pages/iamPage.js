// iamPage.js
import { expect } from '@playwright/test';


export class IamPage {
    constructor(page) {
        this.page = page;
        this.iamPageMenu = page.locator('[data-test="menu-link-\\/iam-item"]');

    }
    async gotoIamPage() {

        await this.iamPageMenu.click();


    }


    async iamPageDefaultOrg() {

        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).click();


    }

    async iamPageDefaultMultiOrg() {



        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();


        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();




    }

    async iamPageURLValidation() {

        await expect(this.page).toHaveURL(/defaulttestmulti/);

    }

    async iamURLValidation() {

        await expect(this.page).toHaveURL(/iam/);

    }


    async iamPageServiceAccountsTab() {

        await this.page.locator('[data-test="iam-service-accounts-tab"]').click();

    }
  
    async iamPageAddServiceAccount() {

        await this.page.getByRole('button', { name: 'Add Service Account' }).click();

    }


    async iamPageAddServiceAccountEmailValidation() {

        await this.page.getByRole('button', { name: 'Save' }).click();
        
      //  await expect(this.page.getByRole('alert')).toContainText('Please enter a valid email address');
        await expect(this.page.getByRole('alert').nth(2)).toContainText('Please enter a valid email address');


    }

    async enterEmailServiceAccount() {

        await this.page.getByLabel('Email *').click();
  await this.page.getByLabel('Email *').fill('aut@ai.ai');

    }

    async clickSaveServiceAccount() {

       
        await this.page.getByRole('button', { name: 'Save' }).click();
        await expect(this.page.getByRole('alert')).toContainText('Service Account created successfully.');

    }

    async validateServiceAccount() {

       
        await expect(this.page.getByRole('alert')).toContainText('Service Account created successfully.');

    }










}
