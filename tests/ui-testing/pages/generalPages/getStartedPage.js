// Copyright 2026 OpenObserve Inc.
const { expect } = require('@playwright/test');

const SOURCE_IDS = [
    'kubernetes', 'linux', 'windows', 'webserver', 'otel', 'http',
    'cloud', 'rum', 'llm', 'agent', 'unsure',
];

class GetStartedPage {
    /** @param {import('@playwright/test').Page} page */
    constructor(page) {
        this.page = page;
        this.dialog = page.locator('[data-test="main-layout-get-started-dialog"]');
        this.title = page.locator('[data-test="onboarding-get-started-title"]');
        this.subtitle = page.locator('[data-test="onboarding-get-started-subtitle"]');
        this.grid = page.locator('[data-test="onboarding-get-started-source-grid"]');
        this.sources = page.locator('[data-test^="onboarding-get-started-source-"]:not([data-test="onboarding-get-started-source-grid"])');
        this.connectCard = page.locator('[data-test="onboarding-get-started-connect-card"]');
        this.chips = page.locator('[data-test="onboarding-get-started-chips"]');
        this.moreChip = page.locator('[data-test="onboarding-get-started-more-chip"]');
        this.chooseBtn = page.locator('[data-test="onboarding-get-started-choose-btn"]');
        this.sampleCard = page.locator('[data-test="onboarding-get-started-sample-card"]');
        this.sampleBtn = page.locator('[data-test="onboarding-get-started-sample-btn"]');
        this.backBtn = page.locator('[data-test="onboarding-get-started-back-btn"]');
        this.search = page.locator('[data-test="onboarding-get-started-search"]');
        this.noMatch = page.locator('[data-test="onboarding-get-started-no-match"]');
        this.skipBtn = page.locator('[data-test="onboarding-get-started-skip-btn"]');
        this.connectPopup = page.locator('[data-test="connect-data-source-popup-dialog"]');
        this.pickGroup = page.locator('[data-test="ingestion-recommended-pick-group"]');
        this.attributionBodies = [];
    }

    static get SOURCE_IDS() {
        return SOURCE_IDS;
    }

    source(id) {
        return this.page.locator(`[data-test="onboarding-get-started-source-${id}"]`);
    }

    // Records each attribution body; OSS has no such endpoint, so there it answers 200 itself.
    async captureAttribution({ passThrough }) {
        await this.page.route(/\/api\/[^/]+\/billings\/new_user_attribution$/, async (route) => {
            this.attributionBodies.push(route.request().postDataJSON());
            if (passThrough) return route.continue();
            return route.fulfill({ status: 200, json: { code: 200, message: 'Success' } });
        });
    }

    // Puts this browser into the first-login state MainLayout opens the dialog for.
    async openAsFirstLogin(path, { orgId } = {}) {
        await this.page.goto(path);
        await this.page.evaluate((org) => {
            localStorage.setItem('isFirstTimeLogin', 'true');
            localStorage.removeItem(`o2.onboarding.firstSource.${org}`);
        }, orgId);
        await this.page.reload();
        await expect(this.title).toBeVisible({ timeout: 20000 });
    }

    async sourceIds() {
        return this.sources.evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-test').replace('onboarding-get-started-source-', '')));
    }

    // Opens the searchable list of every source from the connect card.
    async showAllSources() {
        await this.chooseBtn.click();
        await expect(this.grid).toBeVisible();
    }

    // Picks a source from the list; Not sure yet is not a pick any more and starts the sample.
    async pickFromList(id) {
        await this.showAllSources();
        await this.source(id).click();
    }

    async exploreSample() {
        await this.sampleBtn.click();
    }

    async storedPick(orgId) {
        return this.page.evaluate((org) => localStorage.getItem(`o2.onboarding.firstSource.${org}`), orgId);
    }

    async firstLoginFlag() {
        return this.page.evaluate(() => localStorage.getItem('isFirstTimeLogin'));
    }

    async readClipboard() {
        return this.page.evaluate(() => navigator.clipboard.readText());
    }
}

module.exports = { GetStartedPage };
