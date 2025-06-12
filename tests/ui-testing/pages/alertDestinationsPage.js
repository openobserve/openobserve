import { expect } from '@playwright/test';

export class AlertDestinationsPage {
    constructor(page) {
        this.page = page;
        
        // Navigation locators
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.destinationsTab = '[data-test="alert-destinations-tab"]';
        
        // Destination creation locators
        this.addDestinationButton = '[data-test="alert-destination-list-add-alert-btn"]';
        this.destinationNameInput = '[data-test="add-destination-name-input"]';
        this.templateSelect = '[data-test="add-destination-template-select"]';
        this.urlInput = '[data-test="add-destination-url-input"]';
        // this.methodSelect = '[data-test="add-destination-method-select"]';
        this.submitButton = '[data-test="add-destination-submit-btn"]';
        this.successMessage = 'Destination saved';
    }

    async navigateToDestinations() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.locator(this.destinationsTab).click();
    }

    /** @param {string} destinationName @param {string} url @param {string} templateName */
    async createDestination(destinationName, url, templateName) {
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000); // Wait for page to load
        
        await this.page.locator(this.addDestinationButton).click();
        await this.page.locator(this.destinationNameInput).click();
        await this.page.locator(this.destinationNameInput).fill(destinationName);
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.templateSelect).click();
        await this.page.waitForTimeout(2000); // Wait for template options to load
        await this.page.getByText(templateName, { exact: true }).click();
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.urlInput).click();
        await this.page.locator(this.urlInput).fill(url);
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.submitButton).click();
        await expect(this.page.getByText(this.successMessage)).toBeVisible();
        await expect(this.page.getByRole('cell', { name: destinationName })).toBeVisible();
    }
} 