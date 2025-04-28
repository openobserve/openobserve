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
        this.destinationImportError00Input = '[data-test="destination-import-error-0-0"] [data-test="destination-import-template-input"]';
        this.destinationImportError01Input = '[data-test="destination-import-error-0-1"] [data-test="destination-import-name-input"]';
        this.destinationImportError02Input = '[data-test="destination-import-error-0-2"] [data-test="destination-import-emails-input"]';


        this.destinationImportError10Input = '[data-test="destination-import-error-1-0"] [data-test="destination-import-template-input"]';
        this.destinationImportError11Input = '[data-test="destination-import-error-1-1"] [data-test="destination-import-name-input"]';
        this.destinationImportError12Input = '[data-test="destination-import-error-1-2"] [data-test="destination-import-emails-input"]';
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

    async ClickDestinationImportError00Input(templateName) {
        await this.page.waitForSelector(this.destinationImportError00Input);
        await this.page.locator(this.destinationImportError00Input).click();
        await this.page.getByRole('option', { name: templateName }).locator('div').nth(2).click();
    }

    async ClickDestinationImportError01Input(destinationName) {
        await this.page.waitForSelector(this.destinationImportError01Input);
        await this.page.locator(this.destinationImportError01Input).click();
        await this.page.locator(this.destinationImportError01Input).fill(destinationName);
    }

    async ClickDestinationImportError02Input(email) {
        await this.page.waitForSelector(this.destinationImportError02Input);
        await this.page.locator(this.destinationImportError02Input).click();
        await this.page.locator(this.destinationImportError02Input).fill(email);
    }

    async ClickDestinationImportError10Input(templateName) {
        await this.page.waitForSelector(this.destinationImportError10Input);
        await this.page.locator(this.destinationImportError10Input).click();
        await this.page.getByRole('option', { name: templateName }).locator('div').nth(2).click();
    }

    async ClickDestinationImportError11Input(destinationName) {
        await this.page.waitForSelector(this.destinationImportError11Input);
        await this.page.locator(this.destinationImportError11Input).click();
        await this.page.locator(this.destinationImportError11Input).fill(destinationName);
    }

    async ClickDestinationImportError12Input(email) {
        await this.page.waitForSelector(this.destinationImportError12Input);
        await this.page.locator(this.destinationImportError12Input).click();
        await this.page.locator(this.destinationImportError12Input).fill(email);
    }

    

}