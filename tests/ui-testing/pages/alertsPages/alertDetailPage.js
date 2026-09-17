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
        const onRequest = (request) => {
            if (!/\/_search(_stream)?\?/.test(request.url())) return;
            try {
                const body = JSON.parse(request.postData() || '{}');
                const candidate = body?.query?.sql;
                if (typeof candidate === 'string' && candidate.includes('zo_sql_key')) sql = candidate;
            } catch {
                // a non-JSON body on this route is not ours to interpret
            }
        };
        this.page.on('request', onRequest);
        try {
            await action();
            await this.page.waitForTimeout(2500);
        } finally {
            this.page.off('request', onRequest);
        }
        testLogger.info('Captured evaluation chart query', { sql });
        return sql;
    }

    /** Assert the Evaluation chart did not fail to build or execute its query. */
    async expectNoChartError() {
        const error = this.page.locator(this.locators.chartError);
        if (await error.count()) {
            await expect(error, 'Evaluation chart reported an error').toBeHidden();
        }
    }

    /** Assert the multi-alert layout is rendered: multi badge, stat strip, groups tab + table. */
    async expectMultiLayoutVisible() {
        await expect(this.page.locator(this.locators.multiBadge)).toBeVisible();
        await expect(this.page.locator(this.locators.groupStats)).toBeVisible();
        await expect(this.page.locator(this.locators.groupsTab)).toBeVisible();
        await expect(this.page.locator(this.locators.groupsTable)).toBeVisible();
        testLogger.info('Multi-alert detail layout verified');
    }
}
