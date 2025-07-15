import { expect } from '@playwright/test';
import { LoginPage } from '../loginPage.js';
import { LogsPage } from '../logsPages/logsPage.js';
import { IngestionPage } from '../ingestionPage.js';
import { ManagementPage } from '../managementPage.js';

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
        await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
        await this.page.waitForTimeout(1000);
    }

    async searchStream(streamName) {
        await this.page.getByPlaceholder("Search Stream").click();
        await this.page.getByPlaceholder("Search Stream").fill(streamName);
        await this.page.waitForTimeout(3000);
    }

    async verifyStreamNameVisibility(streamName) {
        await expect(this.page.getByText(streamName)).toBeVisible();
    }

    async exploreStream() {
        const streamButton = this.page.getByRole("button", { name: 'Explore' });
        await expect(streamButton).toBeVisible();
        await streamButton.click({ force: true });
        await this.page.waitForTimeout(1000);
    }

    async verifyStreamExploration() {
        await expect(this.page.url()).toContain("logs");
    }

    async goBack() {
        await this.page.goBack();
        await this.page.waitForTimeout(1000);
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
        await this.managementPage.checkStreaming();
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
} 