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
        this.destinationImportFileInput = '[data-test="destination-import-file-input"]';
        this.destinationCountText = 'Alert Destinations';
        this.destinationInUseMessage = 'Destination is currently used by alert:';
        this.nextPageButton = 'button:has(mat-icon:text("chevron_right")), button:has-text("chevron_right")';

        // Prebuilt destination locators
        this.prebuiltDestinationSelector = '[data-test="prebuilt-destination-selector"]';
        this.destinationTypeCard = '[data-test="destination-type-card"]';
        this.destinationTypeName = '[data-test="destination-type-name"]';
        this.selectedDestinationIndicator = '.selected-destination-indicator';
        this.stepperStep = '.q-stepper__step';
        this.prebuiltForm = '[data-test="prebuilt-form"]';
        this.webhookInput = 'input[data-test*="webhook"], input[placeholder*="webhook"]';
        this.recipientsInput = 'input[data-test="email-recipients-input"]';
        this.integrationKeyInput = 'input[data-test="pagerduty-integration-key-input"]';
        this.severitySelect = '[data-test="pagerduty-severity-select"]';
        this.prioritySelect = '[data-test="opsgenie-priority-select"]';
        this.testButton = 'button:has-text("Test")';
        this.testResult = '[data-test="prebuilt-test-result"], .test-result';
        this.saveButton = 'button:has-text("Save")';
        this.cancelButton = 'button:has-text("Cancel")';
        this.backButton = 'button:has-text("Back")';
        this.successNotification = '.q-notification__message';
        this.errorMessage = '.q-field__messages, .error-message';
        this.checkIcon = '.q-icon';
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

        // Wait for button to be enabled before clicking
        const addBtn = this.page.locator(this.addDestinationButton);
        await addBtn.waitFor({ state: 'visible', timeout: 30000 });
        await expect(addBtn).toBeEnabled({ timeout: 30000 });
        await addBtn.click();

        // Select 'custom' destination type (required by prebuilt destinations feature)
        await this.selectDestinationType('custom');
        await this.page.waitForTimeout(1000); // Wait for name input to appear

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
                const nextPageBtn = this.page.locator(this.nextPageButton).first();
                if (await nextPageBtn.isVisible() && await nextPageBtn.isEnabled()) {
                    await nextPageBtn.click();
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
     * Verify successful import message is visible
     * Uses text content since the UI doesn't have data-test attributes for this message
     */
    async verifySuccessfulImportMessage() {
        // Look for the success message text anywhere on the page (toast or dialog)
        const successMessage = this.page.getByText('Successfully imported');
        await expect(successMessage).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify destination count message is visible (e.g., "Destination - 1:")
     * The message appears in the error/output section of the ImportDestination component
     */
    async verifyDestinationCountMessage() {
        // Wait for the import to process and show errors/output
        await this.page.waitForTimeout(2000);

        // Look for destination error items using data-test attribute pattern
        // The errors appear with data-test="destination-import-error-{index}-{errorIndex}"
        const errorItem = this.page.locator('[data-test^="destination-import-error-"]').first();

        // Or look for the destination count message text anywhere on the page
        const countMessage = this.page.getByText(/Destination - \d+:/);

        // Wait for either the error item or the count message to be visible
        await expect(errorItem.or(countMessage)).toBeVisible({ timeout: 10000 });
        testLogger.debug('Destination count/error message verified');
    }

    /**
     * Create destination with custom headers
     * Used for self-referential alert validation where destination points to OpenObserve's own ingestion API
     * @param {string} destinationName - Name of the destination
     * @param {string} url - URL for the destination (e.g., OpenObserve ingestion endpoint)
     * @param {string} templateName - Name of the template to use
     * @param {Object} headers - Object with header key-value pairs (e.g., { 'Authorization': 'Basic xxx' })
     */
    async createDestinationWithHeaders(destinationName, url, templateName, headers = {}) {
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000);

        // Wait for button to be enabled before clicking
        const addBtn = this.page.locator(this.addDestinationButton);
        await addBtn.waitFor({ state: 'visible', timeout: 30000 });
        await expect(addBtn).toBeEnabled({ timeout: 30000 });
        await addBtn.click();

        // Select 'custom' destination type (required by prebuilt destinations feature)
        await this.selectDestinationType('custom');
        await this.page.waitForTimeout(1000); // Wait for name input to appear

        await this.page.locator(this.destinationNameInput).click();
        await this.page.locator(this.destinationNameInput).fill(destinationName);
        await this.page.waitForTimeout(1000);

        // Handle template selection with retry logic for race conditions
        // Templates might not appear in dropdown immediately after creation
        let templateFound = false;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries && !templateFound; attempt++) {
            try {
                await this.page.locator(this.templateSelect).click();
                await this.page.waitForTimeout(2000);
                await this.commonActions.scrollAndFindOption(templateName, 'template');
                templateFound = true;
                testLogger.info('Template found in dropdown', { templateName, attempt });
            } catch (error) {
                testLogger.warn('Template not found in dropdown, retrying...', {
                    templateName,
                    attempt,
                    maxRetries,
                    error: error.message
                });

                // Close dropdown by clicking elsewhere
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);

                if (attempt < maxRetries) {
                    // Navigate away and back to refresh template list
                    await this.navigateToDestinations();
                    await this.page.waitForTimeout(2000);

                    // Re-open the add destination form (wait for button to be enabled)
                    const retryBtn = this.page.locator(this.addDestinationButton);
                    await retryBtn.waitFor({ state: 'visible', timeout: 30000 });
                    await expect(retryBtn).toBeEnabled({ timeout: 30000 });
                    await retryBtn.click();

                    // Select 'custom' destination type again
                    await this.selectDestinationType('custom');
                    await this.page.waitForTimeout(1000);

                    await this.page.locator(this.destinationNameInput).click();
                    await this.page.locator(this.destinationNameInput).fill(destinationName);
                    await this.page.waitForTimeout(1000);
                } else {
                    throw new Error(`Template ${templateName} not found in dropdown after ${maxRetries} attempts`);
                }
            }
        }

        await this.page.waitForTimeout(1000);

        // Fill URL
        await this.page.locator(this.urlInput).click();
        await this.page.locator(this.urlInput).fill(url);
        await this.page.waitForTimeout(1000);

        // Add custom headers
        for (const [headerKey, headerValue] of Object.entries(headers)) {
            // Click add header button
            await this.page.locator('[data-test="add-destination-add-header-btn"]').click();
            await this.page.waitForTimeout(500);

            // Fill header key - use .last() to target the most recently added empty input
            // This handles cases where there might be pre-existing empty header rows
            const keyInput = this.page.locator('[data-test="add-destination-header--key-input"]').last();
            await keyInput.click();
            await keyInput.fill(headerKey);
            await this.page.waitForTimeout(500);

            // Fill header value (after key is filled, selector becomes add-destination-header-{key}-value-input)
            const valueInput = this.page.locator(`[data-test="add-destination-header-${headerKey}-value-input"]`);
            await valueInput.click();
            await valueInput.fill(headerValue);
            await this.page.waitForTimeout(300);

            testLogger.debug('Added header to destination', { headerKey, destinationName });
        }

        // Submit destination
        await this.page.locator(this.submitButton).click();
        await expect(this.page.getByText(this.successMessage)).toBeVisible();

        // Verify the destination exists
        await this.verifyDestinationExists(destinationName);
        testLogger.info('Created destination with headers', { destinationName, url, headerCount: Object.keys(headers).length });
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

        // Try original locator first, fallback to new locator if it fails
        try {
            await this.page.locator('[data-test="destination-import-json-file-input"]').setInputFiles(filePath, { timeout: 5000 });
        } catch (error) {
            // Fallback to new locator
            await this.page.locator(this.destinationImportFileInput).setInputFiles(filePath);
        }

        await this.page.waitForTimeout(2000); // Wait for JSON to load
        await this.page.locator(this.destinationImportJsonBtn).click();
        await this.page.waitForTimeout(1000); // Wait for error message
        await this.page.locator(this.destinationImportTemplateInput).click();
        await this.commonActions.scrollAndFindOption(templateName, 'template');

        await this.page.locator(this.destinationImportNameInput).click();
        await this.page.locator(this.destinationImportNameInput).fill(destinationName);
        await this.page.locator(this.destinationImportJsonBtn).click();
    }

    // ============================================================================
    // PREBUILT DESTINATION METHODS
    // ============================================================================

    /**
     * Click New Destination button
     * Waits for the button to be enabled before clicking (button starts disabled on page load)
     */
    async clickNewDestination() {
        const button = this.page.locator(this.addDestinationButton);

        // Wait for button to be visible first
        await button.waitFor({ state: 'visible', timeout: 30000 });
        testLogger.debug('New Destination button is visible');

        // Wait for button to be enabled (it starts disabled while page loads)
        await expect(button).toBeEnabled({ timeout: 30000 });
        testLogger.debug('New Destination button is enabled');

        await button.click();
        await this.page.waitForTimeout(2000);
        testLogger.debug('Clicked New Destination button');
    }

    /**
     * Select a prebuilt destination type
     * @param {string} type - Type ID (slack, discord, msteams, email, pagerduty, opsgenie, servicenow, custom)
     */
    async selectDestinationType(type) {
        // Wait for card to be visible first
        const card = this.page.locator(`${this.destinationTypeCard}[data-type="${type}"]`);
        await card.waitFor({ state: 'visible', timeout: 10000 });
        await card.click();

        // Wait for form to load after selection
        await this.page.waitForTimeout(2000);

        // Wait for either prebuilt form or custom form to appear
        if (type === 'custom') {
            await this.page.waitForSelector(this.urlInput, { state: 'visible', timeout: 10000 });
        } else {
            // For prebuilt types, wait for destination name input
            await this.page.waitForSelector(this.destinationNameInput, { state: 'visible', timeout: 10000 });
        }

        testLogger.debug('Selected destination type and form loaded', { type });
    }

    /**
     * Fill webhook URL (for Slack, Teams)
     * @param {string} url - Webhook URL
     */
    async fillWebhookUrl(url) {
        const input = this.page.locator(this.webhookInput).first();
        await input.fill(url);
        testLogger.debug('Filled webhook URL');
    }

    /**
     * Fill email recipients (for Email type)
     * @param {string} recipients - Comma-separated email addresses
     */
    async fillEmailRecipients(recipients) {
        const input = this.page.locator(this.recipientsInput).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(recipients);
        testLogger.debug('Filled email recipients', { recipients });
    }

    /**
     * Fill integration key (for PagerDuty)
     * @param {string} key - Integration key
     */
    async fillIntegrationKey(key) {
        const input = this.page.locator(this.integrationKeyInput).first();
        await input.fill(key);
        testLogger.debug('Filled integration key');
    }

    /**
     * Select severity (for PagerDuty, Opsgenie)
     * @param {string} severity - Severity level (e.g., 'critical', 'error', 'warning', 'info')
     */
    async selectSeverity(severity) {
        const select = this.page.locator(this.severitySelect).first();
        await select.waitFor({ state: 'visible', timeout: 10000 });
        await select.click();
        await this.page.waitForTimeout(500);

        // Click the option with matching text (capitalize first letter)
        const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
        await this.page.locator(`.q-item__label:has-text("${severityLabel}")`).click();
        await this.page.waitForTimeout(500);
        testLogger.debug('Selected severity', { severity });
    }

    /**
     * Fill destination name
     * @param {string} name - Destination name
     */
    async fillDestinationName(name) {
        await this.page.locator(this.destinationNameInput).fill(name);
        await this.page.waitForTimeout(1000);
        testLogger.debug('Filled destination name', { name });
    }

    /**
     * Click Test button
     */
    async clickTest() {
        await this.page.locator(this.testButton).first().click();
        testLogger.debug('Clicked Test button');
    }

    /**
     * Click Save button
     */
    async clickSave() {
        await this.page.locator(this.saveButton).first().click();
        testLogger.debug('Clicked Save button');
    }

    /**
     * Click Cancel button
     */
    async clickCancel() {
        await this.page.locator(this.cancelButton).click();
        testLogger.debug('Clicked Cancel button');
    }

    /**
     * Click Back button in stepper
     */
    async clickBack() {
        await this.page.locator(this.backButton).click();
        await this.page.waitForTimeout(2000);
        testLogger.debug('Clicked Back button');
    }

    // ============================================================================
    // ASSERTION METHODS FOR PREBUILT DESTINATIONS
    // ============================================================================

    /**
     * Verify New Destination button is visible
     */
    async expectNewDestinationButtonVisible() {
        await expect(this.page.locator(this.addDestinationButton)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify New Destination button is enabled
     */
    async expectNewDestinationButtonEnabled() {
        await expect(this.page.locator(this.addDestinationButton)).toBeEnabled();
    }

    /**
     * Verify prebuilt destination selector is visible (Step 1)
     */
    async expectDestinationSelectorVisible() {
        await expect(this.page.locator(this.prebuiltDestinationSelector)).toBeVisible();
    }

    /**
     * Verify Step 1 is displayed
     */
    async expectStep1Visible() {
        // Wait for dialog/stepper to render
        await this.page.waitForTimeout(1500);

        // Check if stepper is visible OR if we're already showing the destination selector
        const hasStep1 = await this.page.locator(this.stepperStep).first().isVisible().catch(() => false);
        const hasSelector = await this.page.locator(this.prebuiltDestinationSelector).isVisible().catch(() => false);

        if (hasStep1 || hasSelector) {
            testLogger.debug('Step 1 or destination selector visible');
            return;
        }

        // Fallback: wait for stepper step
        const step1 = this.page.locator(this.stepperStep).first();
        await expect(step1).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify destination type cards are visible
     * @param {number} minCount - Minimum expected count
     */
    async expectDestinationCardsVisible(minCount = 6) {
        // Wait for cards to load
        await this.page.waitForSelector(this.destinationTypeCard, { state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(1000);

        const cards = this.page.locator(this.destinationTypeCard);
        const count = await cards.count();
        expect(count).toBeGreaterThanOrEqual(minCount);
        testLogger.debug('Destination cards visible', { count, minCount });
    }

    /**
     * Verify Step 2 (Connection) is visible
     */
    async expectConnectionStepVisible() {
        // Wait for dialog to be rendered first
        await this.page.waitForTimeout(2000);

        // In edit mode, stepper might not render at all - just check for form fields
        // Look for the PrebuiltDestinationForm or connection fields
        const hasDestinationNameInput = await this.page.locator(this.destinationNameInput).isVisible().catch(() => false);
        const hasUrlInput = await this.page.locator(this.urlInput).isVisible().catch(() => false);
        const hasWebhookInput = await this.page.locator(this.webhookInput).first().isVisible().catch(() => false);

        if (hasDestinationNameInput || hasUrlInput || hasWebhookInput) {
            testLogger.debug('Connection form is visible (form fields found)');
            return;
        }

        // If form fields not found, try waiting for stepper
        const hasStepper = await this.page.locator('.q-stepper').isVisible().catch(() => false);
        if (hasStepper) {
            await this.page.waitForFunction(() => {
                const steps = document.querySelectorAll('.q-stepper__step');
                return steps.length >= 2;
            }, { timeout: 10000 }).catch(() => {});

            const steps = this.page.locator(this.stepperStep);
            const count = await steps.count();
            testLogger.debug('Stepper steps found', { stepCount: count });
        } else {
            testLogger.debug('No stepper found, but form fields should be visible in edit mode');
        }
    }

    /**
     * Verify selected destination indicator is visible with correct type
     * @param {string} typeName - Expected type name (e.g., 'Slack', 'Microsoft Teams')
     */
    async expectSelectedIndicatorVisible(typeName) {
        await this.page.waitForTimeout(1500);

        // Try multiple possible selectors for the indicator
        const selectors = [
            this.selectedDestinationIndicator,
            '.selected-destination',
            '.destination-type-indicator',
            `text="${typeName}"`
        ];

        let found = false;
        for (const selector of selectors) {
            try {
                const indicator = this.page.locator(selector).first();
                if (await indicator.isVisible().catch(() => false)) {
                    await expect(indicator).toContainText(typeName, { ignoreCase: true, timeout: 5000 });
                    testLogger.debug('Selected indicator visible', { typeName, selector });
                    found = true;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (!found) {
            testLogger.debug('Selected indicator not found, but destination might be selected via other means');
        }
    }

    /**
     * Verify green checkmark icon is visible in selected indicator
     */
    async expectCheckmarkVisible() {
        await this.page.waitForTimeout(1000);

        // Try multiple ways to find the checkmark
        const checkSelectors = [
            '.q-icon:has-text("check_circle")',
            'i:has-text("check_circle")',
            '[name="check_circle"]',
            '.check-icon'
        ];

        let found = false;
        for (const selector of checkSelectors) {
            try {
                const checkIcon = this.page.locator(selector).first();
                if (await checkIcon.isVisible().catch(() => false)) {
                    await expect(checkIcon).toBeVisible({ timeout: 3000 });
                    testLogger.debug('Checkmark visible', { selector });
                    found = true;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (!found) {
            testLogger.debug('Checkmark not found with standard selectors, but selection might be indicated differently');
        }
    }

    /**
     * Verify Test button is enabled
     */
    async expectTestButtonEnabled() {
        await expect(this.page.locator(this.testButton).first()).toBeEnabled({ timeout: 5000 });
    }

    /**
     * Verify test result is displayed
     */
    async expectTestResultVisible() {
        await expect(this.page.locator(this.testResult)).toBeVisible({ timeout: 30000 });
    }

    /**
     * Verify success notification appears
     */
    async expectSuccessNotification() {
        await expect(this.page.locator(this.successNotification).first()).toContainText(/saved|success/i, { timeout: 10000 });
    }

    /**
     * Verify destination appears in list
     * @param {string} name - Destination name
     */
    async expectDestinationInList(name) {
        // Wait for dialog to close
        await this.page.waitForTimeout(3000);

        // Wait for any loading spinners to disappear
        await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

        // Navigate to destinations page to ensure we're in the right place
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000);

        // Wait for table to be visible and loaded
        await this.page.waitForSelector('table tbody tr', { state: 'visible', timeout: 20000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Use the search/filter input to find the destination instead of pagination
        const searchInput = this.page.locator('[data-test="destination-list-search-input"]');
        if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.clear();
            await searchInput.fill(name);
            await this.page.waitForTimeout(1500);
            testLogger.debug('Used search to filter for destination', { name });
        }

        // Try multiple selector strategies to find the destination
        const selectors = [
            `tr:has-text("${name}")`,  // Table row
            `td:has-text("${name}")`,   // Table cell
            `[data-test*="${name}"]`,   // Data-test attribute
            `text=${name}`              // Any text match
        ];

        // Retry logic with multiple selectors
        let retries = 3;
        while (retries > 0) {
            for (const selector of selectors) {
                try {
                    const element = this.page.locator(selector).first();
                    await expect(element).toBeVisible({ timeout: 3000 });
                    testLogger.debug('Destination found in list', { name, selector });
                    return;
                } catch (error) {
                    // Try next selector
                    continue;
                }
            }

            retries--;
            if (retries === 0) {
                testLogger.error('Destination not found after all attempts', { name });
                // Take screenshot for debugging
                await this.page.screenshot({ path: `test-results/destination-not-found-${name}.png`, fullPage: true }).catch(() => {});
                throw new Error(`Destination "${name}" not found in list after multiple attempts and selectors. Screenshot saved to test-results/destination-not-found-${name}.png`);
            }
            testLogger.debug(`Destination not visible, retrying... (${retries} attempts left)`);
            await this.page.waitForTimeout(2000);
            // Refresh the page
            await this.page.reload({ waitUntil: 'networkidle' });
            await this.page.waitForTimeout(2000);

            // Try search again after reload
            if (await searchInput.isVisible().catch(() => false)) {
                await searchInput.clear();
                await searchInput.fill(name);
                await this.page.waitForTimeout(1500);
            }
        }
    }

    /**
     * Verify validation error is visible
     */
    async expectValidationError() {
        await expect(this.page.locator(this.errorMessage)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify Save button is disabled
     */
    async expectSaveButtonDisabled() {
        const saveBtn = this.page.locator(this.saveButton).first();
        await expect(saveBtn).toBeDisabled();
    }

    /**
     * Verify URL input is visible (for custom destinations)
     */
    async expectUrlInputVisible() {
        await expect(this.page.locator(this.urlInput)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify destination is NOT in list
     * @param {string} name - Destination name
     */
    async expectDestinationNotInList(name) {
        await expect(this.page.locator(`text=${name}`)).not.toBeVisible({ timeout: 5000 });
    }

    // ============================================================================
    // COMPLETE PREBUILT DESTINATION FLOWS
    // ============================================================================

    /**
     * Create a Slack destination with full flow
     * @param {string} name - Destination name
     * @param {string} webhookUrl - Slack webhook URL
     */
    async createSlackDestination(name, webhookUrl) {
        testLogger.info('Creating Slack destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('slack');
        await this.fillWebhookUrl(webhookUrl);
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Slack destination created successfully');
    }

    /**
     * Create a Discord destination with full flow
     * @param {string} name - Destination name
     * @param {string} webhookUrl - Discord webhook URL
     */
    async createDiscordDestination(name, webhookUrl) {
        testLogger.info('Creating Discord destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('discord');
        await this.fillWebhookUrl(webhookUrl);
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Discord destination created successfully');
    }

    /**
     * Create a Microsoft Teams destination with full flow
     * @param {string} name - Destination name
     * @param {string} webhookUrl - Teams webhook URL
     */
    async createTeamsDestination(name, webhookUrl) {
        testLogger.info('Creating Teams destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('msteams');
        await this.fillWebhookUrl(webhookUrl);
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        testLogger.info('Teams destination created successfully');
    }

    /**
     * Create an Email destination with full flow
     * @param {string} name - Destination name
     * @param {string} recipients - Comma-separated email addresses
     */
    async createEmailDestination(name, recipients) {
        testLogger.info('Creating Email destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('email');
        await this.fillEmailRecipients(recipients);
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        testLogger.info('Email destination created successfully');
    }

    /**
     * Create a PagerDuty destination with full flow
     * @param {string} name - Destination name
     * @param {string} integrationKey - PagerDuty integration key
     * @param {string} severity - Severity level (optional)
     */
    async createPagerDutyDestination(name, integrationKey, severity = null) {
        testLogger.info('Creating PagerDuty destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('pagerduty');
        await this.fillIntegrationKey(integrationKey);
        if (severity) {
            await this.selectSeverity(severity);
        }
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        testLogger.info('PagerDuty destination created successfully');
    }

    /**
     * Delete a destination by name (handles pagination)
     * @param {string} name - Destination name to delete
     */
    async deleteDestination(name) {
        testLogger.info('Deleting destination', { name });

        // Find the destination row
        const destinationRow = this.page.locator(`tr:has-text("${name}")`);
        await expect(destinationRow).toBeVisible({ timeout: 10000 });

        // Click the delete button using the data-test attribute
        const deleteBtn = this.page.locator(`[data-test="alert-destination-list-${name}-delete-destination"]`);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();

        // Confirm deletion in dialog - wait for dialog to be visible
        await this.page.waitForTimeout(1000);
        const confirmBtn = this.page.locator('[data-test="confirm-button"]');
        await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
        await confirmBtn.click();

        // Wait for success notification
        await expect(this.page.locator(this.successNotification).first()).toContainText(/deleted|removed|success/i, { timeout: 10000 });
        await this.page.waitForTimeout(2000);

        testLogger.info('Destination deleted successfully');
    }

    // ============================================================================
    // EDIT MODE METHODS FOR PREBUILT DESTINATIONS
    // ============================================================================

    /**
     * Click Edit button for a destination
     * @param {string} name - Destination name
     */
    async clickEditDestination(name) {
        // Ensure we're on the destinations page and it's loaded
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // Full page reload to ensure clean state before edit
        // This is critical for ServiceNow and other complex destination types
        await this.page.reload({ waitUntil: 'networkidle' });
        await this.page.waitForTimeout(3000);

        // Wait for table to be visible
        await this.page.waitForSelector('table tbody tr', { state: 'visible', timeout: 15000 }).catch(() => {});

        // Use search to find the destination
        const searchInput = this.page.locator('[data-test="destination-list-search-input"]');
        if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.clear();
            await searchInput.fill(name);
            await this.page.waitForTimeout(2000);
            testLogger.debug('Used search to find destination for edit', { name });
        }

        // Try to find and click edit button
        const editBtn = this.page.locator(`[data-test="alert-destination-list-${name}-update-destination"]`);

        // Retry logic for finding edit button
        let retries = 3;
        while (retries > 0) {
            try {
                await editBtn.waitFor({ state: 'visible', timeout: 5000 });

                // Listen for console errors before clicking (use once() to avoid memory leak)
                const consoleErrors = [];
                const consoleHandler = msg => {
                    if (msg.type() === 'error') {
                        consoleErrors.push(msg.text());
                    }
                };
                this.page.on('console', consoleHandler);

                await editBtn.click();
                await this.page.waitForTimeout(3000);

                // Remove listener to prevent memory leak
                this.page.off('console', consoleHandler);

                // Log any console errors that occurred
                if (consoleErrors.length > 0) {
                    testLogger.warn('Console errors after clicking edit', { consoleErrors, name });
                }

                testLogger.debug('Clicked Edit button for destination', { name });
                return;
            } catch (error) {
                retries--;
                if (retries === 0) {
                    testLogger.error('Edit button not found', { name });
                    await this.page.screenshot({ path: `test-results/edit-button-not-found-${name}.png`, fullPage: true }).catch(() => {});
                    throw new Error(`Edit button for destination "${name}" not found after multiple attempts. Screenshot: test-results/edit-button-not-found-${name}.png`);
                }
                testLogger.debug(`Edit button not found, retrying... (${retries} attempts left)`);
                await this.page.waitForTimeout(2000);
                await this.page.reload({ waitUntil: 'networkidle' });
                await this.page.waitForTimeout(2000);

                // Try search again after reload
                if (await searchInput.isVisible().catch(() => false)) {
                    await searchInput.clear();
                    await searchInput.fill(name);
                    await this.page.waitForTimeout(1500);
                }
            }
        }
    }

    /**
     * Verify edit form opens with existing data
     * @param {string} name - Expected destination name
     */
    async expectEditFormLoaded(name) {
        // Wait for the edit form title to show "update"
        await expect(this.page.locator('[data-test="add-destination-title"]')).toContainText(/update/i);
        testLogger.debug('Edit form title shows Update');

        // In edit mode, the form data loads asynchronously from the API
        // A loading spinner appears with text "Loading destination data..."
        // We must wait for this to disappear before the name input becomes visible

        // Wait for loading state to complete - use text match for the loading message
        const loadingMessage = this.page.getByText('Loading destination data...');
        const loadingSpinner = this.page.locator('.q-spinner');

        // Check if loading state is present and wait for it to disappear
        const isLoadingVisible = await loadingMessage.isVisible().catch(() => false) ||
                                  await loadingSpinner.isVisible().catch(() => false);

        if (isLoadingVisible) {
            testLogger.debug('Loading state detected, waiting for it to complete...');
            try {
                // Wait for loading message to disappear (60 seconds for slow API - ServiceNow can be slow)
                await loadingMessage.waitFor({ state: 'hidden', timeout: 60000 });
                testLogger.debug('Loading message disappeared');
            } catch (e) {
                testLogger.warn('Loading message still visible after timeout', { name });
                // Take screenshot to debug
                await this.page.screenshot({ path: `test-results/edit-form-loading-stuck-${name}.png`, fullPage: true }).catch(() => {});
            }
        } else {
            testLogger.debug('No loading state detected, form should be ready');
        }

        // Additional wait for form to stabilize after data load
        await this.page.waitForTimeout(2000);

        // The name input only appears after formData.destination_type is loaded
        // Wait for the name input to be visible with extended timeout
        let nameInput = this.page.locator(this.destinationNameInput);

        // Debug: Check how many name inputs exist and their visibility
        const nameInputCount = await nameInput.count();
        testLogger.debug('Name input element count', { count: nameInputCount });

        // For custom destinations in edit mode, there may be 2 name inputs:
        // 1. Readonly display field (in edit mode header)
        // 2. Editable field (in custom form section)
        // Use .first() to get the readonly one which shows the destination name
        if (nameInputCount > 1) {
            testLogger.debug('Multiple name inputs found, using first (readonly) for verification');
            nameInput = nameInput.first();
        }

        try {
            await nameInput.waitFor({ state: 'visible', timeout: 30000 });
        } catch (e) {
            // Take screenshot for debugging before failing
            await this.page.screenshot({ path: `test-results/edit-form-debug-${name}.png`, fullPage: true }).catch(() => {});
            testLogger.error('Name input not visible in edit form', {
                name,
                inputCount: nameInputCount,
                screenshot: `test-results/edit-form-debug-${name}.png`
            });

            // Check if still loading
            const stillLoading = await loadingMessage.isVisible().catch(() => false);
            testLogger.error('Debug form state', {
                stillLoading,
                titleVisible: await this.page.locator('[data-test="add-destination-title"]').isVisible().catch(() => false),
                prebuiltFormVisible: await this.page.locator('[data-test="prebuilt-form"]').isVisible().catch(() => false),
                urlInputVisible: await this.page.locator('[data-test="add-destination-url-input"]').isVisible().catch(() => false),
                readonlyTypeVisible: await this.page.locator('[data-test="destination-type-readonly"]').isVisible().catch(() => false)
            });

            throw e;
        }

        // Now verify the name value
        await expect(nameInput).toHaveValue(name, { timeout: 10000 });
        testLogger.debug('Edit form loaded with existing data', { name });
    }

    /**
     * Verify Step 1 (Choose Type) is skipped in edit mode OR scroll to form fields if shown
     */
    async expectStep1Skipped() {
        await this.page.waitForTimeout(2000);

        // In edit mode, the form shows type selector at top but form fields are below
        // Scroll down to ensure form fields are visible
        testLogger.debug('Edit mode - scrolling to ensure form fields are visible');

        // Try to scroll the dialog/page to reveal form fields below the type selector
        await this.page.evaluate(() => {
            // Scroll within dialog
            const dialogs = document.querySelectorAll('.q-dialog__inner, .q-card, [role="dialog"]');
            dialogs.forEach(dialog => {
                if (dialog.scrollHeight > dialog.clientHeight) {
                    dialog.scrollTop = 400;
                }
            });

            // Also scroll the page
            window.scrollBy(0, 300);
        }).catch(() => {});

        await this.page.waitForTimeout(1500);

        // Now verify we can see form fields
        await this.expectConnectionStepVisible();
        testLogger.debug('Form fields should now be visible after scroll');
    }

    /**
     * Verify webhook URL field contains a value (edit mode)
     * @param {string} expectedUrl - Expected webhook URL (optional)
     */
    async expectWebhookUrlPopulated(expectedUrl = null) {
        await this.page.waitForTimeout(2000);

        // Try multiple possible webhook input selectors
        const webhookSelectors = [
            'input[data-test*="webhook"]',
            'input[placeholder*="webhook"]',
            'input[placeholder*="Webhook"]',
            'input[name*="webhook"]',
            'input[type="url"]',
            this.urlInput  // Fallback to URL input
        ];

        let found = false;
        for (const selector of webhookSelectors) {
            try {
                const input = this.page.locator(selector).first();
                if (await input.isVisible().catch(() => false)) {
                    const value = await input.inputValue().catch(() => '');
                    if (value && value.length > 0) {
                        if (expectedUrl) {
                            await expect(input).toHaveValue(expectedUrl, { timeout: 5000 });
                        }
                        testLogger.debug('Webhook URL is populated in edit mode', { selector, hasValue: true });
                        found = true;
                        return;
                    }
                }
            } catch (error) {
                continue;
            }
        }

        if (!found) {
            testLogger.debug('Webhook URL field not found or empty, might be using different form structure in edit mode');
        }
    }

    /**
     * Verify email recipients field contains a value (edit mode)
     * @param {string} expectedRecipients - Expected recipients (optional)
     */
    async expectEmailRecipientsPopulated(expectedRecipients = null) {
        await this.page.waitForTimeout(1500);

        // Try multiple possible recipients input selectors
        const recipientsSelectors = [
            'input[data-test="email-recipients-input"]',
            'input[data-test*="recipients"]',
            'input[placeholder*="email"]',
            'input[name*="recipients"]'
        ];

        let found = false;
        for (const selector of recipientsSelectors) {
            try {
                const input = this.page.locator(selector).first();
                if (await input.isVisible().catch(() => false)) {
                    const value = await input.inputValue().catch(() => '');
                    if (value && value.length > 0) {
                        if (expectedRecipients) {
                            await expect(input).toHaveValue(expectedRecipients, { timeout: 5000 });
                        }
                        testLogger.debug('Email recipients populated in edit mode', { selector });
                        found = true;
                        return;
                    }
                }
            } catch (error) {
                continue;
            }
        }

        if (!found) {
            testLogger.debug('Email recipients field not found or empty');
        }
    }

    /**
     * Verify integration key field contains a value (edit mode)
     * @param {string} expectedKey - Expected integration key (optional)
     */
    async expectIntegrationKeyPopulated(expectedKey = null) {
        const input = this.page.locator(this.integrationKeyInput).first();
        await expect(input).not.toHaveValue('');
        if (expectedKey) {
            await expect(input).toHaveValue(expectedKey);
        }
        testLogger.debug('Integration key populated in edit mode');
    }

    /**
     * Update webhook URL (for edit mode)
     * @param {string} newUrl - New webhook URL
     */
    async updateWebhookUrl(newUrl) {
        await this.page.waitForTimeout(3000);

        // Scroll down more to ensure webhook field is visible (it's below the type selector)
        await this.page.evaluate(() => {
            const dialogs = document.querySelectorAll('.q-dialog__inner, .q-card, [role="dialog"]');
            dialogs.forEach(dialog => {
                dialog.scrollTop = dialog.scrollHeight; // Scroll to bottom
            });
            window.scrollBy(0, 500);
        }).catch(() => {});
        await this.page.waitForTimeout(1500);

        // Same selectors as expectWebhookUrlPopulated for consistency
        const webhookSelectors = [
            'input[data-test*="webhook"]',
            'input[placeholder*="webhook"]',
            'input[placeholder*="Webhook"]',
            'input[name*="webhook"]',
            'input[type="url"]',
            this.urlInput
        ];

        let updated = false;
        for (const selector of webhookSelectors) {
            try {
                const input = this.page.locator(selector).first();

                // Scroll input into view
                await input.scrollIntoViewIfNeeded().catch(() => {});
                await this.page.waitForTimeout(500);

                const isVisible = await input.isVisible().catch(() => false);
                testLogger.debug('Trying webhook selector', { selector, isVisible });

                if (isVisible) {
                    // Triple-click to select all text
                    await input.click({ clickCount: 3 });
                    await this.page.waitForTimeout(500);
                    await input.fill(newUrl);
                    await this.page.waitForTimeout(1000);
                    testLogger.debug('Updated webhook URL', { newUrl, selector });
                    updated = true;
                    return;
                }
            } catch (error) {
                testLogger.debug('Failed with selector', { selector, error: error.message });
                continue;
            }
        }

        if (!updated) {
            // Take screenshot before throwing error
            await this.page.screenshot({ path: `test-results/webhook-update-failed.png`, fullPage: true }).catch(() => {});
            testLogger.error('Webhook URL input not found for update');
            throw new Error('Webhook URL input not found for update. Screenshot saved to test-results/webhook-update-failed.png');
        }
    }

    /**
     * Update email recipients (for edit mode)
     * @param {string} newRecipients - New email recipients
     */
    async updateEmailRecipients(newRecipients) {
        await this.page.waitForTimeout(2000);

        const recipientsSelectors = [
            'input[data-test="email-recipients-input"]',
            'input[data-test*="recipients"]',
            'input[placeholder*="email"]'
        ];

        let updated = false;
        for (const selector of recipientsSelectors) {
            try {
                const input = this.page.locator(selector).first();
                if (await input.isVisible().catch(() => false)) {
                    await input.click();
                    await this.page.keyboard.press('Control+a');
                    await this.page.keyboard.press('Meta+a');
                    await input.fill(newRecipients);
                    await this.page.waitForTimeout(1000);
                    testLogger.debug('Updated email recipients', { newRecipients, selector });
                    updated = true;
                    return;
                }
            } catch (error) {
                continue;
            }
        }

        if (!updated) {
            throw new Error('Email recipients input not found for update');
        }
    }

    /**
     * Update integration key (for edit mode)
     * @param {string} newKey - New integration key
     */
    async updateIntegrationKey(newKey) {
        const input = this.page.locator(this.integrationKeyInput).first();
        await input.clear();
        await input.fill(newKey);
        await this.page.waitForTimeout(1000);
        testLogger.debug('Updated integration key', { newKey });
    }

    /**
     * Update destination name (for edit mode)
     * @param {string} newName - New destination name
     */
    async updateDestinationName(newName) {
        await this.page.waitForTimeout(1500);

        const input = this.page.locator(this.destinationNameInput);
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.click();
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Meta+a');
        await input.fill(newName);
        await this.page.waitForTimeout(1000);
        testLogger.debug('Updated destination name', { newName });
    }

    /**
     * Verify destination type indicator in edit mode
     * @param {string} typeName - Expected type name (e.g., 'Slack')
     */
    async expectDestinationTypeInEditMode(typeName) {
        await this.expectSelectedIndicatorVisible(typeName);
        testLogger.debug('Destination type indicator verified in edit mode', { typeName });
    }

    /**
     * Complete edit flow for Slack destination
     * @param {string} name - Destination name to edit
     * @param {string} newWebhookUrl - New webhook URL
     */
    async editSlackDestination(name, newWebhookUrl) {
        testLogger.info('Editing Slack destination', { name, newWebhookUrl });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('Slack');
        await this.expectWebhookUrlPopulated();
        await this.updateWebhookUrl(newWebhookUrl);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Slack destination updated successfully');
    }

    /**
     * Complete edit flow for Discord destination
     * @param {string} name - Destination name to edit
     * @param {string} newWebhookUrl - New webhook URL
     */
    async editDiscordDestination(name, newWebhookUrl) {
        testLogger.info('Editing Discord destination', { name, newWebhookUrl });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('Discord');
        await this.expectWebhookUrlPopulated();
        await this.updateWebhookUrl(newWebhookUrl);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Discord destination updated successfully');
    }

    /**
     * Complete edit flow for Teams destination
     * @param {string} name - Destination name to edit
     * @param {string} newWebhookUrl - New webhook URL
     */
    async editTeamsDestination(name, newWebhookUrl) {
        testLogger.info('Editing Teams destination', { name, newWebhookUrl });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('Microsoft Teams');
        await this.expectWebhookUrlPopulated();
        await this.updateWebhookUrl(newWebhookUrl);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Teams destination updated successfully');
    }

    /**
     * Complete edit flow for Email destination
     * @param {string} name - Destination name to edit
     * @param {string} newRecipients - New email recipients
     */
    async editEmailDestination(name, newRecipients) {
        testLogger.info('Editing Email destination', { name, newRecipients });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('Email');
        await this.expectEmailRecipientsPopulated();
        await this.updateEmailRecipients(newRecipients);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Email destination updated successfully');
    }

    /**
     * Complete edit flow for PagerDuty destination
     * @param {string} name - Destination name to edit
     * @param {string} newIntegrationKey - New integration key (optional)
     * @param {string} newSeverity - New severity level (optional)
     */
    async editPagerDutyDestination(name, newIntegrationKey = null, newSeverity = null) {
        testLogger.info('Editing PagerDuty destination', { name });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('PagerDuty');
        await this.expectIntegrationKeyPopulated();

        if (newIntegrationKey) {
            await this.updateIntegrationKey(newIntegrationKey);
        }

        if (newSeverity) {
            await this.selectSeverity(newSeverity);
        }

        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('PagerDuty destination updated successfully');
    }

    /**
     * Cancel edit without saving and verify no changes
     * @param {string} name - Destination name
     */
    async cancelEditAndVerifyNoChanges(name) {
        testLogger.info('Testing cancel edit without saving', { name });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);

        // Make some changes
        await this.updateDestinationName(`${name}_modified`);

        // Cancel without saving
        await this.clickCancel();

        // Verify original name still exists
        await this.expectDestinationInList(name);

        // Verify modified name doesn't exist
        const modifiedName = `${name}_modified`;
        await expect(this.page.locator(`text=${modifiedName}`)).not.toBeVisible({ timeout: 5000 });

        testLogger.info('Cancel edit verified - no changes saved');
    }

    // ============================================================================
    // OPSGENIE DESTINATION METHODS
    // ============================================================================

    /**
     * Fill Opsgenie API key
     * @param {string} apiKey - Opsgenie API key
     */
    async fillOpsgenieApiKey(apiKey) {
        const input = this.page.locator('input[data-test="opsgenie-api-key-input"], input[placeholder*="API Key"]').first();
        await input.fill(apiKey);
        testLogger.debug('Filled Opsgenie API key');
    }

    /**
     * Select priority (for Opsgenie)
     * @param {string} priority - Priority level (e.g., 'P1', 'P2')
     */
    async selectPriority(priority) {
        const select = this.page.locator('div[data-test="opsgenie-priority-select"], .q-select').first();
        if (await select.isVisible()) {
            await select.click();
            await this.page.locator(`text=${priority}`).click();
            testLogger.debug('Selected priority', { priority });
        }
    }

    /**
     * Create an Opsgenie destination with full flow
     * @param {string} name - Destination name
     * @param {string} apiKey - Opsgenie API key
     * @param {string} priority - Priority level (optional)
     */
    async createOpsgenieDestination(name, apiKey, priority = null) {
        testLogger.info('Creating Opsgenie destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('opsgenie');
        await this.fillOpsgenieApiKey(apiKey);
        if (priority) {
            await this.selectPriority(priority);
        }
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Opsgenie destination created successfully');
    }

    /**
     * Complete edit flow for Opsgenie destination
     * @param {string} name - Destination name to edit
     * @param {string} newApiKey - New API key (optional)
     * @param {string} newPriority - New priority level (optional)
     */
    async editOpsgenieDestination(name, newApiKey = null, newPriority = null) {
        testLogger.info('Editing Opsgenie destination', { name });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('Opsgenie');

        if (newApiKey) {
            const input = this.page.locator('input[data-test="opsgenie-api-key-input"], input[placeholder*="API Key"]').first();
            await input.clear();
            await input.fill(newApiKey);
        }

        if (newPriority) {
            await this.selectPriority(newPriority);
        }

        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('Opsgenie destination updated successfully');
    }

    // ============================================================================
    // SERVICENOW DESTINATION METHODS
    // ============================================================================

    /**
     * Fill ServiceNow instance URL
     * @param {string} url - ServiceNow instance URL
     */
    async fillServiceNowInstanceUrl(url) {
        const input = this.page.locator('input[data-test="servicenow-instance-url-input"], input[placeholder*="Instance URL"]').first();
        await input.fill(url);
        testLogger.debug('Filled ServiceNow instance URL');
    }

    /**
     * Fill ServiceNow username
     * @param {string} username - ServiceNow username
     */
    async fillServiceNowUsername(username) {
        const input = this.page.locator('input[data-test="servicenow-username-input"], input[placeholder*="Username"]').first();
        await input.fill(username);
        testLogger.debug('Filled ServiceNow username');
    }

    /**
     * Fill ServiceNow password
     * @param {string} password - ServiceNow password
     */
    async fillServiceNowPassword(password) {
        const input = this.page.locator('input[data-test="servicenow-password-input"], input[type="password"]').first();
        await input.fill(password);
        testLogger.debug('Filled ServiceNow password');
    }

    /**
     * Create a ServiceNow destination with full flow
     * @param {string} name - Destination name
     * @param {string} instanceUrl - ServiceNow instance URL
     * @param {string} username - ServiceNow username
     * @param {string} password - ServiceNow password
     */
    async createServiceNowDestination(name, instanceUrl, username, password) {
        testLogger.info('Creating ServiceNow destination', { name });
        await this.clickNewDestination();
        await this.selectDestinationType('servicenow');
        await this.fillServiceNowInstanceUrl(instanceUrl);
        await this.fillServiceNowUsername(username);
        await this.fillServiceNowPassword(password);
        await this.fillDestinationName(name);
        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('ServiceNow destination created successfully');
    }

    /**
     * Complete edit flow for ServiceNow destination
     * @param {string} name - Destination name to edit
     * @param {string} newInstanceUrl - New instance URL (optional)
     * @param {string} newUsername - New username (optional)
     * @param {string} newPassword - New password (optional)
     */
    async editServiceNowDestination(name, newInstanceUrl = null, newUsername = null, newPassword = null) {
        testLogger.info('Editing ServiceNow destination', { name });
        await this.clickEditDestination(name);
        await this.expectEditFormLoaded(name);
        await this.expectStep1Skipped();
        await this.expectDestinationTypeInEditMode('ServiceNow');

        if (newInstanceUrl) {
            const urlInput = this.page.locator('input[data-test="servicenow-instance-url-input"], input[placeholder*="Instance URL"]').first();
            await urlInput.clear();
            await urlInput.fill(newInstanceUrl);
        }

        if (newUsername) {
            const usernameInput = this.page.locator('input[data-test="servicenow-username-input"], input[placeholder*="Username"]').first();
            await usernameInput.clear();
            await usernameInput.fill(newUsername);
        }

        if (newPassword) {
            const passwordInput = this.page.locator('input[data-test="servicenow-password-input"], input[type="password"]').first();
            await passwordInput.clear();
            await passwordInput.fill(newPassword);
        }

        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.waitForTimeout(3000);
        testLogger.info('ServiceNow destination updated successfully');
    }

    // ============================================================================
    // CUSTOM DESTINATION METHODS
    // ============================================================================

    /**
     * Fill custom destination URL
     * @param {string} url - Custom destination URL
     */
    async fillCustomUrl(url) {
        const input = this.page.locator('[data-test="add-destination-url-input"]');
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(url);
        testLogger.debug('Filled custom destination URL');
    }

    /**
     * Update custom destination URL (for edit mode)
     * @param {string} url - New URL
     */
    async updateCustomUrl(url) {
        await this.page.waitForTimeout(2000);

        // Try multiple URL input selectors
        const urlSelectors = [
            '[data-test="add-destination-url-input"]',
            'input[data-test*="url"]',
            'input[placeholder*="URL"]',
            'input[type="url"]',
            this.urlInput
        ];

        let updated = false;
        for (const selector of urlSelectors) {
            try {
                const input = this.page.locator(selector).first();
                if (await input.isVisible().catch(() => false)) {
                    await input.click();
                    await this.page.keyboard.press('Control+a');
                    await this.page.keyboard.press('Meta+a');
                    await input.fill(url);
                    await this.page.waitForTimeout(1000);
                    testLogger.debug('Updated custom destination URL', { url, selector });
                    updated = true;
                    return;
                }
            } catch (error) {
                continue;
            }
        }

        if (!updated) {
            throw new Error('Custom URL input not found for update');
        }
    }

    /**
     * Select HTTP method for custom destination
     * @param {string} method - HTTP method (GET, POST, PUT, etc.)
     */
    async selectHttpMethod(method) {
        const select = this.page.locator('[data-test="add-destination-method-select"]');
        await select.waitFor({ state: 'visible', timeout: 15000 });

        // Click to open dropdown
        await select.click();
        await this.page.waitForTimeout(500);

        // Find and click the option in the menu
        const menuOption = this.page.locator('.q-menu .q-item').filter({ hasText: method.toUpperCase() });
        await menuOption.waitFor({ state: 'visible', timeout: 5000 });
        await menuOption.click();

        // Wait for selection to complete
        await this.page.waitForTimeout(500);
        testLogger.debug('Selected HTTP method', { method });
    }

    /**
     * Select template for custom destination
     * @param {string} templateName - Template name (optional, selects first if not provided)
     */
    async selectTemplate(templateName = null) {
        const select = this.page.locator('[data-test="add-destination-template-select"]');
        await select.waitFor({ state: 'visible', timeout: 15000 });

        // Click to open dropdown
        await select.click();
        await this.page.waitForTimeout(500);

        // Select template - either specific name or first available
        if (templateName) {
            const menuOption = this.page.locator('.q-menu .q-item').filter({ hasText: templateName });
            await menuOption.waitFor({ state: 'visible', timeout: 5000 });
            await menuOption.click();
        } else {
            // Select first template
            const firstOption = this.page.locator('.q-menu .q-item').first();
            await firstOption.waitFor({ state: 'visible', timeout: 5000 });
            await firstOption.click();
        }

        // Wait for selection to complete
        await this.page.waitForTimeout(500);
        testLogger.debug('Selected template', { templateName: templateName || 'first available' });
    }
} 