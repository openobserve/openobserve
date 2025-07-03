import { expect, test } from '@playwright/test';
import { test as base } from '@playwright/test';
import fs from 'fs';

export class AlertTemplatesPage {
    constructor(page) {
        this.page = page;
        
        // Navigation locators
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.templatesTab = '[data-test="alert-templates-tab"]';
        
        // Template creation locators
        this.addTemplateButton = '[data-test="alert-template-list-add-alert-btn"]';
        this.templateNameInput = '[data-test="add-template-name-input"]';
        this.templateEditor = '[data-test="add-template-editor"]';
        this.templateSubmitButton = '[data-test="add-template-submit-btn"]';
        this.templateSuccessMessage = 'Template Saved Successfully.';
        
        // Template management locators
        this.templateSearchInput = '[data-test="template-list-search-input"]';
        this.templateDeleteButton = '[data-test="alert-template-list-{templateName}-delete-template"]';
        this.templateUpdateButton = '[data-test="alert-template-list-{templateName}-update-template"]';
        this.deleteConfirmText = 'Delete Template';
        this.confirmButton = '[data-test="confirm-button"]';
        this.templateDeletedMessage = 'Template %s deleted successfully';
        this.templateInUseMessage = 'Template is in use for destination {destinationName}';
        
        // Template import locators
        this.templateImportButton = '[data-test="template-import"]';
        this.importUrlTab = '[data-test="tab-import_json_url"]';
        this.importUrlInput = '[data-test="template-import-url-input"]';
        this.importJsonButton = '[data-test="template-import-json-btn"]';
        this.importNameInput = '[data-test="template-import-name-input"]';
        this.importFileInput = '[data-test="template-import-json-file-input"]';
        this.templateImportSuccessMessage = 'Successfully imported';
        this.templateImportErrorText = 'Template - 1: "email template" creation failed --> Reason: Template name cannot contain \':\', \'#\', \'?\', \'&\', \'%\', \'/\', quotes and space characters';
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
            console.error('Error navigating to templates:', error);
            
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
        await this.page.locator(".cm-content").click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(1000);
        
        // Enter the template content all at once
        await this.page.keyboard.type(templateText);
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.templateSubmitButton).click();
        await expect(this.page.getByText(this.templateSuccessMessage)).toBeVisible({ timeout: 30000 });
        
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
                await this.page.locator('table').waitFor({ state: 'visible', timeout: 10000 });
                
                // Use search to find the template
                await this.page.locator(this.templateSearchInput).click();
                await this.page.locator(this.templateSearchInput).fill(templateName);
                await this.page.waitForTimeout(1000);

