// homePage.js
import { expect } from '@playwright/test';
//import { validateUrlContains } from './utils/validateUrlContains';

export class HomePage {
    constructor(page) {
        this.page = page;
        this.homePageMenu = page.locator('[data-test="menu-link-\\/-item"]');

    }
    async gotoHomePage() {

        await this.homePageMenu.click();

    }

    async homePageValidation() {

        await expect(this.page.getByRole('main')).toContainText('Streams');
        await expect(this.page.getByRole('main')).toContainText('Function');
        await expect(this.page.getByRole('main')).toContainText('Scheduled');


    }


    async homePageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).click();
    }

    async homePageURLValidationDefaultOrg() {
        // TODO: Fix this test
        await expect(this.page).toHaveURL(/default/);
    }

    async homePageDefaultMultiOrg() {
        // await this.page.pause();
        await this.page.waitForTimeout(5000);
        await this.page.reload();
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(5000);

        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async homePageURLValidation() {
        // TODO: Fix this test
        await expect(this.page).not.toHaveURL(/default/);
    }

    async homePageOrg(orgName) {
        // await this.page.pause();
        await this.page.waitForTimeout(5000);
        await this.page.reload();
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(5000);

        await this.page.getByRole('option', { name: orgName }).locator('div').nth(2).click();
    }

    async homePageURLValidation(orgName) {
        // TODO: Fix this test
        await expect(this.page).not.toHaveURL(orgName);
    }

    async homePageURLContains(orgNameIdentifier) {
        // TODO: Fix this test
        await expect(this.page).toHaveURL(orgNameIdentifier);
    }

    async homeURLContains(orgNameIdentifier) {
        const expectedURLPart = `org_identifier=${orgNameIdentifier}`;
        const currentURL = this.page.url(); // Get the current page URL
    
        // Check if the current URL contains the expected identifier
        await expect(currentURL).toContain(expectedURLPart);
    }

    async homeDefaultOrg() {
        // Click the dropdown to open the list of organizations
        await this.page.getByText('arrow_drop_down').click();
    
        // Wait for the dropdown options to be visible
        await this.page.waitForTimeout(500); // Brief wait to ensure the dropdown opens
    
        // Check if the options are visible
        const isDropdownVisible = await this.page.isVisible('[role="option"]');
        if (!isDropdownVisible) {
            throw new Error('Dropdown options are not visible');
        }
    
        // Locate the 'default' option by its exact name and click it
        await this.page.getByRole('option', { name: 'default' }).click();
    
        // Optionally, you can click the dropdown again to close it if necessary
        await this.page.getByText('arrow_drop_down').click();
    }
    
    
}