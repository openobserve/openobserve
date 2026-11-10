// The AutoObserve section of Settings › Slack (web/src/components/settings/SlackInsightsSection.vue).
const { expect } = require('@playwright/test');

class SlackInsightsPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('[data-test="slack-insights"]');
    this.lock = page.locator('[data-test="slack-insights-lock"]');
    this.channelLine = page.locator('[data-test="slack-insights-channel-line"]');
    this.channelTrigger = page.locator('[data-test="slack-insights-channel-select-trigger"]');
    this.channelOptions = page.locator('[data-test="slack-insights-channel-select-option"]');
    this.time = page.locator('[data-test="slack-insights-time"] input');
    this.trial = page.locator('[data-test="slack-insights-trial"] [role="switch"]');
    this.allow = page.locator('[data-test="slack-insights-allow"] [role="switch"]');
    this.status = page.locator('[data-test="slack-insights-status"]');
    this.saveError = page.locator('[data-test="slack-insights-save-error"]');
    this.save = page.locator('[data-test="slack-insights-save"]');
  }

  async waitLoaded() {
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.time).toBeVisible({ timeout: 30000 });
  }

  async pickChannel(name) {
    await this.channelTrigger.click();
    const option = this.channelOptions.filter({ hasText: `#${name}` }).first();
    await expect(option).toBeVisible({ timeout: 20000 });
    await option.click();
    await expect(this.channelTrigger).toContainText(`#${name}`);
  }

  async setTime(hhmm) {
    await this.time.fill(hhmm);
    await this.time.press('Tab');
    await expect(this.time).toHaveValue(hhmm);
  }

  async saveAndWait() {
    const put = this.page.waitForResponse(
      (r) => r.url().includes('/slack/insights-settings') && r.request().method() === 'PUT',
      { timeout: 30000 },
    );
    await this.save.click();
    return put;
  }
}

module.exports = { SlackInsightsPage };
