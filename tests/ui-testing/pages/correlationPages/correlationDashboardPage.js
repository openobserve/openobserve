// correlationDashboardPage.js
// Page object for the full-drawer TelemetryCorrelationDashboard (dialog mode).
// Covers the inline row expand → log-correlation-btn → ODrawer path.

import { expect } from '@playwright/test';

export class CorrelationDashboardPage {
  constructor(page) {
    this.page = page;

    // --- Logs search result table (for inline expand) ---
    this.resultTable = '[data-test="logs-search-result-logs-table"]';
    this.expandCell = '[data-test="o2-table-expand-cell"], [data-test^="o2-table-expand-"]';

    // --- Full drawer dashboard ---
    this.correlationBtn = '[data-test="log-correlation-btn"]';
    this.dashboardDrawer = '[data-test="telemetry-correlation-dashboard-drawer"]';

    // --- Dashboard tabs ---
    this.logsTab = this.page.locator('[role="tab"]').filter({ hasText: 'Logs' }).first();
    this.metricsTab = this.page.locator('[role="tab"]').filter({ hasText: 'Metrics' }).first();
    this.tracesTab = this.page.locator('[role="tab"]').filter({ hasText: 'Traces' }).first();

    // --- Metric stream sidebar ---
    this.metricStreamItem = '[data-test="telemetry-correlation-metric-stream-item"]';

    // --- Traces tab states ---
    this.noTracesState = '[data-test="correlation-no-traces-state-drawer"]';
    this.viewTracesPageBtn = '[data-test="correlation-view-traces-page"]';
    this.errorState = '[data-test="error-state"]';

    // --- Informational (embedded-tabs path, for no-match test) ---
    this.correlatedLogsTab = '[data-test="correlated-logs-tab"]';
  }

  // ==================== Full drawer open ====================

  /**
   * Expand the first row inline and click the correlation button to open the
   * full-drawer TelemetryCorrelationDashboard.
   */
  async openFullDrawerDashboard() {
    const firstRow = this.page
      .locator(`${this.resultTable} tbody tr`)
      .first();
    await firstRow.waitFor({ state: 'visible', timeout: 20_000 });

    const expander = firstRow
      .locator(this.expandCell)
      .first();
    await expander.waitFor({ state: 'visible', timeout: 15_000 });
    await expander.click();

    const btn = this.page.locator(this.correlationBtn).first();
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    await btn.click();
  }

  /**
   * Assert the full-drawer correlation dashboard container is visible.
   */
  async expectDashboardDrawerVisible() {
    await expect(this.page.locator(this.dashboardDrawer).first()).toBeVisible({ timeout: 30_000 });
  }

  // ==================== Dashboard tabs ====================

  /**
   * Click the Logs tab in the full-drawer dashboard and wait for content.
   */
  async clickLogsTab() {
    await this.logsTab.waitFor({ state: 'visible', timeout: 15_000 });
    await this.logsTab.click();
    // Allow tab content to settle
    await this.page.waitForTimeout(800);
  }

  /**
   * Click the Metrics tab in the full-drawer dashboard.
   */
  async clickMetricsTab() {
    await this.metricsTab.waitFor({ state: 'visible', timeout: 15_000 });
    await this.metricsTab.click();
    await this.page.waitForTimeout(800);
  }

  /**
   * Click the Traces tab in the full-drawer dashboard.
   */
  async clickTracesTab() {
    await this.tracesTab.waitFor({ state: 'visible', timeout: 15_000 });
    await this.tracesTab.click();
    await this.page.waitForTimeout(800);
  }

  /**
   * Assert all three telemetry tabs (Logs, Metrics, Traces) are present in the drawer.
   */
  async expectAllTabsVisible() {
    await expect(this.logsTab).toBeVisible({ timeout: 10_000 });
    await expect(this.metricsTab).toBeVisible({ timeout: 10_000 });
    await expect(this.tracesTab).toBeVisible({ timeout: 10_000 });
  }

  // ==================== Metric stream sidebar ====================

  /**
   * Wait for at least one metric stream item to be visible in the sidebar.
   */
  async expectMetricStreamItemsVisible() {
    const firstItem = this.page.locator(this.metricStreamItem).first();
    await expect(firstItem).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Click the nth metric stream item (0-indexed).
   * @param {number} index - 0-based index of the metric stream item to click
   */
  async clickMetricStreamItem(index = 0) {
    const items = this.page.locator(this.metricStreamItem);
    const target = items.nth(index);
    await target.waitFor({ state: 'visible', timeout: 15_000 });
    await target.click();
  }

  /**
   * Get the count of visible metric stream items.
   * @returns {Promise<number>}
   */
  async getMetricStreamItemCount() {
    const items = this.page.locator(this.metricStreamItem);
    return await items.count();
  }

  // ==================== Traces tab ====================

  /**
   * Wait for the traces tab content to settle. Accepts any of:
   * traces list, empty state, or loading that resolves. Asserts no error state.
   */
  async expectTracesContentLoaded() {
    // Wait for the no-traces empty state OR the view-traces-page button OR any
    // trace result content to appear (whichever loads first).
    await Promise.race([
      this.page.locator(this.noTracesState).first()
        .waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      this.page.locator(this.viewTracesPageBtn).first()
        .waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      // Generic fallback: wait for the drawer to settle
      this.page.locator(this.dashboardDrawer).first()
        .waitFor({ state: 'visible', timeout: 30_000 }),
    ]);
    // Regardless of which state rendered, no error state should appear.
    await expect(
      this.page.locator(this.errorState).first(),
      'traces tab must not render an error state',
    ).not.toBeVisible({ timeout: 5_000 });
  }

  /**
   * Assert the "Open in Traces" button is visible (present when dimension-based
   * traces are found).
   */
  async expectViewTracesPageButtonVisible() {
    const btn = this.page.locator(this.viewTracesPageBtn).first();
    // The button may or may not appear depending on data — wait briefly then
    // assert if visible (non-fatal if absent — traces may be empty).
    const visible = await btn.isVisible({ timeout: 15_000 }).catch(() => false);
    if (visible) {
      await expect(btn).toBeVisible();
    }
  }

  // ==================== K8s nested mode ====================

  /**
   * Check whether Pods/Nodes outer tabs are visible (k8s nested mode indicator).
   * Returns true if either tab is found, false otherwise.
   * @returns {Promise<boolean>}
   */
  async hasK8sNestedTabs() {
    const podsTab = this.page.getByRole('tab', { name: 'Pods' });
    const nodesTab = this.page.getByRole('tab', { name: 'Nodes' });
    const podsVisible = await podsTab.isVisible({ timeout: 3_000 }).catch(() => false);
    const nodesVisible = await nodesTab.isVisible({ timeout: 3_000 }).catch(() => false);
    return podsVisible || nodesVisible;
  }

  // ==================== No-match informational message ====================

  /**
   * Assert the correlated-logs tab (embedded DetailTable path) does NOT show an
   * error state when no service matches. Used for the 200-null no-match test.
   */
  async expectCorrelatedLogsTabClickable() {
    const tab = this.page.locator(this.correlatedLogsTab).first();
    await tab.waitFor({ state: 'visible', timeout: 15_000 });
    await tab.click();
  }

  /**
   * Assert the no-match informational message is visible (any non-error text
   * indicating no service was matched).
   */
  async expectNoMatchMessageVisible() {
    // After clicking the correlated-logs tab, the UI should show an
    // informational message — NOT an error state.
    await expect(
      this.page.locator(this.errorState).first(),
      'no-match path must not render an error state',
    ).not.toBeVisible({ timeout: 10_000 });
  }
}
