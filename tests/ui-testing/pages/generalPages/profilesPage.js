// profilesPage.js - Page Object for the Profiles (continuous profiling) menu gate
// Covers the left-rail "Profiles" tile that MainLayout.vue inserts/removes based
// on zoConfig.profiling_enabled (ZO_FEATURE_PROFILING_ENABLED, default false),
// plus the /profiles page reachable by direct URL regardless of the flag.
//
// The tile's data-test is derived from its link path (MenuLink.vue `menu-link-${link}-item`),
// so the Profiles entry (link: "/profiles") is `menu-link-/profiles-item` — escaped as
// `menu-link-\\/profiles-item` in CSS, matching the Home tile `menu-link-\\/-item` convention.
import { expect } from '@playwright/test';

export class ProfilesPage {
  constructor(page) {
    this.page = page;

    this.profilesMenuItem = page.locator('[data-test="menu-link-\\/profiles-item"]');
    this.tracesGroup = page.locator('[data-test="nav-group-traces"]');
    this.profilesStreamSelect = page.locator('[data-test="profiles-stream-select"]');
    this.profilesNoStream = page.locator('[data-test="profiles-no-stream"]');
  }

  /**
   * Reads the gate's source value straight from /api/{org}/config — the same
   * endpoint that hydrates zoConfig.profiling_enabled off the Vuex store, so
   * there is no frontend/backend mismatch to tolerate (cf. StatusPagesPage.detectBuildType).
   * Returns true only when profiling_enabled is explicitly true (false or undefined otherwise).
   */
  async detectProfilingEnabled(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    // Backend is a separate origin from the Vite-served frontend (ZO_BASE_URL);
    // INGESTION_URL is the existing convention for that, falling back to ZO_BASE_URL.
    const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
    const response = await this.page.request.get(`${baseUrl}/api/${orgId}/config`);
    const body = await response.json();
    return body.profiling_enabled === true;
  }

  /** Navigate straight to the Profiles page by direct URL (route is NOT flag-gated). */
  async navigate(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    await this.page.goto(`/web/profiles?org_identifier=${orgId}`, { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Asserts the Profiles rail tile is not present (zero DOM occurrences). */
  async expectMenuItemAbsent() {
    await expect(this.profilesMenuItem).toHaveCount(0);
  }

  /** Asserts the Profiles rail tile is visible. */
  async expectMenuItemVisible() {
    await expect(this.profilesMenuItem).toBeVisible({ timeout: 15000 });
  }

  /** Clicks the Profiles rail tile (only meaningful when the tile is shown). */
  async clickMenuItem() {
    await expect(this.profilesMenuItem).toBeVisible({ timeout: 15000 });
    await this.profilesMenuItem.click();
  }

  /**
   * Asserts the Profiles tile sits after the Traces group in document order.
   * Both are rail siblings; compareDocumentPosition(FOLLOWING) holds only when
   * Traces precedes Profiles, which is exactly what updateProfilesMenu() does.
   */
  async expectMenuItemOrderedAfterTracesGroup() {
    await expect(this.tracesGroup).toBeVisible({ timeout: 15000 });
    await expect(this.profilesMenuItem).toBeVisible({ timeout: 15000 });
    const ordered = await this.page.evaluate(() => {
      const profiles = document.querySelector('[data-test="menu-link-/profiles-item"]');
      const traces = document.querySelector('[data-test="nav-group-traces"]');
      if (!profiles || !traces) return false;
      return Boolean(
        traces.compareDocumentPosition(profiles) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(ordered, 'Profiles tile should be ordered after the Traces group').toBe(true);
  }

  /** Asserts the /profiles page mounted — either the stream picker or the no-stream empty state. */
  async expectPageMounted() {
    await expect(
      this.profilesStreamSelect.or(this.profilesNoStream).first(),
    ).toBeVisible({ timeout: 15000 });
  }
}
