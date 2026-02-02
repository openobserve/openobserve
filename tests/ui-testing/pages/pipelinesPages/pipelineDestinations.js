
import { expect } from '@playwright/test';


export class PipelineDestinations {
    constructor(page) {
        this.page = page;

        this.pipelineDestinationsTabSelector = '[data-test="pipeline-destinations-tab"]';
    }

    async navigateToManagement() {

        // Wait for the settings menu link to be visible before clicking
        await this.page.locator('[data-test="menu-link-settings-item"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="menu-link-settings-item"]').click();
    }

    async navigateToPipelineDestinations() {
        // Wait for the pipeline destinations tab to be visible
        await this.page.locator(this.pipelineDestinationsTabSelector).waitFor({ state: 'visible' });   
        // Click the pipeline destinations tab
        await this.page.locator(this.pipelineDestinationsTabSelector).click();      
    }

    async addDestination(name, url) {
        await this.page.locator('[data-test="pipeline-destination-list-add-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="pipeline-destination-list-add-btn"]').click();
        await this.page.locator('[data-test="destination-type-card-openobserve"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="destination-type-card-openobserve"]').click();
        await this.page.locator('[data-test="step1-continue-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="step1-continue-btn"]').click();
        await this.page.locator('[data-test="add-destination-name-input"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-name-input"]').fill(name);
        await this.page.locator('[data-test="add-destination-url-input"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-url-input"]').fill(url);
        await this.page.locator('[data-test="add-destination-submit-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-submit-btn"]').click();
    }

    async verifyDestinationAdded() {
        await expect(this.page.locator('[data-test="pipeline-destination-list-add-btn"]')).toBeVisible();
    }

}