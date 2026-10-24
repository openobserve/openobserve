// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');
const billingStrings = require('../../../../web/src/locales/languages/en-US.json').billing;

export class AiAssistantCreditsPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // Header AI chat toggle (Header.vue). Rendered even when locked on a
        // non-entitled build, so availability is probed by whether the chat
        // composer mounts after clicking, not by the button's presence.
        this.aiChatToggle = '[data-test="menu-link-ai-item"]';

        // Chat composer — the RichTextInput's contenteditable, scoped to the
        // O2AIChat panel so it never collides with another editable surface.
        this.chatInput = '.chat-container [contenteditable="true"]';

        // Credits notice (O2AICreditsNotice.vue)
        this.creditsExhausted = '[data-test="o2-ai-credits-exhausted"]';
        this.creditsLow = '[data-test="o2-ai-credits-low"]';
        this.creditsPlans = '[data-test="o2-ai-credits-plans"]';
        this.creditsContact = '[data-test="o2-ai-credits-contact"]';
        this.contactLabelText = billingStrings.contactLabel;
        this.creditsRecheck = '[data-test="o2-ai-credits-recheck"]';

        // Paid-usage consent card (O2AIPaidUsageConsent.vue)
        this.paidUsageConsent = '[data-test="o2-ai-paid-usage-consent"]';
        this.paidUsageConsentEnable = '[data-test="o2-ai-paid-usage-consent-enable"]';
        this.paidUsageConsentCancel = '[data-test="o2-ai-paid-usage-consent-cancel"]';
        this.authorizationCheckbox = '[data-test="paid-overage-authorization-checkbox"]';

        // Chat error block (declined-notice / credits-exhausted surface)
        this.chatStreamError = '[data-test="o2-ai-chat-stream-error"]';

        // Mutable response read at fulfill time so the refresh test can swap
        // the balance between mount and the re-check click.
        this.aiUsageResponse = null;
    }

    /**
     * Opens the AI chat panel. Returns false on a build where the toggle is
     * locked (the chat composer never mounts) so callers can skip gracefully.
     * @returns {Promise<boolean>}
     */
    async openChat() {
        testLogger.debug('Opening AI chat panel');
        const toggle = this.page.locator(this.aiChatToggle);
        // Header.vue hides (not locks) the toggle when ai_enabled is false.
        if (!(await toggle.count())) {
            testLogger.debug('AI chat toggle not present — feature disabled on this build');
            return false;
        }
        await toggle.click();
        try {
            await this.page.locator(this.chatInput).waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch {
            testLogger.debug('AI chat composer did not mount — feature locked on this build');
            return false;
        }
    }

    /**
     * Stubs `GET /api/{org}/ai/usage` (drives O2AICreditsNotice) with the given
     * AiUsage payload. The response is re-read from `aiUsageResponse` on every
     * request, so `setAiUsage` can change it mid-test (the refresh re-check).
     * @param {object} usage
     */
    async mockAiUsage(usage) {
        this.aiUsageResponse = usage;
        await this.page.route(/\/api\/[^/]+\/ai\/usage(\?.*)?$/, async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(this.aiUsageResponse),
            });
        });
    }

    /** Swap the balance the ai/usage stub will return on its next call. */
    setAiUsage(usage) {
        this.aiUsageResponse = usage;
    }

    /**
     * Stubs `POST /api/{org}/ai/chat_stream` to refuse the turn with the given
     * status/body (e.g. 412 paid_overage_consent_required).
     * @param {number} status
     * @param {object} body
     */
    async mockChatTurn(status, body) {
        await this.page.route(/\/api\/[^/]+\/ai\/chat_stream(\?.*)?$/, async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            await route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        });
    }

    /** Types a prompt into the chat composer. */
    async typePrompt(text) {
        const input = this.page.locator(this.chatInput);
        await input.click();
        await input.fill(text);
    }

    /** Sends the typed prompt (Enter submits the RichTextInput). */
    async sendPrompt() {
        await this.page.locator(this.chatInput).press('Enter');
    }

    /** Clicks "Refresh" on the exhausted credits notice. */
    async clickRecheck() {
        await this.page.locator(this.creditsRecheck).click();
    }

    /** Checks the paid-usage authorization acknowledgement. */
    async checkAuthorizationCheckbox() {
        await this.page.locator(this.authorizationCheckbox).click();
    }

    /** Clicks "Cancel" on the paid-usage consent card. */
    async clickConsentCancel() {
        await this.page.locator(this.paidUsageConsentCancel).click();
    }

    // ── Locator getters (for expect() assertions in the spec) ────────────────

    getCreditsExhaustedLocator() { return this.page.locator(this.creditsExhausted); }
    getCreditsLowLocator() { return this.page.locator(this.creditsLow); }
    getCreditsPlansLocator() { return this.page.locator(this.creditsPlans); }
    getCreditsContactLocator() { return this.page.locator(this.creditsContact); }
    getCreditsRecheckLocator() { return this.page.locator(this.creditsRecheck); }
    getPaidUsageConsentLocator() { return this.page.locator(this.paidUsageConsent); }
    getPaidUsageConsentEnableLocator() { return this.page.locator(this.paidUsageConsentEnable); }
    getChatStreamErrorLocator() { return this.page.locator(this.chatStreamError); }
}
