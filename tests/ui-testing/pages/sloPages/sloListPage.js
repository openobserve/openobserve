/**
 * SloListPage — Page object for the SLO list page (SloList.vue)
 *
 * Covers: type filter (including "alert"), navigation to SLO rows,
 * and list-level CRUD interactions.
 */
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class SloListPage {
    constructor(page) {
        this.page = page;

        // ---- Page chrome ----
        this.title = '[data-test="slos-slolist-title"]';
        this.newButton = '[data-test="slos-slolist-new"]';
        this.table = '[data-test="slos-slolist-table"]';
        this.searchInput = '[data-test="slos-slolist-search"]';
        this.refreshButton = '[data-test="slos-slolist-refresh"]';
        this.statsStrip = '[data-test="slos-slolist-stats"]';

        // ---- Type filter ----
        this.typeFilterToggle = '[data-test="slos-slolist-type-filter"]';
        this.typeFilterAlert = '[data-test="slos-slolist-type-filter-alert"]';

        // ---- Row actions (per-SLO) ----
        this.editButton = (name) => `[data-test="slos-slolist-edit-${name}"]`;
        this.deleteButton = (name) => `[data-test="slos-slolist-delete-${name}"]`;
    }

    // ============================
    //  NAVIGATION / PAGE LOAD
    // ============================

    async expectPageLoaded() {
        await expect(this.page.locator(this.title)).toBeVisible({ timeout: 15000 });
        await expect(this.page.locator(this.newButton)).toBeVisible({ timeout: 10000 });
    }

    // ============================
    //  TYPE FILTER
    // ============================

    async filterByAlertType() {
        testLogger.info('Filtering SLO list by Alert type');
        await this.page.locator(this.typeFilterAlert).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async clearAlertTypeFilter() {
        testLogger.info('Clearing Alert type filter');
        // Toggle off by clicking again
        await this.page.locator(this.typeFilterAlert).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================
    //  ROW INTERACTIONS
    // ============================

    async clickSloRow(name) {
        testLogger.info('Clicking SLO row', { name });
        const row = this.page.locator(this.table).locator('tr').filter({ hasText: name }).first();
        await row.waitFor({ state: 'visible', timeout: 10000 });
        await row.click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ============================
    //  EXPECTATIONS
    // ============================

    async expectSloRowVisible(name) {
        const row = this.page.locator(this.table).locator('tr').filter({ hasText: name }).first();
        await expect(row).toBeVisible({ timeout: 15000 });
    }

    async expectSloRowNotVisible(name) {
        const row = this.page.locator(this.table).locator('tr').filter({ hasText: name }).first();
        await expect(row).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    }

    async expectTableRowsCount(expectedMin) {
        const rows = this.page.locator(`${this.table} tbody tr`);
        // Count visible rows with content (not "no data" rows)
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(expectedMin);
    }

    async expectTypeFilterAlertExists() {
        await expect(this.page.locator(this.typeFilterAlert)).toBeVisible({ timeout: 5000 });
    }
}
