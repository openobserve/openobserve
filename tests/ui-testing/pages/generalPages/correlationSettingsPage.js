import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * Page Object for Correlation Settings page
 * Route: /web/settings/correlation_settings?org_identifier={orgId}
 *
 * Tabs:
 * - Service Identity (identity)
 * - Discovered Services (services)
 * - Alert Correlation (alert-correlation)
 */
export class CorrelationSettingsPage {
    constructor(page) {
        this.page = page;

        // ==================== Main Page Selectors ====================
        this.pageTitle = '.general-page-title';
        this.pageSubtitle = '.general-page-subtitle';

        // Tab selectors (Quasar tabs - use role="tab" or .q-tab class)
        // Note: Quasar tabs use name attribute: identity, services, alert-correlation
        this.tabsContainer = '.q-tabs';
        this.serviceIdentityTabName = 'Service Identity';
        this.discoveredServicesTabName = 'Discovered Services';
        this.alertCorrelationTabName = 'Alert Correlation';

        // ==================== Service Identity Tab Selectors ====================
        this.serviceIdentityBackwardBtn = '[data-test="correlation-service-identity-backward-btn"]';
        this.serviceIdentityForwardBtn = '[data-test="correlation-service-identity-forward-btn"]';
        this.serviceIdentitySearchInput = '[data-test="correlation-service-identity-available-search-input"]';
        this.serviceIdentityResetBtn = '[data-test="correlation-service-identity-reset-btn"]';
        this.serviceIdentitySaveBtn = '[data-test="correlation-service-identity-save-btn"]';

        // ==================== Discovered Services Tab Selectors ====================
        this.retryDiscoveredServicesBtn = '[data-test="retry-discovered-services-btn"]';
        this.refreshDiscoveredServicesBtn = '[data-test="refresh-discovered-services-btn"]';

        // ==================== Alert Correlation Tab Selectors ====================
        this.dedupSettingsRefreshBtn = '[data-test="dedup-settings-refresh-btn"]';
        this.organizationDedupEnableCheckbox = '[data-test="organization-deduplication-enable-checkbox"]';
        this.crossAlertEnableCheckbox = '[data-test="organizationdeduplication-enable-cross-alert-checkbox"]';
        this.defaultWindowInput = '[data-test="organizationdeduplication-default-window-input"]';

        // ==================== Semantic Field Groups Selectors ====================
        this.semanticGroupCategorySelect = '[data-test="semantic-group-category-select"]';
        this.importJsonBtn = '[data-test="correlation-semanticfieldgroup-import-json-btn"]';
        this.addCustomGroupBtn = '[data-test="correlation-semanticfieldgroup-add-custom-group-btn"]';

        // ==================== Semantic Group Item Selectors ====================
        this.semanticGroupDisplayInput = '[data-test="semantic-group-display-input"]';
        this.semanticGroupScopeCheckbox = '[data-test="semantic-group-action-scope-chkbox"]';
        this.semanticGroupStableCheckbox = '[data-test="semantic-group-action-stable-chkbox"]';
        this.semanticGroupNormalizeCheckbox = '[data-test="semantic-group-action-normalize-chkbox"]';
        this.semanticGroupRemoveBtn = '[data-test="semantic-group-remove-group-btn"]';

        // ==================== Common Selectors ====================
        this.loadingSpinner = '.q-spinner-hourglass';
        this.notification = '.q-notification__message';
    }

    // ==================== Test Data Setup ====================

