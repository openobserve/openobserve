// rumPerformancePage.js — RUM Performance summary + API tab page
import { expect } from '@playwright/test';

export class RumPerformancePage {
    constructor(page) {
        this.page = page;

        // ----- Overview tab locators -----
        this.refreshButton = page.locator('[data-test="rum-performance-refresh"]');
        this.summaryLoadingIndicator = page.locator(
            '[data-test="performance-summary-loading-indicator"]',
        );

        // ----- API tab locators -----
        this.apiDashboardContainer = page.locator('[data-test="api-performance-dashboards"]');
        this.schemaLoadingSpinner = page.locator('[data-test="api-dashboard-schema-loading"]');
        this.apiEmptyState = page.locator('[data-test="api-dashboard-empty"]');
        this.apiTabButton = page.getByRole('tab', { name: 'API' });
        this.overviewTabButton = page.getByRole('tab', { name: 'Overview' });

        // ----- Date-time picker locators (shared by DateTimePickerDashboard → DateTime) -----
        this.dateTimePickerBtn = page.locator('[data-test="date-time-btn"]');
        this.dateTimeApplyBtn = page.locator('[data-test="date-time-apply-btn"]');

        // ----- Page-level container -----
        this.rumPerformancePageContainer = page.locator('[data-test="rum-performance-page"]');

        // ----- Dashboard panel / grid locators -----
        // NOTE: `.grid-stack-item` is a framework CSS class without a `data-test` attribute
        // in the RenderDashboardCharts component. Prefer a `data-test` when one becomes available.
        this.gridStackItem = page.locator('.grid-stack-item');

        // ----- Selector strings (used as relative selectors inside poll/query chains) -----
        this.viewPanelScreenSelector = '[data-test="view-panel-screen"]';
    }

    // ========================================================================
    //  OVERVIEW TAB (existing)
    // ========================================================================

