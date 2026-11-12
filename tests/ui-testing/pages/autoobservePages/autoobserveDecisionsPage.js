// Alert calibration's write patterns through the AutoObserve decision route: Dismiss, Mark as intended report, the Dismissed lists and Undo, by data-test only.
const { expect } = require('@playwright/test');

const BASE = () => (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
const DECISIONS = /\/api\/v2\/[^/]+\/autoobserve\/decisions(\?|$)/;
const UNDO = /\/api\/v2\/[^/]+\/autoobserve\/decisions\/[^/]+\/undo$/;

class AutoObserveDecisionsPage {
  constructor(page) {
    this.page = page;
    this.dismissButtons = page.locator('[data-test="alert-calibration-dashboard-dismiss"]');
    this.ruleGroups = page.locator(
      '[data-test^="alert-calibration-dashboard-rule-"]:not([data-test$="all-dismissed"])',
    );
    this.dialog = page.locator('[data-test="decision-dismiss-dialog"]');
    this.effect = page.locator('[data-test="decision-dismiss-effect"]');
    this.notice = page.locator('[data-test="decision-dismiss-notice"]');
    this.locked = page.locator('[data-test="decision-dismiss-locked"]');
    this.submit = page.locator('[data-test="decision-dismiss-submit"]');
    this.until = page.locator('[data-test="decision-dismiss-until"]');
    this.duration = page.locator('[data-test="decision-dismiss-duration"]');
    this.note = page.locator('[data-test="decision-dismiss-note"] textarea, textarea[data-test="decision-dismiss-note"]');
    this.toastUndo = page.getByRole('button', { name: /^Undo$/ });
    this.decidedList = page.locator('[data-test="decision-dismissed"]');
    this.decidedRows = page.locator('[data-test="decision-dismissed-row"]');
    this.decidedSummaries = page.locator('[data-test="decision-dismissed-summary"]');
    this.decidedUndo = page.locator('[data-test="decision-dismissed-undo"]');
    this.oldTable = page.locator('[data-test="alert-calibration-dismissed-table"]');
    this.evidence = page.locator(
      '[data-test="alert-calibration-dashboard-rule-noise"] [data-test="alert-calibration-dashboard-view-evidence"]',
    );
    this.markButtons = page.locator('[data-test="alert-calibration-finding-mark-report"]');
    this.markDialog = page.locator('[data-test="decision-mark-dialog"]');
    this.markChecks = page.locator('[data-test="decision-mark-row-check"]');
    this.markSubmit = page.locator('[data-test="decision-mark-submit"]');
    this.findingBadge = page.locator('[data-test="alert-calibration-finding-dismissed"]');
    this.findingFold = page.locator('[data-test="alert-calibration-finding-fold"]');
  }

  url(org, query = '') {
    return `${BASE()}/web/alert-calibration?org_identifier=${org}${query ? `&${query}` : ''}`;
  }

  // Groups start folded; their Dismiss buttons exist only once opened.
  async open(org, query = '') {
    await this.page.goto(this.url(org, query));
    await expect(this.ruleGroups.first().or(this.decidedList)).toBeVisible({ timeout: 60000 });
    const n = await this.ruleGroups.count();
    for (let i = 0; i < n; i += 1) {
      const trigger = this.ruleGroups.nth(i).locator('[aria-expanded]').first();
      if ((await trigger.count()) && (await trigger.getAttribute('aria-expanded')) === 'false') {
        await trigger.click();
      }
    }
  }

  reason(value) {
    return this.page.locator(`[data-test="decision-dismiss-reason-${value}"]`);
  }

  durationOption(value) {
    return this.page.locator(`[data-test="decision-dismiss-duration-option"][data-test-value="${value}"]`);
  }

  async openDismiss() {
    await this.dismissButtons.first().click();
    await expect(this.dialog).toBeVisible({ timeout: 15000 });
    await expect(this.effect).not.toHaveAttribute('data-state', 'loading', { timeout: 15000 });
  }

  // Waits for the preview of the terms just chosen, so Save writes what the reader saw.
  async chosen(action) {
    const asked = this.page.waitForResponse((r) => r.url().includes('/autoobserve/decisions/preview'));
    await action();
    await asked;
    await expect(this.effect).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  }

  async save(button = this.submit) {
    const written = this.page.waitForResponse(
      (r) => DECISIONS.test(new URL(r.url()).pathname + new URL(r.url()).search) && r.request().method() === 'POST',
    );
    await button.click();
    const response = await written;
    return { sent: response.request().postDataJSON(), status: response.status(), body: await response.json() };
  }

  async undo(button) {
    const undone = this.page.waitForResponse((r) => UNDO.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await button.click();
    return (await undone).status();
  }
}

module.exports = { AutoObserveDecisionsPage, BASE };
