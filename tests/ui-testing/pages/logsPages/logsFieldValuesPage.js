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

import { expect } from '@playwright/test';

export class LogsFieldValuesPage {
  constructor(page) {
    this.page = page;

    this.valuesPanel = '[data-test="field-values-panel-container"]';
    // OSearchInput renders no data-test of its own, so the wrapper class is the hook.
    this.valueSearchInput = `${this.valuesPanel} .value-search-input-wrap input`;
  }

  expandButton(field) {
    return `[data-test="log-search-expand-${field}-field-btn"]`;
  }

  loadMoreButton(field) {
    return `[data-test="log-search-subfield-load-more-${field}"]`;
  }

  valueRowPrefix(field) {
    return `logs-search-subfield-add-${field}-`;
  }

  async openLogs(org, stream) {
    const url =
      `/web/logs?org_identifier=${org}&stream=${stream}&stream_type=logs` +
      '&period=15m&refresh=0&sql_mode=false&quick_mode=false&show_histogram=true';
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async expandField(field) {
    const button = this.page.locator(this.expandButton(field));
    await button.waitFor({ state: 'visible', timeout: 60000 });
    await button.click();
    await this.page
      .locator(this.valuesPanel)
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
  }

  /** The distinct value keys currently rendered for `field`, in display order. */
  async valueKeys(field) {
    const prefix = this.valueRowPrefix(field);
    return this.page
      .locator(`[data-test^="${prefix}"]`)
      .evaluateAll(
        (elements, len) => elements.map((el) => el.getAttribute('data-test').slice(len)),
        prefix.length,
      );
  }

  async waitForValues(field, timeout = 60000) {
    await expect.poll(async () => (await this.valueKeys(field)).length, { timeout }).toBeGreaterThan(0);
    return this.valueKeys(field);
  }

  async expectLoadMoreVisible(field) {
    await expect(this.page.locator(this.loadMoreButton(field))).toBeVisible({ timeout: 30000 });
  }

  async clickLoadMore(field) {
    const button = this.page.locator(this.loadMoreButton(field));
    await button.waitFor({ state: 'visible', timeout: 30000 });
    await button.click();
  }

  async waitForMoreThan(field, count, timeout = 60000) {
    await expect.poll(async () => (await this.valueKeys(field)).length, { timeout }).toBeGreaterThan(count);
    return this.valueKeys(field);
  }

  async searchValues(term) {
    const input = this.page.locator(this.valueSearchInput).first();
    await input.waitFor({ state: 'visible', timeout: 30000 });
    await input.fill(term);
  }

  /** Polls until every rendered key contains `term` and at least one is rendered. */
  async waitForValuesMatching(field, term, timeout = 60000) {
    await expect
      .poll(
        async () => {
          const keys = await this.valueKeys(field);
          return keys.length > 0 && keys.every((key) => key.includes(term));
        },
        { timeout },
      )
      .toBe(true);
    return this.valueKeys(field);
  }
}
