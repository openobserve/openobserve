// billingPlansPage.js — Page object for Billing > Plans (pricing cards)
// Feature: Enterprise/Cloud only — the /billings route isn't registered on the OSS build.
// Routes:
//   Plans: /web/billings/plans?org_identifier={org}
//
// All pricing data is derived at runtime from https://openobserve.ai/pricing.json and the
// list_subscription / ai/usage / billing_group/membership / paid_overage APIs, so the spec
// pins every source with page.route mocks. This object owns the route mocks, locators and
// assertions, keeping the spec a pure flow description.

import { expect } from '@playwright/test';

export class BillingPlansPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // Pro ("Pay as you go") card
        // ============================================================
        this.proSubscribeBtn = page.locator('[data-test="billing-plans-pro-subscribe-btn"]');
        this.proCancelBtn = page.locator('[data-test="billing-plans-pro-cancel-btn"]');
        this.proPriceOptions = page.locator('[data-test="billing-plans-pro-price-options"]');
        this.proPriceOptionBadge = page.locator('[data-test="billing-plans-pro-price-option-badge"]');
        this.proContactSalesBtn = page.locator('[data-test="billing-plans-pro-contact-sales-btn"]');
        this.proAdditionalInfo = page.locator('[data-test="billing-plans-pro-additional-info"]');

        // ============================================================
        // Enterprise card
        // ============================================================
        this.enterprisePriceBlock = page.locator('[data-test="billing-plans-enterprise-price"]');
        this.enterpriseContactBtn = page.locator('[data-test="billing-plans-enterprise-contact-btn"]');

        // ============================================================
        // Shared card controls
        // ============================================================
        this.pricingRetryBtn = page.locator('[data-test="billing-pricing-retry"]');

        // ============================================================
        // Child-org managed-billing panel
        // ============================================================
        this.managedBillingPanel = page.locator('[data-test="plans-managed-billing-panel"]');
        this.viewOrgGroupBtn = page.locator('[data-test="plans-view-org-group-btn"]');

        // ============================================================
        // AI credits card + paid-AI switch
        // ============================================================
        this.aiUsedByFeature = page.locator('[data-test="billing-ai-used-by-feature"]');
        this.paidAiUsage = page.locator('[data-test="billing-paid-ai-usage"]');
        this.paidAiUsageToggle = page.locator('[data-test="billing-paid-ai-usage-toggle"]');
        this.paidAiUsageHint = page.locator('[data-test="billing-paid-ai-usage-hint"]');

        // ============================================================
        // Text-only anchors (no data-test per feature doc "NEEDS SELECTOR")
        // ============================================================
        this.subscribedTag = page.getByText('Subscribed', { exact: true });
        this.onDiscountTag = page.getByText('On discount', { exact: true });
        this.aiCreditsLabel = page.getByText('AI credits', { exact: true });
        this.pricingErrorText = page.getByText('Pricing details did not load.', { exact: true });
    }

    // ----------------------------------------------------------------
    // Route mocks / API setup
    // The Plans page derives its state at runtime from the pricing.json fetch and the
    // list_subscription / ai/usage / billing_group/membership / paid_overage APIs, so the spec
    // pins every source with page.route mocks. These helpers own that setup so the spec stays
    // a pure flow description.
    // ----------------------------------------------------------------
    async pinListSubscription({ subscription_type, provider }) {
        await this.page.route(/\/billings\/list_subscription(\?.*)?$/, (route) =>
            route.fulfill({
                json: {
                    subscription_type: subscription_type ?? '',
                    provider: provider ?? null,
                    customer_id: null,
                },
            }),
        );
    }

    async mockPricingJson(json) {
        await this.page.route('https://openobserve.ai/pricing.json', (route) => route.fulfill({ json }));
    }

    async blockPricingJson() {
        await this.page.route('https://openobserve.ai/pricing.json', (route) => route.abort('failed'));
    }

    async mockHostedUrl(url) {
        await this.page.route(/\/billings\/hosted_subscription_url(\?.*)?$/, (route) => route.fulfill({ json: { url } }));
        // Land the redirect deterministically instead of hitting an unreachable external host.
        await this.page.route(url, (route) => route.fulfill({ body: '<html><body>checkout</body></html>' }));
    }

    async mockAiUsage(body) {
        await this.page.route(/\/api\/[^/]+\/ai\/usage(\?.*)?$/, (route) => route.fulfill({ json: body }));
    }

    async mockMembership(body) {
        await this.page.route(/\/billing_group\/membership(\?.*)?$/, (route) => route.fulfill({ json: body }));
    }

    async mockPaidOverage(status) {
        await this.page.route(/\/quota\/ai_credits\/paid_overage(\?.*)?$/, (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            return route.fulfill({ json: status });
        });
    }

    // Reads the live bootstrap `/config` response (the same endpoint the frontend boots from) to
    // learn the build type ("opensource" | "enterprise" | "cloud"). The /billings route is only
    // registered on Cloud/Enterprise builds (web/src/router/index.ts:30), so the spec skips the OSS
    // build from this signal instead of relying on a rendered label.
    async detectBuildType() {
        const baseUrl = process.env['ZO_BASE_URL'].replace(/\/+$/, '');
        const response = await this.page.request.get(`${baseUrl}/config`);
        const body = await response.json();
        return body.build_type;
    }

    // ----------------------------------------------------------------
    // Navigation
    // ----------------------------------------------------------------
    async gotoPlansPage(orgId) {
        const baseUrl = process.env['ZO_BASE_URL'].replace(/\/$/, '');
        await this.page.goto(`${baseUrl}/web/billings/plans?org_identifier=${orgId}`);
        await this.page.waitForURL(/\/billings\/plans/, { timeout: 30000 });
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // ----------------------------------------------------------------
    // Interactions
    // ----------------------------------------------------------------
    async clickProSubscribe() {
        await this.proSubscribeBtn.click();
    }

    async clickPricingRetry() {
        await this.pricingRetryBtn.first().click();
    }

    // ----------------------------------------------------------------
    // Assertions
    // ----------------------------------------------------------------
    async expectProManageBtnVisible() {
        await expect(this.proCancelBtn).toBeVisible();
    }

    async expectEnterpriseContactBtnVisible() {
        await expect(this.enterpriseContactBtn).toBeVisible();
    }

    async expectProSubscribeCount(count) {
        await expect(this.proSubscribeBtn).toHaveCount(count);
    }

    async expectProCancelCount(count) {
        await expect(this.proCancelBtn).toHaveCount(count);
    }

    async expectEnterpriseContactCount(count) {
        await expect(this.enterpriseContactBtn).toHaveCount(count);
    }

    async expectSubscribedCount(count) {
        await expect(this.subscribedTag).toHaveCount(count);
    }

    async expectOnDiscountCount(count) {
        await expect(this.onDiscountTag).toHaveCount(count);
    }

    async expectPriceOptionsVisible() {
        await expect(this.proPriceOptions).toBeVisible();
    }

    async expectPriceOptionVisible(index) {
        await expect(this.page.locator(`[data-test="billing-plans-pro-price-option-${index}"]`)).toBeVisible();
    }

    async expectPriceOptionBadgeCount(count) {
        await expect(this.proPriceOptionBadge).toHaveCount(count);
    }

    async expectProContactSalesCount(count) {
        await expect(this.proContactSalesBtn).toHaveCount(count);
    }

    async expectEnterprisePriceBlockVisible() {
        await expect(this.enterprisePriceBlock).toBeVisible();
    }

    async expectEnterprisePriceBlockCount(count) {
        await expect(this.enterprisePriceBlock).toHaveCount(count);
    }

    async expectPricingRetryCount(count) {
        await expect(this.pricingRetryBtn).toHaveCount(count);
    }

    async expectPricingErrorVisible() {
        await expect(this.pricingErrorText.first()).toBeVisible();
    }

    async expectPricingErrorCount(count) {
        await expect(this.pricingErrorText).toHaveCount(count);
    }

    async expectProAdditionalInfoVisible() {
        await expect(this.proAdditionalInfo).toBeVisible();
    }

    async expectManagedProviderTagVisible(tagText) {
        await expect(this.page.getByText(tagText, { exact: true }).first()).toBeVisible();
    }

    async expectManagedMessageVisible(message) {
        await expect(this.page.getByText(message).first()).toBeVisible();
    }

    async expectManagedBillingPanelVisible() {
        await expect(this.managedBillingPanel).toBeVisible();
    }

    async expectViewOrgGroupBtnVisible() {
        await expect(this.viewOrgGroupBtn).toBeVisible();
    }

    async expectAiCreditsVisible() {
        await expect(this.aiCreditsLabel.first()).toBeVisible();
    }

    async expectAiUsedByFeatureVisible() {
        await expect(this.aiUsedByFeature).toBeVisible();
    }

    async expectPaidAiUsageVisible() {
        await expect(this.paidAiUsage).toBeVisible();
    }

    async expectPaidAiUsageToggleVisible() {
        await expect(this.paidAiUsageToggle).toBeVisible();
    }

    async expectPaidAiUsageHintVisible() {
        await expect(this.paidAiUsageHint).toBeVisible();
    }
}
