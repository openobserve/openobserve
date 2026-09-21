// connectDataSourcePopupPage.js - Page Object for the Cloud-only onboarding popups
// Covers ConnectDataSourcePopup (web/src/components/ConnectDataSourcePopup.vue) and
// CommunitySlackInvite (web/src/components/CommunitySlackInvite.vue), both mounted once in
// MainLayout.vue:213-214 and gated on the build-time flag config.isCloud === "true".
// On the OSS build that flag is the literal string "false", so both components bail out in
// onMounted (ConnectDataSourcePopup.vue:186-190, CommunitySlackInvite.vue:72) and never
// render any DOM. The E2E assertion is therefore negative: both dialog panels have count 0.
import { expect } from '@playwright/test';

export class ConnectDataSourcePopupPage {
  constructor(page) {
    this.page = page;

    // ODialog forwards data-test onto the lazily mounted reka-ui DialogContent, so a
    // closed dialog has NO DOM node — these locators resolve to 0 elements on OSS.
    this.connectPopup = page.locator('[data-test="connect-data-source-popup-dialog"]');
    this.slackPopup = page.locator('[data-test="community-slack-invite-dialog"]');
  }

  /** Navigate to the Logs sub-route so absence can be re-verified after an SPA route change. */
  async navigateToLogs(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    await this.page.goto(`/web/logs?org_identifier=${orgId}`, { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Asserts both onboarding dialogs are structurally absent (count 0, not merely hidden). */
  async expectBothDialogsAbsent() {
    await expect(this.connectPopup).toHaveCount(0);
    await expect(this.slackPopup).toHaveCount(0);
  }
}
