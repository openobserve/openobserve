// Copyright 2026 OpenObserve Inc.
// AI Assistant credits notice & paid-usage consent — E2E tests
//
// The triggering states (credit balance, consent requirement) are owned by the
// backend billing/trial-quota layer and cannot be reached through the UI in CI,
// so each scenario stubs the API with page.route — the same technique used by
// Onboarding/billing.spec.js. The credits notice is Cloud-only (O2AIChat.vue
// renders O2AICreditsNotice only when config.isCloud === "true"); the paid-usage
// consent (412) flow is not cloud-gated and runs wherever the chat is enabled.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

const exhaustedUsage = {
    mode: 'exhausted',
    credits_limit: 100,
    credits_remaining: 0,
    credits_used: 100,
    requires_additional_credits: false,
    payer_org_id: null,
    costs: { chat: 1, incident: 2, incident_reanalysis: 3 },
};

const lowUsage = {
    mode: 'free',
    credits_limit: 100,
    credits_remaining: 10,
    credits_used: 90,
    requires_additional_credits: false,
    payer_org_id: null,
    costs: { chat: 1, incident: 2, incident_reanalysis: 3 },
};

const contractExhaustedUsage = {
    mode: 'exhausted',
    credits_limit: 100,
    credits_remaining: 0,
    credits_used: 100,
    requires_additional_credits: true,
    payer_org_id: 'payer-org',
    costs: { chat: 1, incident: 2, incident_reanalysis: 3 },
};

