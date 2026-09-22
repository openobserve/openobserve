// rumSessionsPage.js — RUM Sessions list + session viewer
import { expect } from '@playwright/test';

export class RumSessionsPage {
    constructor(page) {
        this.page = page;

        // Locators
        this.sessionsTable = page.locator('[data-test="rum-sessions-table"]');
        this.tableRow = page.locator('[data-test^="o2-table-row-"]');
        // Session Viewer empty-state + chrome (SessionViewer.vue).
        this.sessionViewerNoReplay = '[data-test="session-viewer-no-replay"]';
        this.sessionViewerSubtitle = '[data-test="session-viewer-subtitle"]';
        this.sessionViewerShareLinkBtn = '[data-test="session-viewer-share-link-btn"]';
        this.sessionViewerBackBtn = '[data-test="session-viewer-back-btn"]';
    }

    /**
     * Open the Sessions list scoped to one service. The filter is applied to
     * the _rumdata sessions query via the URL (?query= is base64, restored on
     * mount) instead of typing into the Monaco editor, which is racy while the
     * editor boots.
     */
    async gotoSessionsList({ service = null, period = '1h' } = {}) {
        const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        let url = `${base}/web/rum/sessions?period=${period}&org_identifier=${org}`;
        if (service) {
            const filter = Buffer.from(`service='${service}'`).toString('base64');
            url = `${base}/web/rum/sessions?period=${period}&query=${encodeURIComponent(filter)}&org_identifier=${org}`;
        }
        await this.page.goto(url);
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

    /**
     * Navigate directly to the Session Viewer route for a known session id.
     * `start_time` / `end_time` are microsecond epoch bounds.
     */
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

    /**
     * Assert the "No replay was recorded" empty state renders for the session
     * id: visible, naming the session, with the human title intact.
     */
    async expectNoReplayEmptyState(sessionId) {
        const empty = this.page.locator(this.sessionViewerNoReplay);
        await expect(empty).toBeVisible({ timeout: 15000 });
        await expect(empty).toContainText('No replay was recorded for this session');
        await expect(empty).toContainText(sessionId);
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
}
