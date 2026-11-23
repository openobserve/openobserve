// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';

// en-US `dateStyle: medium, timeStyle: short`; Intl may put a narrow no-break space before AM/PM.
const END_TIME = '[A-Z][a-z]{2} \\d{1,2}, \\d{4}, \\d{1,2}:\\d{2}\\s[AP]M';
const LABELS = {
  created: 'Temporary, created by {who}, ends at ',
  on: 'Incident creation turned on by {who} until ',
  off: 'Incident creation turned off by {who} until ',
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The lease chips of the alert list rows and the alert detail header (LeaseChip.vue). */
export class AlertLeasePage {
  constructor(page) {
    this.page = page;
    this.searchField = '[data-test="alert-list-search-input-field"]';
    this.tooltip = '[data-test="o-tooltip-content"]';
  }

  /** `kind` is `created` or `creates_incident`, the lease kind the data-test carries. */
  listChip(name, kind) { return this.page.locator(`[data-test="alert-list-${name}-lease-${kind}"]`); }

  anyListChip(name) { return this.page.locator(`[data-test^="alert-list-${name}-lease-"]`); }

  detailChip(kind) { return this.page.locator(`[data-test="alerts-alertdetail-lease-${kind}"]`); }

  anyDetailChip() { return this.page.locator('[data-test^="alerts-alertdetail-lease-"]'); }

  listRow(name) {
    return this.page.locator('tr', { has: this.page.locator(`[data-test="alert-list-${name}-more-options"]`) });
  }

  pauseStartButton(name) { return this.page.locator(`[data-test="alert-list-${name}-pause-start-alert"]`); }

  async searchList(text) {
    await this.page.locator(this.searchField).fill(text);
  }

  async reloadList() {
    await this.page.reload();
    await expect(this.page.locator(this.searchField)).toBeVisible({ timeout: 30000 });
  }

  /** The exact chip text; `variant` is `created`, `on` or `off`. */
  labelPattern(variant, who) {
    const prefix = escapeRegex(LABELS[variant].replace('{who}', who));
    return new RegExp(`^\\s*${prefix}${END_TIME}\\s*$`);
  }

  async expectChip(chip, variant, who) {
    await expect(chip).toBeVisible({ timeout: 30000 });
    await expect(chip).toHaveText(this.labelPattern(variant, who), { timeout: 15000 });
  }

  /** The hover repeats the whole label and adds the reason, since the list cell truncates the chip. */
  async expectTooltip(chip, variant, who, reason) {
    const label = escapeRegex(LABELS[variant].replace('{who}', who));
    await chip.hover();
    const tip = this.page.locator(this.tooltip).filter({ hasText: reason });
    await expect(tip).toBeVisible({ timeout: 15000 });
    // Not anchored: reka repeats the content in a visually hidden role="tooltip" node.
    await expect(tip).toHaveText(new RegExp(`${label}${END_TIME}\\. Why: ${escapeRegex(reason)}`), { timeout: 15000 });
    await this.page.mouse.move(0, 0);
  }

  async expectRowEnabled(name, enabled) {
    await expect(this.pauseStartButton(name)).toHaveAttribute('data-row-action', enabled ? 'pause' : 'resume', { timeout: 15000 });
  }

  /** Records every alert-list GET from now on, to prove a chip changed without a refetch. */
  recordListFetches() {
    const urls = [];
    this.page.on('request', (request) => {
      if (request.method() === 'GET' && /\/api\/v2\/[^/]+\/alerts\?/.test(request.url())) urls.push(request.url());
    });
    return urls;
  }
}
