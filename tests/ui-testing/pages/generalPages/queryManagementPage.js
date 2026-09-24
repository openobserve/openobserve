// Copyright 2026 OpenObserve Inc.
//
// Page Object Model for the Settings Query Management navigation/gating feature.
// Query Management ("Running Queries") is an enterprise-only, meta-org-only
// settings section. On an OSS build the route is never registered and the
// sidebar tab is hidden, so the observable behavior is: the tab is absent from
// the Settings rail and a direct URL falls through to the 404 page.

import { expect } from '@playwright/test';

export class QueryManagementPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // Settings rail (SectionRail root — always present in the Settings shell).
    this.sectionRail = page.locator('[data-test="section-rail"]');
    // General Settings page title (OPageHeader title-data-test for key "general").
    this.generalPageTitle = page.locator('[data-test="settings-general-page-title"]');
    // Query Management rail tab — filtered out entirely on OSS (SectionRail drops
    // `visible !== false` items), so count 0 rather than merely hidden.
    this.queryManagementTab = page.locator('[data-test="query-management-tab"]');
    // 404 page "Go Home" button — primary proof the Error404 catch-all rendered.
    this.goHomeBtn = page.locator('[data-test="error-404-go-home-btn"]');
  }

  baseUrl() {
    return process.env['ZO_BASE_URL'] || 'http://localhost:5080';
  }

  async navigateToSettingsGeneral(org) {
    await this.page.goto(`${this.baseUrl()}/web/settings/general?org_identifier=${org}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async navigateToQueryManagement(org) {
    await this.page.goto(`${this.baseUrl()}/web/settings/query_management?org_identifier=${org}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async expectSettingsRailVisible() {
    await expect(this.sectionRail).toBeVisible({ timeout: 15000 });
  }

  async expectGeneralPageTitleVisible() {
    await expect(this.generalPageTitle).toBeVisible({ timeout: 15000 });
  }

  async expectQueryManagementTabAbsent() {
    await expect(this.queryManagementTab).toHaveCount(0);
  }

  async expect404Page() {
    // Assert promptly — Error404 auto-redirects home after a 10 s countdown.
    await expect(this.goHomeBtn).toBeVisible({ timeout: 15000 });
  }
}
