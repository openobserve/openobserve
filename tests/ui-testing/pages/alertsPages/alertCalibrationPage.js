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
    this.digestPage = '[data-test="alert-calibration-digest-page"]';

    // Settings form — the enabled toggle. OFormSwitch forwards data-test to the
    // OSwitch button as `<data-test>-btn`; the button exposes role="switch".
    this.enabledSwitchBtn = '[data-test="alert-calibration-settings-enabled-btn"]';

    // Copy used to tell the two dashboard empty states apart. OEmptyState renders
    // a fixed data-test="o2-empty-state", so the state is identified by its title.
    this.notEnabledTitle = 'Alert calibration is not running for this organization';
    this.dashboardEmptyTitle = 'No runs in the last';

    // Dismiss and reopen (P5a)
    this.dismiss = {
      ruleGroupTrigger: '[data-test="alert-calibration-dashboard-rule-no_destination"] button',
      rowDismiss: (alertId) =>
        `[data-test="alert-calibration-dashboard-alert-${alertId}"] [data-test="alert-calibration-dashboard-dismiss"]`,
      row: (alertId) => `[data-test="alert-calibration-dashboard-alert-${alertId}"]`,
      dialog: '[data-test="alert-calibration-dismiss-dialog"]',
      reason: (reason) => `[data-test="alert-calibration-dismiss-reason-${reason}"]`,
      note: '[data-test="alert-calibration-dismiss-note-field"]',
      duration: (value) =>
        `[data-test="alert-calibration-dismiss-duration-option"][data-test-value="${value}"]`,
      submit: '[data-test="alert-calibration-dismiss-submit"]',
      notice: '[data-test="alert-calibration-dismiss-notice"]',
      filterOpen: '[data-test="alert-calibration-filter-open"]',
      filterDismissed: '[data-test="alert-calibration-filter-dismissed"]',
      dismissedTable: '[data-test="alert-calibration-dismissed-table"]',
      reopen: '[data-test="alert-calibration-dismissed-reopen"]',
      dismissedEmpty: '[data-test="alert-calibration-dismissed-empty"]',
      toast: (variant) => `[data-test-variant="${variant}"] [data-test="o-toast-message"]`,
      card: '[data-test="alert-calibration-finding-no_destination"]',
      cardDismiss: '[data-test="alert-calibration-finding-dismiss"]',
      cardBadge: '[data-test="alert-calibration-finding-dismissed"]',
      cardFold: '[data-test="alert-calibration-finding-fold"]',
      cardReopen: '[data-test="alert-calibration-finding-reopen"]',
    };
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

  // ── Dismiss and reopen ──────────────────────────────────────────────────

  /** Answers only the two digest reads with one v2 no-destination finding; every other call reaches the server. */
  async routeDigestFixture(org, finding) {
    const now = Date.now() * 1000;
    const day = 86_400_000_000;
    const coverage = {
      coverage_gap: false,
      coverage_unreadable_definitions: 0,
      coverage_facts_without_definition: 0,
      coverage_definitions_without_facts: 0,
      coverage_transitions_truncated: false,
      coverage_counters_truncated: false,
      coverage_error_clusters_truncated: false,
      coverage_error_clusters_unattributed: 0,
      coverage_stream_substrate_empty: false,
    };
    const run = {
      window_start: now - 31 * day,
      window_end: now - day,
      emitted_at: now - 60_000_000,
      finding_count: 1,
      skip_count: 0,
      alerts_in_scope: 1,
      ...coverage,
    };
    const record = {
      ...run,
      _timestamp: run.emitted_at,
      org,
      config_id: 'e2e',
      schema_version: 2,
      kind: 'finding',
      rule_id: 'no_destination',
      severity: 'Medium',
      confidence: 'High',
      title: `${finding.alertName} fired with no destination`,
      alert_id: finding.alertId,
      alert_name: finding.alertName,
      finding_id: finding.findingId,
      scope_kind: 'alert',
      scope_key: finding.alertId,
    };
    delete record.emitted_at;
    await this.page.route(/\/alert_calibration\/digests\/records(\?|$)/, (route) =>
      route.fulfill({ json: [record] }),
    );
    await this.page.route(/\/alert_calibration\/digests(\?|$)/, (route) =>
      route.fulfill({ json: [run] }),
    );
    return run;
  }

  async navigateToDigest(run) {
    const url = `${process.env["ZO_BASE_URL"]}/web/alert-calibration/digests/${run.window_start}/${run.window_end}?org_identifier=${process.env["ORGNAME"]}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(this.page.locator(this.dismiss.card)).toBeVisible({ timeout: 20000 });
  }

  async openNoDestinationGroup() {
    await expect(this.page.locator(this.dashboardRuns)).toBeVisible({ timeout: 20000 });
    await this.page.locator(this.dismiss.ruleGroupTrigger).first().click();
  }

  async openDismissDialog(alertId) {
    await this.page.locator(this.dismiss.rowDismiss(alertId)).click();
    await expect(this.page.locator(this.dismiss.dialog)).toBeVisible({ timeout: 10000 });
  }

  async fillDismissForm({ reason, note, duration }) {
    if (reason) await this.page.locator(this.dismiss.reason(reason)).click();
    if (note !== undefined) await this.page.locator(this.dismiss.note).fill(note);
    if (duration) await this.page.locator(this.dismiss.duration(duration)).click();
  }

  async submitDismiss() {
    await this.page.locator(this.dismiss.submit).click();
  }

  async expectDialogClosed() {
    await expect(this.page.locator(this.dismiss.dialog)).toBeHidden({ timeout: 15000 });
  }

  async expectNotice(severity, text) {
    const notice = this.page.locator(this.dismiss.notice);
    await expect(notice).toHaveAttribute('data-severity', severity, { timeout: 15000 });
    await expect(notice).toContainText(text);
  }

  async expectRowGone(alertId) {
    await expect(this.page.locator(this.dismiss.row(alertId))).toHaveCount(0, { timeout: 15000 });
  }

  async expectDismissedCount(count) {
    await expect(this.page.locator(this.dismiss.filterDismissed)).toContainText(
      `Dismissed (${count})`,
      { timeout: 15000 },
    );
  }

  async showDismissed() {
    await this.page.locator(this.dismiss.filterDismissed).click();
    await expect(this.page).toHaveURL(/findings=dismissed/);
  }

  async reopenFirst() {
    await this.page.locator(this.dismiss.reopen).first().click();
  }

  async expectToast(variant, text) {
    await expect(this.page.locator(this.dismiss.toast(variant)).filter({ hasText: text })).toBeVisible({
      timeout: 15000,
    });
  }
}

