/**
 * SloDetailPage - the SLO detail view (views/slos/SloDetail.vue)
 *
 * This page object exists mainly to read the MEASURED SLI, which is the only
 * number in the feature produced by the backend measurement pipeline. The form
 * preview computes its own SLI client-side and agreed with the backend even
 * while the backend was wrong (the time-slice always-100% defect), so preview
 * agreement proves nothing about measurement. Assertions that matter read here.
 *
 * Absent values render as an EM DASH, never 0 — `useSloFormat.ABSENT`:
 *   "a brand-new SLO has measured nothing, and rendering that as a number
 *    invites someone to read it as a measurement."
 * readSli() preserves that distinction by returning null for the dash.
 *
 * Formats (useSloFormat.ts):
 *   sli      "98.031%"  3 decimals   | ABSENT
 *   target   "99%"      trimmed
 *   budget   "-97.7%"   1 decimal    | ABSENT
 *   burn     "×1.2"     1 decimal    | ABSENT
 *   coverage "95%"      rounded      | ABSENT
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

/** The em dash the app uses for "not measured". */
const ABSENT = '—';

export class SloDetailPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      title: '[data-test="slos-slodetail-title"]',
      notFound: '[data-test="slos-slodetail-not-found"]',
      stats: '[data-test="slos-slodetail-stats"]',
      tabs: '[data-test="slos-slodetail-tabs"]',
      edit: '[data-test="slos-slodetail-edit"]',
      groupsTable: '[data-test="slos-slodetail-groups-table"]',
      sourceAlert: '[data-test="slos-slodetail-source-alert"]',
      frozenBanner: '[data-test="slos-slodetail-frozen-banner"]',

      // Stat tiles
      statSli: '[data-test="slos-slodetail-stat-sli"]',
      statTarget: '[data-test="slos-slodetail-stat-target"]',
      statExhaust: '[data-test="slos-slodetail-stat-exhaust"]',
      statCoverage: '[data-test="slos-slodetail-stat-coverage"]',

      // Tabs
      tabGroups: '[data-test="slos-slodetail-tab-groups"]',

      // Config summary
      configJson: '[data-test="slos-sloconfigsummary-json"]',

      // Burndown panels.
      //
      // Like every other chart in this feature, the component's own
      // `slos-sloburndownchart-root` is NOT in the DOM: SloDetail mounts it with
      // `data-test="slos-slodetail-burndown"`, and a parent's fallthrough
      // attribute overrides the child root's own. The per-panel selectors below
      // are inner elements and keep their own ids.
      burndownRoot: '[data-test="slos-slodetail-burndown"]',
    };
  }

  configField(key) { return `[data-test="slos-sloconfigsummary-${key}"]`; }

  // ---------------------------------------------------------------- navigation

  async goto(orgId, sloId) {
    await this.page.goto(`/web/slos/${sloId}?org_identifier=${orgId}`);
    await this.page.waitForLoadState('domcontentloaded');
    testLogger.navigation('SLO detail', { sloId });
  }

  async openTab(name) {
    const tab = this.page.locator(`[data-test="slos-slodetail-tab-${name}"]`);
    await tab.waitFor({ state: 'visible', timeout: 20000 });
    await tab.click();
    // OTab forwards data-state so the active tab is assertable rather than assumed.
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 10000 });
  }

  async clickEdit() {
    await this.page.locator(this.locators.edit).click();
  }

  // -------------------------------------------------------------- stat reading

  async _statText(selector) {
    const tile = this.page.locator(selector);
    await tile.waitFor({ state: 'visible', timeout: 30000 });
    return (await tile.textContent()) ?? '';
  }

  /**
   * The measured SLI as a number, or null when the SLO is frozen / unmeasured.
   *
   * Returning null rather than 0 is the whole contract — see the class note.
   */
  async readSli() {
    const text = await this._statText(this.locators.statSli);
    if (text.includes(ABSENT)) return null;
    const m = text.match(/([\d.]+)\s*%/);
    return m ? Number(m[1]) : null;
  }

  async readCoverage() {
    const text = await this._statText(this.locators.statCoverage);
    if (text.includes(ABSENT)) return null;
    const m = text.match(/([\d.]+)\s*%/);
    return m ? Number(m[1]) : null;
  }

  // ---------------------------------------------------------------- assertions

  async expectDetailVisible() {
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.stats)).toBeVisible();
    await expect(this.page.locator(this.locators.tabs)).toBeVisible();
  }

  async expectNotFound() {
    await expect(this.page.locator(this.locators.notFound)).toBeVisible({ timeout: 30000 });
  }

  async expectFrozenBanner() {
    await expect(this.page.locator(this.locators.frozenBanner)).toBeVisible({ timeout: 30000 });
  }

  /**
   * The stored definition JSON, parsed — the ground truth for a round-trip.
   *
   * Scoped to the inner `<code>`: OCodeBlock renders the body with
   * `v-html="highlighted"` inside `<pre><code class="hljs">`, and its root also
   * contains a toolbar (language label, copy button) whose text would never
   * parse as JSON.
   */
  async readConfigJson() {
    const block = this.page.locator(this.locators.configJson);
    await block.waitFor({ state: 'visible', timeout: 20000 });

    const code = block.locator('pre code').first();
    await code.waitFor({ state: 'attached', timeout: 20000 });
    // Highlighting wraps tokens in spans, so innerText would reflow; textContent
    // concatenates the token text back into the original source.
    const text = ((await code.textContent()) ?? '').trim();

    if (!text) {
      const html = ((await block.innerHTML()) ?? '').slice(0, 1200);
      throw new Error(
        `Config JSON block rendered empty. Block innerHTML (truncated):\n${html}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Config JSON did not parse. Raw text:\n${text}`);
    }
  }

  /**
   * The groups tab exists and lists per-group rows.
   *
   * The tab itself is `v-if="isGrouped"`, so its presence is already an
   * assertion that the SLO was stored as grouped.
   */
  async expectGroupsTable({ timeout = 30000 } = {}) {
    await this.openTab('groups');
    await expect(this.page.locator(this.locators.groupsTable))
      .toBeVisible({ timeout });
  }

  /** The tab is absent for an ungrouped SLO — nothing to show. */
  async expectGroupsTabAbsent() {
    await expect(this.page.locator(this.locators.tabGroups)).toHaveCount(0);
  }

  /** An alert-sourced SLO names the alert it measures. */
  async expectSourceAlertVisible(name = null) {
    const el = this.page.locator(this.locators.sourceAlert);
    await expect(el).toBeVisible({ timeout: 30000 });
    if (name) await expect(el).toContainText(name);
  }

  /** The target tile shows the configured objective. */
  async expectTargetShown(target) {
    const tile = this.page.locator(this.locators.statTarget);
    await tile.waitFor({ state: 'visible', timeout: 30000 });
    await expect(tile).toContainText(String(target));
  }

  /**
   * Time-to-exhaust reads as absent, not as a duration.
   *
   * It is derived from the burn rate, so before measurement there is nothing to
   * derive it from — a number here would be invented.
   */
  async expectTimeToExhaustAbsent() {
    const text = await this._statText(this.locators.statExhaust);
    expect(
      text.includes(ABSENT),
      `time-to-exhaust must read as absent before measurement, got ${JSON.stringify(text)}`,
    ).toBe(true);
  }

  async expectTitle(name) {
    await expect(this.page.locator(this.locators.title)).toContainText(name, { timeout: 30000 });
  }

  /**
   * The burndown carries data, not an empty state.
   *
   * Two panels: `budget` (error budget remaining) and `burn` (burn rate). Each
   * renders distinct `-chart` / `-empty` / `-error` / `-loading` nodes, so the
   * assertion targets `-chart` — the root alone is satisfied by an empty chart,
   * which is exactly the false pass this suite is built to avoid.
   *
   * Unlike the previews, SloBurndownChart is mounted WITHOUT a parent
   * `data-test`, so its own root selector genuinely applies here.
   */
  async expectBurndownHasData({ panel = 'budget', timeout = 60000 } = {}) {
    await this.page.locator(this.locators.burndownRoot)
      .waitFor({ state: 'visible', timeout });

    await expect(
      this.page.locator(`[data-test="slos-sloburndownchart-${panel}-loading"]`),
    ).toHaveCount(0, { timeout });

    await expect(
      this.page.locator(`[data-test="slos-sloburndownchart-${panel}-error"]`),
      'the burndown must not be in an error state',
    ).toHaveCount(0);

    await expect(
      this.page.locator(`[data-test="slos-sloburndownchart-${panel}-chart"]`),
      `the ${panel} panel must render a chart, not an empty state`,
    ).toBeVisible({ timeout });
  }
}

export default SloDetailPage;