test.describe('AI Assistant credits & paid-usage consent', () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Test setup completed');
    });

    // A pinned route still in flight when the test ends must not fail it.
    test.afterEach(async ({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('should show the exhausted credits notice with Plans and Refresh actions', {
        tag: ['@ai-assistant-credits', '@all', '@cloud', '@P0'],
    }, async ({ page }) => {
        test.skip(!isCloudEnvironment(), 'Credits notice is Cloud-only');
        testLogger.info('Testing exhausted credits notice');

        await pm.aiAssistantCreditsPage.mockAiUsage(exhaustedUsage);
        const opened = await pm.aiAssistantCreditsPage.openChat();
        test.skip(!opened, 'AI Assistant chat is not enabled in this build');

        await expect(pm.aiAssistantCreditsPage.getCreditsExhaustedLocator()).toBeVisible({ timeout: 15000 });
        await expect(pm.aiAssistantCreditsPage.getCreditsExhaustedLocator()).toContainText(
            'Your organization has used all of its AI credits.',
        );
        await expect(pm.aiAssistantCreditsPage.getCreditsPlansLocator()).toBeVisible();
        await expect(pm.aiAssistantCreditsPage.getCreditsRecheckLocator()).toBeVisible();
        await expect(pm.aiAssistantCreditsPage.getCreditsContactLocator()).toBeHidden();

        testLogger.info('Exhausted credits notice verified');
    });

    test('should show the low credits notice when free credits drop to 20% or less', {
        tag: ['@ai-assistant-credits', '@all', '@cloud', '@P0'],
    }, async ({ page }) => {
        test.skip(!isCloudEnvironment(), 'Credits notice is Cloud-only');
        testLogger.info('Testing low credits notice');

        await pm.aiAssistantCreditsPage.mockAiUsage(lowUsage);
        const opened = await pm.aiAssistantCreditsPage.openChat();
        test.skip(!opened, 'AI Assistant chat is not enabled in this build');

        await expect(pm.aiAssistantCreditsPage.getCreditsLowLocator()).toBeVisible({ timeout: 15000 });
        await expect(pm.aiAssistantCreditsPage.getCreditsLowLocator()).toContainText(
            '10 of 100 free AI credits left',
        );
        await expect(pm.aiAssistantCreditsPage.getCreditsPlansLocator()).toBeVisible();
        await expect(pm.aiAssistantCreditsPage.getCreditsRecheckLocator()).toBeHidden();

        testLogger.info('Low credits notice verified');
    });

    test('should show Contact Sales instead of Plans for an exhausted contract org', {
        tag: ['@ai-assistant-credits', '@all', '@cloud', '@P1'],
    }, async ({ page }) => {
        test.skip(!isCloudEnvironment(), 'Credits notice is Cloud-only');
        testLogger.info('Testing Contact Sales swap for contract org');

        await pm.aiAssistantCreditsPage.mockAiUsage(contractExhaustedUsage);
        const opened = await pm.aiAssistantCreditsPage.openChat();
        test.skip(!opened, 'AI Assistant chat is not enabled in this build');

        await expect(pm.aiAssistantCreditsPage.getCreditsExhaustedLocator()).toBeVisible({ timeout: 15000 });
        await expect(pm.aiAssistantCreditsPage.getCreditsContactLocator()).toBeVisible();
        await expect(pm.aiAssistantCreditsPage.getCreditsContactLocator()).toContainText(pm.aiAssistantCreditsPage.contactLabelText);
        await expect(pm.aiAssistantCreditsPage.getCreditsPlansLocator()).toBeHidden();

        testLogger.info('Contact Sales swap verified');
    });

    test('should re-check the balance and clear the exhausted notice after refresh', {
        tag: ['@ai-assistant-credits', '@all', '@cloud', '@P2'],
    }, async ({ page }) => {
        test.skip(!isCloudEnvironment(), 'Credits notice is Cloud-only');
        testLogger.info('Testing credits refresh transitions exhausted to low');

        await pm.aiAssistantCreditsPage.mockAiUsage(exhaustedUsage);
        const opened = await pm.aiAssistantCreditsPage.openChat();
        test.skip(!opened, 'AI Assistant chat is not enabled in this build');
        await expect(pm.aiAssistantCreditsPage.getCreditsExhaustedLocator()).toBeVisible({ timeout: 15000 });

        pm.aiAssistantCreditsPage.setAiUsage(lowUsage);
        await pm.aiAssistantCreditsPage.clickRecheck();

        await expect(pm.aiAssistantCreditsPage.getCreditsLowLocator()).toBeVisible({ timeout: 15000 });
        await expect(pm.aiAssistantCreditsPage.getCreditsExhaustedLocator()).toBeHidden();

        testLogger.info('Credits refresh transition verified');
    });

    test.fixme('AI chat is disabled in this build (ai_enabled=false — no model provider configured, so o2cfg.ai.has_agent_target() is false), so the O2AIPaidUsageConsent card never renders; see ai_enabled in src/api/management/src/request/status/mod.rs', {
        tag: ['@ai-assistant-credits', '@all', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Testing paid-usage consent gate and declined notice');

        const opened = await pm.aiAssistantCreditsPage.openChat();
        test.skip(!opened, 'AI Assistant chat is not enabled in this build');

        await pm.aiAssistantCreditsPage.mockChatTurn(412, {
            error_type: 'paid_overage_consent_required',
            consent: {
                feature: 'ai_credits',
                organization: {
                    org_id: process.env['ORGNAME'] || 'default',
                    enabled: false,
                    can_manage: true,
                },
                payer: null,
                effective: false,
                billing_status: 'subscription_required',
            },
        });
        await pm.aiAssistantCreditsPage.typePrompt('Show me error logs');
        await pm.aiAssistantCreditsPage.sendPrompt();

        await expect(pm.aiAssistantCreditsPage.getPaidUsageConsentLocator()).toBeVisible({ timeout: 15000 });
        await expect(pm.aiAssistantCreditsPage.getPaidUsageConsentLocator()).toContainText(
            'Turn on paid AI usage?',
        );

        // Enable is gated on the acknowledgement checkbox.
        await expect(pm.aiAssistantCreditsPage.getPaidUsageConsentEnableLocator()).toBeDisabled();
        await pm.aiAssistantCreditsPage.checkAuthorizationCheckbox();
        await expect(pm.aiAssistantCreditsPage.getPaidUsageConsentEnableLocator()).toBeEnabled();

        // Declining returns the composer and surfaces the declined notice.
        await pm.aiAssistantCreditsPage.clickConsentCancel();
        await expect(pm.aiAssistantCreditsPage.getPaidUsageConsentLocator()).toBeHidden();
        await expect(pm.aiAssistantCreditsPage.getChatStreamErrorLocator()).toContainText(
            "wasn't sent",
        );

        testLogger.info('Paid-usage consent gate and declined notice verified');
    });
});
