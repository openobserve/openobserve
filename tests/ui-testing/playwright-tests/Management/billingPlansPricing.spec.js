const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Pricing JSON documents (mock targets for the external https://openobserve.ai/pricing.json fetch).
// Shapes copied from web/src/enterprise/components/billings/plans.spec.ts "pricing JSON" describe.
const PRICING_NEW = {
    data: [{
        cloud: [
            {
                title: 'Cloud Professional',
                pricingOptions: [
                    { label: 'Pay as you go', price: '$0.70', period: '/GB ingested', note: 'No commitment, billed monthly', badge: '' },
                    { label: 'Annual contract', price: '$0.50', period: '/GB ingested', note: '12-month commitment', badge: 'Save 28%' },
                ],
                features: [
                    { title: 'Logs, Metrics, Traces, RUM, Session Replay, Error tracking' },
                    { title: 'Ingestion, pay as you go', price: '$0.70 per GB', isSubItem: true, inPriceBlock: true },
                    { title: 'Ingestion, annual contract', price: '$0.50 per GB', isSubItem: true, inPriceBlock: true },
                    { title: 'Query', price: '$0.01 per GB', isSubItem: true },
                ],
                additionalInfo: '',
            },
            { title: 'Enterprise', price: 'Custom', priceNote: 'volume discounts, BYOB', features: [{ title: 'Pipelines' }, { title: 'SLAs' }] },
        ],
    }],
};

const PRICING_OLD = {
    data: [{
        cloud: [
            {
                title: 'Cloud Professional',
                price: '$0.50',
                period: '/GB ingested',
                priceNote: '+ $0.01/GB queried · billed monthly',
                additionalInfo: '*Includes 30% discount for annual commitment',
                features: [
                    { title: 'Logs, Metrics, Traces, RUM, Session Replay, Error tracking' },
                    { title: 'Ingestion', price: '$0.50 per GB*', isSubItem: true },
                    { title: 'Query', price: '$0.01 per GB', isSubItem: true },
                ],
            },
            { title: 'Enterprise', features: [{ title: 'Pipelines' }, { title: 'SLAs' }] },
        ],
    }],
};

const AI_USAGE_BODY = {
    credits_used: 5,
    credits_limit: 100,
    credits_remaining: 95,
    mode: 'free',
    requires_additional_credits: false,
    payer_org_id: null,
    used_by_feature: { chat: 2, incident: 2, incident_reanalysis: 1 },
};

const PAID_OVERAGE_ELIGIBLE = {
    feature: 'ai_credits',
    billing_status: 'eligible',
    organization: { org_id: 'default', enabled: false, can_manage: true },
    payer: null,
    effective: false,
};

const managedProviderCases = [
    { label: 'AWS Marketplace', subscription_type: '', provider: 'aws', tagText: 'AWS Marketplace', message: /handled through your AWS account/ },
    { label: 'Azure Marketplace', subscription_type: '', provider: 'azure', tagText: 'Azure Marketplace', message: /handled through your Azure account/ },
    { label: 'Contract', subscription_type: 'external-contract', provider: 'stripe', tagText: 'Contract', message: /handled through your contract/ },
];

test.describe('Enterprise Billing Plans Pricing Cards testcases', () => {
    test.describe.configure({ mode: 'parallel' });

    let pm;
    let buildType;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        pm = new PageManager(page);
        // /billings is registered on Cloud and Enterprise builds only (web/src/router/index.ts:30), so skip the OSS build.
        buildType = await pm.billingPlansPage.detectBuildType();
        test.skip(
            buildType === 'opensource',
            `Billing plans are Cloud/Enterprise only (build_type: ${buildType})`,
        );
        await navigateToBase(page);
        testLogger.info('Test setup completed');
    });

    // A pinned route still in flight when the test ends must not fail it after its assertions passed.
    test.afterEach(async ({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('should render both pricing cards with the Subscribed state and pricing options for a paid org', {
        tag: ['@billingPlansPricing', '@all', '@P0', '@cloud'],
    }, async ({ page }) => {
        testLogger.info('Pinning a pay-as-you-go Stripe subscription and pricing.json');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: 'pay-as-you-go', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectProManageBtnVisible();
        await pm.billingPlansPage.expectEnterpriseContactBtnVisible();
        await pm.billingPlansPage.expectProSubscribeCount(0);
        await pm.billingPlansPage.expectProCancelCount(1);
        await pm.billingPlansPage.expectSubscribedCount(1);
        await pm.billingPlansPage.expectPriceOptionsVisible();
        await pm.billingPlansPage.expectPriceOptionVisible(0);
        await pm.billingPlansPage.expectPriceOptionVisible(1);
        await pm.billingPlansPage.expectPriceOptionBadgeCount(1);
        await pm.billingPlansPage.expectProContactSalesCount(1);
        await pm.billingPlansPage.expectEnterpriseContactCount(1);
        testLogger.info('Test completed');
    });

    test('should show Subscribe for a free org and redirect to the hosted checkout URL', {
        tag: ['@billingPlansPricing', '@all', '@P0', '@cloud'],
    }, async ({ page }) => {
        const checkoutUrl = 'https://example.test/checkout';
        testLogger.info('Pinning a free subscription and mocking the hosted checkout redirect');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: '', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.mockHostedUrl(checkoutUrl);
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectProSubscribeCount(1);
        await pm.billingPlansPage.expectProCancelCount(0);
        await pm.billingPlansPage.clickProSubscribe();
        await expect(page).toHaveURL(checkoutUrl, { timeout: 30000 });
        testLogger.info('Test completed');
    });

    test('should show a retryable pricing error and recover on Retry', {
        tag: ['@billingPlansPricing', '@all', '@P1', '@cloud'],
    }, async ({ page }) => {
        testLogger.info('Blocking pricing.json, then re-mocking it before Retry');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: 'pay-as-you-go', provider: 'stripe' });
        await pm.billingPlansPage.blockPricingJson();
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectPricingErrorVisible();
        await pm.billingPlansPage.expectPricingRetryCount(2);

        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.clickPricingRetry();

        await pm.billingPlansPage.expectPricingErrorCount(0);
        await pm.billingPlansPage.expectPriceOptionsVisible();
        await pm.billingPlansPage.expectEnterprisePriceBlockVisible();
        testLogger.info('Test completed');
    });

    test('should render the Enterprise price block with exactly one On discount tag when priced', {
        tag: ['@billingPlansPricing', '@all', '@P1', '@cloud'],
    }, async ({ page }) => {
        testLogger.info('Mocking pricing.json with an Enterprise price');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: '', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectEnterprisePriceBlockVisible();
        await pm.billingPlansPage.expectOnDiscountCount(1);
        testLogger.info('Test completed');
    });

    for (const providerCase of managedProviderCases) {
        test(`should replace the Pro buttons with the ${providerCase.label} managed-billing message`, {
            tag: ['@billingPlansPricing', '@all', '@P1', '@cloud'],
        }, async ({ page }) => {
            testLogger.info(`Pinning ${providerCase.label} billing state`);
            await pm.billingPlansPage.pinListSubscription({
                subscription_type: providerCase.subscription_type,
                provider: providerCase.provider,
            });
            await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
            await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

            await pm.billingPlansPage.expectProSubscribeCount(0);
            await pm.billingPlansPage.expectProCancelCount(0);
            await pm.billingPlansPage.expectManagedProviderTagVisible(providerCase.tagText);
            await pm.billingPlansPage.expectManagedMessageVisible(providerCase.message);
            testLogger.info('Test completed');
        });
    }

    test('should render the AI credits card with the per-feature breakdown', {
        tag: ['@billingPlansPricing', '@all', '@P1', '@cloud'],
    }, async ({ page }) => {
        testLogger.info('Mocking ai/usage to surface the AI credits card');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: 'pay-as-you-go', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.mockAiUsage(AI_USAGE_BODY);
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectAiCreditsVisible();
        await pm.billingPlansPage.expectAiUsedByFeatureVisible();
        testLogger.info('Test completed');
    });

    test('should show the managed-billing panel for a child org', {
        tag: ['@billingPlansPricing', '@all', '@P2', '@cloud'],
    }, async ({ page }) => {
        // fetchMembership returns early unless config.isCloud === "true" (plans.vue:248), so on this
        // Enterprise build the membership is never fetched and the managed-billing panel cannot render.
        // Park as fixme until the panel is wired for non-Cloud builds; the assertion body stays intact.
        test.fixme(
            buildType !== 'cloud',
            'Child-org managed billing is Cloud-only: fetchMembership() returns early unless config.isCloud === "true" (plans.vue:248)',
        );
        testLogger.info('Mocking a non-null billing-group membership');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: '', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.mockMembership({ membership: { payer_org_id: 'payer-org', payer_org_name: 'Payer Org' } });
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectManagedBillingPanelVisible();
        await pm.billingPlansPage.expectViewOrgGroupBtnVisible();
        await pm.billingPlansPage.expectProSubscribeCount(0);
        await pm.billingPlansPage.expectProCancelCount(0);
        await pm.billingPlansPage.expectEnterpriseContactCount(0);
        testLogger.info('Test completed');
    });

    test('should show the On discount tag in the header only for the old-schema Enterprise card', {
        tag: ['@billingPlansPricing', '@all', '@P2', '@cloud'],
    }, async ({ page }) => {
        testLogger.info('Mocking the old pricing schema without an Enterprise price');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: '', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_OLD);
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectEnterprisePriceBlockCount(0);
        await pm.billingPlansPage.expectOnDiscountCount(1);
        await pm.billingPlansPage.expectProAdditionalInfoVisible();
        testLogger.info('Test completed');
    });

    test('should render the paid-AI-usage switch when the org is eligible', {
        tag: ['@billingPlansPricing', '@all', '@P2', '@cloud'],
    }, async ({ page }) => {
        testLogger.info('Mocking ai/usage and an eligible paid-overage status');
        await pm.billingPlansPage.pinListSubscription({ subscription_type: 'pay-as-you-go', provider: 'stripe' });
        await pm.billingPlansPage.mockPricingJson(PRICING_NEW);
        await pm.billingPlansPage.mockAiUsage(AI_USAGE_BODY);
        await pm.billingPlansPage.mockPaidOverage(PAID_OVERAGE_ELIGIBLE);
        await pm.billingPlansPage.gotoPlansPage(getOrgIdentifier());

        await pm.billingPlansPage.expectPaidAiUsageVisible();
        await pm.billingPlansPage.expectPaidAiUsageToggleVisible();
        await pm.billingPlansPage.expectPaidAiUsageHintVisible();
        testLogger.info('Test completed');
    });
});
