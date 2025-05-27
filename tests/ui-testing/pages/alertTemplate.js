// pages/AlertTemplate.js

import { expect } from '@playwright/test';


export class  AlertTemplate {

    constructor(page) {
        this.page = page;
        this.addAlertButton = '[data-test="alert-template-list-add-alert-btn"]';
        this.templateNameInput = '[data-test="add-template-name-input"]';
        this.submitButton = '[data-test="add-template-submit-btn"]';
        this.templateImportButton = '[data-test="template-import"]';
        this.templateImportJsonButton = '[data-test="template-import-json-btn"]';
        this.templateImportError00NameInput = '[data-test="template-import-error-0-0"] [data-test="template-import-name-input"]';
        this.templateImportError10NameInput = '[data-test="template-import-error-1-0"] [data-test="template-import-name-input"]';
        this.importJsonInput = '[data-test="template-import-json-file-input"]';
        this.alertTemplateTab = '[data-test="alert-templates-tab"]';
        this.alertTemplateList = '[data-test="alert-template-list"]';
        this.templateImportUrlInput = '[data-test="template-import-url-input"]';
        this.templateImportUrlTab = '[data-test="tab-import_json_url"]';
        this.templateImportCancelButton = '[data-test="template-import-cancel-btn"]';
    }

    async navigateToAlertTemplate() {
        await this.page.waitForSelector(this.alertTemplateTab);
        await this.page.locator(this.alertTemplateTab).click();
    }

    async importTemplateButton() {
        await this.page.waitForSelector(this.templateImportButton);
        await this.page.locator(this.templateImportButton).click();
    }

    async ClickTemplateImportJsonButton() {
        await this.page.waitForSelector(this.templateImportJsonButton);
        await this.page.locator(this.templateImportJsonButton).click();
    }

    async ClickTemplateImportCancelButton() {
        await this.page.waitForSelector(this.templateImportCancelButton);
        await this.page.locator(this.templateImportCancelButton).click();
    }

    async ClickTemplateImportError00NameInput(name) {
        await this.page.waitForSelector(this.templateImportError00NameInput);
        await this.page.locator(this.templateImportError00NameInput).click();
        await this.page.locator(this.templateImportError00NameInput).fill(name);
    }

    async ClickTemplateImportError10NameInput(name) {
        await this.page.waitForSelector(this.templateImportError10NameInput);
        await this.page.locator(this.templateImportError10NameInput).click();
        await this.page.locator(this.templateImportError10NameInput).fill(name);
    }
    

    async importTemplateFromUrl(url) {
        await this.page.waitForSelector(this.templateImportUrlTab);
        await this.page.locator(this.templateImportUrlTab).click();
        await this.page.waitForSelector(this.templateImportUrlInput);
        await this.page.locator(this.templateImportUrlInput).click();
        await this.page.locator(this.templateImportUrlInput).fill(url);    
    }

    async importTemplate(filePath) {
        await this.page.waitForSelector(this.importJsonInput);
        await this.page.locator(this.importJsonInput).setInputFiles(filePath);
    }

    async checkForTextInTable(text) {
        await expect(this.page.locator('tbody')).toContainText(text);
    }
    
}

