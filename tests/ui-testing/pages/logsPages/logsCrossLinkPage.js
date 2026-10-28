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

// Page object for org-level cross-links as they reach the log-detail drawer.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class LogsCrossLinkPage {
  constructor(page) {
    this.page = page;

    this.detailDialog = '[data-test="logs-search-result-detail-dialog"]';
    this.detailTableTab = '[data-test="log-detail-table-tab"]';
    this.detailTableContent = '[data-test="log-detail-table-content"]';
    this.fieldMenuTrigger = (field) => `[data-test="log-details-include-exclude-field-btn-${field}"]`;
    this.fieldValue = (field) => `[data-test="log-detail-${field}-value"]`;
    this.crossLinkItem = (name) => `[data-test="log-details-cross-link-${name}"]`;
    this.anyCrossLinkItem = '[data-test^="log-details-cross-link-"]';
  }

  // ===== ORG SETTINGS (POST /settings replaces the whole cross_links array) =====

  async readOrgCrossLinks() {
    const url = `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/settings`;
    const response = await this.page.request.get(url, { headers: getAuthHeaders() });
    expect(response.status(), 'could not read org settings').toBe(200);
    const body = await response.json();
    return body?.data?.cross_links ?? [];
  }

  async writeOrgCrossLinks(links) {
    const url = `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/settings`;
    const response = await this.page.request.post(url, {
      headers: getAuthHeaders(),
      data: { cross_links: links },
    });
    expect(response.status(), 'could not write org settings').toBe(200);
    testLogger.debug('Org cross_links written', { count: links.length });
  }

  // ===== DRAWER =====

  async openFieldTableTab() {
    await this.page.locator(this.detailDialog).locator(this.detailTableTab).click();
    await expect(this.page.locator(this.detailTableContent)).toBeVisible({ timeout: 15000 });
  }

  async openFieldMenu(field) {
    const trigger = this.page.locator(this.fieldMenuTrigger(field)).first();
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click();
  }



  async expectCrossLinkOffered(name) {
    await expect(this.page.locator(this.crossLinkItem(name))).toBeVisible({ timeout: 10000 });
  }

  async readFieldValue(field) {
    const cell = this.page.locator(this.fieldValue(field)).first();
    await expect(cell).toBeVisible({ timeout: 15000 });
    return (await cell.innerText()).trim();
  }

  /**
   * Clicks the cross-link item and returns the page window.open actually created.
   * The item passes `noopener`, so the new tab arrives on the context, not as a popup
   * of this page.
   */
  async openCrossLinkAndReadUrl(name) {
    const context = this.page.context();
    const [opened] = await Promise.all([
      context.waitForEvent('page', { timeout: 20000 }),
      this.page.locator(this.crossLinkItem(name)).first().click(),
    ]);
    await expect
      .poll(() => opened.url(), {
        timeout: 15000,
        message: 'the opened tab never committed a URL',
      })
      .not.toBe('about:blank');
    const url = opened.url();
    await opened.close();
    testLogger.info('Cross-link opened a real tab', { url });
    return url;
  }
}
