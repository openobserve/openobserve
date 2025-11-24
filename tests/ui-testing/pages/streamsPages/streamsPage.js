import { expect } from '@playwright/test';
import { LoginPage } from '../generalPages/loginPage.js';
import { LogsPage } from '../logsPages/logsPage.js';
import { IngestionPage } from '../generalPages/ingestionPage.js';
import { ManagementPage } from '../generalPages/managementPage.js';

import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';

export class StreamsPage {
    constructor(page) {
        this.page = page;
        
        // Initialize all the original page objects
        this.loginPage = new LoginPage(page);
        this.logsPage = new LogsPage(page);
        this.ingestionPage = new IngestionPage(page);
        this.managementPage = new ManagementPage(page);

        
        // Locators following alerts pattern - only the ones that were changed
        this.managementMenuItem = page.locator('[data-test="menu-link-settings-item"]');
        this.streamingToggle = page.locator('[data-test="general-settings-enable-streaming"]');
    }

    // Login methods - delegate to LoginPage
    async gotoLoginPage() {
        await this.loginPage.gotoLoginPage();
    }

    async loginAsInternalUser() {
        await this.loginPage.loginAsInternalUser();
    }

    async login() {
        await this.loginPage.login();
    }

    // Logs methods - delegate to LogsPage
    async navigateToLogs() {
        await this.logsPage.navigateToLogs();
    }

    async selectIndexAndStreamJoin() {
        await this.logsPage.selectIndexAndStreamJoin();
    }

    async selectIndexStreamDefault() {
        await this.logsPage.selectIndexStreamDefault();
    }

    async displayTwoStreams() {
        await this.logsPage.displayTwoStreams();
    }

    async selectRunQuery() {
        await this.logsPage.selectRunQuery();
    }

    async enableSQLMode() {
        await this.logsPage.enableSQLMode();
    }

    async clickQuickModeToggle() {
        await this.logsPage.clickQuickModeToggle();
    }

    async clickAllFieldsButton() {
        await this.logsPage.clickAllFieldsButton();
    }

    async clearAndFillQueryEditor(query) {
        await this.logsPage.clearAndFillQueryEditor(query);
    }

    async kubernetesContainerName() {
        await this.logsPage.kubernetesContainerName();
    }

    async kubernetesContainerNameJoin() {
        await this.logsPage.kubernetesContainerNameJoin();
    }

    async kubernetesContainerNameJoinLimit() {
        await this.logsPage.kubernetesContainerNameJoinLimit();
    }

    async kubernetesContainerNameJoinLike() {
        await this.logsPage.kubernetesContainerNameJoinLike();
    }

    async kubernetesContainerNameLeftJoin() {
        await this.logsPage.kubernetesContainerNameLeftJoin();
    }

    async kubernetesContainerNameRightJoin() {
        await this.logsPage.kubernetesContainerNameRightJoin();
    }

    async kubernetesContainerNameFullJoin() {
        await this.logsPage.kubernetesContainerNameFullJoin();
    }

    async clickInterestingFields() {
        await this.logsPage.clickInterestingFields();
    }

    async validateInterestingFields() {
        await this.logsPage.validateInterestingFields();
    }

    async validateInterestingFieldsQuery() {
        await this.logsPage.validateInterestingFieldsQuery();
    }

    async addRemoveInteresting() {
        await this.logsPage.addRemoveInteresting();
    }

    async toggleHistogram() {
        await this.logsPage.toggleHistogram();
    }

    async validateResult() {
        await this.logsPage.validateResult();
    }

    async displayCountQuery() {
        await this.logsPage.displayCountQuery();
    }

    async waitForSearchResultAndCheckText(expectedText) {
        await this.logsPage.waitForSearchResultAndCheckText(expectedText);
    }

