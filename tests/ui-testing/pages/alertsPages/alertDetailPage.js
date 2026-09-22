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
            chartEmpty: '[data-test="alerts-alertgroupchart-empty"]',
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

    /**
     * Capture the SQL the Evaluation chart sends while `action` runs.
     *
     * Asserting on the outgoing query rather than on pixels keeps this
     * independent of whether the look-back window happens to contain data —
     * the chart legitimately renders "No Data" on a quiet stream, but it must
     * never send a malformed statement.
     *
     * @param {() => Promise<void>} action
     * @returns {Promise<string|null>} the chart's SQL, or null if none was sent
     */
    async captureChartQuery(action) {
        let sql = null;
        let responded = false;
        const isSearch = (url) => /\/_search(_stream)?\?/.test(url);
        const onRequest = (request) => {
            if (!isSearch(request.url())) return;
            try {
                const body = JSON.parse(request.postData() || '{}');
                const candidate = body?.query?.sql;
                if (typeof candidate === 'string' && candidate.includes('zo_sql_key')) sql = candidate;
            } catch {
                // a non-JSON body on this route is not ours to interpret
            }
        };
        const onResponse = (response) => {
            if (isSearch(response.url())) responded = true;
        };
        this.page.on('request', onRequest);
        this.page.on('response', onResponse);
        try {
            await action();
            // Wait for the search to come BACK, not a fixed delay: the panel
            // paints its error only after the response lands, so asserting on a
            // timer races the render and passes while the error is still in flight.
            await expect
                .poll(() => responded, {
                    timeout: 20000,
                    message: 'Evaluation chart never completed a search request',
                })
                .toBe(true);
            await this.page.waitForTimeout(500);
        } finally {
            this.page.off('request', onRequest);
            this.page.off('response', onResponse);
        }
        testLogger.info('Captured evaluation chart query', { sql });
        return sql;
    }

    /**
     * Wait for the Evaluation chart to settle into one of its three terminal
     * states — rendered panel, error, or "no chart available" — and return which.
     *
     * Without this wait an assertion runs against a chart that has not rendered
     * yet, where the error node simply does not exist, and passes for the wrong
     * reason.
     */
    async waitForChartSettled({ timeout = 20000 } = {}) {
        const panel = this.page.locator(this.locators.chartPanel);
        const error = this.page.locator(this.locators.chartError);
        const empty = this.page.locator(this.locators.chartEmpty);
        await expect
            .poll(
                async () =>
                    (await panel.count()) + (await error.count()) + (await empty.count()) > 0,
                { timeout, message: 'Evaluation chart never reached a terminal state' },
            )
            .toBe(true);
        if (await error.count()) return 'error';
        if (await panel.count()) return 'panel';
        return 'empty';
    }

    /** Open the alert and wait until its Evaluation chart has run its query. */
    async openWithChartSettled(alertId, opts = {}) {
        return this.captureChartQuery(async () => { await this.open(alertId, opts); });
    }

    /**
     * Assert the Evaluation chart neither failed to BUILD its query nor failed
     * to RUN it.
     *
     * Those surface in two different places. A generate_sql failure renders the
     * component's own error node; a query the backend rejects is reported by the
     * panel renderer INSIDE the panel, so the component still reports success
     * and the dedicated node never appears. Checking only the node passes while
     * "Error during planning: ..." is on screen.
     */
    async expectNoChartError() {
        const state = await this.waitForChartSettled();
        if (state === 'error') {
            const text = await this.page.locator(this.locators.chartError).innerText();
            expect(state, `Evaluation chart failed to build its query: ${text}`).not.toBe('error');
        }
        const region = await this.page.locator(this.locators.chart).innerText();
        expect(
            region,
            `Evaluation chart reported a query error: ${region.replace(/\s+/g, ' ').slice(0, 300)}`,
        ).not.toMatch(/SQL error|Error during planning|ParserError|TokenizerError|Error#/i);
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