    async gotoPerformance() {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${base}/web/rum/performance?org_identifier=${org}`);
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
    }

    async clickRefresh() {
        await this.refreshButton.click();
    }

    /** The loading indicator must resolve (not hang) after refresh. */
    async expectSummaryLoadingResolved(timeoutMs = 30000) {
        await expect(this.summaryLoadingIndicator).toBeHidden({ timeout: timeoutMs });
    }

    // ========================================================================
    //  API TAB — navigation
    // ========================================================================

    /**
     * Navigate directly to the API tab URL.
     * The page MUST already be authenticated (global-setup / navigateToBase).
     */
    async gotoApiTab(period = '15m') {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${base}/web/rum/performance/apis?org_identifier=${org}&period=${period}`);
        // The page container is the reliable signal that route resolved.
        await expect(this.rumPerformancePageContainer).toBeVisible({ timeout: 20000 });
    }

    /** Click the "API" tab button from the Overview (or any other) tab. */
    async clickApiTab() {
        await this.apiTabButton.click();
        // Wait for the API dashboard container to appear.
        await expect(this.apiDashboardContainer).toBeVisible({ timeout: 15000 });
    }

    /** Click the "Overview" tab button. */
    async clickOverviewTab() {
        await this.overviewTabButton.click();
        // Wait for the Overview tab to render — refresh button is always present.
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
    }

    // ========================================================================
    //  API TAB — readiness / visibility assertions
    // ========================================================================

    /**
     * Wait for the schema-loading spinner to disappear.
     * The `_rumdata` schema resolves via `ensureRumSchema()` — once hidden,
     * the dashboard panels can mount.
     */
    async waitForSchemaResolved(timeoutMs = 30000) {
        await expect(this.schemaLoadingSpinner).toBeHidden({ timeout: timeoutMs });
    }

    /** Assert the API dashboard root container is visible. */
    async expectApiDashboardVisible() {
        await expect(this.apiDashboardContainer).toBeVisible({ timeout: 15000 });
    }

    /** Assert the empty-state is NOT shown (stream has resource fields). */
    async expectNoEmptyState() {
        await expect(this.apiEmptyState).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Assert that at least one grid-stack panel item is present and visible.
     * Confirms `RenderDashboardCharts` mounted and rendered panels.
     */
    async expectDashboardPanelsVisible(timeoutMs = 30000) {
        const firstPanel = this.gridStackItem.first();
        await expect(firstPanel).toBeVisible({ timeout: timeoutMs });
    }

    /**
     * After a time-range change, poll until at least one grid-stack panel
     * contains visible child content (not an empty div).
     * This is the core regression guard against "black space" — panels must
     * eventually re-render content after the time range switches.
     */
    async expectDashboardContentAfterTimeChange(timeoutMs = 45000) {
        await expect
            .poll(
                async () => {
                    const panels = this.gridStackItem;
                    const count = await panels.count();
                    if (count === 0) return false;
                    // Check that at least one panel has visible child content.
                    for (let i = 0; i < count; i++) {
                        const panel = panels.nth(i);
                        // The panel must be visible AND contain non-empty text or child elements.
                        const visible = await panel.isVisible().catch(() => false);
                        if (!visible) continue;
                        // Check for a data-test child that signals rendered content
                        const content = panel.locator(this.viewPanelScreenSelector);
                        const hasContent = await content.first().isVisible().catch(() => false);
                        if (hasContent) return true;
                        // Fallback: check for any visible child with text
                        const text = (await panel.textContent().catch(() => '')) || '';
                        if (text.trim().length > 0) return true;
                    }
                    return false;
                },
                { timeout: timeoutMs, intervals: [2000, 3000, 5000] },
            )
            .toBe(true);
    }

    // ========================================================================
    //  DATE-TIME PICKER (Performance page — DateTimePickerDashboard → DateTime)
    // ========================================================================

    /** Open the date-time picker dropdown. */
    async openPerformanceTimePicker() {
        await expect(this.dateTimePickerBtn).toBeVisible({ timeout: 10000 });
        await this.dateTimePickerBtn.click();
        // Assert the picker menu opened — the apply button is a reliable signal.
        await expect(this.dateTimeApplyBtn).toBeVisible({ timeout: 10000 });
    }

    /**
     * Click a relative time preset button.
     * @param {string} rangeCode — e.g. "1-h", "1-d", "15-m"
     */
    async selectRelativeTimePreset(rangeCode) {
        const presetBtn = this.page.locator(`[data-test="date-time-relative-${rangeCode}-btn"]`);
        await expect(presetBtn).toBeVisible({ timeout: 10000 });
        await presetBtn.click();
    }

    /** Click the Apply button in the open date-time picker. */
    async applyTimeRange() {
        await expect(this.dateTimeApplyBtn).toBeVisible({ timeout: 10000 });
        await this.dateTimeApplyBtn.click();
        // After applying, the picker closes and the page re-queries — wait for
        // the picker menu to close as a signal.
        await expect(this.dateTimeApplyBtn).not.toBeVisible({ timeout: 15000 });
    }

    // ========================================================================
    //  FIXME-GAP LOCATORS (for isLoading / loading overlay unwired behaviour)
    //
    //  WARNING (W3): these methods use CSS utility-class selectors (`.visible`,
    //  `.absolute`) because the ApiDashboard.vue divs at :53 and :68 lack
    //  `data-test` attributes. When the `isLoading` ref is wired, add
    //  `data-test` attributes to those elements and switch these locators.
    //  Impact is currently low — only referenced by test.fixme TC04 / TC05.
    // ========================================================================

    /**
     * The ApiDashboard content wrapper that carries the visible/invisible CSS class.
     * Gated by `isLoading.length` — which is always 0 (dead code).
     */
    getContentWrapper() {
        return this.apiDashboardContainer.locator('.visible');
    }

    /**
     * The absolute-positioned loading overlay inside ApiDashboard.
     * Gated by `v-show="isLoading.length"` — never shown (dead code).
     */
    getLoadingOverlay() {
        return this.apiDashboardContainer.locator('.absolute');
    }

    /** Assert the content wrapper has the 'visible' class (isLoading.length === 0). */
    async expectContentWrapperVisible() {
        await expect(this.getContentWrapper()).toBeVisible({ timeout: 5000 });
    }

    /** Assert the loading overlay is NOT visible (isLoading.length === 0 — dead code). */
    async expectLoadingOverlayNotVisible() {
        await expect(this.getLoadingOverlay()).not.toBeVisible({ timeout: 5000 });
    }
}
