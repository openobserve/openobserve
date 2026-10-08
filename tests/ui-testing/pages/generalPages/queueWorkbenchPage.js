// queueWorkbenchPage.js — Page object for the AI Observability Queue Workbench.
// Route: /web/ai/queues/:id/review?org_identifier={org}
// The Workbench item navigator renders each Queue Item's input_preview as its
// primary label and demotes the ref id to secondary text.

import { expect } from '@playwright/test';

export class QueueWorkbenchPage {
    constructor(page) {
        this.page = page;

        this.pageRoot = page.locator('[data-test="ai-queue-workbench-page"]');
        this.empty = page.locator('[data-test="ai-queue-workbench-empty"]');
    }

    navItem(i) {
        return this.page.locator(`[data-test="ai-queue-workbench-nav-item-${i}"]`);
    }

    navPreview(i) {
        return this.page.locator(`[data-test="ai-queue-workbench-nav-preview-${i}"]`);
    }

    // Returns true when the workbench shell renders; false when the route is absent
    // (Queue Workbench is enterprise-only — missing on the OSS binary). Callers skip on false.
    async gotoWorkbench(queueId) {
        const org = process.env['ORGNAME'] || 'default';
        await this.page.goto(
            `${process.env['ZO_BASE_URL']}/web/ai/queues/${queueId}/review?org_identifier=${org}`
        );
        try {
            await this.pageRoot.waitFor({ state: 'visible', timeout: 15000 });
            return true;
        } catch {
            return false;
        }
    }

    async expectNavPreviewText(i, text) {
        await expect(this.navPreview(i)).toHaveText(text);
    }

    async expectNavItemContainsText(i, text) {
        await expect(this.navItem(i)).toContainText(text);
    }

    async expectNavPreviewAbsent(i) {
        await expect(this.navPreview(i)).toHaveCount(0);
    }

    async expectNavItemAbsent(i) {
        await expect(this.navItem(i)).toHaveCount(0);
    }

    async expectEmptyVisible() {
        await expect(this.empty).toBeVisible();
    }
}
