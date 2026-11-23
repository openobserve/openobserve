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

// Page object for the results-header actions and the overflow menu they collapse into
// below SearchResult.vue's measured 700px container width.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsResultsToolbarPage {
  constructor(page) {
    this.page = page;

    this.wrapContentKey = 'wrapContent';
    this.inlineWrapButton = '[data-test="logs-search-result-wrap-table-content-btn"]';
    this.overflowMenuButton = '[data-test="logs-result-actions-menu-btn"]';
    this.overflowWrapItem = '[data-test="logs-result-wrap-menu-item"]';
    this.overflowRefreshItem = '[data-test="logs-result-refresh-menu-item"]';
  }

  /**
   * Resizes, then waits for the header to settle: containerWidth comes from a
   * ResizeObserver, so reading the toolbar at once races the recompute.
   */
  async setViewportWidthAndSettle(width, { expectOverflow }) {
    await this.page.setViewportSize({ width, height: 1024 });
    await this.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))),
        ),
    );
    const appears = expectOverflow ? this.overflowMenuButton : this.inlineWrapButton;
    const disappears = expectOverflow ? this.inlineWrapButton : this.overflowMenuButton;
    await expect(this.page.locator(appears)).toBeVisible({ timeout: 20000 });
    await expect(this.page.locator(disappears)).toHaveCount(0);
    testLogger.debug('Results header settled', { width, expectOverflow });
  }

  async openOverflowMenu() {
    await this.page.locator(this.overflowMenuButton).click();
    await expect(this.page.locator(this.overflowRefreshItem)).toBeVisible({ timeout: 10000 });
  }

  async clickOverflowWrapItem() {
    await this.page.locator(this.overflowWrapItem).click();
    await expect(this.page.locator(this.overflowRefreshItem)).toHaveCount(0);
  }

  async readStoredWrapContent() {
    return await this.page.evaluate((key) => localStorage.getItem(key), this.wrapContentKey);
  }
}
