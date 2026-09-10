import { expect } from '@playwright/test';

const NO_ACCESS_TITLE = "You don't have access";
const NO_ACCESS_DESCRIPTION = 'Contact your administrator if you believe you should have access.';

/**
 * NoAccessStatePage — the generic OTable "403 forbidden" empty state surfaced by
 * list consumers (Dashboards, Alerts). Owns the 403 interception (installed
 * before navigation) and the forbidden/empty locators + assertions so the spec
 * keeps zero raw selectors.
 */
export class NoAccessStatePage {
    constructor(page) {
        this.page = page;

        this.dashboardTable = '[data-test="dashboard-table"]';
        this.alertListTable = '[data-test="alert-list-table"]';
        this.forbiddenContainer = '[data-test="o2-table-forbidden"]';
        this.emptyContainer = '[data-test="o2-table-empty"]';
        this.emptyState = '[data-test="o2-empty-state"]';
        this.table = '[data-test="o2-table"]';
        this.noAccessTitle = NO_ACCESS_TITLE;
        this.noAccessDescription = NO_ACCESS_DESCRIPTION;
        // EmptyLock.vue renders role="img" with this aria-label (preset no-access).
        this.noAccessIllustration = 'svg[role="img"][aria-label="You don\'t have access"]';
        this.dashboardFirstRunTitle = 'Create your first dashboard';
    }

    // ==================== 403 interception (install BEFORE navigation) ====================

    // Dashboards list: GET /api/{org}/dashboards. The glob does NOT match the
    // folders call (/api/v2/{org}/folders/dashboards), so only the list is 403'd.
    async interceptDashboardsList403() {
        await this.page.route('**/api/*/dashboards**', (route) =>
            route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Forbidden' }),
            }),
        );
    }

    // Alerts list: GET /api/v2/{org}/alerts (listByFolderId).
    async interceptAlertsList403() {
        await this.page.route('**/api/v2/*/alerts**', (route) =>
            route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Forbidden' }),
            }),
        );
    }

    // ==================== Locator factories ====================

    dashboardsForbidden() {
        return this.page.locator(`${this.dashboardTable} ${this.forbiddenContainer}`);
    }

    alertsForbidden() {
        return this.page.locator(`${this.alertListTable} ${this.forbiddenContainer}`);
    }

    dashboardsEmpty() {
        return this.page.locator(`${this.dashboardTable} ${this.emptyContainer}`);
    }

    alertsEmpty() {
        return this.page.locator(`${this.alertListTable} ${this.emptyContainer}`);
    }

    // ==================== Assertions ====================

    async expectDashboardsForbiddenVisible() {
        await expect(this.dashboardsForbidden()).toBeVisible({ timeout: 15000 });
    }

    async expectAlertsForbiddenVisible() {
        await expect(this.alertsForbidden()).toBeVisible({ timeout: 15000 });
    }

    async expectForbiddenCopyVisible(forbiddenLocator) {
        const emptyState = forbiddenLocator.locator(this.emptyState);
        await expect(emptyState.getByText(this.noAccessTitle)).toBeVisible();
        await expect(emptyState.getByText(this.noAccessDescription)).toBeVisible();
    }

    async expectForbiddenIllustrationVisible(forbiddenLocator) {
        await expect(forbiddenLocator.locator(this.noAccessIllustration)).toBeVisible();
    }

    async expectNoActionInForbidden(forbiddenLocator) {
        await expect(forbiddenLocator.locator('button')).toHaveCount(0);
    }

    async expectDashboardsEmptyAbsent() {
        await expect(this.dashboardsEmpty()).toHaveCount(0);
    }

    async expectAlertsEmptyAbsent() {
        await expect(this.alertsEmpty()).toHaveCount(0);
    }

    async expectDashboardsFirstRunTitleAbsent() {
        await expect(this.page.getByText(this.dashboardFirstRunTitle)).toHaveCount(0);
    }

    async expectDashboardsForbiddenAbsent() {
        await expect(this.dashboardsForbidden()).toHaveCount(0);
    }

    // Authorized (200) list settles to rows or the first-run empty state.
    async expectDashboardsListSettled() {
        await expect(this.page.locator(this.dashboardTable)).toBeVisible({ timeout: 15000 });
        const rows = this.page.locator(`${this.dashboardTable} ${this.table}`);
        const empty = this.dashboardsEmpty();
        await expect(rows.or(empty).first()).toBeVisible({ timeout: 15000 });
    }
}
