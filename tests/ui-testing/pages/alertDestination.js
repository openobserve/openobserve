// pages/AlertDestination.js
import { expect } from '@playwright/test';

export class AlertDestination {
    constructor(page) {
        this.page = page;
        this.alertDestinationsTab = '[data-test="alert-destinations-tab"]';
        this.destinationImportButton = '[data-test="destination-import"]';
        this.destinationImportJsonButton = '[data-test="destination-import-json-btn"]';
        this.destinationImportCancelButton = '[data-test="destination-import-cancel-btn"]';
        this.alertDestinationsListTitle = '[data-test="alert-destinations-list-title"]';
        this.destinationImportUrlInput = '[data-test="destination-import-url-input"]';
        this.destinationImportUrlTab = '[data-test="tab-import_json_url"]';
    }

    async navigateToAlertDestinations() {
        await this.page.waitForSelector(this.alertDestinationsTab);
        await this.page.locator(this.alertDestinationsTab).click();
    }

    async clickImportDestinationButton() {
        await this.page.waitForSelector(this.destinationImportButton);
        await this.page.locator(this.destinationImportButton).click();
    }

    async clickImportDestinationJsonButton() {
        await this.page.waitForSelector(this.destinationImportJsonButton);
        await this.page.locator(this.destinationImportJsonButton).click();
    }

    async clickCancelDestinationImportButton() {
        await this.page.waitForSelector(this.destinationImportCancelButton);
        await this.page.locator(this.destinationImportCancelButton).click();
    }

    async importDestinationFromUrl(url) {
        await this.page.waitForSelector(this.destinationImportUrlTab);
        await this.page.locator(this.destinationImportUrlTab).click();
        await this.page.waitForSelector(this.destinationImportUrlInput);
        await this.page.locator(this.destinationImportUrlInput).click();
        await this.page.locator(this.destinationImportUrlInput).fill(url);    
    }

    async checkForTextInNotification(text) {
        await expect(this.page.locator('#q-notify')).toContainText(text);
    }
}
