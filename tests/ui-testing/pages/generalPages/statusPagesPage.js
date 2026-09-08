// statusPagesPage.js - Page Object for the Synthetics -> Status Pages admin tab
// Covers the Status Pages table (web/src/views/synthetics/status-pages/StatusPagesList.vue)
// and, specifically, the enterprise/OSS gate on its per-row "more" dropdown:
// Post update / View updates / Custom domains are locked on an OSS build,
// unlocked on an Enterprise build (StatusPagesList.vue `advancedEnabled`,
// keyed off `store.state.zoConfig.build_type`).
//
// Strict selector policy: data-test only, no text matching.
import { expect } from '@playwright/test';

/** The three ODropdownItem entries gated by `advancedEnabled` in StatusPagesList.vue. */
export const GATED_ITEMS = ['post-update', 'view-updates', 'domains'];

export class StatusPagesPage {
  constructor(page) {
    this.page = page;

    this.table = page.locator('[data-test="status-pages-table"]');
    this.searchInput = page.locator('[data-test="status-pages-search-input-field"]');
    this.newPageBtn = page.locator('[data-test="status-pages-new-btn"]');
  }

  /** Navigate straight to the Status Pages tab of the Synthetics view. */
  async navigate(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    const url = `/web/synthetics?section=status-pages&org_identifier=${orgId}`;
    await this.page.goto(url, { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.table).toBeVisible({ timeout: 15000 });
  }

  /**
   * Detects the active build from the live `/config` response rather than a
   * rendered UI signal. `build_type` ("opensource" | "enterprise" | "cloud")
   * is exactly the value StatusPagesList.vue's `advancedEnabled` computed
   * reads off the Vuex store, and the store is itself hydrated from this same
   * endpoint — so reading it directly is a more direct and less brittle signal
   * than parsing a rendered label (cf. EditionFeaturesPage.detectEdition,
   * which has to fall back to a button label because the enterprise dialog's
   * variant is a frontend build-time flag, not `build_type`; no such mismatch
   * exists here since the gate itself is keyed off `build_type`).
   */
  async detectBuildType(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    // The backend is a separate origin from the Vite-served frontend
    // (ZO_BASE_URL) — there is no dev proxy for /api, so this must target the
    // backend directly. INGESTION_URL is the existing convention for that
    // (see global-setup.js's performGlobalIngestion), falling back to
    // ZO_BASE_URL for environments where frontend and backend share an origin.
    const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
    const response = await this.page.request.get(`${baseUrl}/api/${orgId}/config`);
    const body = await response.json();
    return body.build_type;
  }

  /** Open the row's "more" (kebab) dropdown. Returns nothing; items become queryable. */
  async openRowMenu(rowId) {
    const trigger = this.page.locator(`[data-test="status-pages-more-btn-${rowId}"]`);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    // Any one gated item becoming visible confirms the popover content mounted.
    await expect(this.gatedItem('post-update', rowId)).toBeVisible({ timeout: 10000 });
  }

  /** Locator for one of the three gated ODropdownItems (`post-update` | `view-updates` | `domains`). */
  gatedItem(name, rowId) {
    return this.page.locator(`[data-test="status-pages-${name}-item-${rowId}"]`);
  }

  /** Locator for the lock icon rendered inside a gated item when it is disabled. */
  gatedItemLock(name, rowId) {
    return this.page.locator(`[data-test="status-pages-${name}-lock-${rowId}"]`);
  }

  /** True if the dropdown item carries reka-ui's `data-disabled` marker. */
  async isItemDisabled(name, rowId) {
    const value = await this.gatedItem(name, rowId).getAttribute('data-disabled');
    return value !== null;
  }

  /** Asserts all three gated items are disabled and show their lock icon. */
  async expectAllLocked(rowId) {
    for (const name of GATED_ITEMS) {
      const item = this.gatedItem(name, rowId);
      await expect(item, `"${name}" dropdown item should be disabled on OSS`).toHaveAttribute(
        'data-disabled',
        '',
      );
      await expect(
        this.gatedItemLock(name, rowId),
        `"${name}" should show its lock icon on OSS`,
      ).toBeVisible();
    }
  }

  /** Asserts all three gated items are enabled and show no lock icon. */
  async expectAllUnlocked(rowId) {
    for (const name of GATED_ITEMS) {
      const item = this.gatedItem(name, rowId);
      await expect(
        item,
        `"${name}" dropdown item should not be disabled on Enterprise`,
      ).not.toHaveAttribute('data-disabled', '');
      await expect(
        this.gatedItemLock(name, rowId),
        `"${name}" should show no lock icon on Enterprise`,
      ).toBeHidden();
    }
  }
}
