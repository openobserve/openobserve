// rumPage.js
import { expect } from '@playwright/test';


export class RumPage {
    constructor(page) {
        this.page = page;
        this.rumPageMenu = page.locator('[data-test="menu-link-\\/rum-item"]');

        // Error Tracking selectors
        this.dateTimeDropdown = '[data-test="logs-search-bar-date-time-dropdown"]';
        this.runQueryButton = '[data-test="metrics-explorer-run-query-button"]';
        this.errorTrackingTab = 'text=Error Tracking';
        this.errorsTab = 'text=Errors';
        this.appTableContainer = '.app-table-container';
        this.errorViewerContainer = '.error-viewer-container';
        this.errorStacksSection = '.error-stacks';
    }

    async gotoRumPage() {
        await this.rumPageMenu.click();
    }

    async rumPageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();
    }

    async rumPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async rumPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async rumURLValidation() {
        await expect(this.page).toHaveURL(/rum/);
    }

    // ===== ERROR TRACKING PAGE METHODS =====

    async navigateToErrorTracking() {
        await this.page.locator(this.errorTrackingTab).or(this.page.locator(this.errorsTab)).first().click();
        await this.page.waitForTimeout(2000);
    }

    async expectErrorTrackingPageLoaded() {
        await expect(this.page.locator(this.dateTimeDropdown)).toBeVisible({ timeout: 10000 });
        await expect(this.page.locator(this.runQueryButton)).toBeVisible({ timeout: 5000 });
    }

    async openDateTimePicker() {
        await this.page.locator(this.dateTimeDropdown).click();
        await this.page.waitForTimeout(500);
    }

    async selectPastOneHour() {
        const pastHourOption = this.page.locator('text=Past 1 Hour').or(this.page.locator('text=Past 1 hour'));
        await pastHourOption.click();
        await this.page.waitForTimeout(1000);
    }

    async clickRunQuery() {
        await this.page.locator(this.runQueryButton).click();
    }

    async waitForQueryExecution() {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async expectErrorTableVisible() {
        await this.page.waitForSelector(this.appTableContainer, { timeout: 10000 }).catch(() => {});
    }

    async getErrorRowCount() {
        const rows = this.page.locator(`${this.appTableContainer} tbody tr`);
        return await rows.count();
    }

    async clickFirstErrorRow() {
        const firstRow = this.page.locator(`${this.appTableContainer} tbody tr`).first();
        await firstRow.click();
    }

    async expectErrorDetailViewLoaded() {
        await this.page.waitForSelector(this.errorViewerContainer, { timeout: 10000 });

        // Wait for loading to complete
        const loadingSpinner = this.page.locator('text=Loading').or(this.page.locator('.q-spinner'));
        await loadingSpinner.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    async expectTagsSectionVisible() {
        const tagsSection = this.page.locator('text=Tags').or(this.page.locator('.tags-title'));
        await expect(tagsSection).toBeVisible({ timeout: 5000 });
    }

    async getErrorViewerContainerText() {
        return await this.page.locator(this.errorViewerContainer).textContent();
    }

    async expectStackTraceVisible() {
        const stackTraceTitle = this.page.locator('text=Error Stack').or(this.page.locator('text=Stack Trace'));
        await expect(stackTraceTitle).toBeVisible({ timeout: 5000 });
    }

    async getStackTraceText() {
        const stackTraceSection = this.page.locator(this.errorStacksSection).or(this.page.locator('.error_stack')).first();
        if (await stackTraceSection.isVisible().catch(() => false)) {
            return await stackTraceSection.textContent();
        }
        return null;
    }

    async hasErrorRows() {
        await this.page.waitForSelector(`${this.appTableContainer} tbody tr`, { timeout: 10000 }).catch(() => {});
        const rows = this.page.locator(`${this.appTableContainer} tbody tr`);
        return (await rows.count()) > 0;
    }

}