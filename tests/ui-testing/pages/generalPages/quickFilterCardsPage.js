// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';

const ORG = () => process.env.ORGNAME || 'default';
// Default page size of all three lists; a row count is only the full answer within one page.
const PAGE_SIZE = 20;

// Each list page names its table, its card hooks and how a row shows its object.
const LISTS = {
  alerts: {
    table: '[data-test="alert-list-table"]',
    card: (key) => `[data-test="alert-summary-${key}"]`,
    rowName: (name) => `[data-test="alert-list-${name}-name-cell"]`,
  },
  pipelines: {
    table: '[data-test="pipeline-list-table"]',
    card: (key) => `[data-test="pipeline-summary-${key}"]`,
    rowName: (name) => `[data-test="pipeline-list-name-cell-${name}"]`,
  },
  publicLinks: {
    table: '[data-test="dashboards-public-links-table"]',
    card: (key) => `[data-test="dashboards-public-links-summary-${key}"]`,
    rowName: (id) => `[data-test="dashboards-public-links-${id}-name"]`,
  },
};

/** The tray-style quick filter cards above the Alerts, Pipelines and Public links lists. */
export class QuickFilterCardsPage {
  constructor(page) {
    this.page = page;
  }

  async gotoPipelines() {
    await this.page.goto(`/web/pipeline/pipelines?org_identifier=${ORG()}`);
    await expect(this.page.locator(LISTS.pipelines.table)).toBeVisible({ timeout: 30000 });
  }

  async gotoPublicLinks() {
    await this.page.goto(`/web/dashboards/public-links?org_identifier=${ORG()}`);
    await expect(this.page.locator(LISTS.publicLinks.table)).toBeVisible({ timeout: 30000 });
  }

  card(list, key) {
    return this.page.locator(LISTS[list].card(key));
  }

  /** The card's value comes first in its text; a digit right after it would mean a bigger number. */
  async expectCardCount(list, key, count) {
    await expect(this.card(list, key), `${list} card "${key}" count`).toHaveText(
      new RegExp(`^\\s*${count}(?!\\d)`),
      { timeout: 30000 },
    );
  }

  async clickCard(list, key) {
    await this.card(list, key).click();
  }

  async expectCardSelected(list, key, selected) {
    await expect(this.card(list, key), `${list} card "${key}" selected`).toHaveAttribute(
      'aria-pressed',
      String(selected),
      { timeout: 15000 },
    );
  }

  /** The table lists exactly `count` rows, every `shown` object among them and no `hidden` one. */
  async expectRows(list, { count, shown = [], hidden = [] }) {
    const { table, rowName } = LISTS[list];
    expect(count, `${list}: expected rows must fit the first page of ${PAGE_SIZE}`).toBeLessThanOrEqual(PAGE_SIZE);
    for (const name of shown) {
      await expect(this.page.locator(`${table} ${rowName(name)}`), `${list} row ${name} shown`).toBeVisible({ timeout: 30000 });
    }
    for (const name of hidden) {
      await expect(this.page.locator(`${table} ${rowName(name)}`), `${list} row ${name} hidden`).toHaveCount(0, { timeout: 15000 });
    }
    await expect(this.page.locator(`${table} tr[data-test^="o2-table-row-"]`), `${list} row count`).toHaveCount(count, { timeout: 15000 });
  }
}
