import { expect } from "@playwright/test";

/** No Apply button: a pick applies at once with Auto Run on, else defers (pending global/view refresh, ghost-warning panel refresh). */
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

  async expectPanelRefreshVariant(variant) {
    await expect(this.panelRefreshBtn).toHaveAttribute('data-o2-variant', variant);
  }

  async expectPanelRefreshNotPending() {
    await expect(this.panelRefreshBtn).not.toHaveAttribute('data-o2-variant', 'ghost-warning');
  }
}
