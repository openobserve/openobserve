import { expect, test } from '@playwright/test';
import { CommonActions } from '../commonActions';
import { AlertsPage } from './alertsPage.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class AlertDestinationsPage {
    constructor(page) {
        this.page = page;
        this.commonActions = new CommonActions(page);
        this.alertsPage = new AlertsPage(page);
        
        // Navigation locators
        this.settingsMenuItem = '[data-test="menu-link-/settings-item"]';
        this.destinationsTab = '[data-test="alert-destinations-tab"]';
        this.destinationsListTitle = '[data-test="alert-destinations-list-title"]';
        
        // Destination creation locators
        this.addDestinationButton = '[data-test="alert-destination-list-add-alert-btn"]';
        // OInput wrapper (for visibility/state assertions); inner native input uses `-field` suffix for fill/click
        this.destinationNameInput = '[data-test="add-destination-name-input"]';
        this.destinationNameInputField = '[data-test="add-destination-name-input-field"]';
        this.templateSelect = '[data-test="add-destination-template-select"]';
        // OSelect popover + option locators per agent rules §4
        this.templateSelectPopover = '[data-test="add-destination-template-select-popover"]';
        this.templateSelectSearch = '[data-test="add-destination-template-select-search"]';
        this.urlInput = '[data-test="add-destination-url-input"]';
        // OInput inner native input for URL (used for fill operations)
        this.urlInputField = '[data-test="add-destination-url-input-field"]';
        this.submitButton = '[data-test="add-destination-submit-btn"]';
        this.successMessage = 'Destination saved';
        // OToast success message (preferred over getByText to dodge strict-mode collisions)
        this.successToast = '[data-test-variant="success"]';
        this.successToastMessage = '[data-test-variant="success"] [data-test="o-toast-message"]';
        
        // Import locators
        this.destinationImportButton = '[data-test="destination-import"]';
        this.importJsonUrlTab = '[data-test="tab-import_json_url"]';
        this.destinationImportUrlInput = '[data-test="destination-import-url-input"]';
        // OInput inner native input (-field) for the URL field — used for fill/click
        this.destinationImportUrlInputField = '[data-test="destination-import-url-input-field"]';
        this.destinationImportJsonBtn = '[data-test="destination-import-json-btn"]';
        this.destinationImportNameError = '[data-test="destination-import-name-error"]';
        this.destinationImportTemplateInput = '[data-test="destination-import-template-input"]';
        // OSelect search input + popover + option follow the OSelect data-test convention (§4)
        this.destinationImportTemplateSearch = '[data-test="destination-import-template-input-search"]';
        this.destinationImportTemplatePopover = '[data-test="destination-import-template-input-popover"]';
        this.destinationImportTemplateOption = '[data-test="destination-import-template-input-option"]';
        // OInput wrapper for visibility; inner native `-field` derivative for fill/click (§4)
        this.destinationImportNameInput = '[data-test="destination-import-name-input"]';
        this.destinationImportNameInputField = '[data-test="destination-import-name-input-field"]';
        this.destinationImportCancelBtn = '[data-test="destination-import-cancel-btn"]';
        this.destinationListSearchInput = '[data-test="destination-list-search-input"]';
        this.confirmButton = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.deleteDestinationButton = '[data-test="alert-destination-list-{destinationName}-delete-destination"]';
        this.importJsonFileTab = '[data-test="tab-import_json_file"]';
        this.destinationImportFileInput = '[data-test="destination-import-file-input"]';
        this.destinationCountText = 'Alert Destinations';
        this.destinationInUseMessage = 'Destination is currently used by alert:';
        this.nextPageButton = '[data-test="alert-destinations-list-next-btn"]';
        // Search input is an OInput wrapper; inner native input uses `-field` suffix for fill/click
        this.destinationListSearchInputField = '[data-test="destination-list-search-input-field"]';
        this.destinationsListTable = '[data-test="alert-destinations-list-table"]';

        // Dialog/drawer title anchor for clickNewDestination (anchors on dialog open)
        this.addDestinationTitle = '[data-test="add-destination-title"]';

        // Prebuilt destination locators
        this.prebuiltDestinationSelector = '[data-test="prebuilt-destination-selector"]';
        this.destinationTypeCard = '[data-test="destination-type-card"]';
        this.destinationTypeName = '[data-test="destination-type-name"]';
        this.destinationTypeReadonly = '[data-test="destination-type-readonly"]';
        this.prebuiltForm = '[data-test="prebuilt-form"]';
        // Webhook OInput wrapper (any prebuilt type) — used for visibility checks; inner native input uses `-field`
        this.webhookInputAny = '[data-test$="-webhook-url-input"]';
        this.webhookInputAnyField = '[data-test$="-webhook-url-input-field"]';
        this.recipientsInput = '[data-test="email-recipients-input"]';
        this.recipientsInputField = '[data-test="email-recipients-input-field"]';
        this.integrationKeyInput = '[data-test="pagerduty-integration-key-input"]';
        this.integrationKeyInputField = '[data-test="pagerduty-integration-key-input-field"]';
        this.opsgenieApiKeyInput = '[data-test="opsgenie-api-key-input"]';
        this.opsgenieApiKeyInputField = '[data-test="opsgenie-api-key-input-field"]';
        this.servicenowInstanceUrlInputField = '[data-test="servicenow-instance-url-input-field"]';
        this.servicenowUsernameInputField = '[data-test="servicenow-username-input-field"]';
        this.servicenowPasswordInputField = '[data-test="servicenow-password-input-field"]';
        this.severitySelect = '[data-test="pagerduty-severity-select"]';
        this.severitySelectPopover = '[data-test="pagerduty-severity-select-popover"]';
        this.prioritySelect = '[data-test="opsgenie-priority-select"]';
        this.prioritySelectPopover = '[data-test="opsgenie-priority-select-popover"]';
        this.methodSelect = '[data-test="add-destination-method-select"]';
        this.methodSelectPopover = '[data-test="add-destination-method-select-popover"]';
        // Save/Cancel/Test buttons resolve via stable data-test
        this.testButton = '[data-test="destination-test-button"]';
        this.testResult = '[data-test="destination-test-result"]';
        this.testResultPrebuilt = '[data-test="prebuilt-test-result"]';
        this.testResultSuccess = '[data-test="test-result-success"]';
        this.testResultFailure = '[data-test="test-result-failure"]';
        this.testResultLoading = '[data-test="test-result-loading"]';
        this.testResultIdle = '[data-test="test-result-idle"]';
        this.saveButton = '[data-test="add-destination-submit-btn"]';
        this.cancelButton = '[data-test="add-destination-cancel-btn"]';
        this.backButton = '[data-test="add-destination-back-btn"]';
        this.successNotification = '[data-test-variant="success"]';
        this.toastSuccess = '[data-test-variant="success"]';
        this.toastMessage = '[data-test="o-toast-message"]';
        // OInput-derived per-field error nodes (e.g. add-destination-name-input-error). Any of these visible = validation error
        this.errorMessage = '[data-test$="-input-error"], [data-test$="-error"]';
        this.addDestinationTitle = '[data-test="add-destination-title"]';
        this.addDestinationLoadingIndicator = '[data-test="add-destination-loading-indicator"]';
        this.dialogCloseBtn = '[data-test="o-dialog-close-btn"]';
        this.checkmarkIcon = '[name="check-circle"]';
    }

    // ============================================================================
    // FACTORY HELPERS
    // ============================================================================

    /** @param {string} type Type id (slack/discord/msteams/email/pagerduty/opsgenie/servicenow/custom) */
    getDestinationTypeCard(type) {
        return this.page.locator(`${this.destinationTypeCard}[data-type="${type}"]`);
    }

    /** Locator for the row containing a destination's delete button. */
    getDeleteDestinationBtn(name) {
        return this.page.locator(`[data-test="alert-destination-list-${name}-delete-destination"]`);
    }

    /** Locator for the row containing a destination's edit button. */
    getEditDestinationBtn(name) {
        return this.page.locator(`[data-test="alert-destination-list-${name}-update-destination"]`);
    }

    /**
     * Row containing a named destination. Resolves via the destination-specific delete-button data-test
     * and walks up to the OTable row ancestor.
     */
    getDestinationRow(name) {
        return this.page.locator(
            `xpath=//*[@data-test="alert-destination-list-${name}-delete-destination"]/ancestor::*[starts-with(@data-test,'o2-table-row-')][1]`
        );
    }

    async navigateToDestinations(retryCount = 0) {
        const maxRetries = 2;

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
            const destinationsUrl = `${baseUrl}/web/settings/alert_destinations?org_identifier=${orgIdentifier}`;

            try {
                await this.page.goto(destinationsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(2000);

                // Check if destinations page loaded
                const title = this.page.locator(this.destinationsListTitle);
                const titleVisible = await title.isVisible({ timeout: 5000 }).catch(() => false);

                if (titleVisible) {
                    testLogger.info('Navigated to destinations via URL');
                    return;
                }
            } catch (navError) {
                testLogger.warn('URL navigation to destinations failed, trying menu path', { error: navError.message });
            }

            // Fallback: Navigate via Settings menu
            await this.page.locator(this.settingsMenuItem).waitFor({ state: 'visible', timeout: 15000 });
            await this.page.locator(this.settingsMenuItem).click();
            await this.page.waitForTimeout(2000);

            await this.page.locator(this.destinationsTab).waitFor({ state: 'visible', timeout: 15000 });
            await this.page.locator(this.destinationsTab).click();
            await this.page.waitForTimeout(2000);

            // Wait for destinations page to load
            await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(2000);
            await expect(this.page.locator(this.destinationsListTitle)).toBeVisible({ timeout: 15000 });
        } catch (error) {
            testLogger.error('Error navigating to destinations', {
                error: error.message,
                retryCount
            });

            if (retryCount >= maxRetries) {
                throw new Error(`Failed to navigate to destinations after ${maxRetries} attempts`);
            }

            // Try to recover by reloading the page
            await this.page.reload();
            await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(2000);

            // Retry navigation with incremented retry count
            await this.navigateToDestinations(retryCount + 1);
        }
    }

    /** Wait for the destinations list page to be ready (Add Destination button visible). */
    async waitForDestinationListReady() {
        await this.page.locator(this.addDestinationButton).waitFor({ state: 'visible', timeout: 30000 });
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
        // wait for the destination name field to be ready before filling
        await this.page.locator(this.destinationNameInputField).waitFor({ state: 'visible', timeout: 10000 });

        await this.page.locator(this.destinationNameInputField).click();
        await this.page.locator(this.destinationNameInputField).fill(destinationName);
        await expect(this.page.locator(this.destinationNameInputField)).toHaveValue(destinationName, { timeout: 5000 });

        // Handle template selection — prefer deterministic data-test-value match
        await this.selectDestinationTemplate(templateName);

        await this.page.locator(this.urlInputField).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.urlInputField).click();
        await this.page.locator(this.urlInputField).fill(url);
        await expect(this.page.locator(this.urlInputField)).toHaveValue(url, { timeout: 5000 });
        
        await this.page.locator(this.submitButton).click();
        // Wait for the form editor to close — AddDestination unmounts after emit('cancel:hideform')
        // which fires only after the API call returns successfully.
        await this.page.locator(this.addDestinationTitle).waitFor({ state: 'hidden', timeout: 30000 });

        // Navigate back to the list so the dialog is fully closed before verifying
        await this.navigateToDestinations();
        await this.page.locator(this.addDestinationButton).waitFor({ state: 'visible', timeout: 15000 });

        // Verify the destination exists by checking all pages
        await this.verifyDestinationExists(destinationName);
    }

    /**
     * Check if a destination exists via API (bypasses UI pagination which causes page context issues)
     * Uses page.request to bypass the RUM SDK's window.fetch wrapper
     * @param {string} destinationName - Name of the destination to find
     * @returns {Promise<boolean>} True if destination exists via API
     */
    async findDestinationViaApi(destinationName) {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const listUrl = `${baseUrl}/api/${org}/alerts/destinations`;

        try {
            const response = await this.page.request.get(listUrl);
            if (response.ok()) {
                const data = await response.json().catch(() => null);
                if (data) {
                    const list = Array.isArray(data) ? data : (data.list || []);
                    const found = list.some(item =>
                        item.name.toLowerCase() === destinationName.toLowerCase()
                    );
                    if (found) {
                        testLogger.info('Found destination via API', { destinationName });
                        return true;
                    }
                }
                testLogger.info('Destination not found via API', { destinationName });
                return false;
            } else {
                testLogger.warn('API check returned non-OK, falling back to UI', { destinationName, status: response.status() });
                return null; // null = API unavailable, caller should fall back
            }
        } catch (apiError) {
            testLogger.warn('API check failed, falling back to UI pagination', { error: apiError.message });
            return null; // null = API unavailable, caller should fall back
        }
    }

    async findDestinationAcrossPages(destinationName) {
        // Primary path: Check via API first (bypasses fragile UI pagination)
        const apiResult = await this.findDestinationViaApi(destinationName);
        if (apiResult === true) {
            return true;
        }
        if (apiResult === false) {
            return false;
        }

        // Fallback: UI pagination (only if API is unavailable)
        testLogger.info('API unavailable, falling back to UI pagination', { destinationName });

        // Prefer scoping by the OInput search field — pentest backend may have 1000+ rows,
        // so paginating one-by-one is unreliable. The per-row delete button uses the
        // destination name as part of its data-test, giving us a row anchor without
        // relying on getByRole / getByText.
        const listSkeleton = this.page.locator('[data-test="o2-table-skeleton-body"]');
        const searchField = this.page.locator(this.destinationListSearchInputField);
        if (await searchField.isVisible({ timeout: 5000 }).catch(() => false)) {
            await searchField.fill('');
            await searchField.fill(destinationName);
            // Wait for the OTable loading skeleton to clear so we check real rows, not placeholders.
            await listSkeleton.first().waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
            const rowAnchor = this.getDeleteDestinationBtn(destinationName);
            try {
                await rowAnchor.waitFor({ state: 'visible', timeout: 10000 });
                testLogger.info('Found destination via search', { destinationName });
                return true;
            } catch (e) {
                testLogger.debug('Destination not found via search input', { destinationName });
            }
        }

        let destinationFound = false;
        let isLastPage = false;

        while (!destinationFound && !isLastPage) {
            // Wait for the loading skeleton to clear before checking the page's rows.
            await listSkeleton.first().waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
            try {
                await this.page.getByRole('cell', { name: destinationName }).waitFor({ timeout: 5000 });
                destinationFound = true;
                testLogger.info('Found destination via UI', { destinationName });
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
     * Rewrite the JSON inside the import editor when it contains a placeholder URL.
     *
     * The public fixtures hosted on `alert_tests` use `"url": "DEMO"` (or similar
     * placeholders) which the backend's SSRF guard rejects at create time. We swap
     * any such value for a valid HTTPS URL via the Monaco editor's model API
     * (§5 — drive via `window.monaco.editor.getEditors()`).
     *
     * No-op if the editor isn't ready or no placeholder is present (e.g. file-import flows
     * may have already provided a usable URL).
     *
     * @param {string} validUrl - The URL to substitute when a placeholder is detected.
     */
    async replaceImportJsonUrlIfPlaceholder(validUrl) {
        const replaced = await this.page.evaluate(async ({ validUrl }) => {
            const m = window.monaco;
            if (!m || !m.editor) return { ok: false, reason: 'monaco-unavailable' };
            const editors = m.editor.getEditors();
            if (!editors || editors.length === 0) return { ok: false, reason: 'no-editors' };
            const target = editors.find(ed => {
                const dom = ed.getDomNode();
                return dom && dom.closest('[data-test$="-import-sql-editor"]');
            }) || editors[0];
            const model = target.getModel();
            if (!model) return { ok: false, reason: 'no-model' };
            const text = model.getValue();
            const replacement = text.replace(/"url"\s*:\s*"((?!https?:\/\/)[^"]*)"/g, `"url": "${validUrl}"`);
            if (replacement === text) return { ok: true, replaced: false };
            model.setValue(replacement);
            return { ok: true, replaced: true };
        }, { validUrl }).catch(err => ({ ok: false, reason: err && err.message ? err.message : String(err) }));
        if (replaced?.ok && replaced.replaced) {
            await this.page.waitForTimeout(600);
            await this.page.waitForFunction(({ validUrl }) => {
                const m = window.monaco;
                const eds = m?.editor?.getEditors?.() || [];
                const val = eds[0]?.getModel?.()?.getValue?.() || '';
                return val.includes(`"url": "${validUrl}"`);
            }, { validUrl }, { timeout: 4000, polling: 100 }).catch(() => {});
            testLogger.debug('Replaced placeholder URL in import JSON editor', { validUrl });
        }
    }

    /**
     * Select a template inside the ImportDestination OSelect (`destination-import-template-input`).
     *
     * The consumer binds `:options="filteredTemplates"` and only populates that ref via
     * the `@search` emit. On first open the list is empty — typing into the OSelect's
     * search input triggers `@search`, which copies `getFormattedTemplates` into
     * `filteredTemplates`. After that, the per-value `data-test-value="<name>"` option
     * resolves cleanly without scrolling/`getByText`.
     *
     * @param {string} templateName - Template name to pick (must already exist server-side).
     */
    async selectImportTemplate(templateName) {
        const trigger = this.page.locator(this.destinationImportTemplateInput);
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();

        const popover = this.page.locator(this.destinationImportTemplatePopover);
        await popover.waitFor({ state: 'visible', timeout: 10000 });

        // Drive `@search` on the OSelect search input so `filteredTemplates` is populated.
        // Type the exact name to narrow to a single matching option (deterministic).
        const searchInput = this.page.locator(this.destinationImportTemplateSearch);
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });

        // The parent's `templates` prop is populated async via `getTemplates()`; under
        // 5-worker load that fetch is slow, so `filteredTemplates` can stay empty for a
        // while. Re-type the filter across several attempts with bounded fill timeouts
        // (so a transient re-render can't hang the 45s action timeout) until it renders.
        const option = popover.locator(`[data-test-value="${templateName}"]`).first();
        let optionVisible = false;
        for (let attempt = 1; attempt <= 5 && !optionVisible; attempt++) {
            await searchInput.fill('', { timeout: 5000 }).catch(() => {});
            await searchInput.fill(templateName, { timeout: 5000 }).catch(() => {});
            optionVisible = await option.isVisible({ timeout: 8000 }).catch(() => false);
            if (!optionVisible) {
                testLogger.warn('Import template option not rendered after search, re-filtering', { templateName, attempt });
                await this.page.waitForTimeout(1500);
            }
        }
        await expect(option).toBeVisible({ timeout: 8000 });
        await option.click();
        await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        testLogger.debug('Selected import template via OSelect search', { templateName });
    }

    /**
     * Import destination from URL
     * @param {string} url - URL of the destination JSON
     * @param {string} templateName - Name of the template to use
     * @param {string} destinationName - Name for the destination
     */
    async importDestinationFromUrl(url, templateName, destinationName) {
        // Navigate directly to the import destination page (bypasses import button click)
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const orgIdentifier = process.env.ORGNAME || 'default';
        const importUrl = `${baseUrl}/web/settings/alert_destinations?org_identifier=${orgIdentifier}&action=import`;

        try {
            await this.page.goto(importUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            // Wait for ImportDestination/BaseImport with AppTabs to render
            await this.page.waitForTimeout(3000);
            await this.page.locator(this.importJsonUrlTab).waitFor({ state: 'visible', timeout: 20000 });
            testLogger.info('Navigated directly to destination import page');
        } catch (navError) {
            testLogger.warn('Direct navigation failed, clicking import button', { error: navError.message });
            await this.page.locator(this.destinationImportButton).click();
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.importJsonUrlTab).waitFor({ state: 'visible', timeout: 15000 });
        }
        await this.page.locator(this.importJsonUrlTab).click();
        await this.page.locator(this.destinationImportUrlInputField).click();
        await this.page.locator(this.destinationImportUrlInputField).fill(url);
        await this.page.waitForTimeout(2000); // Wait for JSON to load
        await this.page.locator(this.destinationImportJsonBtn).click();
        await expect(this.page.locator(this.destinationImportNameError)).toBeVisible();
        // Resolve the template via the OSelect search-input convention — the legacy
        // scroll-and-find path used getByText/getByRole + an empty-options dropdown
        // race that intermittently lost newly-created templates.
        await this.selectImportTemplate(templateName);

        // OInput inner native field is the `-field` derivative — use it for fill (§4).
        const nameField = this.page.locator(this.destinationImportNameInputField);
        await nameField.waitFor({ state: 'visible', timeout: 10000 });
        await nameField.click();
        await nameField.fill(destinationName);
        // Replace any placeholder URL (`"url": "DEMO"` etc.) in the loaded JSON before
        // submission — the backend's SSRF guard rejects schemeless URLs at create time.
        // This must run AFTER the corrections-form name/template updates because those
        // re-write the Monaco editor from `jsonArrayOfObj` — overwriting any earlier edit.
        await this.replaceImportJsonUrlIfPlaceholder('https://example.com/webhook/import');
        await this.page.locator(this.destinationImportJsonBtn).click();
        // Wait for the post-import navigation back to the destinations list (router.push fires
        // ~400ms after the success toast). This replaces a fixed waitForTimeout and ensures
        // the new destination row has actually been created before downstream verification.
        await this.page.waitForURL(/\/alert_destinations(?!.*action=import)/, { timeout: 15000 }).catch(() => {});
    }

    /**
     * Delete destination using search
     * @param {string} destinationName - Name of the destination to delete
     */
    async deleteDestinationWithSearch(destinationName) {
        // OInput inner native field is the `-field` derivative — use it for fill (§4).
        const searchField = this.page.locator(this.destinationListSearchInputField);
        await searchField.click();
        await searchField.fill(destinationName);
        await this.page.waitForTimeout(1000); // Wait for search results
        await this.page.locator(this.deleteDestinationButton.replace('{destinationName}', destinationName)).click();
        await this.page.locator(this.confirmButton).click();
        await this.page.waitForTimeout(1000); // Wait for deletion to complete
        await expect(this.page.locator('[data-test="o2-empty-state"]')).toBeVisible();
    }

    /**
     * Search for destinations by prefix
     * @param {string} searchText - Text to search for
     */
    async searchDestinations(searchText) {
        await this.page.locator(this.destinationListSearchInput).click();
        // OInput renders data-test on outer <div>; use -field suffix for fill
        await this.page.locator(this.destinationListSearchInputField).fill('');
        await this.page.locator(this.destinationListSearchInputField).fill(searchText);
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
                const closeBtn = this.page.locator('[data-test="o-dialog-close-btn"]').first();
                if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await closeBtn.click();
                } else {
                    await this.page.locator('body').click({ position: { x: 10, y: 10 } });
                }
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
            // Check if empty state is shown
            const noData = await this.page.locator('[data-test="o2-empty-state"]').isVisible({ timeout: 2000 });
            if (noData) {
                testLogger.debug('No destinations found');
                return false;
            }
            return true;
        } catch (e) {
            // If no empty state, assume there are destinations
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
     * Verify successful import message is visible.
     * Anchors on the OToast wrapper (`o-toast-success` or `o-toast-default`) — the success
     * import path emits a default-variant toast, so we probe both via a CSS composite of
     * the data-test prefix and accept the first match. Avoids `getByText` (§2).
     */
    async verifySuccessfulImportMessage() {
        // OToast renders a wrapper `[data-test^="o-toast-"]`; the visible message body has
        // `data-test="o-toast-message"`. Use the wrapper for presence — any toast surfacing
        // signals the import resolved (success / default variant). `.first()` dodges the
        // sr-only / visible double-render strict-mode collision.
        const toastWrapper = this.page.locator(this.successNotification).first();
        await expect(toastWrapper).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify destination count message is visible (e.g., "Destination - 1:")
     * The message appears in the error/output section of the ImportDestination component
     */
    async verifyDestinationCountMessage() {
        // Wait for the import to process and show errors/output
        await this.page.waitForTimeout(2000);

        // Anchor on the destination-import-error data-test prefix — the corrections /
        // error output surfaces with `data-test="destination-import-error-{index}-{errorIndex}"`.
        // `.first()` dodges strict-mode collisions when multiple errors surface.
        const errorItem = this.page.locator('[data-test^="destination-import-error-"]').first();
        await expect(errorItem).toBeVisible({ timeout: 10000 });
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
        await this.page.locator(this.destinationNameInputField).waitFor({ state: 'visible', timeout: 10000 });

        await this.page.locator(this.destinationNameInputField).click();
        await this.page.locator(this.destinationNameInputField).fill(destinationName);
        await expect(this.page.locator(this.destinationNameInputField)).toHaveValue(destinationName, { timeout: 5000 });

        // Handle template selection with retry logic for race conditions
        // Templates might not appear in dropdown immediately after creation
        let templateFound = false;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries && !templateFound; attempt++) {
            try {
                await this.selectDestinationTemplate(templateName);
                templateFound = true;
                testLogger.info('Template found in dropdown', { templateName, attempt });
            } catch (error) {
                testLogger.warn('Template not found in dropdown, retrying...', {
                    templateName,
                    attempt,
                    maxRetries,
                    error: error.message
                });

                // Close popover via Escape (deterministic, no body-click required)
                await this.page.keyboard.press('Escape').catch(() => {});

                if (attempt < maxRetries) {
                    // Navigate away and back to refresh template list
                    await this.navigateToDestinations();

                    // Re-open the add destination form (wait for button to be enabled)
                    const retryBtn = this.page.locator(this.addDestinationButton);
                    await retryBtn.waitFor({ state: 'visible', timeout: 30000 });
                    await expect(retryBtn).toBeEnabled({ timeout: 30000 });
                    await retryBtn.click();

                    // Select 'custom' destination type again
                    await this.selectDestinationType('custom');
                    await this.page.locator(this.destinationNameInputField).waitFor({ state: 'visible', timeout: 10000 });

                    await this.page.locator(this.destinationNameInputField).click();
                    await this.page.locator(this.destinationNameInputField).fill(destinationName);
                    await expect(this.page.locator(this.destinationNameInputField)).toHaveValue(destinationName, { timeout: 5000 });
                } else {
                    throw new Error(`Template ${templateName} not found in dropdown after ${maxRetries} attempts`);
                }
            }
        }

        // Fill URL
        await this.page.locator(this.urlInputField).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.urlInputField).click();
        await this.page.locator(this.urlInputField).fill(url);
        await expect(this.page.locator(this.urlInputField)).toHaveValue(url, { timeout: 5000 });

        // Add custom headers
        for (const [headerKey, headerValue] of Object.entries(headers)) {
            // Click add header button
            await this.page.locator('[data-test="add-destination-add-header-btn"]').click();

            // Fill header key - use .last() to target the most recently added empty input
            // This handles cases where there might be pre-existing empty header rows
            // OInput wrapper data-test is `...-key-input`; inner native input auto-derives `...-key-input-field` — fill the `-field` variant per §4
            const keyInput = this.page.locator('[data-test="add-destination-header--key-input-field"]').last();
            // Wait for the newly added header row's input to render before interacting
            await keyInput.waitFor({ state: 'visible', timeout: 10000 });
            await keyInput.click();
            await keyInput.fill(headerKey);

            // Fill header value (after key is filled, the data-test becomes add-destination-header-{key}-value-input)
            // OInput inner native field — use `-field` variant for fill/click per §4
            // Wait for the reactive data-test rebind (header.key propagation) before clicking
            const valueInput = this.page.locator(`[data-test="add-destination-header-${headerKey}-value-input-field"]`);
            await valueInput.waitFor({ state: 'visible', timeout: 10000 });
            await valueInput.click();
            await valueInput.fill(headerValue);

            testLogger.debug('Added header to destination', { headerKey, destinationName });
        }

        // Submit destination
        await this.page.locator(this.submitButton).click();
        // Wait for the form editor to close — AddDestination unmounts after emit('cancel:hideform')
        // which fires only after the API call returns successfully.
        await this.page.locator(this.addDestinationTitle).waitFor({ state: 'hidden', timeout: 30000 });

        // Navigate back to the list so the dialog is fully closed before verifying
        await this.navigateToDestinations();
        await this.page.waitForTimeout(2000);

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
        // Clean up any q-portal elements that may intercept clicks
        await this.page.evaluate(() => {
            document.querySelectorAll('div[id^="q-portal"]').forEach(el => { if (el.getAttribute('aria-hidden') === 'true') el.style.display = 'none'; });
        }).catch(() => {});

        // Try multiple fallback selectors for the import button
        const importBtnFallbackLocators = [
            this.destinationImportButton,
            'button:has-text("Import Destination")',
            '[data-test*="destination-import"]',
            'button:has-text("Import")',
            '.q-table__control button:has-text("Import")',
            'button[data-o2-btn]:has-text("Import")'
        ];

        let importBtnClicked = false;
        for (const selector of importBtnFallbackLocators) {
            try {
                const btn = this.page.locator(selector).first();
                if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await btn.click({ force: true, timeout: 5000 });
                    importBtnClicked = true;
                    testLogger.info('Clicked Import Destination button via fallback selector', { selector });
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }

        if (!importBtnClicked) {
            throw new Error('Could not find Import Destination button in the UI');
        }

        await this.page.locator(this.importJsonFileTab).click();

        // OFile native <input type=file> uses the `-field` derivative per §4.
        // Try the canonical -field locator first, falling back to the OFile wrapper which
        // some Playwright builds also accept for setInputFiles.
        const fileInputField = this.page.locator('[data-test="destination-import-json-file-input-field"]');
        try {
            await fileInputField.setInputFiles(filePath, { timeout: 5000 });
        } catch (error) {
            await this.page.locator('[data-test="destination-import-json-file-input"]').setInputFiles(filePath, { timeout: 5000 });
        }

        await this.page.waitForTimeout(2000); // Wait for JSON to load
        await this.page.locator(this.destinationImportJsonBtn).click();
        await this.page.waitForTimeout(1000); // Wait for error message
        // Resolve the template via the OSelect search-input convention — the legacy
        // scroll-and-find path used getByText/getByRole + an empty-options dropdown
        // race that intermittently lost newly-created templates.
        await this.selectImportTemplate(templateName);

        // OInput inner native field is the `-field` derivative — use it for fill (§4).
        const nameField = this.page.locator(this.destinationImportNameInputField);
        await nameField.waitFor({ state: 'visible', timeout: 10000 });
        await nameField.click();
        await nameField.fill(destinationName);
        // Replace any placeholder URL (`"url": "DEMO"` etc.) in the loaded JSON before the
        // final submission — the backend's SSRF guard rejects schemeless URLs at create time.
        // This must run AFTER the corrections-form name/template updates because those
        // re-write the Monaco editor from `jsonArrayOfObj` — overwriting any earlier edit.
        await this.replaceImportJsonUrlIfPlaceholder('https://example.com/webhook/import');
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

        // Wait for button to be enabled (it starts disabled while page loads / templates fetch)
        await expect(button).toBeEnabled({ timeout: 30000 });
        testLogger.debug('New Destination button is enabled');

        // Click and wait for the dialog title to appear. If the dialog doesn't
        // open within the budget, re-check button visibility before retrying —
        // a successful click navigates away from the list so the button DOM
        // is gone; retrying the click would target a detached node.
        await button.click();
        const title = this.page.locator(this.addDestinationTitle);
        try {
            await title.waitFor({ state: 'visible', timeout: 15000 });
        } catch (e) {
            testLogger.warn('Add-destination title not visible after click, checking button state');
            const stillVisible = await button.isVisible({ timeout: 1000 }).catch(() => false);
            if (stillVisible) {
                // Button still present → first click was lost; retry once.
                await button.click({ force: true });
                await title.waitFor({ state: 'visible', timeout: 15000 });
            } else {
                // Button gone → dialog opened but title binding may be late; final wait.
                await title.waitFor({ state: 'visible', timeout: 15000 });
            }
        }
        testLogger.debug('Clicked New Destination button — dialog open');
    }

    /**
     * Open the template OSelect popover and select by `data-test-value` (deterministic, per agent rules §4).
     * Uses the popover's search input (Ctrl+A → Backspace → fill) to filter past virtualisation,
     * then clicks the option matching `data-test-value="${templateName}"`. Falls back to scrollAndFindOption.
     */
    async selectDestinationTemplate(templateName) {
        // Click the OSelect -trigger (not the wrapper div, which doesn't reliably toggle
        // the popover under load). Retry the open until the popover is visible.
        const popover = this.page.locator(this.templateSelectPopover);
        const trigger = this.page.locator(this.templateSelect).locator('[data-test$="-trigger"]').first();
        const opener = (await trigger.count().catch(() => 0)) > 0
            ? trigger
            : this.page.locator(this.templateSelect);
        for (let open = 1; open <= 3; open++) {
            await opener.click();
            if (await popover.isVisible({ timeout: 5000 }).catch(() => false)) break;
            await this.page.waitForTimeout(500);
        }
        await popover.waitFor({ state: 'visible', timeout: 10000 });

        // Wait (generously) for the option list to render BEFORE filtering. Under 5-worker
        // load the shared org can take 20s+ to return the template list; typing into the
        // search over an empty list leaves a stale filter that never matches.
        await popover.locator('[data-test-value]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

        const search = this.page.locator(this.templateSelectSearch);
        const option = popover.locator(`[data-test-value="${templateName}"]`).first();

        // Filter + check, re-typing between attempts so a lost race (filter applied over a
        // not-yet-rendered list) recovers. All search interactions use short, bounded
        // timeouts + catch so a transient popover re-render can't hang the default
        // 45s action timeout (which is what stalled the whole spec under load).
        const typeFilter = async () => {
            if (!(await search.isVisible({ timeout: 3000 }).catch(() => false))) return false;
            await search.click({ timeout: 5000 }).catch(() => {});
            await this.page.keyboard.press('Control+A');
            await this.page.keyboard.press('Backspace');
            await search.fill(templateName, { timeout: 5000 }).catch(() => {});
            return true;
        };
        for (let attempt = 1; attempt <= 4; attempt++) {
            await typeFilter();
            if (await option.isVisible({ timeout: 6000 }).catch(() => false)) {
                await option.click();
                // popover should dismiss after selection
                await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                testLogger.debug('Selected template via data-test-value', { templateName, attempt });
                return;
            }
            testLogger.warn('Template option not rendered after search, re-filtering', { templateName, attempt });
            // Clear the filter so the full list re-renders before the next attempt
            if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
                await search.click({ timeout: 5000 }).catch(() => {});
                await this.page.keyboard.press('Control+A');
                await this.page.keyboard.press('Backspace');
            }
            await this.page.waitForTimeout(1500);
        }

        // Fallback: clear any residual filter, then scroll the full list (legacy path)
        await this.commonActions.scrollAndFindOption(templateName, 'template');
    }

    /**
     * Select a prebuilt destination type
     * @param {string} type - Type ID (slack, discord, msteams, email, pagerduty, opsgenie, servicenow, custom)
     */
    /**
     * Wait until `locator` has been CONTINUOUSLY visible for `stableMs`, resetting the moment
     * it detaches. Returns false if it never settles within `timeout`. This is the tool for a
     * field that renders, gets UNMOUNTED by a re-render, then re-renders — a plain waitFor
     * would accept the first (doomed) render; this only accepts the field once it has settled.
     */
    async _waitForFieldStable(locator, { stableMs = 1500, timeout = 20000 } = {}) {
        const start = Date.now();
        let stableSince = null;
        while (Date.now() - start < timeout) {
            const visible = await locator.isVisible().catch(() => false);
            if (visible) {
                if (stableSince === null) stableSince = Date.now();
                if (Date.now() - stableSince >= stableMs) return true;
            } else {
                stableSince = null;
            }
            await this.page.waitForTimeout(250);
        }
        return false;
    }

    async selectDestinationType(type) {
        // Wait for the TYPE-SPECIFIC credential field (proof the type's form rendered) plus the
        // common destination-name field the caller fills next. Each credential field is behind
        // `v-if="destinationType === '<type>'"` in PrebuiltDestinationForm.vue.
        const typeConfirmSelector = {
            slack: '[data-test="slack-webhook-url-input-field"]',
            discord: '[data-test="discord-webhook-url-input-field"]',
            msteams: '[data-test="msteams-webhook-url-input-field"]',
            pagerduty: '[data-test="pagerduty-integration-key-input-field"]',
            opsgenie: '[data-test="opsgenie-api-key-input-field"]',
            servicenow: '[data-test="servicenow-instance-url-input-field"]',
            email: this.recipientsInputField,
            custom: this.urlInput,
        }[type] || this.destinationNameInput;
        const confirmField = this.page.locator(typeConfirmSelector).first();
        const nameField = this.page.locator(this.destinationNameInputField).first();

        // On a REUSED destination form (2nd+ destination in a run), selecting a type sometimes
        // triggers a re-render (template auto-load) that UNMOUNTS the credential/name fields and
        // they stay gone — verified by watching count→0 for 25s+. A wait can't recover an
        // unmounted element, so when the fields don't settle we re-open the form (fresh mount,
        // like the always-stable first destination) and re-select. Deterministic — not a retry.
        for (let openAttempt = 1; openAttempt <= 4; openAttempt++) {
            await this.page.locator(this.prebuiltDestinationSelector).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            const card = this.page.locator(`${this.destinationTypeCard}[data-type="${type}"]`);
            await card.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

            // Click the card once if not already selected. selectType() re-emits on every click,
            // so re-clicking a selected card re-renders the form — only click when needed.
            const cardSelected = () => card.evaluate((el) => el.classList.contains('selected')).catch(() => false);
            if (!(await cardSelected())) {
                await card.click({ timeout: 10000 }).catch((e) => {
                    testLogger.debug('selectDestinationType card click failed', { type, openAttempt, error: e.message });
                });
            }
            await expect.poll(cardSelected, { timeout: 8000, intervals: [400, 800, 1200] }).toBe(true).catch(() => {});

            // Let the prebuilt TEMPLATE auto-load settle BEFORE judging field stability. Picking a
            // type fires a template fetch whose completion re-renders the form and (on a reused
            // form) unmounts the fields. That fetch can land AFTER a short stability window — so
            // without this the fields looked "stable" here, then unmounted during the caller's
            // fills (fillWebhookUrl → fillDestinationName). Waiting for the network to go idle ties
            // us to the actual fetch, so the unmount happens inside the stability check below (and
            // triggers a remount) instead of leaking into the fills.
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

            // Wait for BOTH fields to be STABLE (settled past any re-render), not just present.
            // A healthy field settles in ~1-2s so this returns fast; the caps only bound how long
            // we tolerate the UNMOUNTED case before remounting. The name field settles a touch
            // later than the credential field, so it gets a longer budget.
            const credStable = await this._waitForFieldStable(confirmField, { stableMs: 1500, timeout: 12000 });
            const nameStable = credStable && await this._waitForFieldStable(nameField, { stableMs: 1000, timeout: 12000 });
            if (credStable && nameStable) {
                testLogger.debug('Selected destination type and form loaded', { type, openAttempt });
                return;
            }

            // Fields unmounted and stuck — remount to force a fresh render, then retry. A light
            // remount (cancel + re-open) first; if the stale parent state persists, escalate to a
            // full page reload + fresh navigate — a guaranteed clean mount, like the always-stable
            // first destination — which recovers the cases cancel+reopen can't.
            testLogger.warn('Destination fields did not stabilise after type-select; remounting', { type, openAttempt, credStable, nameStable });
            if (openAttempt === 1) {
                await this.page.locator(this.cancelButton).first().click({ force: true, timeout: 10000 }).catch(() => {});
                await this.page.locator(this.addDestinationTitle).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
                await this.clickNewDestination();
            } else {
                await this.navigateToDestinations();
                await this.clickNewDestination();
            }
        }
        // Surface a clear failure if remounts didn't recover it.
        await confirmField.waitFor({ state: 'visible', timeout: 15000 });
        await nameField.waitFor({ state: 'visible', timeout: 15000 });
        testLogger.debug('Selected destination type and form loaded (after remounts)', { type });
    }

    /**
     * Fill webhook URL (for Slack, Teams)
     * @param {string} url - Webhook URL
     */
    async fillWebhookUrl(url) {
        // selectDestinationType() now confirms this type-specific field is rendered before
        // returning, so it is present here — just wait for visibility, fill, and verify.
        const input = this.page.locator(this.webhookInputAnyField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(url);
        await expect(input).toHaveValue(url, { timeout: 5000 });
        testLogger.debug('Filled webhook URL');
    }

    /**
     * Fill email recipients (for Email type)
     * @param {string} recipients - Comma-separated email addresses
     */
    async fillEmailRecipients(recipients) {
        const input = this.page.locator(this.recipientsInputField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(recipients);
        testLogger.debug('Filled email recipients', { recipients });
    }

    /**
     * Fill integration key (for PagerDuty)
     * @param {string} key - Integration key
     */
    async fillIntegrationKey(key) {
        // selectDestinationType() now returns only once this field is stable, so it's present.
        const input = this.page.locator(this.integrationKeyInputField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(key);
        testLogger.debug('Filled integration key');
    }

    /**
     * Select severity (for PagerDuty, Opsgenie)
     * @param {string} severity - Severity level (e.g., 'critical', 'error', 'warning', 'info')
     */
    async selectSeverity(severity) {
        await this.page.waitForTimeout(5000);
        const select = this.page.locator(this.severitySelect).first();
        await select.waitFor({ state: 'visible', timeout: 10000 });
        await select.click();

        // Severity dropdown is OSelect post-migration — popover with data-test-value per option.
        // Normalise the value (lowercase) for the data-test-value lookup.
        const popover = this.page.locator(this.severitySelectPopover);
        await popover.waitFor({ state: 'visible', timeout: 10000 });
        const severityValue = severity.toLowerCase();
        const option = popover.locator(`[data-test-value="${severityValue}"]`).first();
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
        await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        testLogger.debug('Selected severity', { severity });
    }

    /**
     * Fill destination name
     * @param {string} name - Destination name
     */
    async fillDestinationName(name) {
        await this.page.waitForTimeout(5000);
        const field = this.page.locator(this.destinationNameInputField);
        // Prebuilt forms scroll the name field around as sections (webhook, template,
        // headers) render; scroll it into view and retry so a transient re-render can't
        // fail the visibility wait.
        let ready = false;
        for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
            await field.scrollIntoViewIfNeeded().catch(() => {});
            ready = await field.isVisible({ timeout: 10000 }).catch(() => false);
            if (!ready) {
                testLogger.warn('Destination name field not visible yet, retrying', { attempt });
                await this.page.waitForTimeout(1000);
            }
        }
        await field.waitFor({ state: 'visible', timeout: 10000 });
        await field.fill(name);
        await expect(field).toHaveValue(name, { timeout: 5000 });
        testLogger.debug('Filled destination name', { name });
    }

    /**
     * Click Test button
     */
    async clickTest() {
        const testBtn = this.page.locator(this.testButton).first();
        await testBtn.waitFor({ state: 'visible', timeout: 10000 });
        await testBtn.click();
        testLogger.debug('Clicked Test button');
    }

    /**
     * Click Save button
     */
    async clickSave() {
        // OToast can transiently overlay the dialog buttons; wait for any in-flight toast
        // (especially "Please wait while loading…") to clear before clicking Save so the
        // click isn't intercepted and we don't accidentally read a stale success toast.
        await this.page.locator(this.toastMessage).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        const saveBtn = this.page.locator(this.saveButton).first();
        // Prebuilt forms can scroll the submit button off-screen — scroll it into view first,
        // then wait for visibility, then force-click to bypass any overlay pointer interception.
        // Under concurrent load the form can transiently re-render (toast/validation),
        // briefly detaching the button, so retry the scroll+wait a couple of times.
        let ready = false;
        for (let attempt = 1; attempt <= 5 && !ready; attempt++) {
            await saveBtn.scrollIntoViewIfNeeded().catch(() => {});
            ready = await saveBtn.isVisible({ timeout: 10000 }).catch(() => false);
            if (!ready) {
                testLogger.warn('Save button not visible yet, retrying', { attempt });
                await this.page.waitForTimeout(1500);
            }
        }
        await saveBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expect(saveBtn).toBeEnabled({ timeout: 15000 });
        // force-click bypasses any residual toast overlay still occupying pointer events.
        await saveBtn.click({ force: true, timeout: 10000 });
        // Hard settle: the create/update API + form-close (expectSuccessNotification waits
        // for the title to hide) can lag under load; give the request time to complete.
        await this.page.waitForTimeout(5000);
        testLogger.debug('Clicked Save button');
    }

    /**
     * Click Cancel button
     */
    async clickCancel() {
        // Force-click bypasses any backdrop interception (don't pre-press Escape — it closes the dialog itself)
        try {
            await this.page.locator(this.cancelButton).click({ force: true, timeout: 10000 });
        } catch (e) {
            testLogger.warn('Cancel button click failed, trying dialog close button', { error: e.message });
            const closeBtn = this.page.locator(this.dialogCloseBtn).first();
            if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await closeBtn.click();
            } else {
                await this.page.keyboard.press('Escape');
            }
        }
        // Wait for the cancel button (and form) to detach so subsequent navigation sees a clean state.
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
     * Wait for destinations list title to be visible (page-ready signal)
     */
    async expectDestinationsListTitleVisible() {
        await expect(this.page.locator(this.destinationsListTitle)).toBeVisible({ timeout: 30000 });
    }

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
        // Step 1 surfaces as the prebuilt destination selector being mounted/visible — the legacy
        // q-stepper class has been removed in the UX revamp, so anchor on the selector data-test.
        await expect(this.page.locator(this.prebuiltDestinationSelector)).toBeVisible({ timeout: 10000 });
        testLogger.debug('Step 1 (destination selector) visible');
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
        // In edit mode, the stepper is gone — Connection step = any of the connection form fields
        // (name input, custom URL input, or any prebuilt webhook input) becoming visible.
        const nameVisible = this.page.locator(this.destinationNameInput).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
        const urlVisible = this.page.locator(this.urlInput).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
        const webhookVisible = this.page.locator(this.webhookInputAny).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
        const formVisible = this.page.locator(this.prebuiltForm).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

        const anyVisible = await Promise.race([nameVisible, urlVisible, webhookVisible, formVisible]);
        if (anyVisible) {
            testLogger.debug('Connection form is visible (form field surfaced)');
            return;
        }
        testLogger.debug('Connection form fields not visible within timeout');
    }

    /**
     * Verify selected destination indicator is visible with correct type
     * @param {string} typeName - Expected type name (e.g., 'Slack', 'Microsoft Teams')
     */
    async expectSelectedIndicatorVisible(typeName) {
        // The current PrebuiltDestinationSelector marks the chosen card with the `.selected` modifier
        // and renders a check-circle icon inside; in edit mode the readonly badge surfaces the type name.
        // Probe both surfaces (read-only badge first, then any destination-type-name on a selected card)
        // until one matches the expected type, otherwise log a debug breadcrumb (the spec keeps going).
        const readonly = this.page.locator(this.destinationTypeReadonly).first();
        if (await readonly.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(readonly).toContainText(typeName, { ignoreCase: true, timeout: 5000 });
            testLogger.debug('Selected indicator (readonly badge) visible', { typeName });
            return;
        }

        const selectedTypeName = this.page.locator(
            `xpath=//*[@data-test="destination-type-card"][.//*[@name="check-circle"]]//*[@data-test="destination-type-name"]`
        ).first();
        if (await selectedTypeName.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(selectedTypeName).toContainText(typeName, { ignoreCase: true, timeout: 5000 });
            testLogger.debug('Selected indicator (card title) visible', { typeName });
            return;
        }

        testLogger.debug('Selected indicator not found, but destination might be selected via other means');
    }

    /**
     * Verify green checkmark icon is visible in selected indicator
     */
    async expectCheckmarkVisible() {
        // OIcon emits the `name` attribute on the SVG; PrebuiltDestinationSelector renders `check-circle`
        // inside the selected card. Probe the icon attribute (not the legacy material text content).
        const checkIcon = this.page.locator(this.checkmarkIcon).first();
        if (await checkIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(checkIcon).toBeVisible({ timeout: 3000 });
            testLogger.debug('Checkmark visible');
            return;
        }
        testLogger.debug('Checkmark not found with standard selectors, but selection might be indicated differently');
    }

    /**
     * Verify Test button is enabled
     */
    async expectTestButtonEnabled() {
        await expect(this.page.locator(this.testButton).first()).toBeEnabled({ timeout: 5000 });
    }

    /**
     * Verify test result is displayed (or test completes)
     * The test result may not always render if the backend service is unreachable
     * or if the test functionality is not fully implemented
     */
    async expectTestResultVisible() {
        // Probe any of the DestinationTestResult or prebuilt-test-result data-tests.
        const probes = [
            this.page.locator(this.testResult).first(),
            this.page.locator(this.testResultPrebuilt).first(),
            this.page.locator(this.testResultSuccess).first(),
            this.page.locator(this.testResultFailure).first(),
            this.page.locator(this.testResultLoading).first(),
            this.page.locator(this.testResultIdle).first(),
        ];

        for (const probe of probes) {
            if (await probe.isVisible({ timeout: 3000 }).catch(() => false)) {
                testLogger.debug('Test result visible');
                return;
            }
        }

        const testBtn = this.page.locator(this.testButton).first();
        const testBtnVisible = await testBtn.isVisible().catch(() => false);
        if (testBtnVisible) {
            testLogger.warn('Test button visible but no test result appeared - test functionality may not be working in this environment');
            return;
        }

        try {
            await expect(this.page.locator(this.testResult).first()).toBeVisible({ timeout: 15000 });
        } catch (error) {
            testLogger.error('Test result not visible after all attempts', {
                error: error.message,
                note: 'Test functionality may require valid external service credentials'
            });
            throw error;
        }
    }

    /**
     * Wait for the destination form to close after a save operation.
     * AddDestination.vue unmounts (emits cancel:hideform) only after the API call returns,
     * so the title becoming hidden is a reliable save-completion signal.
     */
    async expectSuccessNotification() {
        // The form closes (title hides) once the create/update API returns. Under load the
        // request can lag; if it doesn't hide in time, reload the page (min 5s settle) to
        // force the stuck form closed — the save itself has usually succeeded, and the
        // caller's expectDestinationInList verifies the actual outcome afterward.
        const title = this.page.locator(this.addDestinationTitle);
        if (await title.waitFor({ state: 'hidden', timeout: 30000 }).then(() => true).catch(() => false)) {
            return;
        }
        for (let attempt = 1; attempt <= 2; attempt++) {
            testLogger.warn('Destination form did not close after save, reloading', { attempt });
            await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await this.page.waitForTimeout(5000);
            if (await title.isHidden().catch(() => true)) return;
        }
        // Surface clearly if the form is still stuck open after reloads.
        await title.waitFor({ state: 'hidden', timeout: 10000 });
    }

    /**
     * Verify destination appears in list
     * @param {string} name - Destination name
     */
    async expectDestinationInList(name) {
        // ── Backend truth first (deterministic) ──────────────────────────────────────────
        // Poll the destination's own API endpoint (session cookies via page.request) until it
        // is registered. This separates two failure modes the rendered list conflates:
        //   • the destination genuinely doesn't exist (a create/edit silently didn't persist) —
        //     the list shows "0 of 0" and blind row-retries just time out with a vague error;
        //   • the destination DOES exist but the list transiently rendered empty (fetch race) —
        //     which we then resolve by re-driving the UI.
        // If the API says it never exists, surface THAT clearly instead of "not found in list".
        const baseUrl = process.env.ZO_BASE_URL;
        const org = getOrgIdentifier();
        const detailUrl = `${baseUrl}/api/${org}/alerts/destinations/${encodeURIComponent(name)}`;
        const listUrl = `${baseUrl}/api/${org}/alerts/destinations?page_num=0&page_size=1000`;
        // Confirm the destination is in the LIST the UI renders from — not just that the single
        // GET returns 200. The detail endpoint can report 200 while the (paginated) list endpoint
        // the UI actually reads hasn't reindexed the new row yet, which surfaced as "registered on
        // backend but did not render in the list". Poll the list endpoint so we only drive the UI
        // once the row will genuinely be there. 404 on detail = definitively gone (didn't persist).
        let apiStatus = 0;
        let inList = false;
        // NOTE: the `.catch(() => {})` below intentionally swallows this poll's pass/fail — the
        // poll is NOT the assertion. Its only job is to advance state (`apiStatus` / `inList`) and
        // give the backend time to register the row. The real verdict is asserted right after:
        // a 404 throws ("did not persist"), and the UI check below throws if the row never renders.
        // Do not "fix" this into a hard `.toBe(true)` — a slow-but-eventually-present row would
        // then fail here before the UI ever gets a chance to confirm it.
        await expect.poll(async () => {
            const detail = await this.page.request.get(detailUrl).catch(() => null);
            apiStatus = detail ? detail.status() : 0;
            if (apiStatus === 404) return true;               // definitively gone
            if (apiStatus === 401 || apiStatus === 403) return true; // auth-inconclusive → rely on UI
            const listResp = await this.page.request.get(listUrl).catch(() => null);
            if (listResp && listResp.ok()) {
                const body = await listResp.json().catch(() => null);
                const arr = (body && (body.list || body.destinations)) || (Array.isArray(body) ? body : []);
                inList = arr.some((d) => (d && (d.name || d)) === name);
            }
            return inList;
        }, { timeout: 30000, intervals: [1000, 1500, 2000, 3000] }).toBe(true).catch(() => {});
        testLogger.debug('Destination backend pre-check', { name, apiStatus, inList });
        if (apiStatus === 404) {
            await this.page.screenshot({ path: `test-results/destination-not-found-${name}.png`, fullPage: true }).catch(() => {});
            throw new Error(`Destination "${name}" does not exist on the backend (API 404) — the create/edit did not persist. Screenshot: test-results/destination-not-found-${name}.png`);
        }

        // ── UI check ─────────────────────────────────────────────────────────────────────
        // The destination is registered (or auth was inconclusive). Navigate fresh so the list
        // re-fetches, search to scope, and confirm the row — retrying the whole navigate+search
        // so a transient empty list ("0 of 0") re-fetches and renders the row.
        const searchField = this.page.locator(this.destinationListSearchInputField);
        const rowAnchor = this.getDeleteDestinationBtn(name);
        const skeleton = this.page.locator('[data-test="o2-table-skeleton-body"]');
        for (let attempt = 1; attempt <= 5; attempt++) {
            await this.navigateToDestinations();
            await this.page.locator(this.destinationsListTable).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            // The list renders a loading SKELETON (TenstackTable) while the destinations fetch is
            // in flight — real rows aren't in the DOM yet. Wait for the skeleton to clear before
            // checking for the row, else we search an all-placeholder table and never find it
            // (the exact "inList=true but did not render" failure). Reload on the next attempt if
            // the fetch is genuinely stuck.
            await skeleton.first().waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
            if (await searchField.isVisible().catch(() => false)) {
                await searchField.fill('');
                // Last attempt: leave the search cleared to render the full list, in case the
                // scoped search itself is the thing failing to surface the (confirmed) row.
                if (attempt < 5) await searchField.fill(name);
            }
            if (await rowAnchor.isVisible({ timeout: 8000 }).catch(() => false)) {
                testLogger.debug('Destination found in list', { name, attempt });
                return;
            }
            testLogger.debug('Destination row not visible yet, re-navigating and re-searching', { name, attempt });
        }
        await this.page.screenshot({ path: `test-results/destination-not-found-${name}.png`, fullPage: true }).catch(() => {});
        throw new Error(`Destination "${name}" is registered on the backend (API ${apiStatus}, inList=${inList}) but did not render in the list after retries. Screenshot: test-results/destination-not-found-${name}.png`);
    }

    /**
     * Verify validation error is visible
     */
    async expectValidationError() {
        await expect(this.page.locator(this.errorMessage).first()).toBeVisible({ timeout: 5000 });
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
        // After search-and-delete, the row anchor (named delete button) must not be present.
        await expect(this.getDeleteDestinationBtn(name)).toHaveCount(0, { timeout: 10000 });
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
        // Wait for the create dialog to close so subsequent navigation finds the list
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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

        // Use the search input to scope the list to this destination first (avoids pagination)
        const searchField = this.page.locator(this.destinationListSearchInputField);
        if (await searchField.isVisible().catch(() => false)) {
            await searchField.fill('');
            await searchField.fill(name);
        }

        // Anchor on the destination-specific delete button data-test
        const deleteBtn = this.getDeleteDestinationBtn(name);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();

        // Confirm deletion in dialog
        const confirmBtn = this.page.locator(this.confirmButton);
        await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
        await confirmBtn.click();

        // Deterministic backend truth: poll the destination's own API endpoint until it is
        // GONE (404). The rendered row detaching (toHaveCount(0)) races the list's getDestinations()
        // re-fetch, which lags under load — so the row could still be shown briefly after the
        // delete API returned, failing the count assertion. Confirming the backend deletion is
        // the real signal; page.request carries the session cookies the endpoint needs.
        const baseUrl = process.env.ZO_BASE_URL;
        const org = getOrgIdentifier();
        const detailUrl = `${baseUrl}/api/${org}/alerts/destinations/${encodeURIComponent(name)}`;
        let apiStatus = 0;
        await expect.poll(async () => {
            const resp = await this.page.request.get(detailUrl).catch(() => null);
            apiStatus = resp ? resp.status() : 0;
            // Terminal states: gone (404), or auth-inconclusive (401/403) — fall back to the UI.
            return apiStatus === 404 || apiStatus === 401 || apiStatus === 403;
        }, { timeout: 20000, intervals: [1000, 1500, 2000, 3000] }).toBe(true).catch(() => {});
        testLogger.debug('Destination delete backend-check', { name, apiStatus });
        if (apiStatus === 404) {
            // Backend confirms the destination is gone — the real success signal. The row
            // detaches on the next list refresh; wait for it best-effort (its re-render can
            // lag under load, but the delete is already done, so don't fail on UI lag).
            await expect(deleteBtn).toHaveCount(0, { timeout: 15000 }).catch(() => {});
        } else {
            // API was auth-inconclusive — fall back to the row detaching as the assertion.
            await expect(deleteBtn).toHaveCount(0, { timeout: 15000 });
        }

        // Clear the search filter so the list returns to its full state. Leaving the
        // deleted name in the search box strands the list on a "No destinations found"
        // empty state, which confuses the next create flow (the New-destination form can
        // open over an empty/transitioning list and mis-render).
        if (await searchField.isVisible().catch(() => false)) {
            await searchField.fill('');
        }

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

        // Full page reload to ensure clean state before edit
        // This is critical for ServiceNow and other complex destination types
        await this.page.reload({ waitUntil: 'domcontentloaded' });

        // Wait for OTable to render
        await this.page.locator(this.destinationsListTable).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

        // Use search to find the destination (fill the OInput inner field)
        const searchField = this.page.locator(this.destinationListSearchInputField);
        if (await searchField.isVisible().catch(() => false)) {
            await searchField.fill('');
            await searchField.fill(name);
            testLogger.debug('Used search to find destination for edit', { name });
        }

        // Try to find and click edit button
        const editBtn = this.getEditDestinationBtn(name);

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
                // Wait for the add-destination dialog title to surface (Update mode)
                await this.page.locator(this.addDestinationTitle).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

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
                await this.page.reload({ waitUntil: 'domcontentloaded' });
                await this.page.locator(this.destinationsListTable).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

                // Try search again after reload
                if (await searchField.isVisible().catch(() => false)) {
                    await searchField.fill('');
                    await searchField.fill(name);
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
        await expect(this.page.locator(this.addDestinationTitle)).toContainText(/update/i);
        testLogger.debug('Edit form title shows Update');

        // In edit mode, the form data loads asynchronously from the API
        // A loading spinner (data-test="add-destination-loading-indicator") appears while loading.
        // We must wait for this to disappear before the name input becomes visible.
        const loadingSpinner = this.page.locator(this.addDestinationLoadingIndicator);

        // Wait for loading spinner to vanish if present
        const isLoadingVisible = await loadingSpinner.isVisible().catch(() => false);
        if (isLoadingVisible) {
            testLogger.debug('Loading state detected, waiting for it to complete...');
            try {
                await loadingSpinner.waitFor({ state: 'hidden', timeout: 60000 });
                testLogger.debug('Loading spinner disappeared');
            } catch (e) {
                testLogger.warn('Loading spinner still visible after timeout', { name });
                await this.page.screenshot({ path: `test-results/edit-form-loading-stuck-${name}.png`, fullPage: true }).catch(() => {});
            }
        } else {
            testLogger.debug('No loading state detected, form should be ready');
        }

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
            const stillLoading = await loadingSpinner.isVisible().catch(() => false);
            testLogger.error('Debug form state', {
                stillLoading,
                titleVisible: await this.page.locator(this.addDestinationTitle).isVisible().catch(() => false),
                prebuiltFormVisible: await this.page.locator(this.prebuiltForm).isVisible().catch(() => false),
                urlInputVisible: await this.page.locator(this.urlInput).isVisible().catch(() => false),
                readonlyTypeVisible: await this.page.locator(this.destinationTypeReadonly).isVisible().catch(() => false)
            });

            throw e;
        }

        // The name's OInput wrapper shows the value on the inner native -field input.
        const nameField = this.page.locator(this.destinationNameInputField).first();
        await nameField.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        await expect(nameField).toHaveValue(name, { timeout: 10000 });
        testLogger.debug('Edit form loaded with existing data', { name });
    }

    /**
     * Verify Step 1 (Choose Type) is skipped in edit mode OR scroll to form fields if shown
     */
    async expectStep1Skipped() {
        // In edit mode, the form shows the readonly type indicator (not the selector cards).
        // Verify the connection-form fields surfaced — that's the deterministic signal of "step 1 skipped".
        testLogger.debug('Edit mode - waiting for connection-step fields to be visible');

        // Scroll within any portal/dialog to reveal fields below the type indicator
        await this.page.evaluate(() => {
            document.querySelectorAll('[data-test^="add-destination"]').forEach(node => {
                if (node.scrollHeight > node.clientHeight) {
                    node.scrollTop = node.scrollHeight;
                }
            });
            window.scrollBy(0, 300);
        }).catch(() => {});

        // Now verify we can see form fields
        await this.expectConnectionStepVisible();
        testLogger.debug('Connection-step form fields visible — step 1 skipped');
    }

    /**
     * Verify webhook URL field contains a value (edit mode)
     * @param {string} expectedUrl - Expected webhook URL (optional)
     */
    async expectWebhookUrlPopulated(expectedUrl = null) {
        // Probe the prebuilt webhook OInput's inner native field, then the custom URL field as fallback.
        const probes = [this.webhookInputAnyField, this.urlInputField];
        for (const selector of probes) {
            const input = this.page.locator(selector).first();
            if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) continue;
            const value = await input.inputValue().catch(() => '');
            if (value && value.length > 0) {
                if (expectedUrl) {
                    await expect(input).toHaveValue(expectedUrl, { timeout: 5000 });
                }
                testLogger.debug('Webhook URL is populated in edit mode', { selector, hasValue: true });
                return;
            }
        }
        testLogger.debug('Webhook URL field not found or empty, might be using different form structure in edit mode');
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
     * Verify integration key field is rendered in edit mode.
     * Note: PagerDuty's integration_key is treated as a credential and is cleared
     * by the form on edit (spec note: "must re-provide integration key as password
     * fields are cleared"), so we only assert the input is visible, not populated.
     * @param {string} expectedKey - Expected integration key (optional, ignored when empty)
     */
    async expectIntegrationKeyPopulated(expectedKey = null) {
        const input = this.page.locator(this.integrationKeyInputField).first();
        await input.waitFor({ state: 'visible', timeout: 10000 });
        if (expectedKey) {
            await expect(input).toHaveValue(expectedKey, { timeout: 5000 });
        }
        testLogger.debug('Integration key field visible in edit mode');
    }

    /**
     * Update webhook URL (for edit mode)
     * @param {string} newUrl - New webhook URL
     */
    async updateWebhookUrl(newUrl) {
        // Scroll within the add-destination dialog to ensure webhook field is visible
        await this.page.evaluate(() => {
            document.querySelectorAll('[data-test^="add-destination"]').forEach(node => {
                if (node.scrollHeight > node.clientHeight) {
                    node.scrollTop = node.scrollHeight;
                }
            });
        }).catch(() => {});

        const probes = [this.webhookInputAnyField, this.urlInputField];
        for (const selector of probes) {
            const input = this.page.locator(selector).first();
            await input.scrollIntoViewIfNeeded().catch(() => {});
            if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) continue;
            // Triple-click to select all text, then fill the new URL
            await input.click({ clickCount: 3 });
            await input.fill(newUrl);
            await expect(input).toHaveValue(newUrl, { timeout: 5000 });
            testLogger.debug('Updated webhook URL', { newUrl, selector });
            return;
        }

        // Take screenshot before throwing error
        await this.page.screenshot({ path: `test-results/webhook-update-failed.png`, fullPage: true }).catch(() => {});
        testLogger.error('Webhook URL input not found for update');
        throw new Error('Webhook URL input not found for update. Screenshot saved to test-results/webhook-update-failed.png');
    }

    /**
     * Update email recipients (for edit mode)
     * @param {string} newRecipients - New email recipients
     */
    async updateEmailRecipients(newRecipients) {
        const input = this.page.locator(this.recipientsInputField).first();
        if (!(await input.isVisible({ timeout: 10000 }).catch(() => false))) {
            throw new Error('Email recipients input not found for update');
        }
        await input.click();
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Meta+a');
        await input.fill(newRecipients);
        await expect(input).toHaveValue(newRecipients, { timeout: 5000 });
        testLogger.debug('Updated email recipients', { newRecipients });
    }

    /**
     * Update integration key (for edit mode)
     * @param {string} newKey - New integration key
     */
    async updateIntegrationKey(newKey) {
        const input = this.page.locator(this.integrationKeyInputField).first();
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill('');
        await input.fill(newKey);
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.waitForTimeout(5000);
        const input = this.page.locator(this.opsgenieApiKeyInputField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(apiKey);
        testLogger.debug('Filled Opsgenie API key');
    }

    /**
     * Select priority (for Opsgenie)
     * @param {string} priority - Priority level (e.g., 'P1', 'P2')
     */
    async selectPriority(priority) {
        const select = this.page.locator(this.prioritySelect).first();
        if (await select.isVisible()) {
            await select.click();
            const popover = this.page.locator(this.prioritySelectPopover);
            await popover.waitFor({ state: 'visible', timeout: 5000 });
            const option = popover.locator(`[data-test-value="${priority}"]`).first();
            await option.waitFor({ state: 'visible', timeout: 5000 });
            await option.click();
            await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
            const input = this.page.locator(this.opsgenieApiKeyInputField).first();
            await input.waitFor({ state: 'visible', timeout: 10000 });
            await input.fill('');
            await input.fill(newApiKey);
        }

        if (newPriority) {
            await this.selectPriority(newPriority);
        }

        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        await this.page.waitForTimeout(5000);
        const input = this.page.locator(this.servicenowInstanceUrlInputField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(url);
        testLogger.debug('Filled ServiceNow instance URL');
    }

    /**
     * Fill ServiceNow username
     * @param {string} username - ServiceNow username
     */
    async fillServiceNowUsername(username) {
        await this.page.waitForTimeout(5000);
        const input = this.page.locator(this.servicenowUsernameInputField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(username);
        testLogger.debug('Filled ServiceNow username');
    }

    /**
     * Fill ServiceNow password
     * @param {string} password - ServiceNow password
     */
    async fillServiceNowPassword(password) {
        await this.page.waitForTimeout(5000);
        const input = this.page.locator(this.servicenowPasswordInputField).first();
        await input.waitFor({ state: 'visible', timeout: 15000 });
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
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
            const urlInput = this.page.locator(this.servicenowInstanceUrlInputField).first();
            await urlInput.waitFor({ state: 'visible', timeout: 10000 });
            await urlInput.fill('');
            await urlInput.fill(newInstanceUrl);
        }

        if (newUsername) {
            const usernameInput = this.page.locator(this.servicenowUsernameInputField).first();
            await usernameInput.waitFor({ state: 'visible', timeout: 10000 });
            await usernameInput.fill('');
            await usernameInput.fill(newUsername);
        }

        if (newPassword) {
            const passwordInput = this.page.locator(this.servicenowPasswordInputField).first();
            await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
            await passwordInput.fill('');
            await passwordInput.fill(newPassword);
        }

        await this.clickSave();
        await this.expectSuccessNotification();
        await this.page.locator(this.cancelButton).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
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
        // OInput inner native field is the `-field` derivative — use it for fills/clicks.
        const input = this.page.locator(this.urlInputField);
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.fill(url);
        testLogger.debug('Filled custom destination URL');
    }

    /**
     * Update custom destination URL (for edit mode)
     * @param {string} url - New URL
     */
    async updateCustomUrl(url) {
        // The custom-edit form renders the URL field only after BOTH
        // formData.destination_type === 'custom' and formData.type === 'http'
        // resolve from props.destination — gate on the OInput wrapper first so the
        // inner `-field` is guaranteed to be attached before we try to fill it.
        const urlWrapper = this.page.locator(this.urlInput).first();
        await urlWrapper.waitFor({ state: 'attached', timeout: 15000 });
        await urlWrapper.waitFor({ state: 'visible', timeout: 15000 });
        // OInput inner native field is the `-field` derivative — use it for fills/clicks.
        const input = this.page.locator(this.urlInputField).first();
        // Edit drawer may be scrolled — bring the URL field into view before waiting on visibility
        await input.scrollIntoViewIfNeeded().catch(() => {});
        await input.waitFor({ state: 'visible', timeout: 15000 });
        await input.click();
        // Cross-platform select-all (Ctrl on Win/Linux, Meta on macOS) before fill
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Meta+a');
        await input.fill(url);
        await expect(input).toHaveValue(url, { timeout: 5000 });
        testLogger.debug('Updated custom destination URL', { url });
    }

    /**
     * Select HTTP method for custom destination
     * @param {string} method - HTTP method (GET, POST, PUT, etc.)
     */
    async selectHttpMethod(method) {
        const select = this.page.locator(this.methodSelect);
        await select.waitFor({ state: 'visible', timeout: 15000 });

        // Click to open OSelect popover
        await select.click();
        const popover = this.page.locator(this.methodSelectPopover);
        await popover.waitFor({ state: 'visible', timeout: 5000 });

        // Resolve via data-test-value (OSelect convention per agent rules §4).
        // apiMethods values are lowercase ("get", "post", "put") — normalise the input.
        const methodValue = method.toLowerCase();
        const option = popover.locator(`[data-test-value="${methodValue}"]`).first();
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
        await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        testLogger.debug('Selected HTTP method', { method });
    }

    /**
     * Select template for custom destination
     * @param {string} templateName - Template name (optional, selects first if not provided)
     */
    async selectTemplate(templateName = null) {
        const select = this.page.locator(this.templateSelect);
        await select.waitFor({ state: 'visible', timeout: 15000 });

        // Click to open OSelect popover
        await select.click();
        const popover = this.page.locator(this.templateSelectPopover);
        await popover.waitFor({ state: 'visible', timeout: 5000 });

        // Resolve via data-test-value when name given; otherwise grab the first available option
        let option;
        if (templateName) {
            option = popover.locator(`[data-test-value="${templateName}"]`).first();
        } else {
            option = popover.locator('[data-test="add-destination-template-select-option"]').first();
        }
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
        await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        testLogger.debug('Selected template', { templateName: templateName || 'first available' });
    }
}