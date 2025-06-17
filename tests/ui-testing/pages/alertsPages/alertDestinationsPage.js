import { expect, test } from '@playwright/test';
import { CommonActions } from '../commonActions';

export class AlertDestinationsPage {
    constructor(page) {
        this.page = page;
        this.commonActions = new CommonActions(page);
        
        // Navigation locators
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.destinationsTab = '[data-test="alert-destinations-tab"]';
        this.destinationsListTitle = '[data-test="alert-destinations-list-title"]';
        
        // Destination creation locators
        this.addDestinationButton = '[data-test="alert-destination-list-add-alert-btn"]';
        this.destinationNameInput = '[data-test="add-destination-name-input"]';
        this.templateSelect = '[data-test="add-destination-template-select"]';
        this.urlInput = '[data-test="add-destination-url-input"]';
        this.submitButton = '[data-test="add-destination-submit-btn"]';
        this.successMessage = 'Destination saved';
        
        // Import locators
        this.destinationImportButton = '[data-test="destination-import"]';
        this.importJsonUrlTab = '[data-test="tab-import_json_url"]';
        this.destinationImportUrlInput = '[data-test="destination-import-url-input"]';
        this.destinationImportJsonBtn = '[data-test="destination-import-json-btn"]';
        this.destinationImportNameError = '[data-test="destination-import-name-error"]';
        this.destinationImportTemplateInput = '[data-test="destination-import-template-input"]';
        this.destinationImportNameInput = '[data-test="destination-import-name-input"]';
        this.destinationImportCancelBtn = '[data-test="destination-import-cancel-btn"]';
        this.destinationListSearchInput = '[data-test="destination-list-search-input"]';
        this.confirmButton = '[data-test="confirm-button"]';
        this.deleteDestinationButton = '[data-test="alert-destination-list-{destinationName}-delete-destination"]';
        this.importJsonFileTab = '[data-test="tab-import_json_file"]';
        this.destinationImportFileInput = '[data-test="destination-import-file-input"]';
    }

    async navigateToDestinations() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.locator(this.destinationsTab).click();
        await expect(this.page.locator(this.destinationsListTitle)).toBeVisible();
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

    /**
     * Import destination from URL
     * @param {string} url - URL of the destination JSON
     * @param {string} templateName - Name of the template to use
     * @param {string} destinationName - Name for the destination
     */
    async importDestinationFromUrl(url, templateName, destinationName) {
        await this.page.locator(this.destinationImportButton).click();
        await this.page.locator(this.importJsonUrlTab).click();
        await this.page.locator(this.destinationImportUrlInput).click();
        await this.page.locator(this.destinationImportUrlInput).fill(url);
        await this.page.waitForTimeout(2000); // Wait for JSON to load
        await this.page.locator(this.destinationImportJsonBtn).click();
        await expect(this.page.locator(this.destinationImportNameError)).toBeVisible();
        await this.page.locator(this.destinationImportTemplateInput).click();
        
        // Scroll through template list to find the template
        const dropdown = this.page.locator('.q-menu');
        let templateFound = false;
        let maxScrolls = 20;
        let scrollAmount = 300;
        let totalScrolled = 0;

        while (!templateFound && maxScrolls > 0) {
            try {
                const template = this.page.getByText(templateName, { exact: true });
                if (await template.isVisible()) {
                    await template.click();
                    templateFound = true;
                    console.log(`Found template after scrolling: ${templateName}`);
                    await this.page.waitForTimeout(1000);
                } else {
                    // Get the current scroll position and height
                    const { scrollTop, scrollHeight, clientHeight } = await dropdown.evaluate(el => ({
                        scrollTop: el.scrollTop,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight
                    }));

                    // If we've scrolled to the bottom, start from the top again
                    if (scrollTop + clientHeight >= scrollHeight) {
                        await dropdown.evaluate(el => el.scrollTop = 0);
                        totalScrolled = 0;
                        await this.page.waitForTimeout(1000);
                    } else {
                        // Scroll down
                        await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                        totalScrolled += scrollAmount;
                        await this.page.waitForTimeout(1000);
                    }
                    maxScrolls--;
                }
            } catch (error) {
                // If template not found, scroll and try again
                await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                totalScrolled += scrollAmount;
                await this.page.waitForTimeout(1000);
                maxScrolls--;
            }
        }

        if (!templateFound) {
            console.error(`Failed to find template ${templateName} after scrolling ${totalScrolled}px`);
            throw new Error(`Template ${templateName} not found in dropdown after scrolling`);
        }

        await this.page.locator(this.destinationImportNameInput).click();
        await this.page.locator(this.destinationImportNameInput).fill(destinationName);
        await this.page.locator(this.destinationImportJsonBtn).click();
    }

