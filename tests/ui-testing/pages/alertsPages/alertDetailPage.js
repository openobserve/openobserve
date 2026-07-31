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
}
