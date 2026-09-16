// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

/**
 * AlertDetailPage — the Alerts 4.0 detail page (/web/alerts/detail/:alert_id),
 * which replaced the row-click side panel. Owns the alerts-alertdetail-* /
 * alerts-alertgroups* selectors and the multi-alert layout assertions so specs
 * stay selector-free.
 */
export class AlertDetailPage {
    constructor(page) {
        this.page = page;
        this.locators = {
            title: '[data-test="alerts-alertdetail-title"]',
            editButton: '[data-test="alerts-alertdetail-edit"]',
            notFound: '[data-test="alerts-alertdetail-not-found"]',
            multiBadge: '[data-test="alerts-alertdetail-multi-badge"]',
            groupStats: '[data-test="alerts-alertdetail-group-stats"]',
            groupsTab: '[data-test="alerts-alertdetail-tab-groups"]',
            groupsTable: '[data-test="alerts-alertgroupstable-table"]',
            chart: '[data-test="alerts-alertgroupchart"]',
            chartPanel: '[data-test="alerts-alertgroupchart-panel"]',
            chartError: '[data-test="alerts-alertgroupchart-error"]',
        };
    }

    /**
     * Navigate to an alert's detail page by id (uses the config baseURL).
     * @param {string} alertId
     * @param {{ folder?: string }} [opts]
     */
    async open(alertId, { folder = 'default' } = {}) {
        await this.page.goto(`/web/alerts/detail/${alertId}?org_identifier=${getOrgIdentifier()}&folder=${folder}`);
        testLogger.info('Opened alert detail page', { alertId });
    }

    async expectTitle(name) {
        await expect(this.page.locator(this.locators.title)).toContainText(name, { timeout: 15000 });
    }

    /** Assert the multi-alert layout is rendered: multi badge, stat strip, groups tab + table. */
    async expectMultiLayoutVisible() {
        await expect(this.page.locator(this.locators.multiBadge)).toBeVisible();
        await expect(this.page.locator(this.locators.groupStats)).toBeVisible();
        await expect(this.page.locator(this.locators.groupsTab)).toBeVisible();
        await expect(this.page.locator(this.locators.groupsTable)).toBeVisible();
        testLogger.info('Multi-alert detail layout verified');
    }

    /**
     * Assert the evaluation chart's panel rendered (error state absent). The
     * panel resolves asynchronously via the generate_sql round-trip and may hold
     * sparse/empty data, so only attachment — never canvas/series content — is
     * asserted.
     */
    async expectChartPanelVisible() {
        await expect(this.page.locator(this.locators.chartPanel)).toBeAttached({ timeout: 30000 });
        await expect(this.page.locator(this.locators.chartError)).not.toBeAttached();
        testLogger.info('Chart panel rendered without error');
    }

    /**
     * Assert the chart's error state rendered with the given backend message
     * fragment (panel absent). Assert the error first — never the panel's
     * absence — so the async generate_sql round-trip has resolved by the time
     * the mutually-exclusive panel state is checked.
     */
    async expectChartErrorVisible(text) {
        await expect(this.page.locator(this.locators.chartError)).toBeVisible({ timeout: 30000 });
        await expect(this.page.locator(this.locators.chartError)).toContainText(text);
        await expect(this.page.locator(this.locators.chartPanel)).not.toBeAttached();
        testLogger.info('Chart error state rendered', { text });
    }

    /**
     * Select a range (1h/6h/24h) in the chart's range toggle and confirm the
     * selection took. Range items carry no data-test; they expose their value
     * via `data-otoggle-value` and their active state via `data-state="on"`.
     *
     * Also awaits the chart's async `generate_sql` rebuild round-trip: the old
     * panel stays attached until the new chartData lands, so without this wait
     * a caller's panel assertion would pass on the stale pre-rebuild state.
     */
    async selectChartRange(value) {
        const item = this.page.locator(`${this.locators.chart} [data-otoggle-value="${value}"]`);
        await expect(item).toBeVisible({ timeout: 15000 });
        const rebuilt = this.page.waitForResponse(
            (response) => response.url().includes('/alerts/generate_sql'),
            { timeout: 30000 },
        );
        await item.click();
        await expect(item).toHaveAttribute('data-state', 'on', { timeout: 10000 });
        await rebuilt;
        testLogger.info('Selected chart range', { value });
    }
}
