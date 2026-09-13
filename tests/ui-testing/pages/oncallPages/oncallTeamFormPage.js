import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * The create/edit team drawer. The drawer is rendered by OnCallTeamForm.vue
 * (shared by the Teams list and the Team detail view), so its fields are
 * reachable from both entry points via the same data-test attributes.
 */
export class OnCallTeamFormPage {
  constructor(page) {
    this.page = page;
    this.drawer = page.locator('[data-test="oncall-team-form-drawer"]');
    this.nameInput = page.locator('[data-test="oncall-team-form-name"] input');
    this.descriptionInput = page.locator('[data-test="oncall-team-form-description"] input');
    this.saveButton = page.locator(
      '[data-test="oncall-team-form-drawer"] [data-test="o-drawer-primary-btn"]',
    );
  }

  async expectDrawerVisible() {
    await expect(this.drawer).toBeVisible({ timeout: 30000 });
  }

  async fillName(name) {
    testLogger.info('Filling team name', { name });
    await this.nameInput.fill(name);
    // The name is required; assert the value stuck so save never fires on an
    // empty field that debounce has not flushed yet.
    await expect(this.nameInput).toHaveValue(name);
  }

  async fillDescription(description) {
    testLogger.info('Filling team description', { description });
    await this.descriptionInput.fill(description);
    await expect(this.descriptionInput).toHaveValue(description);
  }

  async submit() {
    testLogger.info('Submitting the team form');
    await this.saveButton.click();
  }
}
