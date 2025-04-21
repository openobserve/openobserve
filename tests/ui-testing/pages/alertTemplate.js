// pages/AlertTemplatePage.js

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
    
    async importTemplate(filePath) {
        await this.page.waitForSelector(this.importJsonInput);
        await this.page.locator(this.importJsonInput).setInputFiles(filePath);
    }

    async checkForTextInTable(text) {
        await expect(this.page.locator('tbody')).toContainText(text);
    }


}

