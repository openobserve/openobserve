// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Enterprise only: the catalog route answers 403 on OSS, so every spec using this page guards on it.

import { expect } from '@playwright/test';

const SETUP_TIMEOUT = 240_000;

export class StarterPacksPage {
  constructor(page) {
    this.page = page;
    this.chip = page.locator('[data-test="header-starter-packs-btn"]');
    this.popup = page.locator('[data-test="starter-pack-popup"]');
    this.popupCloseBtn = page.locator('[data-test="starter-pack-popup-close-btn"]');
    this.primaryBtn = page.locator('[data-test="starter-pack-list-primary-btn"]');
    this.listStreamChips = page.locator('[data-test="starter-pack-list-stream-chip"]');
    this.railRows = page.locator('[data-test="starter-pack-list-rail"] [role="option"]');
    this.drawer = page.locator('[data-test="starter-pack-drawer"]');
    this.submitBtn = page.locator('[data-test="starter-pack-drawer-submit-btn"]');
    this.readyTitle = page.locator('[data-test="starter-pack-ready-title"]');
    this.retryBtn = page.locator('[data-test="starter-pack-progress-retry-btn"]');
    this.finishBtn = page.locator('[data-test="starter-pack-progress-finish-btn"]');
    this.runningBtn = page.locator('[data-test="starter-pack-progress-running-btn"]');
    this.openDashboardBtn = page.locator('[data-test="starter-pack-drawer-open-btn"]');
    this.viewGroupTitle = page.locator('[data-test="starter-pack-view-group-title"]');
    this.viewDashboardGroup = page.locator('[data-test="starter-pack-view-group-dashboard"]');
    this.viewDashboardOpen = this.viewDashboardGroup.locator('[data-test="starter-pack-view-group-open"]');
    this.viewGroupAlert = page.locator('[data-test="starter-pack-view-group-alert"]');
    this.viewAlertRows = page.locator('[data-test="starter-pack-view-alert-row"]');
    this.viewOrdinaryNote = page.locator('[data-test="starter-pack-view-ordinary"]');
    this.useAllBtn = page.locator('[data-test="starter-pack-repair-use-all-btn"]');
    // Packs no longer offer Undo or Remove, so any such control is a regression.
    this.undoOrRemove = page.locator('[data-test^="starter-pack"][data-test*="undo"], [data-test^="starter-pack"][data-test*="remove"]')
      .or(this.drawer.getByRole('button', { name: /^(Undo|Remove)\b/i }));
    this.accessNotice = page.locator('[data-test="access-action-error"]');
    this.homeAskAdminBanner = page.locator('[data-test="home-pack-ask-admin"]');
    this.profileIcon = page.locator('[data-test="header-my-account-profile-icon"]');
    this.logoutItem = page.locator('[data-test="menu-link-logout-item"]');
    this.loginForm = page.locator('[data-test="login-user-id-field"], [data-test="login-as-internal-user"]');
  }

