import { expect } from '@playwright/test';

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
    }

    async navigateToTemplates() {
        await this.page.locator(this.settingsMenuItem).click();
        await this.page.locator(this.templatesTab).click();
    }

    async createTemplate(templateName) {
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000); // Wait for page to load
        
        await this.page.locator(this.addTemplateButton).click();
        await this.page.locator(this.templateNameInput).click();
        await this.page.locator(this.templateNameInput).fill(templateName);
        
        const templateText = `{
  "text": "{alert_name} is active. This is the alert url {alert_url}. This alert template has been created using a playwright automation script"`;
        
        // Clear the template editor first
        await this.page.locator(".view-line").click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(1000);
        
        // Enter the template content all at once
        await this.page.keyboard.type(templateText);
        await this.page.waitForTimeout(1000);
        await this.page.locator(this.templateSubmitButton).click();
        
        // Wait for success message with explicit timeout
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

                // Verify the template exists in search results
                await expect(this.page.getByText('1-1 of')).toBeVisible({ timeout: 30000 });
                await expect(this.page.getByRole('cell', { name: templateName })).toBeVisible({ timeout: 30000 });
                
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
        try {
            // Try to delete the template
            await this.deleteTemplate(templateName);
            // If deletion succeeds, verify success message
            await expect(this.page.getByText(`Template ${templateName} deleted successfully`)).toBeVisible();
            console.log('Successfully deleted template:', templateName);
            return true;
        } catch (error) {
            // If deletion fails due to template being in use, verify the in-use message
            await this.verifyTemplateInUse(templateName, '');
            console.log('Successfully verified template in use message for template:', templateName);
            return false;
        }
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
            // Try to find the template
            await this.page.getByRole('cell', { name: templateName }).waitFor({ timeout: 2000 });
            console.log('Successfully verified template exists:', templateName);
        } catch (error) {
            throw new Error(`Template ${templateName} not found in the list`);
        }
    }
} 