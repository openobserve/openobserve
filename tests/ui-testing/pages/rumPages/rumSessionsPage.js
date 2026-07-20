// rumSessionsPage.js — RUM Sessions list + session viewer
import { expect } from '@playwright/test';

export class RumSessionsPage {
    constructor(page) {
        this.page = page;

        // Locators
        this.sessionsTable = page.locator('[data-test="rum-sessions-table"]');
        this.tableRow = page.locator('[data-test^="o2-table-row-"]');
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
}
