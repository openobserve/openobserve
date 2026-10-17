// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// alertCalibrationPage.js - Page Object for the Alert Calibration views
// (web/src/components/alert_calibration/*). The feature is gated behind an
// enterprise/cloud build plus `alert_calibration_enabled` from the live
// `/api/{org}/config` response; the OSS route guard bounces `/alert-calibration`
// to the alert list. Selectors are data-test only.
import { expect } from '@playwright/test';

export class AlertCalibrationPage {
  constructor(page) {
    this.page = page;

    // Digests list
    this.digestsPage = '[data-test="alert-calibration-digests-page"]';
    this.digestsTable = '[data-test="alert-calibration-digests-table"]';
    this.digestsStats = '[data-test="alert-calibration-digests-stats"]';

    // Dashboard
    this.dashboardPage = '[data-test="alert-calibration-dashboard-page"]';

    // Settings
    this.settingsPage = '[data-test="alert-calibration-settings"]';
    this.settingsForm = '[data-test="alert-calibration-settings-form"]';

    // Tabs and actions
    this.tabs = '[data-test="alert-calibration-tabs"]';
    this.tabDashboard = '[data-test="alert-calibration-tab-alertCalibrationDashboard"]';
    this.tabDigests = '[data-test="alert-calibration-tab-alertCalibration"]';

    // Redirect target for the OSS route guard
    this.alertListPage = '[data-test="alert-list-page"]';
  }

  /**
   * Reads the feature gate from the live `/api/{org}/config` response: the
   * `build_type` and `alert_calibration_enabled` fields are exactly what the
   * route guard and nav gate read off the Vuex store, which is hydrated from
   * this same endpoint. Reads the backend directly (no dev proxy for /api),
   * mirroring StatusPagesPage.detectBuildType.
   */
  async detectGate(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
    const response = await this.page.request.get(`${baseUrl}/api/${orgId}/config`);
    expect(response.ok(), 'reading /api/{org}/config should succeed').toBe(true);
    const body = await response.json();
    return {
      buildType: body.build_type,
      enabled: body.alert_calibration_enabled === true,
    };
  }

  async gotoDigests(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    await this.page.goto(
      `${process.env['ZO_BASE_URL']}/web/alert-calibration?org_identifier=${orgId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async gotoDashboard(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    await this.page.goto(
      `${process.env['ZO_BASE_URL']}/web/alert-calibration/dashboard?org_identifier=${orgId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async gotoSettings(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    await this.page.goto(
      `${process.env['ZO_BASE_URL']}/web/alert-calibration/settings?org_identifier=${orgId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  async expectDigestsPageVisible() {
    await expect(this.page.locator(this.digestsPage)).toBeVisible({ timeout: 15000 });
  }

  async expectDashboardPageVisible() {
    await expect(this.page.locator(this.dashboardPage)).toBeVisible({ timeout: 15000 });
  }

  async expectSettingsVisible() {
    await expect(this.page.locator(this.settingsPage)).toBeVisible({ timeout: 15000 });
  }

  async expectSettingsFormVisible() {
    await expect(this.page.locator(this.settingsForm)).toBeVisible({ timeout: 15000 });
  }

  /** The OSS guard replaces the route with alertList, so the alert list renders. */
  async expectRedirectedToAlertList() {
    await expect(this.page.locator(this.alertListPage)).toBeVisible({ timeout: 15000 });
  }

  async clickDashboardTab() {
    await this.page.locator(this.tabDashboard).click();
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }
}
