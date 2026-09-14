/**
 * OnCallPagesListPage - the "On-Call Pages" screen (views/OnCall/OnCallResponses.vue)
 *
 * Route `/web/oncall/responses`. Internally everything is spelled "responses",
 * which is why every selector here reads `oncall-responses-*` while the plan and
 * the UI both say "pages".
 *
 * THE COUNT ON A GROUP HEADING IS NOT THE NUMBER OF ROWS UNDER IT.
 *
 * The table paginates at 20 rows across the whole result set, and each heading
 * is redrawn on every page carrying its group's total over the FILTERED set —
 * deliberately, because a heading reading "3" on page one of five would be
 * describing the pagination rather than the state. So `headingTotal` and
 * `rowsDrawn` legitimately differ, and a spec asserting they are equal would be
 * asserting a bug. `readGroupsAndRows()` returns both so §11.3 can assert the
 * RELATIONSHIP — the heading total is the whole group, the rows drawn are this
 * page's slice of it — rather than a raw count.
 *
 * Group order is fixed: ringing, snoozed, handled, resolved.
 *
 * Row-scoped selectors carry `rowKey`, which is the SUBJECT key when grouping is
 * on and the record id when it is off — so a spec that toggles grouping must
 * re-read the keys rather than reuse them.
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

/** The sections, in the order the table lays them out. */
const SECTION_ORDER = ['ringing', 'snoozed', 'handled', 'resolved'];

/** The table's own page size. Hardcoded in the view; §11.3 is written against it. */
const PAGE_SIZE = 20;

/**
 * `[data-test="x"]` + `field` -> `[data-test="x-field"]`.
 *
 * O2 form controls nest their parts INSIDE the attribute value, so a suffix
 * appended after the closing bracket parses as a type selector and matches
 * nothing at all — silently, which is the trap.
 */