    /**
     * Delete destination using search
     * @param {string} destinationName - Name of the destination to delete
     */
    async deleteDestinationWithSearch(destinationName) {
        await this.page.locator(this.destinationListSearchInput).click();
        await this.page.locator(this.destinationListSearchInput).fill(destinationName);
        await this.page.waitForTimeout(1000); // Wait for search results
        await this.page.locator(this.deleteDestinationButton.replace('{destinationName}', destinationName)).click();
        await this.page.locator(this.confirmButton).click();
        await this.page.waitForTimeout(1000); // Wait for deletion to complete
        await expect(this.page.getByText('No data available')).toBeVisible();
    }

    /**
     * Cancel destination import
     */
    async cancelDestinationImport() {
        await this.page.locator(this.destinationImportCancelBtn).click();
        await expect(this.page.locator(this.destinationsListTitle)).toBeVisible();
    }

    /**
     * Import destination from file
     * @param {string} filePath - Path to the destination JSON file
     * @param {string} templateName - Name of the template to use
     * @param {string} destinationName - Name for the destination
     */
    async importDestinationFromFile(filePath, templateName, destinationName) {
        await this.page.locator(this.destinationImportButton).click();
        await this.page.locator(this.importJsonFileTab).click();
        await this.page.locator(this.destinationImportFileInput).setInputFiles(filePath);
        await this.page.waitForTimeout(2000); // Wait for JSON to load
        await this.page.locator(this.destinationImportJsonBtn).click();
        await this.page.waitForTimeout(1000); // Wait for error message
        await this.page.locator(this.destinationImportTemplateInput).click();
        
        // Scroll through template list to find the template
        const dropdown = this.page.locator('.q-menu');
        let templateFound = false;
        let maxScrolls = 20;
        let scrollAmount = 300;
        let totalScrolled = 0;

        while (!templateFound && maxScrolls > 0) {
            try {
                const template = this.page.getByText(templateName, { exact: true });
                if (await template.isVisible()) {
                    await template.click();
                    templateFound = true;
                    console.log(`Found template after scrolling: ${templateName}`);
                    await this.page.waitForTimeout(1000);
                } else {
                    // Get the current scroll position and height
                    const { scrollTop, scrollHeight, clientHeight } = await dropdown.evaluate(el => ({
                        scrollTop: el.scrollTop,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight
                    }));

                    // If we've scrolled to the bottom, start from the top again
                    if (scrollTop + clientHeight >= scrollHeight) {
                        await dropdown.evaluate(el => el.scrollTop = 0);
                        totalScrolled = 0;
                        await this.page.waitForTimeout(1000);
                    } else {
                        // Scroll down
                        await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                        totalScrolled += scrollAmount;
                        await this.page.waitForTimeout(1000);
                    }
                    maxScrolls--;
                }
            } catch (error) {
                // If template not found, scroll and try again
                await dropdown.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                totalScrolled += scrollAmount;
                await this.page.waitForTimeout(1000);
                maxScrolls--;
            }
        }

        if (!templateFound) {
            console.error(`Failed to find template ${templateName} after scrolling ${totalScrolled}px`);
            throw new Error(`Template ${templateName} not found in dropdown after scrolling`);
        }

        await this.page.locator(this.destinationImportNameInput).click();
        await this.page.locator(this.destinationImportNameInput).fill(destinationName);
        await this.page.locator(this.destinationImportJsonBtn).click();
    }
} 