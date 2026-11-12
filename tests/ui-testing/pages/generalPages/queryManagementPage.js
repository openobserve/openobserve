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
    // Query Management rail tab — filtered out on OSS (SectionRail drops `visible !== false` items), so count 0 rather than merely hidden.
    this.queryManagementTab = page.locator('[data-test="query-management-tab"]');
    this.enterpriseLockedPage = page.locator('[data-test="enterprise-feature-locked"]');
    this.queryListButton = page.locator('[data-test="queryList-btn"]');
    this.queryDetailsTable = page.locator('[data-test="queryList-table"]');
    this.tooltipBubble = page.locator('[data-test="o-tooltip-content"]');
    this.queryTypeTabs = page.locator('[data-test="running-queries-query-type-tabs"]');
    this.summaryList = page.locator('[data-test="running-queries-summary-list"]');
    this.allQueriesList = page.locator('[data-test="running-queries-all-queries-list"]');
    this.searchTypeFilter = this.allQueriesList.locator('[data-otoggle-value="dashboards"]');
    // Cancel-flow controls: the confirm dialog and its primary/secondary actions.
    this.confirmDialog = page.locator('[data-test="confirm-dialog"]');
    this.confirmDialogPrimary = page.locator(
      '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
    );
    this.confirmDialogSecondary = page.locator(
      '[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]',
    );
  }

  // The All Queries tab is v-show-toggled, so wait for visibility, not just attachment.
  async openFirstQueryDetails() {
    const button = this.queryListButton.first();
    await expect(button).toBeVisible({ timeout: 15000 });
    await button.click();
    await expect(this.queryDetailsTable).toBeVisible({ timeout: 15000 });
  }

  sqlValueCell(sqlPrefix) {
    return this.queryDetailsTable.getByText(sqlPrefix).first();
  }

  async hoverUntilTooltipShown(cell) {
    await cell.hover();
    await expect(this.tooltipBubble).toBeVisible({ timeout: 5000 });
  }

  // Records the bubble's bounding box on every frame, from now until stopSampling().
  async startSamplingBubbleRects() {
    await this.page.evaluate(() => {
      window.__bubbleRects = [];
      let on = true;
      window.__stopBubbleSampling = () => (on = false);
      const tick = () => {
        document.querySelectorAll('[data-test="o-tooltip-content"]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0) window.__bubbleRects.push({ left: r.left, top: r.top });
        });
        if (on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async stopSamplingBubbleRects() {
    return this.page.evaluate(() => {
      window.__stopBubbleSampling();
      return window.__bubbleRects;
    });
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

  // Rows use search_type 'dashboards' (the All Queries default) so they stay visible.
  runningQuery(traceId, orgId, userId) {
    const now = Date.now() * 1000;
    return {
      trace_id: traceId,
      user_id: userId,
      org_id: orgId,
      search_type: 'dashboards',
      created_at: now - 5000000,
      started_at: now - 5000000,
      status: 'running',
      work_group: 'default',
      stream_type: 'logs',
      query: { start_time: now - 60000000, end_time: now, sql: 'SELECT 1' },
      scan_stats: { files: 1, records: 1, original_size: 1, compressed_size: 1 },
      search_event_context: { folder_name: 'f', dashboard_name: 'd' },
    };
  }

  async navigateToRunningQueries(org) {
    await this.navigateToQueryManagement(org);
    await expect(this.queryTypeTabs).toBeVisible({ timeout: 15000 });
  }

  queryTypeTab(value) {
    return this.queryTypeTabs.locator(`[data-otoggle-value="${value}"]`);
  }

  async selectQueryTypeTab(value) {
    const tab = this.queryTypeTab(value);
    await tab.click();
    // Guard the toggle: confirm the tab actually became active before downstream actions.
    await expect(tab).toHaveAttribute('data-state', 'on', { timeout: 10000 });
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

  // Stubs the cancel route so a cancel resolves without hitting a live server.
  async stubCancel(org) {
    await this.page.route(`**/api/${org}/query_manager/cancel`, (route) =>
      route.fulfill({ json: [{ trace_id: '', org_id: '', is_success: true }] }),
    );
  }

  // Call before the cancel action; await the returned promise after confirming.
  captureCancelRequest(org) {
    return this.page
      .waitForRequest(
        (req) => req.method() === 'PUT' && req.url().includes(`/api/${org}/query_manager/cancel`),
        { timeout: 15000 },
      )
      .then((req) => req.postDataJSON());
  }

  async confirmCancel() {
    await expect(this.confirmDialog).toBeVisible({ timeout: 10000 });
    await this.confirmDialogPrimary.click();
  }

  async dismissCancelDialog() {
    await expect(this.confirmDialog).toBeVisible({ timeout: 10000 });
    await this.confirmDialogSecondary.click();
  }

  async expectConfirmDialogHidden() {
    await expect(this.confirmDialog).toBeHidden({ timeout: 10000 });
  }

  // All Queries tab: cancel the row whose org_id cell matches `orgId`.
  async cancelAllQueriesRow(orgId) {
    const row = this.allQueriesList.locator('tr', { hasText: orgId }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('[data-test="cancelQuery-btn"]').first().click();
  }

  // Summary tab: cancel the summary row whose user_id cell matches `email`.
  async cancelSummaryRow(email) {
    const row = this.summaryList.locator('tr', { hasText: email }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('[data-test="cancelQuery-btn"]').first().click();
  }

  // Selects the All Queries row whose org_id cell matches `orgId` via its checkbox.
  async selectAllQueriesRow(orgId) {
    const row = this.allQueriesList.locator('tr', { hasText: orgId }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('label[data-test^="o2-table-select-"]').click();
  }

  // Clicks the bulk-cancel button surfaced by the All Queries selection bar.
  async clickAllQueriesMultiCancel() {
    const btn = this.allQueriesList.locator('[data-test="qm-multiple-cancel-query-btn"]');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();
  }

  // stop() resolves true if a cancel PUT fires, false if none does within the settle window (dismiss issues no request).
  startCancelWatcher(org) {
    const requestSeen = this.page.waitForRequest(
      (req) => req.method() === 'PUT' && req.url().includes(`/api/${org}/query_manager/cancel`),
      { timeout: 3000 },
    );
    return {
      async stop() {
        try {
          await requestSeen;
          return true;
        } catch (error) {
          // Timeout (no request fired) is the expected outcome for a dismiss.
          return false;
        }
      },
    };
  }
}
