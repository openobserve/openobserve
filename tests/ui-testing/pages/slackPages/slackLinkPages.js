// N7 link pages and the connect callback (SlackLink.vue, SlackLinkCallback.vue, SlackConnectCallback.vue).
const { expect } = require('@playwright/test');
const { BASE } = require('./slackApi.js');

class SlackLinkPages {
  constructor(page) {
    this.page = page;
    this.linkPage = page.locator('[data-test="slack-link-page"]');
    this.callbackPage = page.locator('[data-test="slack-link-callback-page"]');
    this.connectCallbackPage = page.locator('[data-test="slack-connect-callback-page"]');
    this.working = page.locator('[data-test="slack-link-card-working"]');
    this.resend = page.locator('[data-test="slack-link-resend"]');
    this.retry = page.locator('[data-test="slack-link-retry"]');
    this.helpContact = page.locator('[data-test="slack-link-help-contact"]');
    this.resent = page.locator('[data-test="slack-link-resent"]');
    this.cancelled = page.locator('[data-test="slack-link-cancelled"]');
    this.linked = page.locator('[data-test="slack-link-linked"]');
    this.backToSlack = page.locator('[data-test="slack-link-back-to-slack"]');
  }

  /** kind: expired | unknown | noAccess | wrongAccount | rateLimited | failed */
  state(kind) {
    return this.page.locator(`[data-test="slack-link-state-${kind}"]`);
  }

  connectState(kind) {
    return this.page.locator(`[data-test="slack-connect-callback-${kind}"]`);
  }

  linkUrl(r, org) {
    const query = new URLSearchParams({ r });
    if (org) query.set('org_identifier', org);
    return `${BASE()}/web/slack/link?${query}`;
  }

  async openLink(r, org) {
    await this.page.goto(this.linkUrl(r, org), { waitUntil: 'domcontentloaded' });
    await expect(this.linkPage).toBeVisible({ timeout: 30000 });
  }
}

class LinkedAccountsDialogPage {
  constructor(page) {
    this.page = page;
    this.profileMenu = page.locator('[data-test="header-my-account-profile-icon"]');
    this.menuItem = page.locator('[data-test="menu-link-linked-accounts-item"]');
    this.dialog = page.locator('[data-test="linked-accounts-dialog"]');
    this.empty = page.locator('[data-test="linked-accounts-empty"]');
    this.error = page.locator('[data-test="linked-accounts-error"]');
    this.note = page.locator('[data-test="linked-accounts-note"]');
    this.items = page.locator('[data-test^="linked-accounts-item-"]');
  }

  item(linkId) {
    return this.page.locator(`[data-test="linked-accounts-item-${linkId}"]`);
  }

  unlink(linkId) {
    return this.page.locator(`[data-test="linked-accounts-unlink-${linkId}"]`);
  }

  async open() {
    await this.profileMenu.click();
    await this.menuItem.click();
    await expect(this.dialog).toBeVisible({ timeout: 15000 });
  }
}

module.exports = { SlackLinkPages, LinkedAccountsDialogPage };
