// pages/AlertTemplatePage.js

import { expect } from '@playwright/test';


export class  AlertTemplate {

    constructor(page) {
        this.page = page;
        this.addAlertButton = '[data-test="alert-template-list-add-alert-btn"]';
        this.templateNameInput = '[data-test="add-template-name-input"]';
        this.submitButton = '[data-test="add-template-submit-btn"]';
        this.templateImportButton = '[data-test="template-import"]';
        this.importJsonInput = '[data-test="template-import-json-file-input"]';
    }

    async addAlertTemplate(name) {
        await this.page.locator(this.addAlertButton).click();
        await this.page.locator(this.templateNameInput).fill(name);
        await this.page.locator(this.submitButton).click();
    }

    async importTemplate(filePath) {
        await this.page.locator(this.templateImportButton).click();
        await this.page.locator(this.importJsonInput).setInputFiles(filePath);
    }

    async checkForTextInTable(text) {
        await expect(this.page.locator('tbody')).toContainText(text);
    }
}