                // Verify the template exists in search results using waitFor
                await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });
                
                console.log('Successfully verified template exists:', templateName);
                return;
            } catch (error) {
                attempts++;
                if (attempts === maxAttempts) {
                    throw new Error(`Template ${templateName} not found after ${maxAttempts} attempts`);
                }
                console.log(`Attempt ${attempts}: Template not found, retrying...`);
                await this.page.reload();
                await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async editTemplate(templateName) {
        const updatedContent = {
            text: "{alert_name} is active. This is the alert url {alert_url}. This alert template has been created using a playwright automation script. This has also been edited"
        };
        
        await this.page.locator(this.templateUpdateButton.replace('{templateName}', templateName)).click();
        await this.page.keyboard.type(JSON.stringify(updatedContent, null, 2));
        await this.page.locator(this.templateSubmitButton).click();
        await expect(this.page.getByText(this.templateSuccessMessage)).toBeVisible();
    }

    async searchAndVerifyTemplate(templateName) {
        await this.page.locator(this.templateSearchInput).click();
        await this.page.locator(this.templateSearchInput).fill(templateName);
        await expect(this.page.getByText('1-1 of')).toBeVisible();
        await expect(this.page.getByRole('cell', { name: templateName })).toBeVisible();
    }

    async deleteTemplate(templateName) {
        await this.page.locator(this.templateDeleteButton.replace('{templateName}', templateName)).click();
        await expect(this.page.getByText(this.deleteConfirmText, { exact: true })).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.templateDeletedMessage.replace('%s', templateName))).toBeVisible();
    }

    async verifyTemplateInUse(templateName, destinationName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000); // Wait for page to load

        // Click delete button for the template
        await this.page.locator(this.templateDeleteButton.replace('{templateName}', templateName)).click();
        
        // First verify and click the delete confirmation dialog
        await expect(this.page.getByText(this.deleteConfirmText, { exact: true })).toBeVisible();
        await this.page.waitForSelector(this.confirmButton);
        await this.page.locator(this.confirmButton).click();
        
        // Then verify the template in use message
        const expectedMessage = this.templateInUseMessage.replace('{destinationName}', destinationName);
        await expect(this.page.getByText(expectedMessage)).toBeVisible();
    }

    async deleteTemplateAndVerify(templateName) {
        // First search for the template
        await this.page.locator(this.templateSearchInput).click();
        await this.page.locator(this.templateSearchInput).fill('');  // Clear the input first
        await this.page.locator(this.templateSearchInput).fill(templateName.toLowerCase());
        await this.page.waitForTimeout(2000); // Wait for search to complete
        
        // Wait for either search results or no data message
        await Promise.race([
            this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 }),
            this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
        ]).catch(() => {
            console.log('Neither table nor no data message found after search, continuing...');
        });

        // Verify template exists before deletion
        await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });

        // Click delete button using the correct locator
        await this.page.locator(this.templateDeleteButton.replace('{templateName}', templateName)).click();
        await expect(this.page.getByText(this.deleteConfirmText, { exact: true })).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.templateDeletedMessage.replace('%s', templateName))).toBeVisible();
        await this.page.waitForTimeout(2000);

        // Verify template is deleted
        await this.page.locator(this.templateSearchInput).click();
        await this.page.locator(this.templateSearchInput).fill('');  // Clear the input first
        await this.page.locator(this.templateSearchInput).fill(templateName.toLowerCase());
        await this.page.waitForTimeout(2000); // Wait for search to complete
        
        // Verify no results found
        await expect(this.page.getByText('No data available')).toBeVisible();
    }

    async ensureTemplateExists(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        try {
            // Try to find the template directly first
            await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });
            console.log('Found existing template:', templateName);
            return templateName;
        } catch (error) {
            // If not found, create new template
            await this.createTemplate(templateName);
            console.log('Created new template:', templateName);
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
            await this.page.locator(this.templateSearchInput).click();
            await this.page.locator(this.templateSearchInput).fill('');  // Clear the input first
            await this.page.locator(this.templateSearchInput).fill(templateName.toLowerCase());
            await this.page.waitForTimeout(2000); // Wait for search to complete
            
            // Wait for either search results or no data message
            await Promise.race([
                this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 }),
                this.page.getByText('No data available').waitFor({ state: 'visible', timeout: 30000 })
            ]).catch(() => {
                console.log('Neither table nor no data message found after search, continuing...');
            });

            // Try to find the template
            await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });
            console.log('Successfully verified template exists:', templateName);
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
            await expect(this.page.locator('pre')).toContainText(this.templateImportErrorText);
        } else {
            await expect(this.page.getByText(this.templateImportSuccessMessage)).toBeVisible();
        }
    }

    /**
     * Verify imported template exists
     * @param {string} templateName - Name of the imported template
     */
    async verifyImportedTemplateExists(templateName) {
        await this.page.locator(this.templateSearchInput).click();
        await this.page.locator(this.templateSearchInput).fill(templateName);
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
            await expect(this.page.locator('pre')).toContainText(this.templateImportErrorText);
        } else {
            await expect(this.page.getByText(this.templateImportSuccessMessage)).toBeVisible();
        }
    }
} 