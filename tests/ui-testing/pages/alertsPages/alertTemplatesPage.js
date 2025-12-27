import { expect, test } from '@playwright/test';
import { test as base } from '@playwright/test';
import fs from 'fs';
import { AlertDestinationsPage } from './alertDestinationsPage.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertTemplatesPage {
    constructor(page) {
        this.page = page;
        this.alertDestinationsPage = new AlertDestinationsPage(page);
        
        // Navigation locators
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.templatesTab = '[data-test="alert-templates-tab"]';
        
        // Template creation locators
        this.addTemplateButton = '[data-test="template-list-add-btn"]';
        this.templateNameInput = '[data-test="add-template-name-input"]';
        this.templateEditor = '[data-test="add-template-editor"]';
        this.templateSubmitButton = '[data-test="add-template-submit-btn"]';
        this.templateSuccessMessage = 'Template Saved Successfully.';
        
        // Template management locators
        this.templateSearchInput = 'Search Template';
        this.templateDeleteButton = '[data-test="alert-template-list-{templateName}-delete-template"]';
        this.templateUpdateButton = '[data-test="alert-template-list-{templateName}-update-template"]';
        this.deleteConfirmText = 'Delete Template';
        this.confirmButton = '[data-test="confirm-button"]';
        this.templateDeletedMessage = 'Template %s deleted successfully';
        this.templateInUseMessage = 'Template is in use for destination';
        this.templateCountText = 'Templates';
        
        // Template import locators
        this.templateImportButton = '[data-test="template-import"]';
        this.importUrlTab = '[data-test="tab-import_json_url"]';
        this.importUrlInput = '[data-test="template-import-url-input"]';
        this.importJsonButton = '[data-test="template-import-json-btn"]';
        this.importNameInput = '[data-test="template-import-name-input"]';
        this.importFileInput = '[data-test="template-import-json-file-input"]';
        this.templateImportSuccessMessage = 'Successfully imported';
        this.templateImportErrorText = 'Template - 1: "email template" creation failed --> Reason: Template name cannot contain \':\', \'#\', \'?\', \'&\', \'%\', \'/\', quotes and space characters';

        // Inline locators moved from methods
        this.monacoEditorLocator = '.monaco-editor';
        this.tableLocator = 'table';
        this.preLocator = 'pre';
    }

    async navigateToTemplates(retryCount = 0) {
        const maxRetries = 2; // Maximum number of retry attempts
        
        try {
            await this.page.waitForLoadState('networkidle');
            await this.page.locator(this.settingsMenuItem).waitFor({ state: 'visible', timeout: 10000 });
            await this.page.locator(this.settingsMenuItem).click();
            await this.page.waitForTimeout(2000);

            await this.page.locator(this.templatesTab).waitFor({ state: 'visible', timeout: 10000 });
            await this.page.locator(this.templatesTab).click();
            await this.page.waitForTimeout(2000);

            // Wait for templates page to load
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
        } catch (error) {
            testLogger.error('Error navigating to templates', { error: error.message });
            
            // Check if we've exceeded max retries
            if (retryCount >= maxRetries) {
                throw new Error(`Failed to navigate to templates after ${maxRetries} attempts`);
            }
            
            // Try to recover by reloading the page
            await this.page.reload();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            
            // Retry navigation with incremented retry count
            await this.navigateToTemplates(retryCount + 1);
        }
    }

    async createTemplate(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);
        
        await this.page.locator(this.addTemplateButton).click();
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.templateNameInput).click();
        await this.page.locator(this.templateNameInput).fill(templateName);
        await this.page.waitForTimeout(1000);
        
        const templateText = `{
  "text": "{alert_name} is active. This is the alert url {alert_url}. This alert template has been created using a playwright automation script"`;
        
        // Clear the template editor first
        await this.page.locator(this.monacoEditorLocator).first().click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(1000);
        
        // Enter the template content all at once
        await this.page.keyboard.type(templateText);
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.templateSubmitButton).click();

        // Additional wait for WebKit to process the update
        await this.page.waitForTimeout(3000);
        
        // Refresh the page to ensure list is updated
        await this.page.reload();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        // Try to find the template with retry logic
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                // First ensure the table is visible
                await this.page.locator(this.tableLocator).waitFor({ state: 'visible', timeout: 10000 });

                // Use search to find the template
                await this.page.getByPlaceholder(this.templateSearchInput).click();
                await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName);
                await this.page.waitForTimeout(1000);

                // Verify the template exists in search results using waitFor
                await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });

                testLogger.info('Successfully verified template exists', { templateName });
                return;
            } catch (error) {
                attempts++;
                if (attempts === maxAttempts) {
                    throw new Error(`Template ${templateName} not found after ${maxAttempts} attempts`);
                }
                testLogger.info('Template not found, retrying', { attempts });
                await this.page.reload();
                await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(2000);
            }
        }
    }


    async deleteTemplateAndVerify(templateName) {
        // First search for the template
        await this.page.getByPlaceholder(this.templateSearchInput).click();
        await this.page.getByPlaceholder(this.templateSearchInput).fill('');  // Clear the input first
        await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName.toLowerCase());
        await this.page.waitForTimeout(2000); // Wait for search to complete
        
        // Wait for either search results or no data message
        try {
            await Promise.race([
                this.page.locator(this.tableLocator).waitFor({ state: 'visible', timeout: 30000 }),
                this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
            ]);
        } catch (error) {
            testLogger.error('Neither table nor no data message found after template search', { templateName, error: error.message });
            throw new Error(`Failed to search for template "${templateName}": Neither table nor "No data available" message appeared`);
        }

        // Verify template exists before deletion
        await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });

        // Click delete button using the correct locator
        await this.page.locator(this.templateDeleteButton.replace('{templateName}', templateName)).click();
        await expect(this.page.getByText(this.deleteConfirmText, { exact: true })).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        // await expect(this.page.getByText(this.templateDeletedMessage.replace('%s', templateName))).toBeVisible();
        await this.page.waitForTimeout(4000);

        // Verify template is deleted
        await this.page.getByPlaceholder(this.templateSearchInput).click();
        await this.page.getByPlaceholder(this.templateSearchInput).fill('');  // Clear the input first
        await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName.toLowerCase());
        await this.page.waitForTimeout(2000); // Wait for search to complete
        
        // Verify no results found
        await expect(this.page.getByText('No data available')).toBeVisible();
    }

    async ensureTemplateExists(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        try {
            // Use search to find the template (handles pagination)
            await this.page.getByPlaceholder(this.templateSearchInput).click();
            await this.page.getByPlaceholder(this.templateSearchInput).fill('');
            await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName);
            await this.page.waitForTimeout(1000);

            // Try to find the template in search results
            await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 3000 });
            testLogger.info('Found existing template', { templateName });
            return templateName;
        } catch (error) {
            // If not found, create new template
            await this.createTemplate(templateName);
            testLogger.info('Created new template', { templateName });
            return templateName;
        }
    }

    /**
     * Create a validation template with JSON array format for ingestion API
     * This template is specifically designed for alert trigger validation
     * @param {string} templateName - Name of the template to create
     */
    async createValidationTemplate(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        await this.page.locator(this.addTemplateButton).click();
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.templateNameInput).click();
        await this.page.locator(this.templateNameInput).fill(templateName);
        await this.page.waitForTimeout(1000);

        // JSON array format required for OpenObserve ingestion API
        const templateText = `[{"alert_name": "{alert_name}", "alert_type": "validation", "org_name": "{org_name}", "stream_name": "{stream_name}"}]`;

        // Clear the template editor first
        await this.page.locator(this.monacoEditorLocator).first().click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(1000);

        // Enter the template content
        await this.page.keyboard.type(templateText);
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.templateSubmitButton).click();

        // Wait for success message like regular createTemplate
        await expect(this.page.getByText(this.templateSuccessMessage)).toBeVisible({ timeout: 10000 });
        await this.page.waitForTimeout(2000);

        testLogger.info('Created validation template with JSON array format', { templateName });
        return templateName;
    }

    /**
     * Ensure validation template exists (creates with JSON array format if not found)
     * @param {string} templateName - Name of the template
     */
    async ensureValidationTemplateExists(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        try {
            // Use search to find the template
            await this.page.getByPlaceholder(this.templateSearchInput).click();
            await this.page.getByPlaceholder(this.templateSearchInput).fill('');
            await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName);
            await this.page.waitForTimeout(1000);

            await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 3000 });
            testLogger.info('Found existing validation template', { templateName });
            return templateName;
        } catch (error) {
            // Create validation template with proper JSON format
            await this.createValidationTemplate(templateName);
            testLogger.info('Created new validation template', { templateName });
            return templateName;
        }
    }

    /**
     * Verify that a newly created template exists in the list
     * @param {string} templateName - Name of the template to verify
     * @throws {Error} if template is not found
     */
    async verifyCreatedTemplateExists(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        try {
            // Search for the template first
            await this.page.getByPlaceholder(this.templateSearchInput).click();
            await this.page.getByPlaceholder(this.templateSearchInput).fill('');  // Clear the input first
            await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName.toLowerCase());
            await this.page.waitForTimeout(2000); // Wait for search to complete
            
            // Wait for either search results or no data message
            try {
                await Promise.race([
                    this.page.locator(this.tableLocator).waitFor({ state: 'visible', timeout: 30000 }),
                    this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
                ]);
            } catch (error) {
                testLogger.error('Neither table nor no data message found after template search', { templateName, error: error.message });
                throw new Error(`Failed to search for template "${templateName}": Neither table nor "No data available" message appeared`);
            }

            // Try to find the template
            await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });
            testLogger.info('Successfully verified template exists', { templateName });
        } catch (error) {
            throw new Error(`Template ${templateName} not found in the list`);
        }
    }

    /**
     * Import template from URL
     * @param {string} url - URL to import template from
     * @param {string} templateName - Name for the imported template
     * @param {string} importType - Type of import: 'valid' or 'invalid'
     */
    async importTemplateFromUrl(url, templateName, importType = 'valid') {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);
        
        await this.page.locator(this.templateImportButton).click();
        await this.page.locator(this.importUrlTab).click();
        await this.page.locator(this.importUrlInput).click();
        await this.page.locator(this.importUrlInput).fill(url);
        await this.page.waitForTimeout(1000); // Small delay after filling URL
        await this.page.locator(this.importJsonButton).click();
        await expect(this.page.getByText('Template - 1: The "name"')).toBeVisible();
        await this.page.locator(this.importNameInput).click();
        await this.page.locator(this.importNameInput).fill(templateName);
        await this.page.locator(this.importJsonButton).click();
        
        if (importType === 'invalid') {
            await expect(this.page.locator(this.preLocator)).toContainText(this.templateImportErrorText);
        } else {
            await expect(this.page.getByText(this.templateImportSuccessMessage)).toBeVisible();
        }
    }

    /**
     * Verify imported template exists
     * @param {string} templateName - Name of the imported template
     */
    async verifyImportedTemplateExists(templateName) {
        await this.page.getByPlaceholder(this.templateSearchInput).click();
        await this.page.getByPlaceholder(this.templateSearchInput).fill(templateName);
        await expect(this.page.getByRole('cell', { name: templateName })).toBeVisible();
    }

    /**
     * Create template from JSON file
     * @param {string} filePath - Path to the JSON file
     * @param {string} templateName - Name for the template (will override the name in file)
     * @param {string} importType - Type of import: 'valid' or 'invalid'
     */
    async createTemplateFromFile(filePath, templateName, importType = 'valid') {
        await this.navigateToTemplates();
        await this.page.locator(this.templateImportButton).click();
        await this.page.locator(this.importFileInput).setInputFiles(filePath);
        await this.page.locator(this.importJsonButton).click();
        await expect(this.page.getByText('Template - 1: The "name"')).toBeVisible();
        await this.page.locator(this.importNameInput).fill(templateName);
        await this.page.locator(this.importJsonButton).click();

        if (importType === 'invalid') {
            await expect(this.page.locator(this.preLocator)).toContainText(this.templateImportErrorText);
        } else {
            await expect(this.page.getByText(this.templateImportSuccessMessage)).toBeVisible();
        }
    }

    /**
     * Search for templates by prefix
     * @param {string} searchText - Text to search for
     */
    async searchTemplates(searchText) {
        await this.page.getByPlaceholder(this.templateSearchInput).click();
        await this.page.getByPlaceholder(this.templateSearchInput).fill('');
        await this.page.getByPlaceholder(this.templateSearchInput).fill(searchText);
        await this.page.waitForTimeout(2000);
        testLogger.debug('Searched for templates', { searchText });
    }

    /**
     * Get all template names from current search results
     * @returns {Promise<string[]>} Array of template names
     */
    async getAllTemplateNames() {
        const templateNames = [];
        const deleteButtons = await this.page.locator('[data-test*="alert-template-list-"][data-test*="-delete-template"]').all();

        for (const button of deleteButtons) {
            const dataTest = await button.getAttribute('data-test');
            const match = dataTest.match(/alert-template-list-(.+)-delete-template/);
            if (match && match[1]) {
                templateNames.push(match[1]);
            }
        }

        testLogger.debug('Found template names', { templateNames, count: templateNames.length });
        return templateNames;
    }

    /**
     * Check if any templates exist in search results
     * @returns {Promise<boolean>}
     */
    async hasTemplates() {
        try {
            const noData = await this.page.getByText('No data available').isVisible({ timeout: 2000 });
            if (noData) {
                testLogger.debug('No templates found');
                return false;
            }
            return true;
        } catch (e) {
            return true;
        }
    }

    /**
     * Delete a single template by name
     * Handles case where template is in use by a destination
     * @param {string} templateName - Name of the template to delete
     */
    async deleteTemplateByName(templateName) {
        const deleteButton = this.page.locator(this.templateDeleteButton.replace('{templateName}', templateName));
        await deleteButton.waitFor({ state: 'visible', timeout: 5000 });
        await deleteButton.click();
        await this.page.locator(this.confirmButton).click();

        // Check if "Template is in use for destination" message appears
        try {
            const inUseMessage = await this.page.getByText(this.templateInUseMessage).textContent({ timeout: 3000 });

            // Extract destination name from message: "Template is in use for destination Telegram_alert"
            const match = inUseMessage.match(/destination\s+(.+)$/);
            if (match && match[1]) {
                const destinationName = match[1].trim();
                testLogger.warn('Template in use by destination, deleting destination first', { templateName, destinationName });

                // Close the error dialog
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);

                // Navigate to destinations and delete the destination
                await this.alertDestinationsPage.navigateToDestinations();
                await this.page.waitForTimeout(1000);
                await this.alertDestinationsPage.searchDestinations(destinationName);
                await this.alertDestinationsPage.deleteDestinationByName(destinationName);

                // Navigate back to templates
                await this.navigateToTemplates();
                await this.page.waitForTimeout(1000);

                // Search for the template again
                await this.searchTemplates(templateName);

                // Retry deleting the template
                await deleteButton.waitFor({ state: 'visible', timeout: 5000 });
                await deleteButton.click();
                await this.page.locator(this.confirmButton).click();
            }
        } catch (e) {
            // No "in use" message, deletion was successful
        }

        await this.page.waitForTimeout(1000);
        testLogger.debug('Deleted template', { templateName });
    }

    /**
     * Delete all templates matching a prefix
     * @param {string} prefix - Prefix to search for (e.g., "auto_playwright_template")
     */
    async deleteAllTemplatesWithPrefix(prefix) {
        testLogger.info('Starting to delete all templates with prefix', { prefix });

        // Navigate to templates page
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        let totalDeleted = 0;
        let previousCount = -1;

        // Keep looping until search returns no results
        while (true) {
            // Search for templates with the prefix
            await this.searchTemplates(prefix);
            await this.page.waitForTimeout(1500);

            // Check if any templates exist
            const hasAny = await this.hasTemplates();
            if (!hasAny) {
                testLogger.info('No templates found with prefix', { prefix, totalDeleted });
                break;
            }

            // Get all matching template names from current page of search results
            let templateNames = await this.getAllTemplateNames();
            const currentCount = templateNames.length;

            if (currentCount === 0) {
                testLogger.info('No template names found, stopping');
                break;
            }

            // Safety check: if count hasn't changed after deletion, something is wrong
            if (previousCount === currentCount && previousCount !== -1) {
                testLogger.error('Template count unchanged after deletion attempt - stopping to prevent infinite loop', {
                    currentCount,
                    templateNames,
                    totalDeleted
                });
                break;
            }
            previousCount = currentCount;

            testLogger.info('Found templates to delete', { count: currentCount, templateNames });

            // Delete only the FIRST template to handle cascade properly
            // After cascade (template→destination→alert), page state changes
            const templateName = templateNames[0];
            testLogger.debug('Deleting template (one at a time for cascade handling)', { templateName });

            try {
                await this.deleteTemplateByName(templateName);
                totalDeleted++;

                // After successful deletion with potential cascade, navigate back to templates
                await this.navigateToTemplates();
                await this.page.waitForTimeout(1000);
            } catch (error) {
                testLogger.error('Failed to delete template', { templateName, error: error.message });
                // Try to recover by navigating back to templates page
                await this.navigateToTemplates();
                await this.page.waitForTimeout(1000);
            }
        }

        testLogger.info('Completed deletion of all templates with prefix', { prefix, totalDeleted });
    }
} 