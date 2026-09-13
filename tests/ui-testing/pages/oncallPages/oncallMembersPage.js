import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * OnCall → Team detail → Members tab. Owns the member picker (OSelect) and the
 * roster table.
 */
export class OnCallMembersPage {
  constructor(page) {
    this.page = page;
    this.membersRoot = page.locator('[data-test="oncall-members"]');
    this.membersTable = page.locator('[data-test="oncall-members-table"]');
    this.pickerTrigger = page.locator('[data-test="oncall-members-user-select-trigger"]');
    this.pickerOption = page.locator('[data-test="oncall-members-user-select-option"]');
    this.addButton = page.locator('[data-test="oncall-members-add-btn"]');
  }

  async expectMembersVisible() {
    await expect(this.membersRoot).toBeVisible({ timeout: 30000 });
  }

  /**
   * Pick the first available org user in the member picker, add them, and
   * return their email so the caller can assert the roster row.
   */
  async addFirstMember() {
    testLogger.info('Adding first available member');
    await this.pickerTrigger.waitFor({ state: 'visible', timeout: 30000 });
    await this.pickerTrigger.click();
    const popover = this.page.locator('[data-test="oncall-members-user-select-popover"]');
    await popover.waitFor({ state: 'visible', timeout: 10000 });
    const firstOption = this.pickerOption.first();
    await firstOption.waitFor({ state: 'visible', timeout: 10000 });
    const email = await firstOption.getAttribute('data-test-value');
    await firstOption.click();
    // Multiple-select keeps the popover open; close it before clicking Add.
    await this.page.keyboard.press('Escape');
    await this.addButton.click();
    return email;
  }

  async expectMemberRowVisible(email) {
    await expect(this.membersTable.filter({ hasText: email })).toBeVisible({ timeout: 30000 });
  }
}
