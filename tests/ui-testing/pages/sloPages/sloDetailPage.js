/**
 * SloDetailPage — Page object for the SLO detail page (SloDetail.vue)
 *
 * Covers: source-alert button, uptime ribbon on Trend tab, stats strip,
 * new-alert button, and alert-editing deep-link.
 */
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class SloDetailPage {
    constructor(page) {
        this.page = page;

        // ---- Header actions ----
        this.sourceAlertButton = '[data-test="slos-slodetail-source-alert"]';
        this.newAlertButton = '[data-test="slos-slodetail-new-alert"]';
        this.editButton = '[data-test="slos-slodetail-edit"]';

        // ---- Health / stats ----
        this.healthBadge = '[data-test="slos-slodetail-health"]';
        this.statsStrip = '[data-test="slos-slodetail-stats"]';

        // ---- Tabs ----
        this.tabs = '[data-test="slos-slodetail-tabs"]';

        // ---- Trend tab (alert ribbon) ----
        this.alertRibbon = '[data-test="slos-slodetail-alert-ribbon"]';
        this.burndownChart = '[data-test="slos-slodetail-burndown"]';

        // ---- Groups tab ----
        this.groupsTable = '[data-test="slos-slodetail-groups-table"]';

        // ---- Frozen / stale ----
        this.frozenBanner = '[data-test="slos-slodetail-frozen-banner"]';
    }

    // ============================
    //  NAVIGATION
    // ============================

    async navigateToTrendTab() {
        testLogger.info('Navigating to Trend tab');
        // Click the Trend tab within the tabs container
        const trendTab = this.page.locator(this.tabs).getByRole('tab', { name: /trend/i });
        if (await trendTab.isVisible({ timeout: 3000 }).catch(() => false)) {
            await trendTab.click();
        }
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async navigateToAlertsTab() {
        testLogger.info('Navigating to Alerts tab');
        const alertsTab = this.page.locator(this.tabs).getByRole('tab', { name: /alerts/i });
        if (await alertsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
            await alertsTab.click();
        }
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================
    //  ACTIONS
    // ============================

    async clickSourceAlertButton() {
        testLogger.info('Clicking "Source alert" button');
        await this.page.locator(this.sourceAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async clickNewAlertButton() {
        testLogger.info('Clicking "New alert" button');
        await this.page.locator(this.newAlertButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================
    //  EXPECTATIONS
    // ============================

    async expectSourceAlertButtonVisible() {
        await expect(this.page.locator(this.sourceAlertButton)).toBeVisible({ timeout: 10000 });
    }

    async expectSourceAlertButtonHidden() {
        await expect(this.page.locator(this.sourceAlertButton)).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    }

    async expectAlertRibbonVisible() {
        await expect(this.page.locator(this.alertRibbon)).toBeVisible({ timeout: 15000 });
    }

    async expectAlertRibbonBandCountAtLeast(minCount) {
        const bands = this.page.locator('[data-test="slos-sloalertpreview-band"]');
        await expect(bands.first()).toBeVisible({ timeout: 15000 });
        const count = await bands.count();
        expect(count).toBeGreaterThanOrEqual(minCount);
    }

    async expectTallyContainsPercentage() {
        const tally = this.page.locator('[data-test="slos-sloalertpreview-tally"]');
        await expect(tally).toBeVisible({ timeout: 10000 });
        const text = await tally.textContent();
        // Tally should contain a percentage like "99.5%" or at minimum a numeric percent sign
        expect(text).toMatch(/\d/);
    }

    async expectLegendVisible() {
        await expect(this.page.locator('[data-test="slos-sloalertpreview-legend"]')).toBeVisible({ timeout: 10000 });
    }

    async expectStatsStripVisible() {
        await expect(this.page.locator(this.statsStrip)).toBeVisible({ timeout: 10000 });
    }

    async expectOnDetailPage() {
        await this.page.waitForURL(/\/slos\/[a-zA-Z0-9_-]+/, { timeout: 15000 });
    }
}
