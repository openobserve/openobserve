// A3 workspace card and its dialogs (SlackWorkspaceCard.vue, SlackCredentialsDialog.vue, SlackUninstallDialog.vue).
const { expect } = require('@playwright/test');

class SlackWorkspaceCardPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('[data-test="slack-workspace"]');
    this.name = page.locator('[data-test="slack-workspace-name"]');
    this.meta = page.locator('[data-test="slack-workspace-meta"]');
    this.status = page.locator('[data-test="slack-workspace-status"]');
    this.sockets = page.locator('[data-test="slack-workspace-sockets"]');
    this.refreshToken = page.locator('[data-test="slack-refresh-token"]');
    this.test = page.locator('[data-test="slack-test-connection"]');
    this.testResults = page.locator('[data-test="slack-test-results"]');
    this.reinstall = page.locator('[data-test="slack-reinstall"]');
    this.updateCredentials = page.locator('[data-test="slack-update-credentials"]');
    this.connectedOrgs = page.locator('[data-test="slack-connected-orgs"]');
    this.disconnect = page.locator('[data-test="slack-disconnect-org"]');
    this.uninstall = page.locator('[data-test="slack-uninstall"]');
    this.helpContact = page.locator('[data-test="slack-help-contact-field"]');
    this.helpContactForm = page.locator('[data-test="slack-help-contact-form"]');
    this.channelDefaults = page.locator('[data-test="slack-channel-defaults"]');
    this.linking = page.locator('[data-test="slack-linking"]');
  }

  testCheck(id) {
    return this.testResults.locator(`[data-test="slack-check-${id}"]`);
  }

  async waitLoaded() {
    await expect(this.name).toBeVisible({ timeout: 30000 });
  }
}

class SlackCredentialsDialogPage {
  constructor(page) {
    this.page = page;
    this.panel = page.locator('[data-test="o-dialog-panel"]').filter({
      has: page.locator('[data-test^="slack-credentials-"]'),
    });
    this.save = this.panel.locator('[data-test="o-dialog-primary-btn"]');
    this.cancel = this.panel.locator('[data-test="o-dialog-secondary-btn"]');
  }

  field(name) {
    return this.panel.locator(`[data-test="slack-credentials-${name}-field"]`);
  }
}

class SlackOrgDialogPage {
  constructor(page) {
    this.page = page;
    this.confirmBody = page.locator('[data-test="slack-dialog-confirm"]');
    this.resultBody = page.locator('[data-test="slack-dialog-result"]');
    this.panel = page.locator('[data-test="o-dialog-panel"]').filter({
      has: page.locator('[data-test="slack-dialog-confirm"], [data-test="slack-dialog-result"]'),
    });
    this.primary = this.panel.locator('[data-test="o-dialog-primary-btn"]');
    this.cancel = this.panel.locator('[data-test="o-dialog-secondary-btn"]');
    this.removeDestinations = page.locator('[data-test="slack-remove-destinations"]');
    this.deleteApp = page.locator('[data-test="slack-delete-app"]');
  }

  /** Data rows of the affected-destinations table, skeleton rows excluded. */
  affectedRows() {
    return this.resultBody.locator('tbody:not([data-test="o2-table-skeleton-body"]) tr');
  }

  affectedRow(name) {
    return this.affectedRows().filter({ hasText: name });
  }
}

module.exports = { SlackWorkspaceCardPage, SlackCredentialsDialogPage, SlackOrgDialogPage };
