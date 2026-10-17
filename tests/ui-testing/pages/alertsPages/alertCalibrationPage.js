import { expect } from '@playwright/test';

export class AlertCalibrationPage {
  constructor(page) {
    this.page = page;

    // URLs (the app SPA lives under /web/)
    this.dashboardUrl = `${process.env["ZO_BASE_URL"]}/web/alert-calibration?org_identifier=${process.env["ORGNAME"]}`;
    this.settingsUrl = `${process.env["ZO_BASE_URL"]}/web/alert-calibration/settings?org_identifier=${process.env["ORGNAME"]}`;

    // Page containers (OPageLayout forwards data-test to its root)
    this.dashboardPage = '[data-test="alert-calibration-dashboard-page"]';
    this.settingsPage = '[data-test="alert-calibration-settings"]';

    // Settings form — the enabled toggle. OFormSwitch forwards data-test to the
    // OSwitch button as `<data-test>-btn`; the button exposes role="switch".
    this.enabledSwitchBtn = '[data-test="alert-calibration-settings-enabled-btn"]';

    // Copy used to tell the two dashboard empty states apart. OEmptyState renders
    // a fixed data-test="o2-empty-state", so the state is identified by its title.
    this.notEnabledTitle = 'Alert calibration is not running for this organization';
    this.dashboardEmptyTitle = 'No runs in the last';
  }

  async navigateToDashboard() {
    await this.page.goto(this.dashboardUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(this.page.locator(this.dashboardPage)).toBeVisible({ timeout: 15000 });
  }

  async navigateToSettings() {
    await this.page.goto(this.settingsUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(this.page.locator(this.settingsPage)).toBeVisible({ timeout: 15000 });
  }

  async expectEnabledSwitchOn() {
    const switchBtn = this.page.locator(this.enabledSwitchBtn);
    await expect(switchBtn).toBeVisible({ timeout: 20000 });
    await expect(switchBtn).toHaveAttribute('aria-checked', 'true');
  }

  async expectEmptyRunsStateInsteadOfEnablePrompt() {
    // The empty "no runs yet" state proves the org's config resolved to enabled
    // (a disabled org would render the enable prompt), and that no digest exists yet.
    await expect(
      this.page.getByText(this.dashboardEmptyTitle, { exact: false }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      this.page.getByText(this.notEnabledTitle, { exact: true }),
    ).toBeHidden();
  }
}
