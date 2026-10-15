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
        this.hearAboutUs = page.locator('[data-test="onboarding-get-started-hear-about-us-field"]');
        this.whereDoYouWork = page.locator('[data-test="onboarding-get-started-where-do-you-work-field"]');
        // The box itself: the wrapper's centre lands on the Privacy policy link in the label.
        this.agree = page.locator('[data-test="onboarding-get-started-agree-checkbox"]').getByRole('checkbox');
        this.skipBtn = page.locator('[data-test="onboarding-get-started-skip-btn"]');
        this.continueBtn = page.locator('[data-test="onboarding-get-started-submit-btn"]');
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
    async openAsFirstLogin(path, { orgId, prefill } = {}) {
        await this.page.goto(path);
        await this.page.evaluate(({ org, pre }) => {
            localStorage.setItem('isFirstTimeLogin', 'true');
            localStorage.removeItem(`o2.onboarding.firstSource.${org}`);
            if (pre) sessionStorage.setItem('o2.onboarding.prefill', JSON.stringify(pre));
            else sessionStorage.removeItem('o2.onboarding.prefill');
        }, { org: orgId, pre: prefill ?? null });
        await this.page.reload();
        await expect(this.title).toBeVisible({ timeout: 20000 });
    }

    async sourceIds() {
        return this.sources.evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-test').replace('onboarding-get-started-source-', '')));
    }

    async expectPicked(id) {
        await expect(this.source(id)).toHaveAttribute('data-state', 'checked');
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
