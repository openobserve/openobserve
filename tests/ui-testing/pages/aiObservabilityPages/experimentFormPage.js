// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class ExperimentFormPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── URL building ──────────────────────────────────────────────────────
        this.orgId = process.env['ORGNAME'] || 'default';
        this.baseUrl = (process.env['ZO_BASE_URL'] || 'http://localhost:5080').replace(/\/+$/, '');

        // ── Form chrome ───────────────────────────────────────────────────────
        this.formTitle = '[data-test="ai-experiment-form-title"]';
        this.identitySection = '[data-test="ai-experiment-form-identity-section"]';
        this.taskSection = '[data-test="ai-experiment-form-task-section"]';
        this.scorersSection = '[data-test="ai-experiment-form-scorers-section"]';
        this.submitBtn = '[data-test="ai-experiment-form-submit-btn"]';
        this.cancelBtn = '[data-test="ai-experiment-form-cancel-btn"]';

        // ── Fields (OFormInput/OFormSelect data-test → -field / -error) ───────
        this.nameInput = '[data-test="ai-experiment-form-name-input-field"]';
        this.nameError = '[data-test="ai-experiment-form-name-input-error"]';
        this.datasetSelect = '[data-test="ai-experiment-form-dataset-select"]';
        this.scorersSelect = '[data-test="ai-experiment-form-scorers-select"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async gotoCreateForm() {
        testLogger.debug('Navigating to the new experiment form');
        await this.page.goto(`${this.baseUrl}/web/ai/experiments/new?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async gotoCloneForm(experimentId) {
        testLogger.debug('Navigating to the clone experiment form', { experimentId });
        await this.page.goto(
            `${this.baseUrl}/web/ai/experiments/new?org_identifier=${this.orgId}&clone_of=${experimentId}`,
        );
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ── Form assertions ───────────────────────────────────────────────────────

    async expectCreateTitleVisible() {
        await expect(this.page.locator(this.formTitle)).toBeVisible();
        await expect(this.page.locator(this.formTitle)).toContainText('New Experiment');
    }

    async expectSectionsVisible() {
        await expect(this.page.locator(this.identitySection)).toBeVisible();
        await expect(this.page.locator(this.taskSection)).toBeVisible();
        await expect(this.page.locator(this.scorersSection)).toBeVisible();
    }

    async expectSubmitButtonVisible() {
        await expect(this.page.locator(this.submitBtn)).toBeVisible();
    }

    async expectNameErrorVisible() {
        await expect(this.page.locator(this.nameError)).toBeVisible();
        await expect(this.page.locator(this.nameError)).toContainText('Name is required');
    }

    // ── Clone assertions ──────────────────────────────────────────────────────

    async expectCloneTitleVisible() {
        await expect(this.page.locator(this.formTitle)).toBeVisible();
        await expect(this.page.locator(this.formTitle)).toContainText('Clone Experiment');
    }

    async expectDatasetSelectDisabled() {
        await expect(this.page.locator(this.datasetSelect).locator('button').first()).toBeDisabled();
    }

    // ── Form actions ──────────────────────────────────────────────────────────

    async clickSubmit() {
        testLogger.debug('Clicking experiment form submit');
        await this.page.locator(this.submitBtn).click();
    }
}

module.exports = { ExperimentFormPage };
