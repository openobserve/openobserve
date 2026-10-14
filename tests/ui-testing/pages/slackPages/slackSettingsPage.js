// Settings › Slack (web/src/components/settings/Slack.vue and SlackConnectEmpty.vue).
const { expect } = require('@playwright/test');
const { BASE } = require('./slackApi.js');

class SlackSettingsPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('[data-test="slack-settings"]');
    this.disabled = page.locator('[data-test="slack-disabled"]');
    this.disabledStep0 = page.locator('[data-test="slack-disabled-step0"]');
    this.noAccess = page.locator('[data-test="slack-no-access"]');
    this.loadError = page.locator('[data-test="slack-load-error"]');
    this.otherRegion = page.locator('[data-test="slack-other-region"]');
    this.connectEmpty = page.locator('[data-test="slack-connect-empty"]');
    this.setupApp = page.locator('[data-test="slack-setup-app"]');
    this.consent = page.locator('[data-test="slack-connect-consent"]');
    this.available = page.locator('[data-test="slack-available"]');
    this.wizard = page.locator('[data-test="slack-wizard"]');
    this.workspace = page.locator('[data-test="slack-workspace"]');
  }

  async goto(org) {
    await this.page.goto(`${BASE()}/web/settings/slack?org_identifier=${encodeURIComponent(org)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(this.root).toBeVisible({ timeout: 30000 });
  }

  availableInstallation(installationId) {
    return this.page.locator(`[data-test="slack-available-${installationId}"]`);
  }
}

module.exports = { SlackSettingsPage };
