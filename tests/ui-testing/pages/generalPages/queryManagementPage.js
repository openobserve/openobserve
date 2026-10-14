// Copyright 2026 OpenObserve Inc.
//
// Page Object Model for the Settings Query Management navigation/gating feature.
// Query Management ("Running Queries") is an enterprise-only, meta-org-only
// settings section. On an OSS build the sidebar tab is hidden and a direct URL
// redirects to the enterprise-locked page.

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
    this.enterpriseLockedPage = page.locator('[data-test="enterprise-feature-locked"]');
    this.queryTypeTabs = page.locator('[data-test="running-queries-query-type-tabs"]');
    this.summaryList = page.locator('[data-test="running-queries-summary-list"]');
    this.allQueriesList = page.locator('[data-test="running-queries-all-queries-list"]');
    this.searchTypeFilter = this.allQueriesList.locator('[data-otoggle-value="dashboards"]');
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

  async expectEnterpriseLockedPage() {
    await expect(this.enterpriseLockedPage).toBeVisible({ timeout: 15000 });
    await expect(this.page).toHaveURL(/enterprise-locked\?feature=queryManagement/);
  }

  async stubRunningQueries(org, queries) {
    await this.page.route(`**/api/${org}/query_manager/status`, (route) =>
      route.fulfill({ json: { status: queries } })
    );
  }

  async navigateToRunningQueries(org) {
    await this.navigateToQueryManagement(org);
    await expect(this.queryTypeTabs).toBeVisible({ timeout: 15000 });
  }

  queryTypeTab(value) {
    return this.queryTypeTabs.locator(`[data-otoggle-value="${value}"]`);
  }

  async selectQueryTypeTab(value) {
    await this.queryTypeTab(value).click();
  }

  async drillIntoUser(email) {
    await this.summaryList.getByText(email, { exact: true }).first().click();
  }

  async expectAllQueriesViewFor(email) {
    await expect(this.queryTypeTab('all')).toHaveAttribute('data-state', 'on');
    await expect(this.allQueriesList).toBeVisible();
    await expect(this.summaryList).toBeHidden();
    await expect(this.searchTypeFilter).toBeVisible();
    await expect(this.allQueriesList.getByText(email).first()).toBeVisible();
  }
}
