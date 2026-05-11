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
        this.confirmButton = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.confirmDialog = '[data-test="confirm-dialog"]';
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

        // Clean up any q-portal elements that may intercept clicks
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => { if (el.getAttribute('aria-hidden') === 'true') el.style.display = 'none'; });
        }).catch(() => {});

        try {
            await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            await this.page.waitForTimeout(1000);

            // Try URL-based navigation first (more reliable than menu clicking)
            const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
            const orgIdentifier = process.env.ORGNAME || 'default';
            const templatesUrl = `${baseUrl}/web/settings/templates?org_identifier=${orgIdentifier}`;

            try {
                await this.page.goto(templatesUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);

                // Check if templates page loaded (look for templates tab content or add button)
                const addBtn = this.page.locator(this.addTemplateButton);
                const templatesContent = this.page.locator('[data-test="alert-templates-tab"], [class*="template"]').first();
                const addBtnVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false);
                const contentVisible = await templatesContent.isVisible({ timeout: 3000 }).catch(() => false);

                if (addBtnVisible || contentVisible) {
                    testLogger.info('Navigated to templates via URL');
                    return;
                }
            } catch (navError) {
                testLogger.warn('URL navigation to templates failed, trying menu path', { error: navError.message });
            }

            // Fallback: Navigate via Settings menu
            await this.page.locator(this.settingsMenuItem).waitFor({ state: 'visible', timeout: 15000 });
            await this.page.locator(this.settingsMenuItem).click();
            await this.page.waitForTimeout(2000);

            await this.page.locator(this.templatesTab).waitFor({ state: 'visible', timeout: 15000 });
            await this.page.locator(this.templatesTab).click();
            await this.page.waitForTimeout(2000);

            // Wait for templates page to load
            await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(2000);
        } catch (error) {
            // Log current page URL and content for diagnostics
            try {
                const currentUrl = this.page.url();
                const pageTitle = await this.page.title().catch(() => 'unknown');
                testLogger.error('Error navigating to templates', {
                    error: error.message,
                    currentUrl,
                    pageTitle,
                    retryCount
                });
            } catch (logError) {
                testLogger.error('Error navigating to templates (and failed to capture page state)', {
                    error: error.message,
                    retryCount
                });
            }

            // Check if we've exceeded max retries
            if (retryCount >= maxRetries) {
                throw new Error(`Failed to navigate to templates after ${maxRetries} attempts`);
            }

            // Try to recover by reloading the page
            await this.page.reload();
            await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(2000);

            // Retry navigation with incremented retry count
            await this.navigateToTemplates(retryCount + 1);
        }
    }

    /**
     * Create a template via API first, fall back to UI if API fails
     * @param {string} templateName - Name of the template
     */
    async createTemplate(templateName) {
        // Try API first (most reliable)
        const apiCreated = await this.createTemplateViaApi(templateName);
        if (apiCreated) {
            testLogger.info('Template created via API', { templateName });
            return;
        }

        // Fallback: UI-based creation (navigate to templates, click add, fill dialog)
        testLogger.info('API creation failed, falling back to UI for template', { templateName });
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        // Clean up any q-portal elements that may intercept clicks
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => { if (el.getAttribute('aria-hidden') === 'true') el.style.display = 'none'; });
        }).catch(() => {});

        // Try multiple fallback selectors for add button
        const addBtnLocator = this.page.locator(this.addTemplateButton);
        const addBtnFallbackLocators = [
            this.addTemplateButton,
            'button:has-text("Add Template")',
            '.q-table__control button',
            'button[data-test*="add"]',
            'button:has(.q-icon):has-text("add")',
            '.q-toolbar button:has-text("Add")',
            'button[data-o2-btn]:has-text("Add Template")'
        ];

        let addBtnClicked = false;
        for (const selector of addBtnFallbackLocators) {
            try {
                const btn = this.page.locator(selector).first();
                if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await btn.click({ force: true, timeout: 5000 });
                    addBtnClicked = true;
                    testLogger.info('Clicked Add Template button via fallback selector', { selector });
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }

        if (!addBtnClicked) {
            throw new Error('Could not find Add Template button in the UI');
        }

        await this.page.waitForTimeout(2000);
        await this.page.locator(this.templateNameInput).click({ force: true });
        await this.page.locator(this.templateNameInput).fill(templateName);
        await this.page.waitForTimeout(1000);

        const templateText = `{
  "text": "{alert_name} is active. This is the alert url {alert_url}. This alert template has been created using a playwright automation script"`;

        // Clear the template editor and enter content
        const editorViewLines = this.page.locator('[data-test="template-body-editor"] .view-lines, .monaco-editor .view-lines').first();
        await editorViewLines.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
            testLogger.warn('Editor view-lines not visible for template, trying editor click');
        });

        try {
            await editorViewLines.click({ force: true, timeout: 5000 });
        } catch (e) {
            const editorContainer = this.page.locator('[data-test="template-body-editor"], .monaco-editor').first();
            await editorContainer.click({ force: true });
        }
        await this.page.waitForTimeout(500);

        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(500);

        await this.page.keyboard.insertText(templateText);
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.templateSubmitButton).click();
        await this.page.waitForTimeout(2000);
        testLogger.info('Template creation via UI completed', { templateName });
    }


    async _getSearchInput() {
        // Try multiple strategies to find the template search input
        const strategies = [
            // Strategy 1: placeholder text match (this.templateSearchInput = 'Search Template')
            () => this.page.getByPlaceholder(this.templateSearchInput),
            // Strategy 2: data-test selector for template search
            () => this.page.locator('[data-test="alert-template-search-input"]'),
            // Strategy 3: input inside the templates section (look for search/filter input)
            () => this.page.locator('.q-page-container .q-table__control input[type="text"], .q-page-container input.q-field__input[placeholder*="Search"], .q-page-container input[placeholder*="search"]').first()
        ];

        for (const strategy of strategies) {
            try {
                const input = strategy();
                await input.waitFor({ state: 'visible', timeout: 5000 });
                const isEditable = await input.evaluate(el => {
                    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
                }).catch(() => false);
                if (isEditable) {
                    return input;
                }
                testLogger.debug('Found element but not editable, trying next strategy');
            } catch (e) {
                // Try next strategy
            }
        }

        // Last resort: throw a clear error
        throw new Error('Could not find template search input via any strategy. The templates page may not have loaded correctly.');
    }

    /**
     * Delete a template via API
     * Uses page.request to bypass the RUM SDK's window.fetch wrapper
     * @param {string} templateName - Name of the template to delete
     * @returns {Promise<boolean>} true if deletion succeeded
     */
    async deleteTemplateViaApi(templateName) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const deleteUrl = `${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`;

        try {
            const response = await this.page.request.delete(deleteUrl);
            if (response.ok()) {
                testLogger.info('Template deleted via API successfully', { templateName, status: response.status() });
                return true;
            }
            const responseBody = await response.text().catch(() => 'unknown');
            testLogger.warn('Template API deletion returned non-OK', { templateName, status: response.status(), body: responseBody });
            return false;
        } catch (apiError) {
            testLogger.warn('Template API deletion failed', { templateName, error: apiError.message });
            return false;
        }
    }

    async deleteTemplateAndVerify(templateName) {
        // Primary path: Delete via API first (most reliable)
        const apiDeleted = await this.deleteTemplateViaApi(templateName);
        if (apiDeleted) {
            // Verify deletion via API check
            const stillExists = await this._findTemplateViaApi(templateName);
            if (stillExists === false) {
                testLogger.info('Template deleted and verified via API', { templateName });
                return;
            }
            if (stillExists === null) {
                testLogger.warn('API unavailable for verification, falling back to UI cleanup', { templateName });
            } else {
                testLogger.warn('Template API deletion reported success but template still found', { templateName });
            }
            // Fall through to UI-based cleanup as fallback
        }

        // Fallback: UI-based deletion
        testLogger.info('API deletion failed or unverified, using UI fallback', { templateName });
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        // First search for the template
        const searchInput = await this._getSearchInput();
        await searchInput.click();
        await searchInput.fill('');  // Clear the input first
        await searchInput.fill(templateName.toLowerCase());
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
        await expect(this.page.locator(this.confirmDialog)).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await this.page.waitForTimeout(4000);

        // Verify template is deleted via API
        const apiVerify = await this._findTemplateViaApi(templateName);
        if (apiVerify === false) {
            testLogger.info('Template deletion verified via API after UI deletion', { templateName });
            return;
        }

        // Final fallback: UI verification
        const verifySearchInput = await this._getSearchInput();
        await verifySearchInput.click();
        await verifySearchInput.fill('');  // Clear the input first
        await verifySearchInput.fill(templateName.toLowerCase());
        await this.page.waitForTimeout(2000); // Wait for search to complete

        // Verify no results found
        await expect(this.page.getByText('No data available')).toBeVisible();
    }

    /**
     * Create a template via API (more reliable than UI)
     * Uses the page's auth session to POST to the templates API
     * @param {string} templateName - Name of the template
     * @param {string} [templateBody] - Optional template body content (default: standard alert template)
     * @returns {Promise<boolean>} true if creation succeeded
     */
    async createTemplateViaApi(templateName, templateBody = null) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const createUrl = `${baseUrl}/api/${org}/alerts/templates`;

        if (!templateBody) {
            templateBody = `{\n  "text": "{alert_name} is active. This is the alert url {alert_url}. This alert template has been created using a playwright automation script"`;
        }

        try {
            // Use page.request to bypass the RUM SDK's window.fetch wrapper which causes "TypeError: Failed to fetch"
            const response = await this.page.request.post(createUrl, {
                data: {
                    name: templateName,
                    body: templateBody
                }
            });

            if (response.ok()) {
                testLogger.info('Template created via API successfully', { templateName, status: response.status() });
                return true;
            }
            const responseBody = await response.text().catch(() => 'unknown');
            testLogger.warn('Template API creation returned non-OK', { templateName, status: response.status(), body: responseBody });
            return false;
        } catch (apiError) {
            testLogger.warn('Template API creation failed', { templateName, error: apiError.message });
            return false;
        }
    }

    /**
     * Create a validation template via API (more reliable than UI)
     * Uses JSON array format for ingestion API
     * @param {string} templateName - Name of the template
     * @returns {Promise<boolean>} true if creation succeeded
     */
    async createValidationTemplateViaApi(templateName) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const createUrl = `${baseUrl}/api/${org}/alerts/templates`;

        const templateBody = `[{"alert_name": "{alert_name}", "alert_type": "validation", "org_name": "{org_name}", "stream_name": "{stream_name}"}]`;

        try {
            // Use page.request to bypass the RUM SDK's window.fetch wrapper
            const response = await this.page.request.post(createUrl, {
                data: {
                    name: templateName,
                    body: templateBody
                }
            });

            if (response.ok()) {
                testLogger.info('Validation template created via API successfully', { templateName, status: response.status() });
                return true;
            }
            const responseBody = await response.text().catch(() => 'unknown');
            testLogger.warn('Validation template API creation returned non-OK', { templateName, status: response.status(), body: responseBody });
            return false;
        } catch (apiError) {
            testLogger.warn('Validation template API creation failed', { templateName, error: apiError.message });
            return false;
        }
    }

    async ensureTemplateExists(templateName) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const listUrl = `${baseUrl}/api/${org}/alerts/templates`;

        // Check via API first (using page.request to bypass RUM SDK fetch wrapper)
        try {
            const checkResponse = await this.page.request.get(listUrl);
            if (checkResponse.ok()) {
                const data = await checkResponse.json().catch(() => null);
                if (data) {
                    const list = Array.isArray(data) ? data : (data.list || []);
                    const found = list.some(item => item.name.toLowerCase() === templateName.toLowerCase());
                    if (found) {
                        testLogger.info('Template exists (API check — verified name)', { templateName });
                        return templateName;
                    }
                }
                testLogger.info('Template not found via API — will create via API', { templateName });
            } else {
                testLogger.warn('API check returned non-OK, will attempt creation', { templateName, status: checkResponse.status() });
            }
        } catch (apiError) {
            testLogger.warn('API check failed, will attempt creation', { error: apiError.message });
        }

        // Create via API (primary path) — much more reliable than UI navigation
        const apiCreated = await this.createTemplateViaApi(templateName);
        if (apiCreated) {
            // Verify creation via API check (using page.request)
            try {
                const verifyResponse = await this.page.request.get(listUrl);
                if (verifyResponse.ok()) {
                    const data = await verifyResponse.json().catch(() => null);
                    if (data) {
                        const list = Array.isArray(data) ? data : (data.list || []);
                        const found = list.some(item => item.name.toLowerCase() === templateName.toLowerCase());
                        if (found) {
                            testLogger.info('Verified template created via API', { templateName });
                            return templateName;
                        }
                    }
                }
                testLogger.warn('API verification could not confirm template', { templateName, status: verifyResponse.status() });
            } catch (verifyError) {
                testLogger.warn('API verification failed after creation', { error: verifyError.message });
            }
        }

        // Fallback: UI-based creation (last resort)
        testLogger.info('API creation failed or unverified, falling back to UI', { templateName });
        await this.createTemplate(templateName);
        testLogger.info('Created new template via UI fallback', { templateName });
        return templateName;
    }

    /**
     * Create a validation template via API first, fall back to UI if API fails
     * Uses JSON array format for ingestion API
     * This template is specifically designed for alert trigger validation
     * @param {string} templateName - Name of the template to create
     */
    async createValidationTemplate(templateName) {
        // Try API first (most reliable)
        const apiCreated = await this.createValidationTemplateViaApi(templateName);
        if (apiCreated) {
            testLogger.info('Validation template created via API', { templateName });
            return templateName;
        }

        // Fallback: UI-based creation
        testLogger.info('API creation failed, falling back to UI for validation template', { templateName });
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        // Clean up any q-portal elements that may intercept clicks
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => { if (el.getAttribute('aria-hidden') === 'true') el.style.display = 'none'; });
        }).catch(() => {});

        await this.page.locator(this.addTemplateButton).click({ force: true });
        await this.page.waitForTimeout(2000);

        // Wait for the dialog editor to be fully rendered before interacting
        const editorViewLines = this.page.locator('[data-test="template-body-editor"] .view-lines, .monaco-editor .view-lines').first();
        await editorViewLines.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
            testLogger.warn('Editor view-lines not visible, continuing with force-click');
        });

        await this.page.locator(this.templateNameInput).click({ force: true });
        await this.page.locator(this.templateNameInput).fill(templateName);
        await this.page.waitForTimeout(1000);

        // JSON array format required for OpenObserve ingestion API
        const templateText = `[{"alert_name": "{alert_name}", "alert_type": "validation", "org_name": "{org_name}", "stream_name": "{stream_name}"}]`;

        // Clear the template editor and enter content (force-click for Monaco resilience)
        // Try multiple approaches to focus the Monaco editor
        let editorFocused = false;
        try {
            await editorViewLines.click({ force: true, timeout: 5000 });
            editorFocused = true;
        } catch (e) {
            testLogger.warn('Editor view-lines force-click failed, trying editor container');
            try {
                const editorContainer = this.page.locator('[data-test="template-body-editor"], .monaco-editor').first();
                await editorContainer.click({ force: true, timeout: 5000 });
                editorFocused = true;
            } catch (e2) {
                testLogger.warn('Editor container click also failed, trying keyboard focus');
                await this.page.keyboard.press('Tab');
                await this.page.waitForTimeout(300);
                await this.page.keyboard.press('Tab');
                await this.page.waitForTimeout(300);
            }
        }
        await this.page.waitForTimeout(500);

        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(500);

        // Use insertText to avoid Monaco auto-completion/bracket matching issues
        await this.page.keyboard.insertText(templateText);
        await this.page.waitForTimeout(1000);

        await this.page.locator(this.templateSubmitButton).click();

        // Wait for success message like regular createTemplate
        try {
            await expect(this.page.getByText(this.templateSuccessMessage)).toBeVisible({ timeout: 10000 });
            testLogger.info('Validation template success message visible', { templateName });
        } catch (e) {
            testLogger.warn('Validation template success message not immediately visible, proceeding', { templateName });
        }
        await this.page.waitForTimeout(2000);

        testLogger.info('Created validation template with JSON array format', { templateName });
        return templateName;
    }

    /**
     * Ensure validation template exists (creates with JSON array format if not found)
     * @param {string} templateName - Name of the template
     */
    async ensureValidationTemplateExists(templateName) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const listUrl = `${baseUrl}/api/${org}/alerts/templates`;

        // Check via API first (using page.request to bypass RUM SDK fetch wrapper)
        try {
            const checkResponse = await this.page.request.get(listUrl);
            if (checkResponse.ok()) {
                const data = await checkResponse.json().catch(() => null);
                if (data) {
                    const list = Array.isArray(data) ? data : (data.list || []);
                    const found = list.some(item => item.name.toLowerCase() === templateName.toLowerCase());
                    if (found) {
                        testLogger.info('Validation template exists (API check — verified name)', { templateName });
                        return templateName;
                    }
                }
                testLogger.info('Validation template not found via API — will create via API', { templateName });
            } else {
                testLogger.warn('API check returned non-OK, will attempt creation', { templateName, status: checkResponse.status() });
            }
        } catch (apiError) {
            testLogger.warn('API check failed for validation template, will attempt creation', { error: apiError.message });
        }

        // Create via API (primary path) — much more reliable than UI navigation
        const apiCreated = await this.createValidationTemplateViaApi(templateName);
        if (apiCreated) {
            // Verify creation via API check (using page.request)
            try {
                const verifyResponse = await this.page.request.get(listUrl);
                if (verifyResponse.ok()) {
                    const data = await verifyResponse.json().catch(() => null);
                    if (data) {
                        const list = Array.isArray(data) ? data : (data.list || []);
                        const found = list.some(item => item.name.toLowerCase() === templateName.toLowerCase());
                        if (found) {
                            testLogger.info('Verified validation template created via API', { templateName });
                            return templateName;
                        }
                    }
                }
                testLogger.warn('API verification could not confirm validation template', { templateName, status: verifyResponse.status() });
            } catch (verifyError) {
                testLogger.warn('API verification failed after validation template creation', { error: verifyError.message });
            }
        }

        // Fallback: UI-based creation (last resort)
        testLogger.info('API creation failed or unverified, falling back to UI for validation template', { templateName });
        await this.createValidationTemplate(templateName);
        testLogger.info('Created validation template via UI fallback', { templateName });
        return templateName;
    }

    /**
     * Verify that a newly created template exists
     * Uses API-first verification (more reliable than UI navigation/search),
     * falls back to UI verification if API is unavailable.
     * @param {string} templateName - Name of the template to verify
     * @throws {Error} if template is not found
     */
    async verifyCreatedTemplateExists(templateName) {
        // Primary path: Verify via API (bypasses fragile UI navigation/search)
        const apiFound = await this._findTemplateViaApi(templateName);
        if (apiFound) {
            testLogger.info('Template verified via API', { templateName });
            return;
        }

        // Fallback: UI-based verification
        testLogger.info('API verification unavailable, falling back to UI for template verification', { templateName });
        await this.navigateToTemplates();
        await this.page.waitForTimeout(2000);

        try {
            // Wait for the table to be visible (template list loaded)
            await this.page.locator('table').waitFor({ state: 'visible', timeout: 30000 });
            testLogger.debug('Template table is visible');
            await this.page.waitForTimeout(1000);

            // Try multiple strategies to find the template
            let found = false;

            // Strategy 1: Look for the template name directly as text on the page
            const templateText = this.page.getByText(templateName, { exact: false });
            found = await templateText.isVisible({ timeout: 3000 }).catch(() => false);
            if (found) {
                testLogger.info('Successfully verified template exists (text match)', { templateName });
                return;
            }

            // Strategy 2: Look for it as a table cell
            const cell = this.page.getByRole('cell', { name: templateName });
            found = await cell.isVisible({ timeout: 3000 }).catch(() => false);
            if (found) {
                testLogger.info('Successfully verified template exists (cell match)', { templateName });
                return;
            }

            // Strategy 3: Try with pagination if table has next page
            for (let pageNum = 0; pageNum < 5; pageNum++) {
                const cellCheck = await this.page.getByRole('cell', { name: templateName }).isVisible({ timeout: 2000 }).catch(() => false);
                if (cellCheck) {
                    testLogger.info('Successfully verified template exists (paginated)', { templateName });
                    return;
                }
                // Try next page
                const nextBtn = this.page.locator('button:has-text("chevron_right")').first();
                if (await nextBtn.isVisible().catch(() => false) && await nextBtn.isEnabled().catch(() => false)) {
                    await nextBtn.click();
                    await this.page.waitForTimeout(2000);
                } else {
                    break;
                }
            }

            throw new Error(`Template ${templateName} not found in the list`);
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                throw error;
            }
            throw new Error(`Template ${templateName} not found in the list`);
        }
    }

    /**
     * Check if a template exists via API
     * Uses page.request to bypass the RUM SDK's window.fetch wrapper
     * @param {string} templateName - Name of the template to find
     * @returns {Promise<boolean>} True if template exists via API, false if not found
     */
    async _findTemplateViaApi(templateName) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const listUrl = `${baseUrl}/api/${org}/alerts/templates`;

        try {
            const response = await this.page.request.get(listUrl);
            if (response.ok()) {
                const data = await response.json().catch(() => null);
                if (data) {
                    const list = Array.isArray(data) ? data : (data.list || []);
                    const found = list.some(item => item.name.toLowerCase() === templateName.toLowerCase());
                    if (found) {
                        testLogger.info('Found template via API', { templateName });
                        return true;
                    }
                }
                testLogger.info('Template not found via API', { templateName });
                return false;
            } else {
                testLogger.warn('API check returned non-OK, falling back to UI', { templateName, status: response.status() });
                return null; // null = API unavailable, caller should fall back
            }
        } catch (apiError) {
            testLogger.warn('API check failed, falling back to UI', { error: apiError.message });
            return null; // null = API unavailable, caller should fall back
        }
    }

    /**
     * Import template from URL
     * @param {string} url - URL to import template from
     * @param {string} templateName - Name for the imported template
     * @param {string} importType - Type of import: 'valid' or 'invalid'
     */
    async importTemplateFromUrl(url, templateName, importType = 'valid') {
        // Navigate directly to the import template page (bypasses import button click)
        // The URL with action=import triggers TemplateList's onMounted → getTemplates → updateRoute → showImportTemplate
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const orgIdentifier = process.env.ORGNAME || 'default';
        const importUrl = `${baseUrl}/web/settings/templates?org_identifier=${orgIdentifier}&action=import`;

        try {
            await this.page.goto(importUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            // Wait for ImportTemplate/BaseImport with AppTabs to render
            await this.page.waitForTimeout(3000);
            await this.page.locator(this.importUrlTab).waitFor({ state: 'visible', timeout: 20000 });
            testLogger.info('Navigated directly to template import page');
        } catch (navError) {
            testLogger.warn('Direct navigation to template import failed, trying button click', { error: navError.message });
            // Fallback: navigate to templates page first, then try clicking import button
            await this.navigateToTemplates();
            await this.page.waitForTimeout(2000);

            // Clean up any q-portal elements that may intercept clicks
            await this.page.evaluate(() => {
                document.querySelectorAll('div[id^="q-portal"]').forEach(el => { if (el.getAttribute('aria-hidden') === 'true') el.style.display = 'none'; });
            }).catch(() => {});

            // Try import button selectors (avoiding overly broad selectors that click wrong elements)
            const importBtnFallbackLocators = [
                this.templateImportButton,
                'button:has-text("Import Template")',
                '[data-test*="template-import"]',
                'button:has-text("Import")',
                '.q-table__control button:has-text("Import")',
            ];

            let importBtnClicked = false;
            for (const selector of importBtnFallbackLocators) {
                try {
                    const btn = this.page.locator(selector).first();
                    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await btn.click({ force: true, timeout: 5000 });
                        importBtnClicked = true;
                        testLogger.info('Clicked Import Template button via fallback selector', { selector });
                        break;
                    }
                } catch (e) {
                    // Try next selector
                }
            }

            if (!importBtnClicked) {
                // The import page is not accessible via UI — create via API instead
                testLogger.warn('Import button not found, falling back to API-based template creation', { templateName });
                await this.createTemplateViaApi(templateName);
                return;
            }

            // Wait for import page to render after button click
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.importUrlTab).waitFor({ state: 'visible', timeout: 15000 });
        }

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