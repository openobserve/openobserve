// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SyntheticsResultsPage — MonitorResults.vue (+ MonitorRuns.vue) and RunDetail.vue; run counts come from the pagination info (10 rows/page).

import { expect } from '@playwright/test';
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SyntheticsResultsPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      page: '[data-test="synthetic-monitor-results-page"]',
      triggerRunButton: '[data-test="synthetic-monitor-results-trigger-run-btn"]',
      dateTimeButton: '[data-test="date-time-btn"]',
      runsSection: '[data-test="synthetics-monitor-runs"]',
      runsTable: '[data-test="monitor-runs-runs-table"]',
      paginationInfo: '[data-test="monitor-runs-runs-table"] [data-test="o2-table-pagination-info"]',
      pageEmpty: '[data-test="monitor-runs-page-empty"]',
      stepsTab: '[data-test="monitor-runs-tab-steps"]',
      stepsErrorNote: '[data-test="monitor-runs-steps-error-note"]',
      timeline: '[data-test="monitor-status-timeline"]',
      timelineScrollLeft: '[data-test="synthetics-timeline-scroll-left-btn"]',
      timelineScrollRight: '[data-test="synthetics-timeline-scroll-right-btn"]',
      row: '[data-test^="o2-table-row-"]',
      drawer: '[data-test="synthetics-run-detail-drawer"]',
      protocolDetail: '[data-test="synthetics-protocol-run-detail"]',
      protocolAssertionsBadge: '[data-test="synthetics-protocol-run-assertions-badge"]',
      // Run detail (full page or drawer)
      statusBadge: '[data-test="synthetics-run-detail-status-badge"]',
      infoSkeleton: '[data-test="synthetics-run-detail-info-skeleton"]',
      detailStepsTab: '[data-test="synthetics-run-detail-tab-steps"]',
      detailEvidenceTab: '[data-test="synthetics-run-detail-tab-evidence"]',
      evidenceEmpty: '[data-test="synthetics-evidence-empty"]',
      errorBanner: '[data-test="synthetics-run-detail-steps-error-banner"]',
      errorSource: '[data-test="synthetics-run-detail-error-source"]',
      viewErrorButton: '[data-test="synthetics-run-detail-step-view-error-btn"]',
      errorFullscreen: '[data-test="synthetics-run-detail-step-error-fullscreen"]',
      screenshotThumb: '[data-test="synthetics-run-detail-step-screenshot-thumb"]',
      attemptSelect: '[data-test="synthetics-run-detail-attempt-select"]',
      attemptDropdown: '[data-test="synthetics-run-detail-attempt-dropdown"]',
      prevButton: '[data-test="synthetics-run-detail-prev-btn"]',
      nextButton: '[data-test="synthetics-run-detail-next-btn"]',
      toastMessage: '[data-test="o-toast-message"]',
    };
  }

  kpi(key) { return `[data-test="monitor-runs-kpi-${key}"]`; }
  statusFilter(key) { return `[data-test="monitor-runs-status-filter-${key}"]`; }
  stepErrorCard(rowId) { return `[data-test="synthetics-run-detail-step-error-card-${rowId}"]`; }
  relativePeriod(suffix) { return `[data-test="date-time-relative-${suffix}-btn"]`; }

  // ---------------------------------------------------------------- navigation

  // `name` mirrors the list link's `?name=` query, which is what the header and toasts display.
  async gotoResults(orgId, checkId, { name = null } = {}) {
    const params = new URLSearchParams({ org_identifier: orgId });
    if (name) params.set('name', name);
    await this.page.goto(`/web/synthetics/${checkId}/results?${params.toString()}`);
    await expect(this.page.locator(this.locators.page)).toBeVisible({ timeout: 30000 });
    // Loaded means the runs query answered: either the table's pagination or the page-level empty state.
    const loaded = this.page.locator(this.locators.paginationInfo).or(this.page.locator(this.locators.pageEmpty));
    await expect(loaded.first()).toBeVisible({ timeout: 60000 });
    testLogger.navigation('Synthetics results', { checkId });
  }

  async gotoRunDetail(orgId, checkId, runId, executionId) {
    await this.page.goto(
      `/web/synthetics/${checkId}/results/run/${runId}/${executionId}?org_identifier=${orgId}`,
    );
    await expect(this.page.locator(this.locators.statusBadge)).toBeVisible({ timeout: 30000 });
    // The badge shows a default before the run query resolves; the skeleton is the real readiness signal.
    await expect(this.page.locator(this.locators.infoSkeleton)).toHaveCount(0, { timeout: 60000 });
    testLogger.navigation('Synthetics run detail', { checkId, runId, executionId });
  }

  // ------------------------------------------------------------------- actions

  async triggerRun() { await this.page.locator(this.locators.triggerRunButton).click(); }

  // The picker is auto-apply: choosing a period re-queries immediately.
  async setRelativeWindow(suffix) {
    await this.page.locator(this.locators.dateTimeButton).first().click();
    const btn = this.page.locator(this.relativePeriod(suffix));
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await this.page.keyboard.press('Escape');
  }

  async clickStatusFilter(key) {
    const item = this.page.locator(this.statusFilter(key));
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on', { timeout: 10000 });
  }

  async openStepsTab() { await this.page.locator(this.locators.stepsTab).click(); }

  async clickRunRow(index) {
    await this.page.locator(this.locators.runsTable).locator(`[data-test="o2-table-row-${index}"]`).click();
  }

  async openStepErrorFullscreen() {
    await this.page.locator(this.locators.viewErrorButton).first().click();
    await expect(this.page.locator(this.locators.errorFullscreen)).toBeVisible({ timeout: 15000 });
  }

  async openDetailStepsTab() { await this.page.locator(this.locators.detailStepsTab).click(); }
  async openDetailEvidenceTab() { await this.page.locator(this.locators.detailEvidenceTab).click(); }

  async openAttempt(value) {
    await selectOSelectOption(this.page, this.locators.attemptDropdown, value);
  }

  // ---------------------------------------------------------------- assertions

  // Anchored so "of 3" cannot pass on "of 30".
  async expectRunTotal(total) {
    await expect(this.page.locator(this.locators.paginationInfo))
      .toHaveText(new RegExp(`of ${total}\\+?\\s*$`), { timeout: 30000 });
  }

  async expectFirstPageRows(count) {
    await expect(this.page.locator(this.locators.runsTable).locator(this.locators.row))
      .toHaveCount(count, { timeout: 30000 });
  }

  async expectKpiVisible(key) {
    await expect(this.page.locator(this.kpi(key))).toBeVisible({ timeout: 30000 });
  }

  // The tile is label then value, so the value is anchored at the end.
  async expectKpiValue(key, value) {
    await expect(this.page.locator(this.kpi(key))).toHaveText(new RegExp(`\\D${value}\\s*$`), { timeout: 30000 });
  }

  async expectPageEmpty() {
    await expect(this.page.locator(this.locators.pageEmpty)).toBeVisible({ timeout: 30000 });
  }

  // Counts rows of the only table mounted in the active tab panel.
  async expectSectionRowCount(count) {
    await expect(this.page.locator(this.locators.runsSection).locator(this.locators.row))
      .toHaveCount(count, { timeout: 30000 });
  }

  async expectDetailStepRows(count) {
    await expect(this.page.locator(this.locators.row)).toHaveCount(count, { timeout: 30000 });
  }

  async expectStatusBadge(text) {
    await expect(this.page.locator(this.locators.statusBadge)).toHaveText(text, { timeout: 30000 });
  }

  async expectDrawerErrorSource(text) {
    const drawer = this.page.locator(this.locators.drawer);
    await expect(drawer).toBeVisible({ timeout: 30000 });
    await expect(drawer.locator(this.locators.errorSource)).toHaveText(text, { timeout: 30000 });
  }

  async expectPageContainsText(text) {
    await expect(this.page.locator(this.locators.page)).toContainText(text, { timeout: 30000 });
  }

  async expectErrorBanner(sourceLabel) {
    await expect(this.page.locator(this.locators.errorBanner)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.errorSource)).toHaveText(sourceLabel);
  }

  async expectFailedStepCard(rowId) {
    await expect(this.page.locator(this.stepErrorCard(rowId))).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.viewErrorButton)).toBeVisible();
    await expect(this.page.locator(this.locators.screenshotThumb)).toBeAttached();
  }

  async expectStepCardCount(rowId, count) {
    await expect(this.page.locator(this.stepErrorCard(rowId))).toHaveCount(count, { timeout: 30000 });
  }

  async expectEvidenceEmpty() {
    await expect(this.page.locator(this.locators.evidenceEmpty)).toBeVisible({ timeout: 30000 });
  }

  async expectAttemptSelectVisible() {
    await expect(this.page.locator(this.locators.attemptSelect)).toBeVisible({ timeout: 30000 });
  }

  async expectPrevNextDisabled() {
    await expect(this.page.locator(this.locators.prevButton)).toBeDisabled();
    await expect(this.page.locator(this.locators.nextButton)).toBeDisabled();
  }

  async expectTimelineVisible() {
    await expect(this.page.locator(this.locators.timeline)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.timelineScrollLeft)).toBeAttached();
    await expect(this.page.locator(this.locators.timelineScrollRight)).toBeAttached();
  }

  async expectStepsErrorNote() {
    await expect(this.page.locator(this.locators.stepsErrorNote)).toBeVisible({ timeout: 30000 });
  }

  async expectProtocolSummary() {
    await expect(this.page.locator(this.locators.protocolDetail)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.protocolAssertionsBadge)).toBeVisible({ timeout: 30000 });
  }

  async expectToast(text) {
    await expect(this.page.locator(this.locators.toastMessage).filter({ hasText: text }).first())
      .toBeVisible({ timeout: 20000 });
  }
}

export default SyntheticsResultsPage;