    /**
     * Ensure semantic groups exist in the backend for testing fingerprint checkboxes
     * Uses PUT /api/{org}/alerts/deduplication/semantic-groups to set semantic groups
     * AND POST /api/{org}/alerts/deduplication/config to include them in the config
     * The frontend reads semantic groups from the config endpoint first
     * @param {string} orgId - Organization identifier
     * @returns {Promise<boolean>} - True if successful
     */
    async ensureSemanticGroupsExist(orgId) {
        const baseUrl = process.env["ZO_BASE_URL"];
        const username = process.env["ZO_ROOT_USER_EMAIL"];
        const password = process.env["ZO_ROOT_USER_PASSWORD"];
        const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

        // Define test semantic groups that cover common use cases
        const testSemanticGroups = [
            {
                id: 'k8s-cluster',
                display: 'K8s Cluster',
                group: 'Kubernetes',
                fields: ['k8s.cluster.name', 'k8s_cluster_name'],
                normalize: true,
                is_scope: true,
                is_stable: true
            },
            {
                id: 'k8s-namespace',
                display: 'K8s Namespace',
                group: 'Kubernetes',
                fields: ['k8s.namespace.name', 'k8s_namespace_name'],
                normalize: true,
                is_scope: true,
                is_stable: true
            },
            {
                id: 'k8s-deployment',
                display: 'K8s Deployment',
                group: 'Kubernetes',
                fields: ['k8s.deployment.name', 'k8s_deployment_name'],
                normalize: true,
                is_scope: false,
                is_stable: true
            },
            {
                id: 'service',
                display: 'Service',
                group: 'Common',
                fields: ['service.name', 'service_name', 'service'],
                normalize: true,
                is_scope: false,
                is_stable: true
            }
        ];

        testLogger.info('Setting up test semantic groups via API', { orgId, groupCount: testSemanticGroups.length });

        try {
            // Step 1: PUT semantic groups to the semantic-groups endpoint
            const putUrl = `${baseUrl}/api/${orgId}/alerts/deduplication/semantic-groups`;
            testLogger.info('PUT semantic groups', { url: putUrl });

            const putResponse = await fetch(putUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(testSemanticGroups)
            });

            const putText = await putResponse.text();
            testLogger.info('PUT semantic-groups response', {
                status: putResponse.status,
                statusText: putResponse.statusText,
                body: putText.substring(0, 500)
            });

            // Step 2: POST to config endpoint with semantic_field_groups included
            // This is critical because the frontend reads from /config first, not /semantic-groups
            const configUrl = `${baseUrl}/api/${orgId}/alerts/deduplication/config`;
            const configPayload = {
                enabled: true,
                alert_dedup_enabled: false, // Don't enable cross-alert by default, let tests control this
                alert_fingerprint_groups: [],
                semantic_field_groups: testSemanticGroups
            };

            testLogger.info('POST deduplication config with semantic groups', { url: configUrl });

            const configPostResponse = await fetch(configUrl, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configPayload)
            });

            const configPostText = await configPostResponse.text();
            testLogger.info('POST config response', {
                status: configPostResponse.status,
                statusText: configPostResponse.statusText,
                body: configPostText.substring(0, 500)
            });

            // Step 3: Verify by GET config (this is what frontend loads)
            const configGetResponse = await fetch(configUrl, {
                method: 'GET',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                }
            });

            const configResult = await configGetResponse.json().catch(() => ({}));
            testLogger.info('GET deduplication config verification', {
                status: configGetResponse.status,
                enabled: configResult.enabled,
                alertDedupEnabled: configResult.alert_dedup_enabled,
                semanticGroupCount: configResult.semantic_field_groups?.length || 0,
                semanticGroupIds: configResult.semantic_field_groups?.map(g => g.id) || []
            });

            // Success if both PUT and POST succeeded
            return putResponse.ok && configPostResponse.ok;
        } catch (error) {
            testLogger.error('Failed to setup semantic groups', { error: error.message, stack: error.stack });
            return false;
        }
    }

    // ==================== Navigation ====================

    async navigateToCorrelationSettings(orgId) {
        const baseUrl = process.env.INGESTION_URL || process.env.ZO_BASE_URL;
        await this.page.goto(`${baseUrl}/web/settings/correlation_settings?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ==================== Page Assertions ====================

    async expectPageLoaded() {
        await expect(this.page.locator(this.pageTitle)).toBeVisible({ timeout: 15000 });
        const titleText = await this.page.locator(this.pageTitle).textContent();
        expect(titleText.toLowerCase()).toContain('correlation');
    }

    async expectAllTabsVisible() {
        // Use getByRole for tabs or filter by text
        const serviceIdentityTab = this.page.getByRole('tab', { name: this.serviceIdentityTabName });
        const discoveredServicesTab = this.page.getByRole('tab', { name: this.discoveredServicesTabName });
        const alertCorrelationTab = this.page.getByRole('tab', { name: this.alertCorrelationTabName });

        await expect(serviceIdentityTab).toBeVisible({ timeout: 15000 });
        await expect(discoveredServicesTab).toBeVisible();
        await expect(alertCorrelationTab).toBeVisible();
    }

    // ==================== Tab Switching ====================

    async clickServiceIdentityTab() {
        const tab = this.page.getByRole('tab', { name: this.serviceIdentityTabName });
        await tab.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async clickDiscoveredServicesTab() {
        const tab = this.page.getByRole('tab', { name: this.discoveredServicesTabName });
        await tab.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async clickAlertCorrelationTab() {
        const tab = this.page.getByRole('tab', { name: this.alertCorrelationTabName });
        await tab.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async expectServiceIdentityTabActive() {
        const tab = this.page.getByRole('tab', { name: this.serviceIdentityTabName });
        await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    }

    async expectDiscoveredServicesTabActive() {
        const tab = this.page.getByRole('tab', { name: this.discoveredServicesTabName });
        await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    }

    async expectAlertCorrelationTabActive() {
        const tab = this.page.getByRole('tab', { name: this.alertCorrelationTabName });
        await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    }

    // ==================== Service Identity Tab Actions ====================

    async expectServiceIdentityContentVisible() {
        // Wait for the section to be visible by checking for buttons
        await expect(this.page.locator(this.serviceIdentitySaveBtn)).toBeVisible({ timeout: 15000 });
    }

    async fillSearchAvailableDimensions(searchText) {
        const searchInput = this.page.locator(this.serviceIdentitySearchInput);
        await expect(searchInput).toBeVisible({ timeout: 10000 });
        await searchInput.fill(searchText);
        await this.page.waitForTimeout(500); // Wait for filtering
    }

    async clearSearchAvailableDimensions() {
        const searchInput = this.page.locator(this.serviceIdentitySearchInput);
        await searchInput.clear();
        await this.page.waitForTimeout(500);
    }

    async clickAddDimensionButton() {
        const btn = this.page.locator(this.serviceIdentityBackwardBtn);
        // Wait for button to be enabled
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        // Check if enabled, if not wait a bit
        const isDisabled = await btn.getAttribute('disabled');
        if (isDisabled !== null) {
            await this.page.waitForTimeout(500);
        }
        await btn.click({ force: true });
    }

    async clickRemoveDimensionButton() {
        const btn = this.page.locator(this.serviceIdentityForwardBtn);
        // Wait for button to be visible
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        // Check if enabled, if not wait a bit
        const isDisabled = await btn.getAttribute('disabled');
        if (isDisabled !== null) {
            await this.page.waitForTimeout(500);
        }
        await btn.click({ force: true });
    }

    async clickResetButton() {
        await this.page.locator(this.serviceIdentityResetBtn).click();
    }

    async clickSaveServiceIdentity() {
        await this.page.locator(this.serviceIdentitySaveBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async expectAddDimensionButtonEnabled() {
        const btn = this.page.locator(this.serviceIdentityBackwardBtn);
        await expect(btn).not.toBeDisabled();
    }

    async expectAddDimensionButtonDisabled() {
        const btn = this.page.locator(this.serviceIdentityBackwardBtn);
        await expect(btn).toBeDisabled();
    }

    async expectSaveButtonVisible() {
        await expect(this.page.locator(this.serviceIdentitySaveBtn)).toBeVisible({ timeout: 10000 });
    }

    async expectResetButtonVisible() {
        await expect(this.page.locator(this.serviceIdentityResetBtn)).toBeVisible({ timeout: 10000 });
    }

    // ==================== Discovered Services Tab Actions ====================

    async expectDiscoveredServicesContentVisible() {
        // Wait for loading to finish
        await this.page.locator(this.loadingSpinner).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        // Check for refresh button (always visible) or empty state
        const refreshBtn = this.page.locator(this.refreshDiscoveredServicesBtn);
        await expect(refreshBtn.first()).toBeVisible({ timeout: 15000 });
    }

    async clickRefreshDiscoveredServices() {
        await this.page.locator(this.refreshDiscoveredServicesBtn).first().click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async expectDiscoveredServicesLoading() {
        await expect(this.page.locator(this.loadingSpinner)).toBeVisible({ timeout: 5000 });
    }

    async expectDiscoveredServicesLoaded() {
        await this.page.locator(this.loadingSpinner).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    }

    async expectRefreshDiscoveredServicesButtonVisible() {
        const refreshBtn = this.page.locator(this.refreshDiscoveredServicesBtn).first();
        await expect(refreshBtn).toBeVisible({ timeout: 15000 });
    }

    // ==================== Alert Correlation Tab Actions ====================

    async expectAlertCorrelationContentVisible() {
        await expect(this.page.locator(this.organizationDedupEnableCheckbox)).toBeVisible({ timeout: 15000 });
    }

    async clickEnableDeduplicationCheckbox() {
        await this.page.locator(this.organizationDedupEnableCheckbox).click();
    }

    async clickEnableCrossAlertCheckbox() {
        await this.page.locator(this.crossAlertEnableCheckbox).click();
    }

    async expectCrossAlertCheckboxVisible() {
        await expect(this.page.locator(this.crossAlertEnableCheckbox)).toBeVisible({ timeout: 5000 });
    }

    async expectCrossAlertCheckboxHidden() {
        await expect(this.page.locator(this.crossAlertEnableCheckbox)).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Check if the cross-alert deduplication checkbox is currently checked
     * @returns {Promise<boolean>} True if checkbox is checked
     */
    async isCrossAlertCheckboxChecked() {
        const checkbox = this.page.locator(this.crossAlertEnableCheckbox);
        // Quasar checkbox uses aria-checked attribute
        const ariaChecked = await checkbox.getAttribute('aria-checked');
        if (ariaChecked !== null) {
            return ariaChecked === 'true';
        }
        // Fallback to checking the inner input if visible
        const input = checkbox.locator('input[type="checkbox"]');
        if (await input.count() > 0) {
            return await input.isChecked();
        }
        // Last resort - check for checked class
        const hasCheckedClass = await checkbox.evaluate(el => {
            return el.classList.contains('q-checkbox--checked') ||
                   el.closest('.q-checkbox')?.classList.contains('q-checkbox--checked');
        }).catch(() => false);
        return hasCheckedClass;
    }

    async fillTimeWindowInput(minutes) {
        const input = this.page.locator(this.defaultWindowInput);
        await expect(input).toBeVisible({ timeout: 5000 });
        await input.fill(String(minutes));
    }

    async getTimeWindowValue() {
        const input = this.page.locator(this.defaultWindowInput);
        return await input.inputValue();
    }

    async clickRefreshDedupSettings() {
        await this.page.locator(this.dedupSettingsRefreshBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async expectEnableDedupCheckboxVisible() {
        await expect(this.page.locator(this.organizationDedupEnableCheckbox)).toBeVisible({ timeout: 10000 });
    }

    async expectTimeWindowInputVisible() {
        await expect(this.page.locator(this.defaultWindowInput)).toBeVisible({ timeout: 10000 });
    }

    async expectDedupRefreshButtonVisible() {
        await expect(this.page.locator(this.dedupSettingsRefreshBtn)).toBeVisible({ timeout: 10000 });
    }

    // ==================== Fingerprint Checkbox Actions ====================

    async clickFingerprintCheckbox(groupId) {
        const selector = `[data-test="organizationdeduplication-fingerprint-${groupId}-checkbox"]`;
        await this.page.locator(selector).click();
    }

    async expectFingerprintCheckboxVisible(groupId) {
        const selector = `[data-test="organizationdeduplication-fingerprint-${groupId}-checkbox"]`;
        await expect(this.page.locator(selector)).toBeVisible({ timeout: 5000 });
    }

    // ==================== Semantic Field Groups Actions ====================

    async clickCategorySelect() {
        await this.page.locator(this.semanticGroupCategorySelect).click();
    }

    async selectCategory(categoryName) {
        await this.clickCategorySelect();
        await this.page.getByRole('option', { name: categoryName }).click();
    }

    async clickImportJsonButton() {
        await this.page.locator(this.importJsonBtn).click();
    }

    async clickAddCustomGroupButton() {
        await this.page.locator(this.addCustomGroupBtn).click();
        await this.page.waitForTimeout(500);
    }

    async expectAddCustomGroupButtonVisible() {
        await expect(this.page.locator(this.addCustomGroupBtn)).toBeVisible({ timeout: 10000 });
    }

    async expectCategorySelectVisible() {
        await expect(this.page.locator(this.semanticGroupCategorySelect)).toBeVisible({ timeout: 10000 });
    }

    async expectImportJsonButtonVisible() {
        await expect(this.page.locator(this.importJsonBtn)).toBeVisible({ timeout: 10000 });
    }

    // ==================== Service Identity Navigation Buttons ====================

    async expectBackwardButtonVisible() {
        await expect(this.page.locator(this.serviceIdentityBackwardBtn)).toBeVisible({ timeout: 10000 });
    }

    async expectForwardButtonVisible() {
        await expect(this.page.locator(this.serviceIdentityForwardBtn)).toBeVisible({ timeout: 10000 });
    }

    // ==================== Semantic Group Item Actions ====================

    async fillSemanticGroupDisplayName(name, index = 0) {
        const input = this.page.locator(this.semanticGroupDisplayInput).nth(index);
        await input.fill(name);
    }

    async toggleSemanticGroupScope(index = 0) {
        await this.page.locator(this.semanticGroupScopeCheckbox).nth(index).click();
    }

    async toggleSemanticGroupStable(index = 0) {
        await this.page.locator(this.semanticGroupStableCheckbox).nth(index).click();
    }

    async toggleSemanticGroupNormalize(index = 0) {
        await this.page.locator(this.semanticGroupNormalizeCheckbox).nth(index).click();
    }

    async clickRemoveSemanticGroup(index = 0) {
        await this.page.locator(this.semanticGroupRemoveBtn).nth(index).click();
    }

    async getSemanticGroupCount() {
        return await this.page.locator(this.semanticGroupDisplayInput).count();
    }

    // ==================== Notification Helpers ====================

    async expectNotificationVisible(expectedText = null, timeout = 5000) {
        const notification = this.page.locator(this.notification);
        await expect(notification).toBeVisible({ timeout });

        if (expectedText) {
            const text = await notification.textContent();
            expect(text.toLowerCase()).toContain(expectedText.toLowerCase());
        }
    }

    async expectSuccessNotification(timeout = 5000) {
        await this.expectNotificationVisible(null, timeout);
    }

    // ==================== Functional Test Helpers ====================

    async getAvailableDimensionsCount() {
        // Count items in the available dimensions list (right side)
        const list = this.page.locator('.q-list').nth(1);
        await list.waitFor({ state: 'visible', timeout: 10000 });
        const items = list.locator('.q-item');
        return await items.count();
    }

    async expectSearchFiltersResults(searchTerm, expectedToFilter = true) {
        // Get initial count
        const initialCount = await this.getAvailableDimensionsCount();

        // Enter search term
        await this.fillSearchAvailableDimensions(searchTerm);
        await this.page.waitForTimeout(500);

        // Get filtered count
        const filteredCount = await this.getAvailableDimensionsCount();

        if (expectedToFilter) {
            // Should have fewer or equal items after filtering
            return filteredCount <= initialCount;
        }
        return true;
    }

    async expectPositiveNotification(timeout = 5000) {
        const notification = this.page.locator('.q-notification--positive, .q-notification.bg-positive');
        await expect(notification).toBeVisible({ timeout });
    }

    async waitForNotificationToDisappear(timeout = 10000) {
        await this.page.locator(this.notification).waitFor({ state: 'hidden', timeout }).catch(() => {});
    }

    async refreshPage() {
        await this.page.reload();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async isDedupCheckboxChecked() {
        const checkbox = this.page.locator(this.organizationDedupEnableCheckbox);
        // Quasar checkboxes use aria-checked or have a specific class when checked
        const isChecked = await checkbox.getAttribute('aria-checked');
        if (isChecked !== null) {
            return isChecked === 'true';
        }
        // Fallback: check for checked class
        const classList = await checkbox.getAttribute('class');
        return classList?.includes('q-checkbox--checked') || classList?.includes('checked');
    }

    // ==================== Alert Correlation Save Button ====================

    async clickSaveAlertCorrelation() {
        // The save button in Alert Correlation tab
        const saveBtn = this.page.getByRole('button', { name: /save/i }).last();
        await saveBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async expectAlertCorrelationSaveSuccess() {
        // Wait for positive notification about saved settings
        const notification = this.page.locator('.q-notification__message');
        await expect(notification).toBeVisible({ timeout: 10000 });
        const text = await notification.textContent();
        return text?.toLowerCase().includes('saved') || text?.toLowerCase().includes('success');
    }

    // ==================== Phase 1 High Priority - Dimension Management ====================

    /**
     * Select an available dimension from the right list by name
     * @param {string} dimensionName - Name of dimension to select
     */
    async selectAvailableDimension(dimensionName) {
        // Available dimensions are in the second q-list (right side) within service-identity-config
        const serviceConfig = this.page.locator('.service-identity-config');
        await serviceConfig.waitFor({ state: 'visible', timeout: 10000 });
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const rightList = lists.last();
        await rightList.waitFor({ state: 'visible', timeout: 5000 });
        const item = rightList.locator('.q-item').filter({ hasText: dimensionName }).first();
        await item.click();
        // Wait for button to become enabled
        await this.page.waitForTimeout(300);
    }

    /**
     * Select a priority dimension from the left list by name
     * @param {string} dimensionName - Name of dimension to select
     */
    async selectPriorityDimension(dimensionName) {
        // Priority dimensions are in the first q-list (left side) within service-identity-config
        const serviceConfig = this.page.locator('.service-identity-config');
        await serviceConfig.waitFor({ state: 'visible', timeout: 10000 });
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const leftList = lists.first();
        await leftList.waitFor({ state: 'visible', timeout: 5000 });
        const item = leftList.locator('.q-item').filter({ hasText: dimensionName }).first();
        await item.click();
        // Wait for button to become enabled
        await this.page.waitForTimeout(300);
    }

    /**
     * Get count of dimensions in the priority list (left side)
     * @returns {Promise<number>}
     */
    async getPriorityDimensionsCount() {
        const serviceConfig = this.page.locator('.service-identity-config');
        await serviceConfig.waitFor({ state: 'visible', timeout: 10000 });
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const leftList = lists.first();
        await leftList.waitFor({ state: 'visible', timeout: 5000 });
        // Exclude empty state items (the "No dimensions configured" message)
        const items = leftList.locator('.q-item:not(:has-text("No"))');
        return await items.count();
    }

    /**
     * Check if a dimension exists in the priority list
     * @param {string} dimensionName - Name of dimension to check
     */
    async expectPriorityDimensionExists(dimensionName) {
        const serviceConfig = this.page.locator('.service-identity-config');
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const leftList = lists.first();
        const item = leftList.locator('.q-item').filter({ hasText: dimensionName }).first();
        await expect(item).toBeVisible({ timeout: 5000 });
    }

    /**
     * Check if a dimension does NOT exist in the priority list
     * @param {string} dimensionName - Name of dimension to check
     */
    async expectPriorityDimensionNotExists(dimensionName) {
        const serviceConfig = this.page.locator('.service-identity-config');
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const leftList = lists.first();
        const item = leftList.locator('.q-item').filter({ hasText: dimensionName }).first();
        await expect(item).not.toBeVisible({ timeout: 5000 });
    }

    // ==================== Phase 1 High Priority - Fingerprint Groups ====================

    /**
     * Get all fingerprint group checkboxes
     * @returns {import('@playwright/test').Locator}
     */
    getFingerprintGroupCheckboxes() {
        return this.page.locator('[data-test^="organizationdeduplication-fingerprint-"]');
    }

    /**
     * Expect fingerprint groups section to be visible
     */
    async expectFingerprintGroupsVisible() {
        const checkboxes = this.getFingerprintGroupCheckboxes();
        await expect(checkboxes.first()).toBeVisible({ timeout: 10000 });
    }

    /**
     * Expect fingerprint groups section to be hidden
     */
    async expectFingerprintGroupsHidden() {
        const checkboxes = this.page.locator('[data-test^="organizationdeduplication-fingerprint-"]');
        await expect(checkboxes.first()).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Get count of fingerprint group checkboxes
     * @returns {Promise<number>}
     */
    async getFingerprintGroupsCount() {
        const checkboxes = this.getFingerprintGroupCheckboxes();
        return await checkboxes.count();
    }

    /**
     * Check if a specific fingerprint group is checked
     * @param {string} groupId - The group ID
     * @returns {Promise<boolean>}
     */
    async isFingerprintGroupChecked(groupId) {
        const selector = `[data-test="organizationdeduplication-fingerprint-${groupId}-checkbox"]`;
        const checkbox = this.page.locator(selector);
        const isChecked = await checkbox.getAttribute('aria-checked');
        if (isChecked !== null) {
            return isChecked === 'true';
        }
        const classList = await checkbox.getAttribute('class');
        return classList?.includes('q-checkbox--checked') || classList?.includes('checked');
    }

    /**
     * Expect validation error notification to be visible
     * @param {string} expectedMessage - Expected error message (partial match)
     */
    async expectValidationErrorVisible(expectedMessage = null) {
        const notification = this.page.locator('.q-notification--negative, .q-notification.bg-negative, .q-notification__message');
        await expect(notification.first()).toBeVisible({ timeout: 10000 });
        if (expectedMessage) {
            const text = await notification.first().textContent();
            expect(text.toLowerCase()).toContain(expectedMessage.toLowerCase());
        }
    }

    /**
     * Click the Cancel button in Alert Correlation tab
     */
    async clickCancelAlertCorrelation() {
        const cancelBtn = this.page.getByRole('button', { name: /cancel/i });
        await cancelBtn.click();
    }

    // ==================== Phase 1 High Priority - Discovered Services ====================

    /**
     * Expect loading spinner to be visible (during data fetch)
     */
    async expectLoadingSpinnerVisible() {
        await expect(this.page.locator(this.loadingSpinner)).toBeVisible({ timeout: 5000 });
    }

    /**
     * Expect discovered services data to be loaded (content visible)
     */
    async expectServicesDataLoaded() {
        await this.page.locator(this.loadingSpinner).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        // Check for either services content or empty state
        const hasContent = await this.page.locator('.q-table, .q-list, .discovered-services-content').first().isVisible().catch(() => false);
        const hasEmptyState = await this.page.locator('text=/no.*service|empty/i').first().isVisible().catch(() => false);
        return hasContent || hasEmptyState;
    }

    /**
     * Expect empty state message when no services discovered
     */
    async expectEmptyStateVisible() {
        const emptyState = this.page.locator('text=/no.*service|empty|no data/i').first();
        await expect(emptyState).toBeVisible({ timeout: 10000 });
    }

    /**
     * Click the Retry button when in error state
     */
    async clickRetryButton() {
        await this.page.locator(this.retryDiscoveredServicesBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    /**
     * Expect retry button to be visible (error state)
     */
    async expectRetryButtonVisible() {
        await expect(this.page.locator(this.retryDiscoveredServicesBtn)).toBeVisible({ timeout: 10000 });
    }

    // ==================== Phase 1 High Priority - Error/Success Notifications ====================

    /**
     * Expect error notification to be visible
     * @param {string} message - Expected message content (optional)
     */
    async expectErrorNotificationVisible(message = null) {
        const notification = this.page.locator('.q-notification--negative, .q-notification.bg-negative');
        await expect(notification.first()).toBeVisible({ timeout: 10000 });
        if (message) {
            const text = await notification.first().textContent();
            expect(text.toLowerCase()).toContain(message.toLowerCase());
        }
    }

    /**
     * Expect success notification to be visible
     * @param {string} message - Expected message content (optional)
     */
    async expectSuccessNotificationVisible(message = null) {
        const notification = this.page.locator('.q-notification--positive, .q-notification.bg-positive, .q-notification__message');
        await expect(notification.first()).toBeVisible({ timeout: 10000 });
        if (message) {
            const text = await notification.first().textContent();
            expect(text.toLowerCase()).toContain(message.toLowerCase());
        }
    }

    // ==================== Phase 1 High Priority - Reset Functionality ====================

    /**
     * Click Reset to Defaults button and wait for confirmation
     */
    async clickResetToDefaults() {
        await this.page.locator(this.serviceIdentityResetBtn).click();
        // Wait for any confirmation dialog or immediate reset
        await this.page.waitForTimeout(500);
    }

    /**
     * Confirm reset dialog if present
     */
    async confirmResetDialog() {
        const confirmBtn = this.page.getByRole('button', { name: /confirm|yes|ok/i });
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmBtn.click();
        }
    }

    /**
     * Get the first available dimension name for testing
     * @returns {Promise<string>}
     */
    async getFirstAvailableDimensionName() {
        const serviceConfig = this.page.locator('.service-identity-config');
        await serviceConfig.waitFor({ state: 'visible', timeout: 10000 });
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const rightList = lists.last();
        await rightList.waitFor({ state: 'visible', timeout: 5000 });
        const firstItem = rightList.locator('.q-item:not(:has-text("No"))').first();
        // Try to get just the label text
        const label = firstItem.locator('.q-item__label').first();
        if (await label.isVisible().catch(() => false)) {
            return await label.textContent();
        }
        // Fallback to full text
        const fullText = await firstItem.textContent();
        // Extract dimension name (usually formatted like "Name (id)")
        const match = fullText.match(/([A-Za-z0-9\s\-_]+\s*\([^)]+\))/);
        return match ? match[1].trim() : fullText.trim();
    }

    /**
     * Get the first priority dimension name for testing
     * @returns {Promise<string>}
     */
    async getFirstPriorityDimensionName() {
        const serviceConfig = this.page.locator('.service-identity-config');
        await serviceConfig.waitFor({ state: 'visible', timeout: 10000 });
        // Lists have q-list--bordered class (from Quasar bordered prop) and tw:h-80 height class
        const lists = serviceConfig.locator('.q-list--bordered, .q-list.tw\\:h-80');
        const leftList = lists.first();
        await leftList.waitFor({ state: 'visible', timeout: 5000 });
        const firstItem = leftList.locator('.q-item:not(:has-text("No"))').first();
        // Try to get just the label text
        const label = firstItem.locator('.q-item__label').first();
        if (await label.isVisible().catch(() => false)) {
            return await label.textContent();
        }
        // Fallback to full text
        const fullText = await firstItem.textContent();
        // Extract dimension name
        const match = fullText.match(/([A-Za-z0-9\s\-_]+\s*\([^)]+\))/);
        return match ? match[1].trim() : fullText.trim();
    }

    /**
     * Check if backward (add) button is enabled
     * @returns {Promise<boolean>}
     */
    async isAddButtonEnabled() {
        try {
            const btn = this.page.locator(this.serviceIdentityBackwardBtn);
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            const isDisabled = await btn.getAttribute('disabled', { timeout: 2000 });
            return isDisabled === null;
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if forward (remove) button is enabled
     * @returns {Promise<boolean>}
     */
    async isRemoveButtonEnabled() {
        try {
            const btn = this.page.locator(this.serviceIdentityForwardBtn);
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            const isDisabled = await btn.getAttribute('disabled', { timeout: 2000 });
            return isDisabled === null;
        } catch (e) {
            return false;
        }
    }

    // ==================== Utility Helpers ====================

    /**
     * Wait for UI to stabilize after an action (e.g., selection, toggle)
     * @param {number} ms - Milliseconds to wait (default: 500)
     */
    async waitForUIStabilization(ms = 500) {
        await this.page.waitForTimeout(ms);
    }

    /**
     * Short wait for quick UI updates (e.g., button state changes)
     * @param {number} ms - Milliseconds to wait (default: 300)
     */
    async waitForQuickUpdate(ms = 300) {
        await this.page.waitForTimeout(ms);
    }
}
