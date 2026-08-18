// onlineEvalsPage.js
// Page object for the Online Evals job form (AI Observability → Eval Jobs).
// Selectors verified against:
//   web/src/enterprise/components/OnlineEvals.vue
//   web/src/enterprise/components/onlineEvals/forms/JobFormPage.vue
//   web/src/enterprise/components/onlineEvals/forms/job/JobPreviewPanel.vue
//   web/src/lib/forms/Select/OSelect.vue (option data-test derivation)

import { expect } from '@playwright/test';

// Scope → { title, suffixWord } for the matched-targets preview card.
const SCOPE_TEXT = {
  span: { title: 'Matched Spans', suffixWord: 'spans' },
  trace: { title: 'Matched Traces', suffixWord: 'traces' },
  session: { title: 'Matched Sessions', suffixWord: 'sessions' },
};

export class OnlineEvalsPage {
  constructor(page) {
    this.page = page;

    // ===== PAGE / NAVIGATION =====
    // AI Observability shell root (route /web/ai/evaluations?tab=jobs).
    this.onlineEvalsPageRoot = '[data-test="online-evals-page"]';
    // Jobs tab "New Job" button (OPageHeader #actions).
    this.evalJobListAddBtn = '[data-test="eval-job-list-add-btn"]';

    // ===== JOB FORM (JobFormPage.vue) =====
    this.jobFormTitle = '[data-test="job-form-title"]';
    this.streamSelect = '[data-test="job-form-stream-select"]';
    this.targetScopeSelect = '[data-test="job-form-target-scope-select"]';

    // ===== PREVIEW PANEL (JobPreviewPanel.vue) =====
    // The matched-targets count card (title + count + suffix). Count/suffix are
    // plain spans without their own data-test, so assert against container text.
    this.matchedTargetsCard = '[data-test="job-preview-matched-targets"]';
  }

  /**
   * Navigate directly to the Online Evals "Eval Jobs" tab (fastest path — mirrors
   * tracesPage.navigateToTracesUrl). The route is /web/ai/evaluations?tab=jobs.
   */
  async navigateToOnlineEvalsJobs() {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const url = `${baseUrl}/web/ai/evaluations?tab=jobs&org_identifier=${org}`;
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // Guard: the shell must actually render before callers click "New Job".
    await expect(this.page.locator(this.onlineEvalsPageRoot)).toBeVisible({ timeout: 15000 });
  }

  /**
   * Click "New Job" and wait for the create form to mount. Guards the click so a
   * silently-failed click (form never mounts) fails here instead of later.
   */
  async clickNewJob() {
    const addBtn = this.page.locator(this.evalJobListAddBtn);
    await expect(addBtn).toBeVisible({ timeout: 15000 });
    await addBtn.click();
    await expect(this.page.locator(this.jobFormTitle)).toBeVisible({ timeout: 15000 });
  }

  /**
   * Select a value in an OSelect field (wrapper data-test + <parent>-option /
   * <parent>-trigger derivation from OSelect.vue). Guarded: confirms the selection
   * landed via the trigger's data-test-selected-value before returning.
   * @param {string} wrapperSelector - full `[data-test="…"]` wrapper selector (a property)
   * @param {string} value - the option's value (e.g. "default", "span")
   */
  async selectOption(wrapperSelector, value) {
    // Derive the bare data-test name so the -trigger/-option/-popover children
    // (OSelect.vue: `${parentDataTest}-trigger` etc.) can be targeted.
    const dataTestName = wrapperSelector.match(/data-test="([^"]+)"/)?.[1];
    const wrapper = this.page.locator(wrapperSelector);
    await wrapper.waitFor({ state: 'visible', timeout: 10000 });

    const trigger = this.page.locator(`[data-test="${dataTestName}-trigger"]`);
    await trigger.waitFor({ state: 'visible', timeout: 5000 });

    // Idempotent: already selected → nothing to do.
    const selected = await trigger.getAttribute('data-test-selected-value').catch(() => null);
    if (selected === value) return;

    // Open the popover (options only mount while it is open — virtualised list).
    await trigger.click();

    const option = this.page
      .locator(`[data-test="${dataTestName}-option"][data-test-value="${value}"]`)
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();

    // Guard: confirm the selection actually took effect before callers assert on it.
    await expect(trigger).toHaveAttribute('data-test-selected-value', value, { timeout: 10000 });

    // Dismiss the popover if it is still open.
    const popover = this.page.locator(`[data-test="${dataTestName}-popover"]`);
    if (await popover.isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
    }
  }

  /** Select the input traces stream in the job form. */
  async selectJobStream(streamName = 'default') {
    await this.selectOption(this.streamSelect, streamName);
  }

  /** Select the evaluation target scope (span | trace | session). */
  async selectTargetScope(scope) {
    await this.selectOption(this.targetScopeSelect, scope);
  }

  /** The matched-targets preview card is visible (renders in every form state). */
  async expectMatchedTargetsCardVisible() {
    await expect(this.page.locator(this.matchedTargetsCard)).toBeVisible({ timeout: 15000 });
  }

  /**
   * The hint branch (no stream selected) — the count/suffix must NOT be present.
   * "last 1h" only renders in the count branch, so its absence confirms the hint.
   */
  async expectMatchedTargetsHint() {
    await expect(this.page.locator(this.matchedTargetsCard)).not.toContainText('last 1h', {
      timeout: 15000,
    });
  }

  /**
   * The count branch is settled for the given scope: correct title, correct
   * "… matched" wording, and the new "last 1h" suffix — with the 24h→1h
   * regression guard ("last 24h" must be absent).
   * @param {('span'|'trace'|'session')} scope
   */
  async expectMatchedTargetsScope(scope) {
    const { title, suffixWord } = SCOPE_TEXT[scope];
    const card = this.page.locator(this.matchedTargetsCard);
    // The suffix appears once the debounced (400ms) count query resolves — auto-retrying.
    await expect(card).toContainText(title, { timeout: 15000 });
    await expect(card).toContainText(`${suffixWord} matched`, { timeout: 15000 });
    await expect(card).toContainText('last 1h', { timeout: 15000 });
    await expect(card).not.toContainText('last 24h', { timeout: 15000 });
  }
}
