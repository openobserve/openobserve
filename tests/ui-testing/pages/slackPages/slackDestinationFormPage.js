// The Slack section of the alert destination form (web/src/components/alerts/SlackDestinationSetup.vue).
const { expect } = require('@playwright/test');
const { BASE } = require('./slackApi.js');

class SlackDestinationFormPage {
  constructor(page) {
    this.page = page;
    this.typeCard = page.locator('[data-test="destination-type-card"][data-type="slack"]');
    this.section = page.locator('[data-test="slack-destination-setup"]');
    this.appBanner = page.locator('[data-test="slack-form-app-banner"]');
    this.upgradeBanner = page.locator('[data-test="slack-form-upgrade-banner"]');
    this.upgradeButton = page.locator('[data-test="slack-form-upgrade-button"]');
    this.linkPeople = page.locator('[data-test="slack-form-link-people"]');
    this.methodOAuth = page.locator('[data-test="slack-setup-method-oauth"]');
    this.methodManifest = page.locator('[data-test="slack-setup-method-manifest"]');
    this.methodWebhook = page.locator('[data-test="slack-setup-method-webhook"]');
    this.connect = page.locator('[data-test="slack-oauth-connect-button"]');
    this.connected = page.locator('[data-test="slack-oauth-connected"]');
    this.permissionNote = page.locator('[data-test="slack-oauth-permission-note"]');
    this.name = page.locator('[data-test="add-destination-name-input-field"]');
  }

  async openNew(org) {
    await this.page.goto(`${BASE()}/web/alert-destinations?org_identifier=${encodeURIComponent(org)}`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
    await expect(this.typeCard).toBeVisible({ timeout: 30000 });
    await this.typeCard.click();
    await expect(this.section).toBeVisible({ timeout: 15000 });
  }
}

module.exports = { SlackDestinationFormPage };
