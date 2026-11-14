import { expect } from "@playwright/test";

/** No Apply button: a pick applies at once with Auto Run on, else defers (a stale global, view or panel refresh). */
export default class DashboardTimeRange {
  constructor(page) {
    this.page = page;
    this.dateTimeApplyBtn = page.locator('[data-test="date-time-apply-btn"]');
    this.panelRefreshBtn = page.locator('[data-test="dashboard-panel-refresh-panel-btn"]');
  }

  // The headline change: dashboard pickers render no Apply button (autoApply=true).
  async expectNoApplyButton() {
    await expect(this.dateTimeApplyBtn).toHaveCount(0);
  }

  // The applied (not picked) global range is what the URL reflects.
  async expectUrlPeriod(period) {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.get('period'), { timeout: 30000 })
      .toBe(period);
  }

  // UI v2 has no "ghost-warning" variant: a waiting panel refresh stays ghost and carries data-o2-stale.
  async expectPanelRefreshVariant(variant) {
    if (variant === 'ghost-warning') {
      await expect(this.panelRefreshBtn).toHaveAttribute('data-o2-stale', 'true');
      return;
    }
    await expect(this.panelRefreshBtn).toHaveAttribute('data-o2-variant', variant);
    await expect(this.panelRefreshBtn).not.toHaveAttribute('data-o2-stale', 'true');
  }

  async expectPanelRefreshNotPending() {
    await expect(this.panelRefreshBtn).not.toHaveAttribute('data-o2-stale', 'true');
  }
}