function part(selector, suffix) {
  return selector.replace(/"\]$/, `-${suffix}"]`);
}

export class OnCallPagesListPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      root: '[data-test="oncall-responses-page"]',
      table: '[data-test="oncall-responses-table"]',
      filterTabs: '[data-test="oncall-responses-filter-tabs"]',
      teamFilter: '[data-test="oncall-responses-team-filter"]',
      priorityFilter: '[data-test="oncall-responses-priority-filter"]',
      causeFilter: '[data-test="oncall-responses-cause-filter"]',
      search: '[data-test="oncall-responses-search"]',
      groupToggle: '[data-test="oncall-responses-group-toggle"]',
      refresh: '[data-test="oncall-responses-refresh"]',
      mineButton: '[data-test="oncall-responses-mine-btn"]',
      empty: '[data-test="oncall-responses-empty"]',
      error: '[data-test="oncall-responses-error"]',
      unavailable: '[data-test="oncall-responses-unavailable"]',
      truncated: '[data-test="oncall-responses-truncated"]',
      escalationCapped: '[data-test="oncall-escalation-capped"]',

      // Bulk bar, which only exists once something is selected.
      bulkCount: '[data-test="oncall-bulk-count"]',
      bulkAck: '[data-test="oncall-bulk-ack"]',
      bulkResolve: '[data-test="oncall-bulk-resolve"]',
      bulkSnooze: '[data-test="oncall-bulk-snooze"]',
      bulkCancel: '[data-test="oncall-bulk-cancel"]',

      // Shared OTable furniture.
      body: '[data-test="o2-table-body"]',
      // `o2-table-select-header`, NOT `-select-all`: OTableSelectCheckbox builds
      // `o2-table-select-${rowId ?? 'header'}`, and the header row has no rowId.
      // `-select-all` appears only in OTable's own unit spec and is never rendered.
      selectAll: '[data-test="o2-table-select-header"]',
      pageSizeSelect: '[data-test="o2-table-page-size-select"]',
      paginationInfo: '[data-test="o2-table-pagination-info"]',
      firstPage: '[data-test="o2-table-first-page-btn"]',
      prevPage: '[data-test="o2-table-prev-page-btn"]',
      nextPage: '[data-test="o2-table-next-page-btn"]',
      lastPage: '[data-test="o2-table-last-page-btn"]',
    };
  }

  // Built rather than stored — these carry a section key, a rowKey or an index.
  filterTab(key) { return `[data-test="oncall-responses-tab-${key}"]`; }
  sectionHeader(key) { return `[data-test="oncall-section-header-${key}"]`; }
  sectionCount(key) { return `[data-test="oncall-section-count-${key}"]`; }

  rowAck(rowKey) { return `[data-test="oncall-row-ack-${rowKey}"]`; }
  rowResolve(rowKey) { return `[data-test="oncall-row-resolve-${rowKey}"]`; }
  rowAssign(rowKey) { return `[data-test="oncall-row-assign-${rowKey}"]`; }
  rowIncident(rowKey) { return `[data-test="oncall-row-incident-${rowKey}"]`; }
  rowMore(rowKey) { return `[data-test="oncall-row-more-${rowKey}"]`; }
  rowTeam(rowKey) { return `[data-test="oncall-row-team-${rowKey}"]`; }
  rowTimeline(rowKey) { return `[data-test="oncall-row-timeline-${rowKey}"]`; }
  rowLadderStarted(rowKey) { return `[data-test="oncall-ladder-started-${rowKey}"]`; }
  rowSnooze(rowKey, minutes) {
    return `[data-test="oncall-row-snooze-${rowKey}-${minutes}"]`;
  }
  rowExpansion(rowKey) { return `[data-test="oncall-expansion-${rowKey}"]`; }

  /**
   * The expand control and the row are keyed by the table's own row INDEX, not
   * by `rowKey` — and that index is the table's, not a position on the page, so
   * page two does not start at 0. Use `readRowIndices()` rather than assuming.
   */
  expandControl(index) { return `[data-test="o2-table-expand-${index}"]`; }
  rowByIndex(index) { return `[data-test="o2-table-row-${index}"]`; }
  rowSelect(index) { return `[data-test="o2-table-select-${index}"]`; }

  // ---------------------------------------------------------------- navigation

  /** @param {string} orgId the org **identifier** (ksuid), never the display name. */
  async goto(orgId) {
    await this.page.goto(`/web/oncall/responses?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('On-call pages list');
  }

  /** The detail route for one page record. Distinct from the list's own row keys. */
  async gotoDetail(orgId, responseId) {
    await this.page.goto(`/web/oncall/responses/${responseId}?org_identifier=${orgId}`);
    await this.page.waitForLoadState('domcontentloaded');
    testLogger.navigation('On-call page detail', { responseId });
  }

  async refresh() {
    await this.page.locator(this.locators.refresh).click();
  }

  // ------------------------------------------------------------------- filters

  /**
   * Narrow to one state.
   *
   * The tabs are an OToggleGroup, not a select: there is no popover, and each
   * item reports `data-state`, so the click is verifiable rather than assumed.
   *
   * @param {'all'|'ringing'|'handled'|'resolved'|'snoozed'} key
   */
  async selectFilterTab(key) {
    const tab = this.page.locator(this.filterTab(key));
    await tab.waitFor({ state: 'visible', timeout: 20000 });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'on', { timeout: 15000 });
    await this.page.waitForTimeout(400);
  }

  /**
   * Pick in one of the OSelect filters.
   *
   * Team and cause are SERVER-side filters — they refetch — while priority is
   * client-side. Options carry the raw value on `data-test-value`, so matching
   * on the label would break under translation and on virtualized rows.
   */
  async _selectFilter(fieldSelector, value) {
    const trigger = this.page.locator(part(fieldSelector, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const option = this.page.locator(`${part(fieldSelector, 'option')}[data-test-value="${value}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
    await this.page.waitForTimeout(500);
  }

  async filterByTeam(teamId) {
    await this._selectFilter(this.locators.teamFilter, teamId);
  }

  async filterByPriority(priority) {
    await this._selectFilter(this.locators.priorityFilter, String(priority));
  }

  /**
   * A cause can only match a RESOLVED record, so this filter is rendered only
   * while resolved rows are in view. Select the resolved tab first or the
   * control is not there to click.
   */
  async filterByCause(cause) {
    await this._selectFilter(this.locators.causeFilter, cause);
  }

  async search(text) {
    const field = this.page.locator(`${this.locators.search} [data-test$="-field"]`).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(text);
    await this.page.waitForTimeout(600);
  }

  /**
   * Group-by-alert, on by default.
   *
   * An OCheckbox: the `data-test` lands on the label, and the state lives on the
   * inner `role="checkbox"` button as `data-state`. Reading before and after is
   * the point — a click that lands mid-render is otherwise a silent no-op.
   */
  getGroupToggleControl() {
    return this.page.locator(`${this.locators.groupToggle} [role="checkbox"]`).first();
  }

  async isGrouped() {
    const control = this.getGroupToggleControl();
    await control.waitFor({ state: 'visible', timeout: 20000 });
    return (await control.getAttribute('data-state')) === 'checked';
  }

  async setGrouped(on) {
    if ((await this.isGrouped()) === on) return;
    const control = this.getGroupToggleControl();
    const before = await control.getAttribute('data-state');
    await control.click();
    await expect(control).not.toHaveAttribute('data-state', before ?? '', { timeout: 15000 });
    await this.page.waitForTimeout(400);
  }

  /** Narrow to pages the signed-in user is on the hook for. Hidden when the viewer is unknown. */
  async toggleMineOnly() {
    const button = this.page.locator(this.locators.mineButton);
    await button.waitFor({ state: 'visible', timeout: 20000 });
    const before = await button.getAttribute('aria-pressed');
    await button.click();
    await expect(button).not.toHaveAttribute('aria-pressed', before ?? '', { timeout: 15000 });
  }

  // ---------------------------------------------------------------- pagination

  async goToNextPage() {
    await this.page.locator(this.locators.nextPage).click();
    await this.page.waitForTimeout(400);
  }

  async goToPrevPage() {
    await this.page.locator(this.locators.prevPage).click();
    await this.page.waitForTimeout(400);
  }

  async goToFirstPage() {
    await this.page.locator(this.locators.firstPage).click();
    await this.page.waitForTimeout(400);
  }

  async goToLastPage() {
    await this.page.locator(this.locators.lastPage).click();
    await this.page.waitForTimeout(400);
  }

  /** The pagination strip's own sentence, verbatim. Never reconstruct it. */
  async readPaginationInfo() {
    const info = this.page.locator(this.locators.paginationInfo);
    if ((await info.count()) === 0) return null;
    return ((await info.first().textContent()) ?? '').trim();
  }

  // ------------------------------------------------------------------ reading

  /** Rows drawn on the CURRENT page. Headings are sibling `<tr>`s, so they are excluded. */
  async countRowsOnPage() {
    return await this.page.locator('[data-test^="o2-table-row-"]').count();
  }

  /**
   * Both halves of §11.3, read together.
   *
   * Headings and rows are FLAT SIBLINGS in one `<tbody>` — a heading is not a
   * parent of the rows it describes — so attributing rows to a heading means
   * walking the body in DOM order. That is what the evaluate below does, keyed
   * entirely on `data-test` attributes.
   *
   * `headingTotal` is the group's total over the whole filtered set and
   * `rowsDrawn` is what this page actually shows, so on a result set larger than
   * one page they SHOULD differ. The assertion a spec wants is that the drawn
   * rows are a slice of the stated total — `rowsDrawn <= headingTotal`, and the
   * totals summing to what pagination claims — not that the two are equal.
   *
   * @returns {Promise<{
   *   pageSize: number,
   *   rowsDrawn: number,
   *   paginationInfo: string|null,
   *   groups: Array<{key: string, headingTotal: number, rowsDrawn: number}>,
   * }>}
   */
  async readGroupsAndRows() {
    await this.page.locator(this.locators.table).waitFor({ state: 'visible', timeout: 30000 });

    const groups = await this.page.evaluate(() => {
      const body = document.querySelector('[data-test="o2-table-body"]');
      if (!body) return [];

      const out = [];
      let current = null;
      for (const child of Array.from(body.children)) {
        const attr = child.getAttribute('data-test') ?? '';
        if (attr.startsWith('o2-table-section-')) {
          const key = attr.replace('o2-table-section-', '');
          const countNode = child.querySelector(`[data-test="oncall-section-count-${key}"]`);
          const headingTotal = Number((countNode?.textContent ?? '0').trim()) || 0;
          current = { key, headingTotal, rowsDrawn: 0 };
          out.push(current);
        } else if (attr.startsWith('o2-table-row-') && current) {
          current.rowsDrawn += 1;
        }
      }
      return out;
    });

    return {
      pageSize: PAGE_SIZE,
      rowsDrawn: await this.countRowsOnPage(),
      paginationInfo: await this.readPaginationInfo(),
      groups,
    };
  }

  /** The heading's stated total for one group, over the whole filtered set. */
  async readSectionCount(key) {
    const tag = this.page.locator(this.sectionCount(key));
    if ((await tag.count()) === 0) return null;
    return Number(((await tag.first().textContent()) ?? '').trim()) || 0;
  }

  /**
   * The table's row indices for the rows currently drawn, in order.
   *
   * These are what `o2-table-row-*` and `o2-table-expand-*` interpolate, and
   * they do NOT restart at 0 on page two — so a spec wanting "the first row on
   * this page" takes `(await readRowIndices())[0]`, never a literal 0.
   */
  async readRowIndices() {
    const rows = this.page.locator('[data-test^="o2-table-row-"]');
    const count = await rows.count();
    const indices = [];
    for (let i = 0; i < count; i++) {
      const attr = await rows.nth(i).getAttribute('data-test');
      if (attr) indices.push(Number(attr.replace('o2-table-row-', '')));
    }
    return indices;
  }

  /** The `rowKey`s of the rows currently drawn, in order. */
  async readRowKeys() {
    const acks = this.page.locator('[data-test^="oncall-row-ack-"]');
    const count = await acks.count();
    const keys = [];
    for (let i = 0; i < count; i++) {
      const attr = await acks.nth(i).getAttribute('data-test');
      if (attr) keys.push(attr.replace('oncall-row-ack-', ''));
    }
    return keys;
  }

  // ------------------------------------------------------------- row actions

  async acknowledgeRow(rowKey) {
    await this.page.locator(this.rowAck(rowKey)).click();
  }

  async resolveRow(rowKey) {
    await this.page.locator(this.rowResolve(rowKey)).click();
  }

  async snoozeRow(rowKey, minutes) {
    await this.page.locator(this.rowMore(rowKey)).click();
    await this.page.locator(this.rowSnooze(rowKey, minutes)).click();
  }

  async openRowMenu(rowKey) {
    await this.page.locator(this.rowMore(rowKey)).click();
  }

  /** Open one page's detail by clicking the row. Index omitted = the first row drawn. */
  async openRow(index = null) {
    const target = index ?? (await this.readRowIndices())[0];
    await this.page.locator(this.rowByIndex(target)).click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Click the row's expand control and report what it did.
   *
   * Written to be read rather than trusted: the chevron stops propagation and
   * toggles an inline expansion in the source, but the manual pass against a
   * running build recorded it NAVIGATING to the page detail instead. Rather than
   * encode one of those and break on the other, this returns both observations
   * and lets the spec assert the behaviour the plan claims.
   *
   * @returns {Promise<{navigated: boolean, url: string, expandedInline: boolean}>}
   */
  async clickRowExpand(index = null, { rowKey = null, settleMs = 1200 } = {}) {
    const target = index ?? (await this.readRowIndices())[0];
    const before = this.page.url();
    await this.page.locator(this.expandControl(target)).click();
    await this.page.waitForTimeout(settleMs);
    const url = this.page.url();

    const expandedInline = rowKey
      ? (await this.page.locator(this.rowExpansion(rowKey)).count()) > 0
      : (await this.page.locator('[data-test^="oncall-expansion-"]').count()) > 0;

    return { navigated: url !== before, url, expandedInline };
  }

  // --------------------------------------------------------------- selection

  async selectAll() {
    await this.page.locator(this.locators.selectAll).click();
  }

  /**
   * Select one row's checkbox.
   *
   * Keyed by the table's row index, the same handle the expand control uses —
   * and only selectable rows have one, since the list gates selection on whether
   * the viewer may acknowledge the page.
   */
  async selectRow(index = null) {
    const target = index ?? (await this.readRowIndices())[0];
    await this.page.locator(this.rowSelect(target)).click();
  }

  async readBulkCount() {
    const node = this.page.locator(this.locators.bulkCount);
    if ((await node.count()) === 0) return null;
    return ((await node.first().textContent()) ?? '').trim();
  }

  // ---------------------------------------------------------------- assertions

  async expectListVisible() {
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.table)).toBeVisible({ timeout: 30000 });
  }

  async expectRowVisible(rowKey) {
    await expect(this.page.locator(this.rowTeam(rowKey))).toBeVisible({ timeout: 30000 });
  }

  async expectSectionVisible(key) {
    await expect(this.page.locator(this.sectionHeader(key))).toBeVisible({ timeout: 30000 });
  }

  async expectSectionAbsent(key) {
    await expect(this.page.locator(this.sectionHeader(key))).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * §3.2 / §3.3: what a row says about the ladder must be per-state.
   *
   * The wording is the assertion, so it is passed in by the spec rather than
   * matched here — a page object hardcoding "Ladder finished" would pin the
   * English copy into the foundation.
   */
  async expectRowText(rowKey, text) {
    await expect(this.page.locator(this.rowTeam(rowKey))).toContainText(text, { timeout: 30000 });
  }

  /**
   * §11.6: a page nothing routed reads "Unrouted".
   *
   * The team cell is the one that has to say it — the exhaust reason must not
   * claim the team was deleted, which is the wording this guards against.
   */
  async readRowTeamLabel(rowKey) {
    const cell = this.page.locator(this.rowTeam(rowKey));
    await cell.waitFor({ state: 'visible', timeout: 30000 });
    return ((await cell.textContent()) ?? '').trim();
  }

  /** The list hit its fetch cap. The loaded length is never the total — §G.5. */
  async expectTruncatedNotice() {
    await expect(this.page.locator(this.locators.truncated)).toBeVisible({ timeout: 30000 });
  }

  // ------------------------------------------------------- enterprise gating

  async isUnavailable() {
    return (await this.page.locator(this.locators.unavailable).count()) > 0;
  }

  async expectAvailable() {
    await expect(
      this.page.locator(this.locators.unavailable),
      'on-call is not available on this deployment — the suite needs an enterprise build with O2_ONCALL_ENABLED',
    ).toHaveCount(0, { timeout: 30000 });
  }
}

OnCallPagesListPage.SECTION_ORDER = SECTION_ORDER;
OnCallPagesListPage.PAGE_SIZE = PAGE_SIZE;

export default OnCallPagesListPage;
