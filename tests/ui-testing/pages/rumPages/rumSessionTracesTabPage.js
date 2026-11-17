// rumSessionTracesTabPage.js — the session player's Traces tab (PlayerTracesTab.vue)
import { expect } from '@playwright/test';

export class RumSessionTracesTabPage {
    constructor(page) {
        this.page = page;
        this.tab = page.locator('[data-test="tab-traces"]');
        this.table = page.locator('[data-test="rum-player-traces-tab-table"]');
        this.rows = this.table.locator('[data-test^="o2-table-row-"]');
        this.countBadge = page.locator('[data-test="rum-player-traces-tab-count-badge"]');
        this.errorCountBadge = page.locator('[data-test="rum-player-traces-tab-error-count-badge"]');
        this.partialNotice = page.locator('[data-test="rum-player-traces-tab-partial"]');
        this.metadataErrorNotice = page.locator('[data-test="rum-player-traces-tab-metadata-error"]');
        this.loadError = page.locator('[data-test="rum-player-traces-tab-error"]');
        this.emptyState = page.locator('[data-test="rum-player-traces-tab-empty"]');
        this.httpStatusChip = page.locator('[data-test="rum-player-traces-tab-http-status"]');
        this.backButton = page.locator('[data-test="rum-player-traces-tab-back-btn"]');
    }

    async open(timeoutMs = 60000) {
        await expect(this.tab).toBeVisible({ timeout: timeoutMs });
        await this.tab.click();
        await expect(this.table).toBeVisible({ timeout: timeoutMs });
    }

    /** The badge counts every listed request, so it must equal the number ingested. */
    async expectTraceCount(count, timeoutMs = 90000) {
        await expect(this.countBadge).toHaveText(`${count} traces`, { timeout: timeoutMs });
    }

    async expectErrorTraceCount(count, timeoutMs = 30000) {
        await expect(this.errorCountBadge).toHaveText(`${count} error traces`, { timeout: timeoutMs });
    }

    /** A failed or partial lookup keeps rows without details and raises one of these notices instead. */
    async expectListComplete() {
        await expect(this.partialNotice).toHaveCount(0);
        await expect(this.metadataErrorNotice).toHaveCount(0);
        await expect(this.loadError).toHaveCount(0);
        await expect(this.emptyState).toHaveCount(0);
    }

    async listedRequests() {
        return this.rows.evaluateAll((rows) =>
            rows.map((row) => {
                const cell = (id) =>
                    (row.querySelector(`[data-test="o2-table-cell-${id}"]`)?.textContent || '').replace(/\s+/g, ' ').trim();
                return { op: cell('route'), duration: cell('duration'), status: cell('status') };
            }),
        );
    }

    /** Polls until the listed rows, cut to `fields`, equal `expected` exactly, ignoring order. */
    async expectListedRequests(expected, fields = ['op', 'duration', 'status'], timeoutMs = 60000) {
        const pick = (row) => Object.fromEntries(fields.map((field) => [field, row[field]]));
        const key = (row) => JSON.stringify(row);
        const sorted = (rows) => rows.map(pick).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
        const want = sorted(expected);
        await expect
            .poll(async () => sorted(await this.listedRequests()), {
                timeout: timeoutMs,
                intervals: [1000, 2000],
                message: 'the Traces tab must list every ingested request with its own duration and status',
            })
            .toEqual(want);
    }

    rowFor(op) {
        return this.rows.filter({
            has: this.page.locator('[data-test="o2-table-cell-route"]').getByText(op, { exact: true }),
        });
    }

    async openRequest(op, timeoutMs = 30000) {
        const row = this.rowFor(op);
        await expect(row).toHaveCount(1, { timeout: timeoutMs });
        await row.click();
        await expect(this.backButton).toBeVisible({ timeout: timeoutMs });
    }

    async expectHttpStatus(text, timeoutMs = 30000) {
        await expect(this.httpStatusChip).toHaveText(text, { timeout: timeoutMs });
    }

    async backToList(timeoutMs = 30000) {
        await this.backButton.click();
        await expect(this.table).toBeVisible({ timeout: timeoutMs });
    }
}
