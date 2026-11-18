const { expect } = require('@playwright/test');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';

const PAGE_TIMEOUT_MS = 30000;

class SecurityPage {
  constructor(page) {
    this.page = page;
    this.switcher = '[data-test="solution-switcher"]';
    this.mainNav = '[data-test="navbar-main-nav"]';
    this.eventsStream = '[data-test="security-events-stream"]';
    this.eventsTable = '[data-test="security-events-table"]';
    this.detectionsTable = '[data-test="security-detections-table"]';
    this.newDetectionButton = '[data-test="security-detections-new"]';
    this.newDetectionDialog = '[data-test="security-detections-new-dialog"]';
    this.newDetectionStream = '[data-test="security-detections-new-stream"]';
    this.sigmaEditor = '[data-test="security-detections-new-yaml"] .monaco-editor';
    this.compileBanner = '[data-test="security-detections-new-compile"]';
    this.pageLock = '[data-test="security-page-lock"]';
    this.casesSearch = '[data-test="security-cases-search"] input';
    this.caseDrawer = '[data-test="security-cases-drawer"]';
    this.caseTimeline = '[data-test="security-cases-drawer-timeline"]';
    this.closeDialog = '[data-test="security-case-close-dialog"]';
    this.closeVerdict = '[data-test="security-case-close-verdict"]';
    this.mergeDialog = '[data-test="security-case-merge-dialog"]';
    this.mergeTarget = '[data-test="security-case-merge-target"]';
    this.dialogPrimary = '[data-test="o-dialog-primary-btn"]';
  }

  navItem(path) {
    return this.page.locator(`${this.mainNav} [data-test="menu-link-${path}-item"]`);
  }

  caseTitle(id) {
    return this.page.locator(`[data-test="security-cases-title-${id}"]`);
  }

  caseRow(id) {
    return this.page.locator('[data-test^="o2-table-row-"]', { has: this.caseTitle(id) });
  }

  async goto(path, query = {}) {
    const params = new URLSearchParams({ org_identifier: getOrgIdentifier(), ...query });
    await this.page.goto(`${process.env.ZO_BASE_URL}/web/security/${path}?${params}`);
  }

