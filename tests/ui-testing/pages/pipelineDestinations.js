// pipelineDestinations.js
import { expect } from '@playwright/test';


export class PipelineDestinations {
    constructor(page) {
        this.page = page;
        
    }

    async navigateToPipelineDestinations() {
        await this.page.locator('[data-test="menu-link-settings-item"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="menu-link-settings-item"]').click();
        await this.page.waitForTimeout(2000);
        await this.page.locator('[data-test="pipeline-destinations-tab"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="pipeline-destinations-tab"]').click();
    }

    async addDestination(name, url) {
        await this.page.locator('[data-test="alert-destination-list-add-alert-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
        await this.page.locator('[data-test="add-destination-name-input"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-name-input"]').fill(name);
        await this.page.locator('[data-test="add-destination-url-input"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-url-input"]').fill(url);
        await this.page.locator('[data-test="add-destination-submit-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-submit-btn"]').click();
    }

    async verifyDestinationAdded() {
        await expect(this.page.locator('[data-test="alert-destination-list-add-alert-btn"]')).toBeVisible();
    }
   

   

  
    
    
    


}