import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * OnCall → Team detail view. Owns the five-tab header, the detail title and
 * the edit entry point.
 */
export class OnCallTeamDetailPage {
  constructor(page) {
    this.page = page;
    this.detailPage = page.locator('[data-test="oncall-team-detail-page"]');
    this.coverageTag = page.locator('[data-test="oncall-team-coverage"]');
    this.editButton = page.locator('[data-test="oncall-team-detail-edit-btn"]');
  }

  async expectDetailTitle(name) {
    await expect(this.detailPage).toBeVisible({ timeout: 30000 });
    await expect(this.detailPage.locator('h1')).toContainText(name);
  }

  async expectTabsVisible() {
    for (const tab of ['overview', 'schedule', 'members', 'policy', 'ownership']) {
      await expect(this.page.locator(`[data-test="oncall-team-tab-${tab}"]`)).toBeVisible();
    }
  }

  async expectCoverageVisible() {
    await expect(this.coverageTag).toBeVisible({ timeout: 30000 });
  }

  async openTab(name) {
    testLogger.info('Opening team detail tab', { name });
    await this.page.locator(`[data-test="oncall-team-tab-${name}"]`).click();
  }

  async clickEdit() {
    testLogger.info('Clicking team detail edit button');
    await this.editButton.click();
  }
}
