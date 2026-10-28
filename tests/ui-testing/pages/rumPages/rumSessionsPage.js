// rumSessionsPage.js — RUM Sessions list + session viewer
import { expect } from '@playwright/test';

export class RumSessionsPage {
    constructor(page) {
        this.page = page;

        // Locators
        this.sessionsTable = page.locator('[data-test="rum-sessions-table"]');
        this.tableRow = page.locator('[data-test^="o2-table-row-"]');
        this.sessionViewerNoReplay = '[data-test="session-viewer-no-replay"]';
        this.sessionViewerEventsOnly = '[data-test="session-viewer-events-only"]';
        this.sessionViewerSubtitle = '[data-test="session-viewer-subtitle"]';
        this.sessionViewerShareLinkBtn = '[data-test="session-viewer-share-link-btn"]';
        this.sessionViewerBackBtn = '[data-test="session-viewer-back-btn"]';
        this.sessionIdCells = page.locator('[data-test="rum-app-sessions-session-id-text"]');
        this.sessionIdCellsWithoutId = page.locator(
            '[data-test="rum-app-sessions-session-id-text"]:not([title]), [data-test="rum-app-sessions-session-id-text"][title=""]',
        );
        this.activitySparkline = '[data-test="rum-session-activity-sparkline"]';
        this.activityLoading = '[data-test="rum-session-activity-loading"]';
    }

    /**
     * Open the Sessions list scoped to one service. The filter is applied to
     * the _rumdata sessions query via the URL (?query= is base64, restored on
     * mount) instead of typing into the Monaco editor, which is racy while the
     * editor boots.
     */
    async gotoSessionsList({ service = null, period = '1h', filter = null, org = null } = {}) {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const orgId = org || process.env.ORGNAME || 'default';
        let url = `${base}/web/rum/sessions?period=${period}&org_identifier=${orgId}`;
        const where = filter || (service ? `service='${service}'` : null);
        if (where) {
            const encoded = Buffer.from(where).toString('base64');
            url = `${base}/web/rum/sessions?period=${period}&query=${encodeURIComponent(encoded)}&org_identifier=${orgId}`;
        }
        await this.page.goto(url);
    }

    /** Session aggregation can lag ingestion, so the list is polled until it settles on exactly `count` rows. */
    async expectSessionRowCount(count, timeoutMs = 60000) {
        await expect
            .poll(async () => this.tableRow.count(), { timeout: timeoutMs, intervals: [2000, 3000, 5000] })
            .toBe(count);
    }

    /** No listed row lacks a session id; such a row is SDK telemetry grouped into a phantom session. */
    async expectEverySessionRowHasAnId() {
        await expect(this.sessionIdCells.first()).toBeVisible({ timeout: 30000 });
        await expect(this.sessionIdCellsWithoutId).toHaveCount(0);
    }

    sessionRow(sessionId) {
        return this.tableRow.filter({
            has: this.page.locator(`[data-test="rum-app-sessions-session-id-text"][title="${sessionId}"]`),
        });
    }

    /** The session's Activity cell finishes loading into a sparkline instead of keeping its skeleton. */
    async expectActivityLoadedFor(sessionId, timeoutMs = 30000) {
        const row = this.sessionRow(sessionId);
        await expect(row).toHaveCount(1, { timeout: timeoutMs });
        await row.scrollIntoViewIfNeeded();
        await expect(row.locator(this.activitySparkline)).toBeVisible({ timeout: timeoutMs });
        await expect(row.locator(this.activityLoading)).toHaveCount(0);
    }

    async expectSessionViewerUrlKeepsOrg(sessionId, org, timeoutMs = 15000) {
        await expect(this.page).toHaveURL(new RegExp(`/rum/sessions/view/${sessionId}\\?.*org_identifier=${org}(&|$)`), {
            timeout: timeoutMs,
        });
    }

    async reloadSessionViewer() {
        await this.page.reload();
    }

    async expectSessionsTableVisible(timeoutMs = 15000) {
        await expect(this.sessionsTable).toBeVisible({ timeout: timeoutMs });
    }

    /** Session aggregation can lag ingestion — poll for the filtered row. */
    async waitForSessionRowsPresent(timeoutMs = 60000) {
        await expect
            .poll(async () => this.tableRow.count(), {
                timeout: timeoutMs,
                intervals: [2000, 3000, 5000],
            })
            .toBeGreaterThan(0);
    }

    async openFirstSession() {
        await this.tableRow.first().click();
    }

    /** The session viewer URL must carry the exact recorded session id. */
    async expectSessionViewerFor(sessionId, timeoutMs = 15000) {
        await expect(this.page).toHaveURL(new RegExp(`/rum/sessions/view/${sessionId}`), {
            timeout: timeoutMs,
        });
    }

    /** `startTimeUs` / `endTimeUs` are microsecond epoch bounds. */
    async gotoSessionViewer(sessionId, { startTimeUs, endTimeUs } = {}) {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        const nowUs = Date.now() * 1000;
        const start = startTimeUs || nowUs - 3600 * 1000 * 1000;
        const end = endTimeUs || nowUs;
        const url = `${base}/web/rum/sessions/view/${sessionId}?start_time=${start}&end_time=${end}&org_identifier=${org}`;
        await this.page.goto(url);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async expectNoReplayEmptyState(sessionId) {
        const empty = this.page.locator(this.sessionViewerNoReplay);
        await expect(empty).toBeVisible({ timeout: 15000 });
        await expect(empty).toContainText('No replay was recorded for this session');
        await expect(empty).toContainText(sessionId);
    }

    async expectEventsOnlyState() {
        const eventsOnly = this.page.locator(this.sessionViewerEventsOnly);
        await expect(eventsOnly).toBeVisible({ timeout: 15000 });
        await expect(eventsOnly).toContainText('No replay was recorded for this session');
    }

    async expectSessionViewerSubtitleHidden() {
        await expect(this.page.locator(this.sessionViewerSubtitle)).toHaveCount(0);
    }

    async expectSessionViewerShareLinkHidden() {
        await expect(this.page.locator(this.sessionViewerShareLinkBtn)).toHaveCount(0);
    }

    async expectSessionViewerBackVisible() {
        await expect(this.page.locator(this.sessionViewerBackBtn)).toBeVisible({ timeout: 15000 });
    }

    // SessionViewer's back is router.back(), so it leaves the viewer route for whatever page preceded it.
    async clickSessionViewerBackAndExpectLeft(sessionId) {
        await this.page.locator(this.sessionViewerBackBtn).click();
        await expect(this.page).not.toHaveURL(new RegExp(`/rum/sessions/view/${sessionId}`), { timeout: 15000 });
    }
}
