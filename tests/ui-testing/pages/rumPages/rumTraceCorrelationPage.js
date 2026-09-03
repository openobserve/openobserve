// rumTraceCorrelationPage.js — RUM session viewer traces tab + event drawer trace correlation
import { expect } from '@playwright/test';

export class RumTraceCorrelationPage {
    constructor(page) {
        this.page = page;

        // Locators (all verified against web/src/components/rum/*.vue)
        this.tracesTab = page.locator('[data-test="tab-traces"]');
        this.tracesTable = page.locator('[data-test="rum-player-traces-tab-table"]');
        this.tracesEmpty = page.locator('[data-test="rum-player-traces-tab-empty"]');
        this.tracesCountBadge = page.locator('[data-test="rum-player-traces-tab-count-badge"]');
        this.traceRow = page.locator('[data-test="rum-player-traces-tab-table"] [data-test^="o2-table-row-"]');
        this.tracesBackBtn = page.locator('[data-test="rum-player-traces-tab-back-btn"]');
        this.actionEventRow = page.locator('[data-test^="player-event-row-action"]');
        this.eventDrawer = page.locator('[data-test="event-detail-drawer"]');
        this.viewTraceBtn = page.locator('[data-test="view-trace-btn"]');
        this.traceDetailsTree = page.locator('[data-test="trace-details-tree"]');
    }

    /**
     * Open the session viewer directly (skips the Sessions-list aggregation and
     * its `session_has_replay` filter). `startMs`/`endMs` (ms) are passed as
     * `start_time`/`end_time` (µs) so SessionViewer.getSession() frames the
     * `_sessionreplay` lookup over the seeded window.
     */
    async openSessionViewer(sessionId, { startMs, endMs } = {}) {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const params = new URLSearchParams({ org_identifier: org });
        if (startMs != null && endMs != null) {
            params.set('start_time', String(startMs * 1000));
            params.set('end_time', String(endMs * 1000));
        }
        await this.page.goto(`${base}/web/rum/sessions/view/${sessionId}?${params.toString()}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async openTracesTab() {
        await this.tracesTab.click();
    }

    async expectTracesTableVisible(timeoutMs = 30000) {
        await expect(this.tracesTable).toBeVisible({ timeout: timeoutMs });
    }

    async expectTracesEmptyVisible(timeoutMs = 30000) {
        await expect(this.tracesEmpty).toBeVisible({ timeout: timeoutMs });
    }

    async expectTracesTableAbsent() {
        await expect(this.tracesTable).toHaveCount(0);
    }

    async expectTraceCountBadgeContains(text, timeoutMs = 30000) {
        await expect(this.tracesCountBadge).toContainText(text, { timeout: timeoutMs });
    }

    async expectSingleTraceRow(timeoutMs = 30000) {
        await expect(this.traceRow).toHaveCount(1, { timeout: timeoutMs });
    }

    async clickFirstTraceRow() {
        await this.traceRow.first().click();
    }

    async expectEmbeddedTraceDetails(timeoutMs = 30000) {
        await expect(this.traceDetailsTree).toBeVisible({ timeout: timeoutMs });
    }

    async expectBackFromTraceDetail() {
        await this.tracesBackBtn.click();
        await expect(this.tracesTable).toBeVisible({ timeout: 30000 });
    }

    async expectActionEventRowVisible(timeoutMs = 30000) {
        await expect(this.actionEventRow.first()).toBeVisible({ timeout: timeoutMs });
    }

    async openFirstActionEvent() {
        await this.expectActionEventRowVisible();
        await this.actionEventRow.first().click();
    }

    async expectEventDrawerVisible(timeoutMs = 30000) {
        await expect(this.eventDrawer).toBeVisible({ timeout: timeoutMs });
    }

    async expectViewTraceBtnVisible(timeoutMs = 30000) {
        await expect(this.viewTraceBtn).toBeVisible({ timeout: timeoutMs });
    }

    /** Click "View Trace"; returns the new-tab page (popup). */
    async clickViewTrace() {
        const popupPromise = this.page.waitForEvent('popup', { timeout: 30000 });
        await this.viewTraceBtn.click();
        return popupPromise;
    }

    /**
     * Assert the popup landed on the standalone trace-details route with the
     * canonical padded trace id, the `default` stream, and a window WIDER than
     * the ±10 s guess (the seeded span outlives it by 2 min). The indexed
     * window is the padded range, so `to - from` is on the order of minutes,
     * not the 20 s a guess would produce.
     */
    async expectTraceDetailsUrl(popup, traceId, minWindowUs = 90000000) {
        await expect(popup).toHaveURL(/\/traces\/trace-details/, { timeout: 30000 });
        const url = new URL(popup.url());
        expect(url.searchParams.get('trace_id')).toBe(traceId);
        expect(url.searchParams.get('stream')).toBe('default');
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        expect(Number.isFinite(from) && Number.isFinite(to)).toBe(true);
        expect(to - from).toBeGreaterThan(minWindowUs);
    }

    /** Assert the trace tree renders on a given page (the standalone popup). */
    async expectTraceDetailsTreeOn(popupPage, timeoutMs = 30000) {
        await expect(popupPage.locator('[data-test="trace-details-tree"]')).toBeVisible({
            timeout: timeoutMs,
        });
    }
}