  /** Keeps every API error this page sees, for a run that stops without saying why. */
  watchApiErrors() {
    if (this.apiErrors) return;
    this.apiErrors = [];
    this.page.on('response', (r) => {
      if (/\/api\//.test(r.url()) && r.status() >= 400) {
        this.apiErrors.push(`${r.request().method()} ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 140)}`);
      }
    });
    this.page.on('requestfailed', (r) => {
      if (/\/api\//.test(r.url())) this.apiErrors.push(`${r.method()} FAILED(${r.failure()?.errorText}) ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 140)}`);
    });
  }

  row(packId) {
    return this.page.locator(`[data-test="starter-pack-list-row-${packId}"]`);
  }

  adaptedQuestion(text) {
    return this.page.locator('[data-test="starter-pack-adapted-question"]', { hasText: text });
  }

  async chooseAdapted(text) {
    await this.adaptedQuestion(text).locator('[data-test="starter-pack-adapted-choose-btn"]').click();
  }

  homeUrl(org) {
    return `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/web/?org_identifier=${org}`;
  }

  /** Home's Overview tab is what runs the first match, and the chip shows only once one is saved. */
  async gotoHome(org) {
    const tab = this.page.getByRole('tab', { name: 'Overview' });
    this.watchApiErrors();
    await this.page.goto(this.homeUrl(org), { waitUntil: 'domcontentloaded' });
    // A slow shared env can leave Home on its skeleton; one reload is the recovery.
    if (!(await tab.waitFor({ state: 'visible', timeout: 90_000 }).then(() => true, () => false))) {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
    }
    await tab.click({ timeout: 90_000 });
  }

  /** A notice that lasts only while another run is going, so it is polled for rather than read once. */
  async expectDrawerShows(text, timeout = 60_000) {
    await expect(this.drawer).toContainText(text, { timeout });
  }

  async expectDashboardTitle(title) {
    await expect(this.page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  }

  async waitForChip(timeout = 90_000) {
    if (await this.chip.waitFor({ state: 'visible', timeout }).then(() => true, () => false)) return;
    const home = await this.page.locator('[data-test="home-pack-section"]').count();
    throw new Error(`Starter Packs chip not shown (home-pack-section=${home}); API errors: ${(this.apiErrors ?? []).join(' ; ') || 'none'}`);
  }

  async chipNumber() {
    const text = await this.chip.innerText();
    const m = text.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  }

  async openPopup() {
    await this.waitForChip();
    if (!(await this.popup.isVisible().catch(() => false))) await this.chip.click();
    await this.popup.waitFor({ state: 'visible', timeout: 20_000 });
  }

  async closePopup() {
    await this.popupCloseBtn.first().click().catch(() => {});
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.popup.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }

  async signOut() {
    await this.profileIcon.click();
    await this.logoutItem.click();
    await this.loginForm.first().waitFor({ state: 'visible', timeout: 60_000 });
  }

  async selectPack(packId) {
    await this.row(packId).click();
    await expect(this.primaryBtn).toBeVisible();
  }

  /** Popup → pack → Review Pack, waiting until Set up is clickable. */
  async openReview(org, packId, { navigate = true } = {}) {
    this.watchApiErrors();
    if (navigate) await this.gotoHome(org);
    await this.openPopup();
    await this.selectPack(packId);
    await expect(this.primaryBtn).toHaveText(/Review/i);
    await this.primaryBtn.click();
    await expect(this.submitBtn).toBeEnabled({ timeout: 90_000 });
  }

  /** Popup → pack → its installed view (View Pack, or Finish for a stopped one). */
  async openPack(org, packId, { navigate = true } = {}) {
    if (navigate) await this.gotoHome(org);
    await this.openPopup();
    await this.selectPack(packId);
    await this.primaryBtn.click();
    await this.drawer.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Clicks Set up and waits for the run to end; see waitForOutcome. */
  async setUp() {
    await this.submitBtn.click();
    return this.waitForOutcome();
  }

  /** 'ready' (all created), 'failed' (Retry offered) or 'stopped' (Finish offered). */
  async waitForOutcome(timeout = SETUP_TIMEOUT) {
    await this.readyTitle.or(this.retryBtn).or(this.finishBtn).first().waitFor({ state: 'visible', timeout });
    await expect(this.runningBtn).toBeHidden({ timeout });
    if (await this.retryBtn.isVisible()) return 'failed';
    if (await this.finishBtn.isVisible()) return 'stopped';
    return 'ready';
  }

  // Only a stop with a proxy 5xx is retried, so a stop with no gateway error still fails the test.
  async setUpExpectReady(testInfo) {
    let outcome = await this.setUp();
    for (let i = 0; i < 2 && outcome !== 'ready' && (this.apiErrors ?? []).some((e) => / 50[234] /.test(e)); i++) {
      testInfo?.annotations.push({ type: 'setup-stopped', description: `${outcome}: ${(this.apiErrors ?? []).join(' ; ')}`.slice(0, 2000) });
      outcome = await this.retry();
    }
    return outcome;
  }

  /** Clicks Retry (or Finish) and waits for that run to end. */
  async retry() {
    const btn = (await this.retryBtn.isVisible()) ? this.retryBtn : this.finishBtn;
    await btn.click();
    await expect(btn).toBeHidden({ timeout: 30_000 });
    return this.waitForOutcome();
  }

  async drawerText() {
    return (await this.drawer.innerText().catch(() => '')).replace(/\s+/g, ' ');
  }

  async pageText() {
    return (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');
  }
}
