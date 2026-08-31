// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class PlaygroundPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── URL building ──────────────────────────────────────────────────────
        this.orgId = process.env['ORGNAME'] || 'default';
        this.baseUrl = (process.env['ZO_BASE_URL'] || 'http://localhost:5080').replace(/\/+$/, '');

        // ── Bench chrome ──────────────────────────────────────────────────────
        this.playgroundPage = '[data-test="ai-playground-page"]';
        this.playgroundTitle = '[data-test="ai-playground-title"]';
        this.runAllBtn = '[data-test="ai-playground-run-all-btn"]';
        this.windowCount = '[data-test="ai-playground-window-count"]';
        this.variableBar = '[data-test="ai-playground-variable-bar"]';
        this.resetBtn = '[data-test="ai-playground-reset-btn"]';

        // Reset uses the global useConfirmDialog composable, rendered via
        // ConfirmDialogProvider — not the legacy ConfirmDialog component.
        this.confirmDialog = '[data-test="confirm-dialog-provider"]';
        this.confirmSecondaryBtn = `${this.confirmDialog} [data-test="o-dialog-secondary-btn"]`;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async gotoPlayground() {
        testLogger.debug('Navigating to the AI Observability playground');
        await this.page.goto(`${this.baseUrl}/web/ai/playground?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ── Bench assertions ──────────────────────────────────────────────────────

    async expectPlaygroundPageVisible() {
        await expect(this.page.locator(this.playgroundPage)).toBeVisible();
    }

    async expectTitleVisible() {
        await expect(this.page.locator(this.playgroundTitle)).toBeVisible();
    }

    async expectRunAllButtonVisible() {
        await expect(this.page.locator(this.runAllBtn)).toBeVisible();
    }

    async expectWindowCountVisible() {
        await expect(this.page.locator(this.windowCount)).toBeVisible();
    }

    async expectVariableBarVisible() {
        await expect(this.page.locator(this.variableBar)).toBeVisible();
    }

    // ── Reset confirmation ────────────────────────────────────────────────────

    async clickReset() {
        testLogger.debug('Clicking playground reset');
        await this.page.locator(this.resetBtn).click();
    }

    async expectConfirmDialogVisible() {
        await expect(this.page.locator(this.confirmDialog)).toBeVisible();
    }

    async clickConfirmCancel() {
        testLogger.debug('Cancelling the playground reset confirmation');
        await this.page.locator(this.confirmSecondaryBtn).click();
    }

    async expectConfirmDialogHidden() {
        await expect(this.page.locator(this.confirmDialog)).toBeHidden();
    }
}

module.exports = { PlaygroundPage };
