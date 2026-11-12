import { expect } from '@playwright/test';

export class AlertCalibrationPage {
  constructor(page) {
    this.page = page;

    // URLs (the app SPA lives under /web/)
    this.dashboardUrl = `${process.env["ZO_BASE_URL"]}/web/alert-calibration?org_identifier=${process.env["ORGNAME"]}`;
    this.settingsUrl = `${process.env["ZO_BASE_URL"]}/web/alert-calibration/settings?org_identifier=${process.env["ORGNAME"]}`;
    this.runsUrl = `${process.env["ZO_BASE_URL"]}/web/alert-calibration/runs?org_identifier=${process.env["ORGNAME"]}`;

    // Page containers (OPageLayout forwards data-test to its root)
    this.dashboardPage = '[data-test="alert-calibration-dashboard-page"]';
    this.settingsPage = '[data-test="alert-calibration-settings"]';
    this.dashboardRuns = '[data-test="alert-calibration-dashboard"]';
    this.runsPage = '[data-test="alert-calibration-digests-page"]';
    this.runsStats = '[data-test="alert-calibration-digests-stats"]';
    this.runsTable = '[data-test="alert-calibration-digests-table"]';
    this.tabDashboard = '[data-test="alert-calibration-tab-alertCalibration"]';
    this.tabRuns = '[data-test="alert-calibration-tab-alertCalibrationRuns"]';
    this.alertListPage = '[data-test="alert-list-page"]';

    // Settings form — the enabled toggle. OFormSwitch forwards data-test to the
    // OSwitch button as `<data-test>-btn`; the button exposes role="switch".
    this.enabledSwitchBtn = '[data-test="alert-calibration-settings-enabled-btn"]';

    // Copy used to tell the two dashboard empty states apart. OEmptyState renders
    // a fixed data-test="o2-empty-state", so the state is identified by its title.
    this.notEnabledTitle = 'Alert calibration is not running for this organization';
    this.dashboardEmptyTitle = 'No runs in the last';
  }

  // build_type from the authenticated full config — the exact value the route
  // guard reads, so the spec skips instead of timing out on the alertList bounce.
  async detectBuildType(org) {
    const orgId = org || process.env["ORGNAME"] || "default";
    const baseUrl = (process.env["INGESTION_URL"] || process.env["ZO_BASE_URL"]).replace(/\/+$/, "");
    const response = await this.page.request.get(`${baseUrl}/api/${orgId}/config`);
    return (await response.json()).build_type;
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

  // Returns false when the route guard bounced to the alert list, which also catches an OSS web bundle on an enterprise backend.
  async openRunsIfReachable() {
    await this.page.goto(this.runsUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const runs = this.page.locator(this.runsPage);
    await expect(runs.or(this.page.locator(this.alertListPage)).first()).toBeVisible({ timeout: 15000 });
    return runs.isVisible();
  }

  async openRunsExpectingRedirect() {
    await this.page.goto(this.runsUrl, { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator(this.alertListPage)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.runsPage)).toHaveCount(0);
  }

  async expectRunsPageShell() {
    await expect(this.page.locator(this.runsPage)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.runsStats)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.runsTable)).toBeVisible({ timeout: 15000 });
  }

  async switchToDashboardTab() {
    await this.page.locator(this.tabDashboard).click();
    await expect(this.page).toHaveURL(/\/alert-calibration\?/);
    await expect(this.page.locator(this.dashboardPage)).toBeVisible({ timeout: 15000 });
  }

  async switchToRunsTab() {
    await this.page.locator(this.tabRuns).click();
    await expect(this.page).toHaveURL(/\/alert-calibration\/runs/);
    await expect(this.page.locator(this.runsPage)).toBeVisible({ timeout: 15000 });
  }

  async expectEnabledSwitchOn() {
    const switchBtn = this.page.locator(this.enabledSwitchBtn);
    await expect(switchBtn).toBeVisible({ timeout: 20000 });
    await expect(switchBtn).toHaveAttribute('aria-checked', 'true');
  }

  async expectRunsViewInsteadOfEnablePrompt() {
    // An enabled org shows the empty state or, once the scheduler has run, the latest digest.
    await expect(
      this.page
        .getByText(this.dashboardEmptyTitle, { exact: false })
        .or(this.page.locator(this.dashboardRuns))
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      this.page.getByText(this.notEnabledTitle, { exact: true }),
    ).toBeHidden();
  }
}
