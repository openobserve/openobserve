import { expect, test } from '@playwright/test';
import { CommonActions } from '../commonActions';
import { AlertsPage } from './alertsPage.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertDestinationsPage {
    constructor(page) {
        this.page = page;
        this.commonActions = new CommonActions(page);
        this.alertsPage = new AlertsPage(page);
        
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
        this.destinationImportFileInput = '[data-test="destination-import-json-file-input"]';
        this.destinationCountText = 'Alert Destinations';
        this.destinationInUseMessage = 'Destination is currently used by alert:';
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
                testLogger.info('Found destination', { destinationName });
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
            testLogger.info('Created new destination', { destinationName });
        } else {
            testLogger.info('Found existing destination', { destinationName });
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
        await this.commonActions.scrollAndFindOption(templateName, 'template');
        
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
     * Search for destinations by prefix
     * @param {string} searchText - Text to search for
     */
    async searchDestinations(searchText) {
        await this.page.locator(this.destinationListSearchInput).click();
        await this.page.locator(this.destinationListSearchInput).fill('');
        await this.page.locator(this.destinationListSearchInput).fill(searchText);
        await this.page.waitForTimeout(2000); // Wait for search results
        testLogger.debug('Searched for destinations', { searchText });
    }

    /**
     * Get all destination names from current search results
     * @returns {Promise<string[]>} Array of destination names
     */
    async getAllDestinationNames() {
        const destinationNames = [];

        // Find all delete buttons with the pattern
        const deleteButtons = await this.page.locator('[data-test*="alert-destination-list-"][data-test*="-delete-destination"]').all();

        for (const button of deleteButtons) {
            const dataTest = await button.getAttribute('data-test');
            // Extract destination name from data-test="alert-destination-list-{destinationName}-delete-destination"
            const match = dataTest.match(/alert-destination-list-(.+)-delete-destination/);
            if (match && match[1]) {
                destinationNames.push(match[1]);
            }
        }

        testLogger.debug('Found destination names', { destinationNames, count: destinationNames.length });
        return destinationNames;
    }

    /**
     * Delete a single destination by name
     * Handles case where destination is in use by an alert
     * @param {string} destinationName - Name of the destination to delete
     */
    async deleteDestinationByName(destinationName) {
        const deleteButton = this.page.locator(this.deleteDestinationButton.replace('{destinationName}', destinationName));
        await deleteButton.waitFor({ state: 'visible', timeout: 5000 });
        await deleteButton.click();
        await this.page.locator(this.confirmButton).click();

        // Check if "Destination is currently used by alert" message appears
        try {
            const inUseMessage = await this.page.getByText(this.destinationInUseMessage).textContent({ timeout: 3000 });

            // Extract alert name from message: "Destination is currently used by alert: Automation_Alert_3Igfv"
            const match = inUseMessage.match(/alert:\s*(.+)$/);
            if (match && match[1]) {
                const alertName = match[1].trim();
                testLogger.warn('Destination in use by alert, deleting alert first', { destinationName, alertName });

                // Close the error dialog
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);

                // Navigate to alerts and delete the alert
                await this.alertsPage.searchAndDeleteAlert(alertName);

                // Navigate back to destinations
                await this.navigateToDestinations();
                await this.page.waitForTimeout(1000);

                // Search for the destination again
                await this.searchDestinations(destinationName);

                // Retry deleting the destination
                await deleteButton.waitFor({ state: 'visible', timeout: 5000 });
                await deleteButton.click();
                await this.page.locator(this.confirmButton).click();
            }
        } catch (e) {
            // No "in use" message, deletion was successful
        }

        await this.page.waitForTimeout(1000);
        testLogger.debug('Deleted destination', { destinationName });
    }

    /**
     * Check if any destinations exist in search results
     * @returns {Promise<boolean>}
     */
    async hasDestinations() {
        try {
            // Check if "No data available" is shown
            const noData = await this.page.getByText('No data available').isVisible({ timeout: 2000 });
            if (noData) {
                testLogger.debug('No destinations found');
                return false;
            }
            return true;
        } catch (e) {
            // If no "No data available", assume there are destinations
            return true;
        }
    }

    /**
     * Delete all destinations matching a prefix
     * @param {string} prefix - Prefix to search for (e.g., "auto_playwright_destination")
     */
    async deleteAllDestinationsWithPrefix(prefix) {
        testLogger.info('Starting to delete all destinations with prefix', { prefix });

        // Navigate to destinations page
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000);

        let totalDeleted = 0;
        let previousCount = -1;

        // Keep looping until search returns no results
        while (true) {
            // Search for destinations with the prefix
            await this.searchDestinations(prefix);
            await this.page.waitForTimeout(1500);

            // Check if any destinations exist
            const hasAny = await this.hasDestinations();
            if (!hasAny) {
                testLogger.info('No destinations found with prefix', { prefix, totalDeleted });
                break;
            }

            // Get all matching destination names from current page
            let destinationNames = await this.getAllDestinationNames();
            const currentCount = destinationNames.length;

            if (currentCount === 0) {
                testLogger.info('No destination names found, stopping');
                break;
            }

            // Safety check: if count hasn't changed after deletion, something is wrong
            if (previousCount === currentCount && previousCount !== -1) {
                testLogger.error('Destination count unchanged after deletion attempt - stopping to prevent infinite loop', {
                    currentCount,
                    destinationNames,
                    totalDeleted
                });
                break;
            }
            previousCount = currentCount;

            testLogger.info('Found destinations to delete', { count: currentCount, destinationNames });

            // Delete only the FIRST destination to handle cascade properly
            // After cascade (destination→alert), page state changes
            const destinationName = destinationNames[0];
            testLogger.debug('Deleting destination (one at a time for cascade handling)', { destinationName });

            try {
                await this.deleteDestinationByName(destinationName);
                totalDeleted++;

                // After successful deletion with potential cascade, navigate back to destinations
                await this.navigateToDestinations();
                await this.page.waitForTimeout(1000);
            } catch (error) {
                testLogger.error('Failed to delete destination', { destinationName, error: error.message });
                // Try to recover by navigating back to destinations page
                await this.navigateToDestinations();
                await this.page.waitForTimeout(1000);
            }
        }

        testLogger.info('Completed deletion of all destinations with prefix', { prefix, totalDeleted });
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
        await this.commonActions.scrollAndFindOption(templateName, 'template');
        
        await this.page.locator(this.destinationImportNameInput).click();
        await this.page.locator(this.destinationImportNameInput).fill(destinationName);
        await this.page.locator(this.destinationImportJsonBtn).click();
    }
} 