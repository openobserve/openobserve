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
        await this.page.getByText('default', { exact: true }).first().click()
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

        // Search for the organization
        await this.page.locator('[data-test="organization-search-input"]').fill(orgName);
        await this.page.waitForTimeout(2000);

        // Click the organization from search results
        await this.page.locator('[data-test="organization-menu-item-label-item-label"]').first().click();
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
        const isDropdownVisible = await this.page.isVisible('[role="presentation"]');
        if (!isDropdownVisible) {
            throw new Error('Dropdown options are not visible');
        }
    
        // Locate the 'default' option by its exact name and click it
        await this.page.getByRole('option', { name: 'default' }).click();
    
        // Optionally, you can click the dropdown again to close it if necessary
        await this.page.getByText('arrow_drop_down').click();
    }
    
    async clickDefaultOrg() {
        // Click the dropdown to open the list of organizations
        await this.page.getByText('arrow_drop_down').click();
    
        // Wait for the dropdown options to be present using the correct selector
        const optionsSelector = '[data-test="organization-menu-item-label-item-label"]';
        try {
            await this.page.waitForSelector(optionsSelector, { state: 'visible', timeout: 60000 });
        } catch (error) {
            console.error('Dropdown options did not become visible:', error);
            return; // Exit the function if options are not visible
        }
    
        // Log the number of options visible for debugging
        const optionsCount = await this.page.locator(optionsSelector).count();
        console.log(`Number of options visible: ${optionsCount}`);
    
        // Find and click the 'default' option using the correct locator
        const defaultOption = this.page.locator(optionsSelector).filter({ hasText: 'default' }).first();
    
        // Wait for the 'default' option to be visible
        try {
            await defaultOption.waitFor({ state: 'visible', timeout: 60000 });
            await defaultOption.click(); // Click the 'default' option
            console.log('Clicked the default option successfully.');
        } catch (error) {
            console.error('Default option is not visible or clickable:', error);
            return; // Exit if the default option is not available
        }
    
        // Optionally, close the dropdown again if needed
        await this.page.getByText('arrow_drop_down').click();
    }
    
}