  async switchSolution(key) {
    const option = this.page.locator(`[data-test="solution-${key}"]`);
    await expect(async () => {
      if (!(await option.isVisible())) await this.page.locator(this.switcher).click();
      await option.click({ timeout: 3000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectSolution(label) {
    await expect(this.page.locator(this.switcher)).toHaveText(label, { timeout: PAGE_TIMEOUT_MS });
  }

  async expectSwitcherHidden() {
    await expect(this.page.locator(this.mainNav)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.switcher)).toHaveCount(0);
  }

  async openNav(path) {
    await this.navItem(path).click();
    await expect(this.page).toHaveURL((url) => url.pathname.includes(`/web${path}`), { timeout: PAGE_TIMEOUT_MS });
  }

  async selectEventsStream(stream) {
    // The page ignores a pick made before its mount-time load ends, which it marks by writing sql_mode into the URL.
    await expect(this.page).toHaveURL((url) => url.searchParams.has('sql_mode'), { timeout: PAGE_TIMEOUT_MS });
    await selectOSelectOption(this.page, this.eventsStream, stream);
  }

  async expectEventRow(marker, cells) {
    const row = this.page.locator(`${this.eventsTable} [data-test^="o2-table-row-"]`, { hasText: marker });
    await expect(row).toHaveCount(1, { timeout: PAGE_TIMEOUT_MS });
    for (const [column, text] of Object.entries(cells)) {
      await expect(row.locator(`[data-test="o2-table-cell-${column}"]`)).toHaveText(text);
    }
  }

  async openNewDetection() {
    await this.page.locator(this.newDetectionButton).click();
    await expect(this.page.locator(this.newDetectionDialog)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async writeSigma(yaml) {
    await this.page.locator('[data-test="security-detections-new-mode-custom"]').click();
    const editor = this.page.locator(this.sigmaEditor).first();
    const lines = this.page.locator('[data-test="security-detections-new-yaml"] .view-lines');
    await expect(editor).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    // The starter rule lands after the editor mounts; clearing earlier leaves it to merge with ours.
    await expect(lines).toContainText('title:', { timeout: PAGE_TIMEOUT_MS });
    await expect(async () => {
      await editor.click();
      // The run's device profile reports a non-Mac user agent, so the editor binds select-all to Control on every host.
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Delete');
      await expect(lines).toHaveText('', { timeout: 2000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
    // insertText lands as one edit, so the editor's auto-indent cannot shift the YAML's nesting.
    await this.page.keyboard.insertText(yaml);
    await expect(lines).toContainText(yaml.split('\n')[0]);
  }

  async pickDetectionStream(stream) {
    await selectOSelectOption(this.page, this.newDetectionStream, stream);
  }

  async expectCompilesAgainst(stream) {
    await expect(this.page.locator(this.compileBanner)).toContainText(`Compiles against ${stream}`, {
      timeout: PAGE_TIMEOUT_MS,
    });
  }

  async submitDialog(dialogSelector) {
    const dialog = this.page.locator(dialogSelector);
    await expect(dialog.locator(this.dialogPrimary)).toBeEnabled({ timeout: PAGE_TIMEOUT_MS });
    await dialog.locator(this.dialogPrimary).click();
    await expect(dialog).toBeHidden({ timeout: PAGE_TIMEOUT_MS });
  }

  async createDetection() {
    await this.submitDialog(this.newDetectionDialog);
  }

  async expectDetectionListed(title, stream) {
    const row = this.page.locator(`${this.detectionsTable} [data-test^="o2-table-row-"]`, { hasText: title });
    await expect(row).toHaveCount(1, { timeout: PAGE_TIMEOUT_MS });
    await expect(row).toContainText(stream);
  }

  async expectDetectionsReadable({ canCreate }) {
    await expect(this.page.locator(this.detectionsTable)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.pageLock)).toHaveCount(0);
    const create = this.page.locator(this.newDetectionButton);
    await (canCreate ? expect(create).toBeEnabled() : expect(create).toBeDisabled());
  }

  async expectSecurityLocked(preset) {
    await expect(this.page.locator(this.pageLock)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator('[data-test="security-page-lock-ask-admin"]')).toContainText(preset);
    await expect(this.page.locator(this.detectionsTable)).toHaveCount(0);
    await expect(this.page.locator(this.newDetectionButton)).toHaveCount(0);
  }

  async searchCases(text) {
    // The search commits after a debounce and clears any selection as it fetches, so wait for that fetch.
    const searched = this.page.waitForResponse(
      (r) => r.url().includes('/security/cases/search') && new URL(r.url()).searchParams.get('q') === text,
      { timeout: PAGE_TIMEOUT_MS },
    );
    await this.page.locator(this.casesSearch).fill(text);
    expect((await searched).status()).toBe(200);
  }

  async expectCaseListed(id, listed) {
    await expect(this.caseTitle(id)).toHaveCount(listed ? 1 : 0, { timeout: PAGE_TIMEOUT_MS });
  }

  async openCase(id) {
    await this.caseTitle(id).click();
    await expect(this.page.locator(this.caseDrawer)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page).toHaveURL(new RegExp(`case=${id}`));
  }

  async closeOpenCase(verdict, reason) {
    await this.page.locator('[data-test="security-cases-drawer-status-resolved"]').click();
    await expect(this.page.locator(this.closeDialog)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await selectOSelectOption(this.page, this.closeVerdict, verdict, { scope: this.page.locator(this.closeDialog) });
    await this.page.locator('[data-test="security-case-close-reason"] textarea').fill(reason);
    await this.submitDialog(this.closeDialog);
  }

  async expectTimeline(texts) {
    await this.page.locator('[data-test="security-cases-drawer-tab-timeline"]').click();
    const timeline = this.page.locator(this.caseTimeline);
    for (const text of texts) await expect(timeline).toContainText(text, { timeout: PAGE_TIMEOUT_MS });
  }

  caseCheckbox(id) {
    return this.caseRow(id).locator('[data-test="o2-table-select-cell"] [role="checkbox"]');
  }

  async mergeCases(ids, targetId, reason) {
    const merge = this.page.locator('[data-test="security-cases-bulk-merge"]');
    const dialog = this.page.locator(this.mergeDialog);
    // A list refetch drops the selection and the bulk bar shifts the rows, so picking and opening repeat until the dialog holds every case.
    await expect(async () => {
      if (await dialog.isVisible()) await dialog.locator('[data-test="o-dialog-secondary-btn"]').click();
      for (const id of ids) if (!(await this.caseCheckbox(id).isChecked())) await this.caseCheckbox(id).click();
      for (const id of ids) await expect(this.caseCheckbox(id)).toBeChecked({ timeout: 2000 });
      await merge.click({ timeout: 2000 });
      await expect(dialog).toContainText(`Merge ${ids.length} cases`, { timeout: 2000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
    const trigger = this.page.locator(`${this.mergeDialog} [data-test="security-case-merge-target-trigger"]`);
    // Options carry no value attribute, so the case is picked by the id its label shows.
    await expect(async () => {
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      await this.page.locator('[data-test="security-case-merge-target-option"]', { hasText: targetId }).click({ timeout: 2000 });
      await expect(trigger).toContainText(targetId, { timeout: 2000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
    await this.page.locator('[data-test="security-case-merge-reason"] textarea').fill(reason);
    await expect(dialog).toContainText(`Merge ${ids.length} cases`);
    await this.submitDialog(this.mergeDialog);
  }
}

module.exports = SecurityPage;