    // Stream methods
    async navigateToStreamExplorer() {
        // First navigate to home if not already there
        if (!this.page.url().includes('web/logs')) {
            await this.page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env.ORGNAME}`);
            await this.page.waitForLoadState('networkidle');
        }
        
        try {
            await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
        } catch (error) {
            console.warn('Retry clicking streams menu:', error.message);
            await this.waitForUI(2000);
            await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
        }
        await this.waitForUI(1000);
    }

    async searchStream(streamName) {
        await this.page.getByPlaceholder("Search Stream").click();
        await this.page.getByPlaceholder("Search Stream").fill(streamName);
        await this.waitForUI(3000);
    }

    async verifyStreamNameVisibility(streamName) {
        await expect(this.page.getByText(streamName)).toBeVisible();
    }

    async exploreStream() {
        const streamButton = this.page.getByRole("button", { name: 'Explore' });
        await expect(streamButton).toBeVisible();
        await streamButton.click({ force: true });
        await this.waitForUI(1000);
    }

    async verifyStreamExploration() {
        await expect(this.page.url()).toContain("logs");
    }

    async goBack() {
        await this.page.goBack();
        await this.waitForUI(1000);
    }

    // Ingestion methods - delegate to IngestionPage
    async ingestion() {
        await this.ingestionPage.ingestion();
    }

    async ingestionJoin() {
        await this.ingestionPage.ingestionJoin();
    }

    // Management methods - delegate to ManagementPage with updated locators
    async goToManagement() {
        await this.managementPage.goToManagement();
    }

    async checkStreaming() {
        // await this.managementPage.checkStreaming();
    }

    // Additional methods for streamname test
    async ingestTestData(streamName) {
        const orgId = process.env["ORGNAME"];
        const headers = getHeaders();
        const ingestionUrl = getIngestionUrl(orgId, streamName);
        const payload = {
            level: "info",
            job: "test",
            log: `test message for stream ${streamName}`,
            e2e: "1",
        };
        const response = await sendRequest(this.page, ingestionUrl, payload, headers);
        console.log(`Ingested to ${streamName}:`, response);
        await this.page.waitForTimeout(2000);
    }

    // Validation methods
    async verifyNoHistogramError() {
        const errorHeading = this.page.getByRole('heading', { name: 'Error while fetching' });
        await expect(errorHeading).not.toBeVisible();
        const errorDetailsButton = this.page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(errorDetailsButton).not.toBeVisible();
    }

    // Validation method for 'No data found for histogram.'
    async expectNoDataFoundForHistogram() {
        await expect(this.page.getByText('warning No data found for histogram.')).toBeVisible();
    }

    // Methods from legacy streamsPage.js
    async gotoStreamsPage() {
        await this.page.locator('[data-test="menu-link-\\/streams-item"]').click();
    }

    async streamsPageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
    
        await this.page.waitForSelector('text=default'); 
    
        const defaultOption = this.page.locator('text=default').first(); // Target the first occurrence
        await defaultOption.click();
    }

    async streamsPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();

        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async streamsPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async streamsURLValidation() {
        await expect(this.page).toHaveURL(/streams/);
    }

    // Stream Settings Methods (minimal set for stream-settings.spec.js)
    async expectStreamExistsExact(streamName) {
        await expect(this.page.getByRole('cell', { name: streamName, exact: true })).toBeVisible();
    }

    async openStreamDetail(streamName) {
        await this.page.getByRole('button', { name: 'Stream Detail' }).first().click();
    }

    async searchForField(fieldName) {
        await this.page.locator('[data-test="schema-field-search-input"]').click();
        await this.page.locator('[data-test="schema-field-search-input"]').fill(fieldName);
    }

    async selectFullTextSearch() {
        // Open dropdown first
        await this.page.locator('[data-test="schema-stream-index-select"] div').filter({ hasText: 'arrow_drop_down' }).nth(1).click();
        await this.waitForUI(500);
        
        // Then select Full text search option
        await this.page.locator('div').filter({ hasText: /^Full text search$/ }).nth(1).click();
    }

    async selectSecondaryIndex() {
        // Dropdown stays open after first selection, so just select the option
        await this.page.getByText('Secondary index').click();
    }

    async clickUpdateSettingsButton() {
        await this.page.locator('[data-test="schema-update-settings-button"]').click();
    }

    async expectValidationErrorVisible() {
        // Field-agnostic validation error - matches any field name
        await expect(this.page.locator("text=/Field\\(s\\) '.*' cannot have/")).toBeVisible();
    }

    async verifyIndexTypeOptions() {
        // Wait a bit for the page to load completely
        await this.waitForUI(2000);
        
        try {
            // Click the dropdown arrow to open the options
            const dropdownArrow = this.page.locator('[data-test="schema-stream-index-select"] div').filter({ hasText: 'arrow_drop_down' }).nth(1);
            await dropdownArrow.click({ timeout: 5000 });
            console.log('✅ Clicked dropdown arrow');
            
            // Wait for dropdown to open
            await this.waitForUI(1000);
            
            // Check if Full text search and Secondary index options are visible in the dropdown
            const fullTextOption = this.page.locator('div').filter({ hasText: /^Full text search$/ }).nth(1);
            const secondaryIndexOption = this.page.getByText('Secondary index');
            
            const options = [];
            try {
                if (await fullTextOption.isVisible({ timeout: 3000 })) {
                    options.push('Full text search');
                    console.log('✅ Found Full text search option');
                }
            } catch (e) {
                console.log('⚠️  Full text search option not found');
            }
            
            try {
                if (await secondaryIndexOption.isVisible({ timeout: 3000 })) {
                    options.push('Secondary index');
                    console.log('✅ Found Secondary index option');
                }
            } catch (e) {
                console.log('⚠️  Secondary index option not found');
            }
            
            console.log(`Found ${options.length} options:`, options);
            return options;
            
        } catch (error) {
            console.log('⚠️  Error in verifyIndexTypeOptions:', error.message);
            return [];
        }
    }

    async clearIndexTypeSelection(indexType) {
        if (indexType === 'Full text search') {
            // When both are selected, UI shows "Secondary index, Full text" 
            // We need to click the combined option first, then clear full text
            try {
                // First check if both are selected (combined state)
                const combinedOption = this.page.getByText('Secondary index, Full text');
                if (await combinedOption.isVisible({ timeout: 2000 })) {
                    await this.page.locator('div').filter({ hasText: /^Full text search$/ }).nth(1).click();
                    return;
                }
            } catch (e) {
                // Fallback to individual clearing
            }
            
            // Try individual selector
            try {
                const element = this.page.locator('tr:has-text("Full text search") .q-checkbox__inner');
                if (await element.isVisible({ timeout: 1000 })) {
                    await element.click();
                }
            } catch (e) {
                // Continue silently
            }
        }
        await this.waitForUI(1000);
    }

    // Extended Retention Methods
    async navigateToExtendedRetention() {
        // First open the stream detail view
        await this.page.getByRole('button', { name: 'Stream Detail' }).first().click();
        await this.waitForUI(2000);
        
        // Navigate to Extended Retention tab directly
        await this.page.getByText('Extended Retention').click();
        await this.waitForUI(1000);
    }

    async selectDateRange(startDay, endDay) {
        await this.page.locator('[data-test="date-time-btn"]').click();
        
        // Use specific calendar locators to avoid strict mode violation
        await this.page.locator('.q-date__calendar .q-btn').filter({ hasText: startDay.toString() }).first().click();
        await this.page.locator('.q-date__calendar .q-btn').filter({ hasText: endDay.toString() }).first().click();
        
        await this.page.locator('[data-test="date-time-apply-btn"]').click();
    }

    async selectDateRangeForCurrentMonth() {
        const currentDate = new Date();
        const currentDay = currentDate.getDate();
        const endDay = Math.min(currentDay + 5, 28); // Select a date 5 days later or 28th, whichever is smaller
        
        await this.selectDateRange(currentDay, endDay);
        
        // Return the date range text for later use
        return `${currentDay.toString().padStart(2, '0')}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${currentDate.getFullYear()} ${endDay.toString().padStart(2, '0')}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${currentDate.getFullYear()}`;
    }

    async deleteRetentionPeriod(dateRangeText) {
        // Select the checkbox for deletion
        await this.page.getByRole('row', { name: dateRangeText }).locator('[data-test="schema-stream-delete-undefined-field-fts-key-checkbox"]').click();
        await this.page.locator('[data-test="schema-delete-button"]').click();
        await this.page.locator('[data-test="confirm-button"]').click();
    }

    async expectStreamSettingsUpdatedMessage() {
        await expect(this.page.getByText('Stream settings updated')).toBeVisible();
    }

    async waitForUI(milliseconds) {
        await this.page.waitForTimeout(milliseconds);
    }
} 