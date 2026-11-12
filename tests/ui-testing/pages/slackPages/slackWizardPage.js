// A2 wizard (SlackSelfHostedWizard.vue); OFormInput's fillable element is `<data-test>-field`, not the wrapper.
const { expect } = require('@playwright/test');

class SlackWizardPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('[data-test="slack-wizard"]');
    this.next = page.locator('[data-test="slack-wizard-next"]');
    this.cancel = page.locator('[data-test="slack-wizard-cancel"]');
    this.prereqSummary = this.root.locator('[data-test="slack-prereq-summary"]');
    this.prereqResults = this.root.locator('[data-test="slack-prereq-result"]');
    this.connectivity = page.locator('[data-test="slack-wizard-connectivity"]');
    this.createForm = page.locator('[data-test="slack-wizard-create-form"]');
    this.modeSocket = page.locator('[data-test="slack-wizard-mode-socket"]');
    this.modeHttp = page.locator('[data-test="slack-wizard-mode-http"]');
    this.consent = page.locator('[data-test="slack-wizard-consent"]');
    this.configToken = page.locator('[data-test="slack-wizard-config-token-field"]');
    this.manualToggle = page.locator('[data-test="slack-wizard-manual"]');
    this.openManifest = page.locator('[data-test="slack-wizard-open-manifest"]');
    this.clientId = page.locator('[data-test="slack-wizard-client-id-field"]');
    this.clientSecret = page.locator('[data-test="slack-wizard-client-secret-field"]');
    this.signingSecret = page.locator('[data-test="slack-wizard-signing-secret-field"]');
    this.manualAppToken = page.locator('[data-test="slack-wizard-app-token-field"]');
    this.create = page.locator('[data-test="slack-wizard-create"]');
    this.pending = page.locator('[data-test="slack-wizard-pending"]');
    this.allow = page.locator('[data-test="slack-wizard-allow"]');
    this.startOver = page.locator('[data-test="slack-wizard-start-over"]');
    this.installed = page.locator('[data-test="slack-wizard-installed"]');
    this.appTokenForm = page.locator('[data-test="slack-wizard-app-token-form"]');
    this.appTokenInput = page.locator('[data-test="slack-wizard-app-token-field-field"]');
    this.runChecks = page.locator('[data-test="slack-wizard-run-checks"]');
    this.signInTest = page.locator('[data-test="slack-wizard-signin-test"]');
    this.linkingForm = page.locator('[data-test="slack-wizard-linking-form"]');
    this.finish = page.locator('[data-test="slack-wizard-finish"]');
    this.confirmDialog = page.locator('[data-test="confirm-dialog"]');
  }

  async expectStep(step) {
    await expect(this.root).toHaveAttribute('data-step', String(step), { timeout: 20000 });
  }

  /** The Step 0 result cell of the check whose variable or name contains `label`. */
  prereqResult(label) {
    return this.root.locator('tr', { hasText: label }).locator('[data-test="slack-prereq-result"]');
  }

  async waitForPrerequisites() {
    await expect(this.prereqSummary).toBeVisible({ timeout: 30000 });
  }

  /** Statuses of the Step 0 checks, in table order. */
  async prereqStatuses() {
    return this.prereqResults.evaluateAll((cells) => cells.map((c) => c.getAttribute('data-status')));
  }

  connectivityCheck(host) {
    return this.page.locator(`[data-test="slack-check-${host}"]`);
  }

  async waitForConnectivity() {
    await expect(this.connectivity.locator('[data-test^="slack-check-"]').first()).toBeVisible({ timeout: 30000 });
  }

  async createWithConfigToken(token) {
    await this.configToken.fill(token);
    await this.create.click();
  }

  async confirmStartOver() {
    await this.startOver.click();
    await expect(this.confirmDialog).toBeVisible();
    await this.confirmDialog.locator('[data-test="o-dialog-primary-btn"]').click();
  }

  async saveAppToken(token) {
    await this.appTokenInput.fill(token);
    await this.appTokenForm.locator('button[type="submit"]').click();
  }
}

module.exports = { SlackWizardPage };
