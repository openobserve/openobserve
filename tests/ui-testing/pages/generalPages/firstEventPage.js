import { expect } from '@playwright/test';

// The first-event bar (FirstEventStatus), its diagnosis and the next-visit banner (FirstDataNotice).
export class FirstEventPage {
    constructor(page) {
        this.page = page;
        this.bar = page.locator('[data-test="first-event-status"]');
        this.meta = page.locator('[data-test="first-event-status-meta"]');
        this.summary = page.locator('[data-test="first-event-status-summary"]');
        this.firstRecord = page.locator('[data-test="first-event-status-first-record"]');
        this.openBtn = page.locator('[data-test="first-event-status-open-btn"]');
        this.troubleshootBtn = page.locator('[data-test="first-event-status-troubleshoot-btn"]');
        this.diagnosis = page.locator('[data-test="first-event-diagnosis"]');
        this.diagnosisFix = page.locator('[data-test="first-event-diagnosis-fix"]');
        this.diagnosisCopyBtn = page.locator('[data-test="first-event-diagnosis-copy-btn"]');
        this.diagnosisOrgId = page.locator('[data-test="first-event-diagnosis-org-id"]');
        this.diagnosisEndpoint = page.locator('[data-test="first-event-diagnosis-endpoint"]');
        this.stillStuck = page.locator('[data-test="first-event-diagnosis-still-stuck"]');
        this.docsLink = page.locator('[data-test="first-event-diagnosis-docs-link"]');
        this.contactSupportLink = page.locator('[data-test="first-event-diagnosis-contact-support-link"]');
        this.notice = page.locator('[data-test="first-data-notice"]');
        this.noticeText = page.locator('[data-test="first-data-notice-text"]');
        this.noticeOpenBtn = page.locator('[data-test="first-data-notice-open-btn"]');
        this.noticeDismissBtn = page.locator('[data-test="first-data-notice-dismiss-btn"]');
        this.logsResultRows = page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]');
    }

    async openGuide(path, orgId) {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web${path}?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }

    async openHome(orgId) {
        await this.page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${orgId}`);
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    }

    // Resolves on the watcher's first stream probe; a stream created before it is part of the baseline and never counts.
    firstProbe(type) {
        return this.page.waitForResponse((r) => r.url().includes(`/streams?type=${type}&offset=0&limit=1`), { timeout: 20000 });
    }

    async expectState(state, timeout = 10000) {
        await expect(this.bar).toHaveAttribute('data-state', state, { timeout });
    }

    async clickTroubleshoot() {
        await this.troubleshootBtn.click();
    }

    async clickOpen() {
        await this.openBtn.click();
    }

    async expectDiagnosis({ trigger, reason }, timeout = 10000) {
        await expect(this.diagnosis).toBeVisible({ timeout });
        if (trigger) await expect(this.diagnosis).toHaveAttribute('data-trigger', trigger);
        if (reason) await expect(this.diagnosis).toHaveAttribute('data-reason', reason);
    }

    async expectLogsRows(min = 1, timeout = 20000) {
        await expect.poll(() => this.logsResultRows.count(), { timeout }).toBeGreaterThanOrEqual(min);
    }
}
