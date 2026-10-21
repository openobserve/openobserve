const { expect } = require('@playwright/test');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');

// Page object for the Cloud-only billing invoice history table. The
// invoice-history tab is Stripe-gated (billingProvider === 'stripe'); both
// routes are stubbed so the suite runs on any Cloud org without a real Stripe
// subscription.
class BillingInvoicesPage {
    constructor(page) {
        this.page = page;

        this.container = page.locator('[data-test="invoice-history-container"]');
        this.rows = page.locator('[data-test="invoice-history-container"] tbody tr');
    }

    // Stub list_subscription (provider: stripe) and list_invoice_history with the
    // given invoice rows. Must be called before gotoInvoiceHistory so the routes
    // are armed when Billing.vue / invoiceTable.vue issue their requests.
    async stubBillingState(invoices) {
        await this.page.route(/\/billings\/list_subscription(\?.*)?$/, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { provider: 'stripe', customer_id: 'cus_e2e_test' },
            }),
        );
        await this.page.route(/\/billings\/invoices(\?.*)?$/, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { invoices },
            }),
        );
    }

    async gotoInvoiceHistory() {
        const org = getOrgIdentifier();
        await this.page.goto(`${baseUrl()}/web/billings/invoice_history?org_identifier=${org}`);
        await expect(this.container).toBeVisible({ timeout: 30000 });
    }

    async expectContainsText(text) {
        await expect(this.container).toContainText(text);
    }

    async expectNotContainsText(text) {
        await expect(this.container).not.toContainText(text);
    }

    async expectRowCount(count) {
        await expect(this.rows).toHaveCount(count);
    }
}

module.exports = { BillingInvoicesPage };
