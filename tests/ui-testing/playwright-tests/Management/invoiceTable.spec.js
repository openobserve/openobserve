const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

// Stripe totals are integer minor units (2 digits USD/EUR, 0 JPY); the table divides by 10 ** minorDigits.
const usdInvoice = {
    period_start: 1672531200,
    period_end: 1675209600,
    paid: true,
    total: 10000,
    currency: 'usd',
    amount_paid: 10000,
    amount_due: 0,
    attempt_count: 1,
    statue: 'paid',
    invoice_pdf: 'https://example.com/inv1.pdf',
};

const eurInvoice = {
    period_start: 1675209600,
    period_end: 1677628800,
    paid: false,
    total: 15050,
    currency: 'eur',
    amount_paid: 0,
    amount_due: 15050,
    attempt_count: 0,
    statue: 'open',
    invoice_pdf: 'https://example.com/inv2.pdf',
};

const jpyInvoice = {
    period_start: 1672531200,
    period_end: 1675209600,
    paid: true,
    total: 5000,
    currency: 'jpy',
    amount_paid: 5000,
    amount_due: 0,
    attempt_count: 1,
    statue: 'paid',
    invoice_pdf: 'https://example.com/inv3.pdf',
};

test.describe('Billing Invoice Currency Formatting testcases', () => {
    test.describe.configure({ mode: 'parallel' });

    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(!isCloudEnvironment(), 'Invoice history is Cloud-only (Stripe billing)');
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('Stripe USD and EUR invoice amounts render as localized currency', {
        tag: ['@invoice-currency-formatting', '@billing', '@cloud', '@all', '@P0'],
    }, async ({ page }) => {
        testLogger.info('Stubbing Stripe subscription and USD/EUR invoice history');
        await pm.billingInvoicesPage.stubBillingState([usdInvoice, eurInvoice]);
        await pm.billingInvoicesPage.gotoInvoiceHistory();

        await pm.billingInvoicesPage.expectContainsText('$100.00');
        await pm.billingInvoicesPage.expectContainsText('€150.50');
        await pm.billingInvoicesPage.expectNotContainsText('10000');
        await pm.billingInvoicesPage.expectNotContainsText('15050');

        testLogger.info('Test completed');
    });

    test('JPY invoice amount renders as zero-decimal currency', {
        tag: ['@invoice-currency-formatting', '@billing', '@cloud', '@all', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Stubbing Stripe subscription and JPY invoice history');
        await pm.billingInvoicesPage.stubBillingState([jpyInvoice]);
        await pm.billingInvoicesPage.gotoInvoiceHistory();

        await pm.billingInvoicesPage.expectContainsText('¥5,000');
        await pm.billingInvoicesPage.expectNotContainsText('¥50.00');
        await pm.billingInvoicesPage.expectNotContainsText('¥50');

        testLogger.info('Test completed');
    });

    test('A mixed-currency invoice list formats each row independently', {
        tag: ['@invoice-currency-formatting', '@billing', '@cloud', '@all', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Stubbing Stripe subscription and mixed USD/JPY invoice history');
        await pm.billingInvoicesPage.stubBillingState([usdInvoice, jpyInvoice]);
        await pm.billingInvoicesPage.gotoInvoiceHistory();

        await pm.billingInvoicesPage.expectRowCount(2);
        await pm.billingInvoicesPage.expectContainsText('$100.00');
        await pm.billingInvoicesPage.expectContainsText('¥5,000');
        await pm.billingInvoicesPage.expectNotContainsText('10000');

        testLogger.info('Test completed');
    });
});
