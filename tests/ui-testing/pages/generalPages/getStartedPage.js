// Copyright 2026 OpenObserve Inc.
// Cloud onboarding (/onboarding): step 1 choices, rows, which-one tiles, a guide or the coding
// agent page inside onboarding, the guide's step nav, the agent page's listen bar and the first-data panel.
const { expect } = require('@playwright/test');

const CHOICE_IDS = ['infrastructure', 'backend', 'frontend', 'logs', 'llm'];

class OnboardingPage {
    /** @param {import('@playwright/test').Page} page */
    constructor(page) {
        this.page = page;
        this.view = page.locator('[data-test="onboarding-view"]');
        this.skipBtn = page.locator('[data-test="onboarding-view-skip"]');
        this.choose = page.locator('[data-test="onboarding-step-choose"]');
        this.choices = page.locator('[data-test^="onboarding-step-choose-choice-"]');
        this.others = page.locator('[data-test^="onboarding-step-choose-other-"]');
        this.previewTitle = page.locator('[data-test="onboarding-preview-title"]');
        this.rows = page.locator('[data-test="onboarding-step-rows"]');
        this.which = page.locator('[data-test="onboarding-step-which"]');
        this.guide = page.locator('[data-test="onboarding-step-guide"]');
        this.agentSetup = page.locator('[data-test="onboarding-agent-setup"]');
        this.listenBar = page.locator('[data-test="onboarding-listen-bar"]');
        // The guide's data check: the one step in its nav that carries a status.
        this.guideStatus = page.locator('[data-test="onboarding-guide-rail"] [data-tone]');
        this.firstData = page.locator('[data-test="onboarding-first-data"]');
        this.firstDataOpen = page.locator('[data-test="onboarding-first-data-open"]');
        this.attributionBodies = [];
    }

    static get CHOICE_IDS() {
        return CHOICE_IDS;
    }

    choice(id) {
        return this.page.locator(`[data-test="onboarding-step-choose-choice-${id}"]`);
    }

    other(id) {
        return this.page.locator(`[data-test="onboarding-step-choose-other-${id}"]`);
    }

    row(id) {
        return this.page.locator(`[data-test="onboarding-step-rows-row-${id}"]`);
    }

    tile(id) {
        return this.page.locator(`[data-test="onboarding-step-which-guide-${id}"]`);
    }

    // Records each attribution body; OSS has no such endpoint, so there it answers 200 itself.
    async captureAttribution({ passThrough }) {
        await this.page.route(/\/api\/[^/]+\/billings\/new_user_attribution$/, async (route) => {
            this.attributionBodies.push(route.request().postDataJSON());
            if (passThrough) return route.continue();
            return route.fulfill({ status: 200, json: { code: 200, message: 'Success' } });
        });
    }

    // The signed-in user: the first-login flag holds their email, as Login sets it.
    static get USER_EMAIL() {
        return process.env.ZO_ROOT_USER_EMAIL;
    }

    // Puts this browser into the first-login state MainLayout sends to /onboarding (cloud, org with no data).
    async openAsFirstLogin(path, { orgId, prefill } = {}) {
        await this.page.goto(path);
        await this.page.evaluate(({ org, pre, email }) => {
            localStorage.setItem('isFirstTimeLogin', email);
            localStorage.removeItem(`o2.onboarding.firstSource.${org}`);
            if (pre) sessionStorage.setItem('o2.onboarding.prefill', JSON.stringify(pre));
            else sessionStorage.removeItem('o2.onboarding.prefill');
        }, { org: orgId, pre: prefill ?? null, email: OnboardingPage.USER_EMAIL });
        await this.page.reload();
    }

    async expectStepOne(timeout = 20000) {
        await this.page.waitForURL(/\/onboarding(\?|$)/, { timeout });
        await expect(this.choose).toBeVisible({ timeout });
    }

    async choiceIds() {
        return this.choices.evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-test').replace('onboarding-step-choose-choice-', '')));
    }

    async otherIds() {
        return this.others.evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-test').replace('onboarding-step-choose-other-', '')));
    }

    // tone: waiting | ok | attention
    async expectGuideStatus(tone, timeout = 20000) {
        await expect(this.guideStatus).toHaveAttribute('data-tone', tone, { timeout });
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

module.exports = { OnboardingPage };
