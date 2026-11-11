// Copyright 2026 OpenObserve Inc.
// Metering and budget storage exist only in Cloud builds, so the metering read and the budget reads and writes are mocked; the Usage page's own code stays real.
import { expect } from '@playwright/test';
const { getAuthHeaders } = require('../../playwright-tests/utils/cloud-auth.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

const DAY_SECONDS = 86_400;

const SETTINGS_URL = /\/api\/([^/]+)\/settings(\?.*)?$/;
const METERING_URL = /\/api\/[^/]+\/billings\/data_usage\/[^/?]+(\?.*)?$/;

const pricedMeter = (baseCost, unitDivisor, meteredAmount = 0) => ({
    base_cost: baseCost,
    unit_divisor: unitDivisor,
    metered_amount: meteredAmount,
    metered_cost: (baseCost / unitDivisor) * meteredAmount,
    percent_discount: 0,
    discounted_amount: 0,
});

export class BillingUsagePage {
    constructor(page) {
        this.page = page;

        this.topMeterCard = page.locator('[data-test="billings-usagetrends-kpi-top"]');
        this.totalCostCard = page.locator('[data-test="billings-usagetrends-kpi-total"]');
        this.meterRows = page.locator('[data-test="billings-usagetrends-meters"] tr[data-test^="o2-table-row-"]');

        this.budgetRoot = page.locator('[data-test="billings-usagebudget-root"]');
        this.budgetCard = page.locator('[data-test="billings-usagebudget-kpi-budget"]');
        this.budgetUnsetHint = page.locator('[data-test="billings-usagebudget-unset"]');
        this.budgetAmountField = page.locator('[data-test="billings-usagebudget-total-field"]');
        this.saveBudgetBtn = page.locator('[data-test="billings-usagebudget-save"]');
        this.toastMessage = page.locator('[data-test="o-toast-message"]');

        this.storedBudgets = [];
        this.budgetPosts = [];
    }

    // Field names and nesting follow the `price_details` body of GET /billings/data_usage.
    async mockMetering({ ingestionMb, searchMb, ratePerGb }) {
        const now = Math.floor(Date.now() / 1000);
        const cycleStart = now - Math.floor(11.5 * DAY_SECONDS);
        const ingestion = pricedMeter(ratePerGb, 1024, ingestionMb);
        const query = pricedMeter(ratePerGb, 1024, searchMb);
        const upcoming = {
            total_cost: ingestion.metered_cost + query.metered_cost,
            total_discounted_amount: 0,
            cycle_start: cycleStart,
            cycle_end: cycleStart + 30 * DAY_SECONDS,
            ingestion,
            query,
            retention: pricedMeter(0, 1024),
            pipeline: pricedMeter(0, 1024),
            remote_pipeline: pricedMeter(0, 1024),
            ai: pricedMeter(0, 1),
            synthetics_browser: pricedMeter(0, 1),
            synthetics_protocol: pricedMeter(0, 1),
            missing_details: [],
        };
        await this.page.route(METERING_URL, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    price_details: { upcoming, past: [], oldest_ts: cycleStart },
                }),
            }),
        );
    }

    // Holds budget_config across reads and writes because the server under test has nowhere to store it.
    async mockBudgetStorage(initialBudgets) {
        this.storedBudgets = initialBudgets;
        this.budgetPosts = [];
        await this.page.route(SETTINGS_URL, async (route) => {
            const request = route.request();
            if (request.method() === 'GET') {
                const response = await route.fetch();
                const body = await response.json();
                body.data = { ...body.data, budget_config: this.storedBudgets };
                return route.fulfill({ response, json: body });
            }
            const posted = request.method() === 'POST' ? request.postDataJSON() : null;
            if (!posted?.budget_config) return route.continue();
            this.budgetPosts.push({ orgId: request.url().match(SETTINGS_URL)[1], body: posted });
            // Same rule as the Cloud backend's check_budget_config, which refuses a $0 entry.
            if (posted.budget_config.some((entry) => entry.total_budget_amount <= 0)) {
                return route.fulfill({
                    status: 400,
                    json: { code: 400, message: 'budget amount must be greater than 0' },
                });
            }
            this.storedBudgets = posted.budget_config;
            return route.fulfill({ status: 200, json: { successful: 'true' } });
        });
    }

    // `size` is sent fractional so the stream infers the same float type the server's own usage reporter writes.
    async seedUsage(orgId, volumesMb) {
        const records = Object.entries(volumesMb).map(([event, size]) => ({
            event,
            size: size + 0.5,
            org_id: orgId,
        }));
        // Ingest answers 400 while a stream delete from an earlier run is still finishing.
        await expect
            .poll(
                async () => {
                    const ingest = await this.page.request.post(`${ingestionUrl()}/api/${orgId}/usage/_json`, {
                        headers: getAuthHeaders(),
                        data: records,
                    });
                    return ingest.status();
                },
                { timeout: 60000, intervals: [2000] },
            )
            .toBe(200);

        const now = Date.now() * 1000;
        await expect
            .poll(
                async () => {
                    const res = await this.page.request.post(`${baseUrl()}/api/${orgId}/_search?type=logs`, {
                        headers: getAuthHeaders(),
                        data: {
                            query: {
                                // The server's own reporter writes tiny rows here too, and those must not count as the seed.
                                sql: 'select event from "usage" where size > 1',
                                start_time: now - 3_600_000_000,
                                end_time: now + 3_600_000_000,
                                from: 0,
                                size: records.length + 1,
                            },
                        },
                    });
                    return res.ok() ? (await res.json()).hits.length : 0;
                },
                { timeout: 30000 },
            )
            .toBe(records.length);
    }

    async enableUsageReporting(orgId) {
        const res = await this.page.request.post(`${baseUrl()}/api/${orgId}/settings`, {
            headers: getAuthHeaders(),
            data: { usage_stream_enabled: true },
        });
        expect(res.ok()).toBeTruthy();
    }

    // A run killed before its cleanup leaves rows here; usually nothing is left, so a failed delete is expected and not checked.
    async clearLeftoverUsage(orgId) {
        await this.page.request.delete(`${baseUrl()}/api/${orgId}/streams/usage?type=logs`, { headers: getAuthHeaders() });
    }

    // Reporting goes off first, or the server's reporter would recreate the stream; soft, so a cleanup failure cannot hide the test's own.
    async removeUsageData(orgId) {
        const headers = getAuthHeaders();
        const reportingOff = await this.page.request.post(`${baseUrl()}/api/${orgId}/settings`, {
            headers,
            data: { usage_stream_enabled: false },
        });
        expect.soft(reportingOff.status(), 'turning usage reporting off').toBe(200);
        const streamDelete = await this.page.request.delete(`${baseUrl()}/api/${orgId}/streams/usage?type=logs`, { headers });
        expect.soft(streamDelete.status(), 'deleting the usage stream').toBe(200);
    }

    async openUsageTab(orgId, tab) {
        await this.page.goto(`${baseUrl()}/web/billings/usage?org_identifier=${orgId}&tab=${tab}`);
    }

    async toggleMeter(meterName) {
        await this.meterRows.filter({ hasText: meterName }).click();
    }

    async expectTopMeter(meterName, costAndShare) {
        await expect(this.topMeterCard).toContainText(meterName, { timeout: 30000 });
        await expect(this.topMeterCard).toContainText(costAndShare);
    }

    async expectTopMeterIsNot(meterName) {
        await expect(this.topMeterCard).not.toContainText(meterName);
    }

    async expectTotalCost(cost) {
        await expect(this.totalCostCard).toContainText(cost, { timeout: 30000 });
    }

    async getTopMeterSharePercent() {
        const text = await this.topMeterCard.innerText();
        const match = text.match(/(\d+)% of cost/);
        expect(match, `Top Meter card has no share: ${text}`).not.toBeNull();
        return Number(match[1]);
    }

    async expectBudgetShown(amount, cost) {
        await expect(this.budgetAmountField).toHaveValue(amount, { timeout: 30000 });
        await expect(this.budgetCard).toContainText(cost);
    }

    async expectNoBudgetShown() {
        await expect(this.budgetAmountField).toHaveValue('');
        await expect(this.budgetCard).toContainText('Not set');
        await expect(this.budgetUnsetHint).toBeVisible();
    }

    async setBudgetAmount(value) {
        await this.budgetAmountField.fill(value);
    }

    async expectSaveEnabled() {
        await expect(this.saveBudgetBtn).toBeEnabled();
    }

    async expectSaveDisabled() {
        await expect(this.saveBudgetBtn).toBeDisabled();
    }

    async saveBudget() {
        const post = this.page.waitForResponse(
            (res) =>
                SETTINGS_URL.test(res.url()) &&
                res.request().method() === 'POST' &&
                Boolean(res.request().postDataJSON()?.budget_config),
        );
        await this.saveBudgetBtn.click();
        await post;
    }

    async expectToast(message) {
        await expect(this.toastMessage.filter({ hasText: message })).toBeVisible();
    }

    // The layout reads settings too, so this response may not be the Budget tab's; expectNothingStoredToRemove proves that one landed.
    async reloadBudgetTab() {
        const settingsRead = this.page.waitForResponse(
            (res) => SETTINGS_URL.test(res.url()) && res.request().method() === 'GET' && res.ok(),
            { timeout: 30000 },
        );
        await this.page.reload();
        await settingsRead;
        await expect(this.budgetRoot).toBeVisible({ timeout: 30000 });
    }

    // Save enables only once the Budget tab's own read has landed, and clearing the field only counts as a change while a budget is stored.
    async expectNothingStoredToRemove() {
        await expect(async () => {
            await this.setBudgetAmount('700');
            await expect(this.saveBudgetBtn).toBeEnabled({ timeout: 2000 });
        }).toPass({ timeout: 15000 });
        await this.setBudgetAmount('');
        await this.expectSaveDisabled();
    }
}
