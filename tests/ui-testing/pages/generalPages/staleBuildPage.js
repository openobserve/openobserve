// The red "new version available" toast a stale tab shows after a redeploy.
import { expect } from '@playwright/test';

export class StaleBuildPage {
    constructor(page) {
        this.page = page;
        this.newVersionText = 'A new version of the application is available';
        this.newVersionToast = page
            .locator('[data-test^="o-toast-"][data-test-variant="error"]')
            .filter({ hasText: this.newVersionText });
        this.dashboardsMenuLink = page.locator('[data-test="menu-link-\\/dashboards-item"]');
    }

    async expectNoNewVersionToast() {
        await expect(this.newVersionToast).toHaveCount(0);
    }

    async openDashboardsFromMenu() {
        await expect(this.dashboardsMenuLink).toBeVisible({ timeout: 15000 });
        await this.dashboardsMenuLink.click();
    }

    async expectNewVersionToastShownOnce() {
        await expect(this.newVersionToast).toBeVisible({ timeout: 15000 });
        await expect(this.newVersionToast).toBeInViewport();
        await expect(this.newVersionToast).toHaveCount(1);
    }
}

export default StaleBuildPage;
