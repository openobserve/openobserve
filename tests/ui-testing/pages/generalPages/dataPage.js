// dataPage.js
import { expect } from '@playwright/test';
import { openNavFlyoutChild } from '../commonActions.js';


export class DataPage {
    constructor(page) {
        this.page = page;

    }

    async gotoDataPage() {
        await openNavFlyoutChild(this.page, 'ingestion');
        await expect(this.page.getByRole('main')).toContainText('Data sources');
    }


    async dataPageDefaultOrg() {

        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();


    }

    async dataPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async dataPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async dataURLValidation() {
        await expect(this.page).toHaveURL(/ingestion/);
    }

    // ==========================================================================
    // AI Integrations selectors
    // ==========================================================================
    get aiIntegrationFirstItem() {
        return this.page.locator('[data-test^="ai-integrations-item-"]').first();
    }

    get aiIntegrationDetailPane() {
        return this.page.locator('[data-test="ai-integrations-detail-pane"]');
    }

    get aiIntegrationPlaceholder() {
        return this.page.getByText('Select an integration to view details.');
    }

    // ---- AI datasource categories (#11534) ----------------------------
    // Keyed on the category SLUG from components/ingestion/ai/data.ts, not the
    // tab label: the label goes through i18n and would break under a non-English
    // locale while the slug is part of the route.
    getAiCategoryTab(slug) {
        return this.page.locator(`[data-test="ai-integrations-category-${slug}"]`).first();
    }
    getAiIntegrationItems() {
        return this.page.locator('[data-test^="ai-integrations-item-"]');
    }

    async expectAiCategoryVisible(slug) {
        await expect(this.getAiCategoryTab(slug),
            `AI category tab "${slug}" must be present`).toBeVisible({ timeout: 15000 });
    }

    async openAiCategory(slug) {
        await this.getAiCategoryTab(slug).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /** Number of integrations listed in the open category. */
    async expectAiIntegrationsListed(minimum = 1) {
        const items = this.getAiIntegrationItems();
        await expect(items.first(),
            'The open AI category must list integrations').toBeVisible({ timeout: 15000 });
        const count = await items.count();
        expect(count,
            `The open AI category must list more than ${minimum} integration(s)`).toBeGreaterThan(minimum);
        return count;
    }

    async navigateToAIIntegrations(baseUrl, orgName) {
        const aiUrl = `${baseUrl || 'http://localhost:5080'}/web/ingestion/ai-integrations?org_identifier=${orgName || 'default'}`;
        await this.page.goto(aiUrl, { timeout: 15000 });
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    }

    async clickFirstAIIntegration() {
        await expect(this.aiIntegrationFirstItem, 'At least one AI integration should be visible').toBeVisible({ timeout: 5000 });
        await this.aiIntegrationFirstItem.click();
        await this.page.waitForTimeout(1500);
    }

    async verifyAIDetailRendered() {
        await expect(this.aiIntegrationPlaceholder, 'Bug #11682: placeholder should not show after clicking an integration').not.toBeVisible({ timeout: 5000 });
        const content = (await this.aiIntegrationDetailPane.textContent())?.trim() || '';
        expect(content.length, 'Bug #11682: AI Integration detail should show content').toBeGreaterThan(0);
        return content;
    }

}