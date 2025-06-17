import { expect, test } from '@playwright/test';
import { CommonActions } from './commonActions';

export class AlertDestinationsPage {
    constructor(page) {
        this.page = page;
        this.commonActions = new CommonActions(page);
        
        // Navigation locators
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.destinationsTab = '[data-test="alert-destinations-tab"]';
        
        // Destination creation locators
        this.addDestinationButton = '[data-test="alert-destination-list-add-alert-btn"]';
        this.destinationNameInput = '[data-test="add-destination-name-input"]';
        this.templateSelect = '[data-test="add-destination-template-select"]';
        this.urlInput = '[data-test="add-destination-url-input"]';
        this.submitButton = '[data-test="add-destination-submit-btn"]';
        this.successMessage = 'Destination saved';
    }

    async navigateToDestinations() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.locator(this.destinationsTab).click();
        await this.page.waitForTimeout(2000); // Wait for page to load
    }

    /** @param {string} destinationName @param {string} url @param {string} templateName */
    async createDestination(destinationName, url, templateName) {
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000); // Wait for page to load
        
        await this.page.locator(this.addDestinationButton).click();
        await this.page.locator(this.destinationNameInput).click();
        await this.page.locator(this.destinationNameInput).fill(destinationName);
        await this.page.waitForTimeout(1000);
        
        // Handle template selection with scrolling
        await this.page.locator(this.templateSelect).click();
        await this.page.waitForTimeout(2000); // Wait for template options to load
        
        // Use the common scroll function
        await this.commonActions.scrollAndFindOption(templateName, 'template');
        
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.urlInput).click();
        await this.page.locator(this.urlInput).fill(url);
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.submitButton).click();
        await expect(this.page.getByText(this.successMessage)).toBeVisible();
        
        // Verify the destination exists by checking all pages
        await this.verifyDestinationExists(destinationName);
    }

    async findDestinationAcrossPages(destinationName) {
        let destinationFound = false;
        let isLastPage = false;
        
        while (!destinationFound && !isLastPage) {
            try {
                await this.page.getByRole('cell', { name: destinationName }).waitFor({ timeout: 2000 });
                destinationFound = true;
                console.log('Found destination:', destinationName);
            } catch (error) {
                // Check if there's a next page button and if it's enabled
                const nextPageButton = this.page.getByRole('button').filter({ hasText: 'chevron_right' }).first();
                if (await nextPageButton.isVisible() && await nextPageButton.isEnabled()) {
                    await nextPageButton.click();
                    await this.page.waitForTimeout(2000);
                } else {
                    isLastPage = true;
                }
            }
        }
        return destinationFound;
    }

    async verifyDestinationExists(destinationName) {
        const found = await this.findDestinationAcrossPages(destinationName);
        if (!found) {
            throw new Error(`Destination ${destinationName} not found after checking all pages`);
        }
    }
    
    async ensureDestinationExists(destinationName, url, templateName) {
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000);

        // Check if destination exists by searching through all pages
        const destinationFound = await this.findDestinationAcrossPages(destinationName);
        
        if (!destinationFound) {
            // Destination not found, create new one
            await this.createDestination(destinationName, url, templateName);
            console.log('Created new destination:', destinationName);
        } else {
            console.log('Found existing destination:', destinationName);
        }
        
        return destinationName;
    }
} 