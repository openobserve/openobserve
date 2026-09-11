// mobileNavigationPage.js - Responsive mobile nav drawer page object
import { expect } from '@playwright/test';

export class MobileNavigationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // Header hamburger — only visible below 768px (md:hidden).
        this.hamburgerToggle = page.locator('[data-test="header-mobile-nav-toggle"]');
        // Desktop nav rail — max-md:hidden, so it disappears below 768px.
        this.desktopRail = page.locator('[data-test="navbar-main-nav"]');

        // Mobile nav drawer (ODrawer) and its custom close button.
        this.drawer = page.locator('[data-test="main-layout-mobile-nav-drawer"]');
        this.drawerClose = page.locator('[data-test="main-layout-mobile-nav-close"]');
        // Drawer scrim (tap-outside-to-close target). Teleported to <body> as a
        // sibling of the drawer panel, so it cannot be drawer-scoped; only one
        // ODrawer is ever open in this spec, so the global overlay is unambiguous.
        this.drawerOverlay = page.locator('[data-test="o-drawer-overlay"]');

        // Logs link scoped to the drawer — the desktop rail also renders a
        // navbar-main-nav, so an unscoped selector could match the hidden copy.
        this.drawerLogsLink = this.drawer.locator('[data-test="menu-link-\\/logs-item"]');

        // Data group: mobile trigger tile + inline submenu + Streams child.
        // The desktop rail is only CSS-hidden (max-md:hidden), never removed from
        // the DOM, so these MUST be scoped to the drawer or strict-mode click
        // resolves to 2 elements (hidden desktop tile + visible drawer tile).
        this.dataGroupTile = this.drawer.locator('[data-test="menu-link-group-data-item"]');
        this.dataInlineSubmenu = this.drawer.locator('[data-test="nav-group-inline-data"]');
        this.dataFlyout = page.locator('[data-test="nav-group-flyout-data"]');
        this.streamsChild = this.drawer.locator('[data-test="nav-group-item-logstreams"]');

        // Post-navigation page-load indicators.
        this.logsPageIndicator = page.locator('[data-test="logs-search-bar-refresh-btn"]');
        this.streamsPageIndicator = page.locator('[data-test="streams-search-stream-input"]');
    }

    async setMobileViewport() {
        await this.page.setViewportSize({ width: 390, height: 844 });
    }

    // Dismiss the first-login GetStarted overlay if it is covering the page.
    // Optional cleanup — the drawer is unreachable while this full-size dialog
    // (show-close=false) sits on top.
    async dismissGetStartedIfPresent() {
        const dialog = this.page.locator('[data-test="main-layout-get-started-dialog"]');
        if (!(await dialog.isVisible().catch(() => false))) return;
        await this.page.locator('[data-test="onboarding-get-started-hear-about-us-field"]').fill('Other').catch(() => {});
        await this.page.locator('[data-test="onboarding-get-started-where-do-you-work-field"]').fill('Testing').catch(() => {});
        await this.page.locator('[data-test="onboarding-get-started-agree-checkbox"]').click().catch(() => {});
        await this.page.locator('[data-test="onboarding-get-started-submit-btn"]').click().catch(() => {});
        await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    async openMobileNav() {
        await this.hamburgerToggle.waitFor({ state: 'visible', timeout: 15000 });
        await this.hamburgerToggle.click();
        await this.drawer.waitFor({ state: 'visible', timeout: 15000 });
    }

    async closeMobileNav() {
        await this.drawerClose.waitFor({ state: 'visible', timeout: 10000 });
        await this.drawerClose.click();
        await this.drawer.waitFor({ state: 'hidden', timeout: 15000 });
    }

    async tapScrim() {
        await this.drawerOverlay.waitFor({ state: 'visible', timeout: 10000 });
        await this.drawerOverlay.click();
        await this.drawer.waitFor({ state: 'hidden', timeout: 15000 });
    }

    async pressEscapeToClose() {
        await this.page.keyboard.press('Escape');
        await this.drawer.waitFor({ state: 'hidden', timeout: 15000 });
    }

    async expandDataGroup() {
        await this.dataGroupTile.waitFor({ state: 'visible', timeout: 15000 });
        await this.dataGroupTile.click();
        await this.dataInlineSubmenu.waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickDrawerLogsLink() {
        await this.drawerLogsLink.waitFor({ state: 'visible', timeout: 15000 });
        await this.drawerLogsLink.click();
    }

    async clickStreamsChild() {
        await this.streamsChild.waitFor({ state: 'visible', timeout: 10000 });
        await this.streamsChild.click();
    }

    async expectHamburgerVisible() {
        await expect(this.hamburgerToggle).toBeVisible({ timeout: 15000 });
    }

    async expectDesktopRailHidden() {
        await expect(this.desktopRail).toBeHidden();
    }

    async expectDrawerVisible() {
        await expect(this.drawer).toBeVisible({ timeout: 15000 });
    }

    async expectDrawerHidden() {
        await expect(this.drawer).toBeHidden({ timeout: 15000 });
    }

    async expectDrawerLogsLinkVisible() {
        await expect(this.drawerLogsLink).toBeVisible({ timeout: 15000 });
    }

    async expectDataFlyoutNotRendered() {
        await expect(this.dataFlyout).toHaveCount(0);
    }

    async expectLogsPageLoaded() {
        await expect(this.logsPageIndicator).toBeVisible({ timeout: 15000 });
    }

    async expectStreamsPageLoaded() {
        await expect(this.streamsPageIndicator).toBeVisible({ timeout: 15000 });
    }
}
