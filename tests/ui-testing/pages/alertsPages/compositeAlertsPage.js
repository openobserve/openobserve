// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class CompositeAlertsPage {
  constructor(page) {
    this.page = page;
    this.locators = {
      typeSelect: '[data-test="add-alert-type-tab-composite"]',
      childSearch: '[data-test="alerts-composite-child-search-field"]',
      childOption: (id) => `[data-test="alerts-composite-child-option-${id}"]`,
      childCap: '[data-test="alerts-composite-child-cap"]',
      expressionSummary: '[data-test="alerts-composite-expression-summary"]',
      expressionUnused: '[data-test="alerts-composite-expression-unused"]',
      expressionAnd: '[data-test="alerts-composite-expression-and"]',
      expressionOr: '[data-test="alerts-composite-expression-or"]',
      expressionNot: '[data-test="alerts-composite-expression-not"]',
      expressionOpenGroup: '[data-test="alerts-composite-expression-open-group"]',
      expressionCloseGroup: '[data-test="alerts-composite-expression-close-group"]',
      advancedExpression: '[data-test="alerts-composite-expression-advanced-field"]',
      previewResult: '[data-test="alerts-composite-preview-result"]',
      previewRow: (id) => `[data-test="alerts-composite-preview-child-${id}"]`,
      save: '[data-test="add-alert-submit-btn"]',
      // `alert-list-tab-${tab.value}` (AlertList.vue) — was stale as `tab-composite`.
      listCompositeTab: '[data-test="alert-list-tab-composite"]',
      listBadge: (id) => `[data-test="alert-list-composite-badge-${id}"]`,
      listChildCount: (id) => `[data-test="alert-list-child-count-${id}"]`,
      listReferenceCount: (id) => `[data-test="alert-list-reference-count-${id}"]`,
      listNameCell: (name) => `[data-test="alert-list-${name}-name-cell"]`,
      listLastTriggeredCell: '[data-test="o2-table-cell-last_triggered_at"]',
      listLastSatisfiedCell: '[data-test="o2-table-cell-last_satisfied_at"]',
      cloneButton: (name) => `[data-test="alert-list-${name}-clone-alert"]`,
      cloneDialog: '[data-test="alert-list-form-dialog"]',
      cloneNameInputField: '[data-test="to-be-clone-alert-name-field"]',
      cloneStreamType: '[data-test="to-be-clone-stream-type"]',
      cloneStreamName: '[data-test="to-be-clone-stream-name"]',
      cloneSubmitButton: '[data-test="alert-list-form-dialog"] [data-test="o-dialog-primary-btn"]',
      cloneCancelButton: '[data-test="alert-list-form-dialog"] [data-test="o-dialog-secondary-btn"]',
      cloneFolderPicker: '[data-test="alert-list-form-dialog"] [data-test="alerts-index-dropdown-stream_type"]',
      toastMessage: '[data-test="o-toast-message"]',
      detailResult: '[data-test="alerts-composite-detail-result"]',
      detailExpression: '[data-test="alerts-composite-detail-expression"]',
      detailChildren: '[data-test="alerts-composite-detail-children-table"]',
      detailChild: (id) => `[data-test="alerts-composite-detail-child-${id}"]`,
      detailChildLink: (id) => `[data-test="alerts-composite-detail-child-link-${id}"]`,
      detailLevelAt: (id) => `[data-test="alerts-composite-detail-level-at-${id}"]`,
      detailEvaluationTimestamp: '[data-test="alerts-composite-detail-evaluated-at"]',
      timeline: '[data-test="alerts-composite-timeline"]',
      timelineWindow: (value) => `[data-test="alerts-composite-timeline-window-${value}"]`,
      timelineLevel: (id) => `[data-test="alerts-composite-timeline-level-${id}"]`,
      timelineEmpty: '[data-test="alerts-composite-timeline-empty"]',
      previewError: (code) => `[data-test="alerts-composite-preview-error-${code}"]`,
      missingJob: '[data-test="alerts-composite-detail-missing-job"]',
      referenceChip: '[data-test="alerts-composite-reference-chip"]',
      referenceConflict: '[data-test="alerts-composite-reference-conflict"]',
      referenceParent: (id) => `[data-test="alerts-composite-reference-parent-${id}"]`,
      referenceClose: '[data-test="alerts-composite-reference-close"]',
    };
  }

  listCompositeTab() {
    return this.page.locator(this.locators.listCompositeTab);
  }

  listBadge(id) {
    return this.page.locator(this.locators.listBadge(id));
  }

  listChildCount(id) {
    return this.page.locator(this.locators.listChildCount(id));
  }

  listReferenceCount(id) {
    return this.page.locator(this.locators.listReferenceCount(id));
  }

  listNameCell(name) {
    return this.page.locator(this.locators.listNameCell(name));
  }

  listRow(name) {
    return this.page.locator('tr', { has: this.page.locator(this.locators.listNameCell(name)) });
  }

  listLastTriggeredCell(name) {
    return this.listRow(name).locator(this.locators.listLastTriggeredCell);
  }

  listLastSatisfiedCell(name) {
    return this.listRow(name).locator(this.locators.listLastSatisfiedCell);
  }

  childNameCell(name) {
    return this.page.getByText(name, { exact: false });
  }

  expressionSummary() {
    return this.page.locator(this.locators.expressionSummary);
  }

  advancedExpression() {
    return this.page.locator(this.locators.advancedExpression);
  }

  childSearch() {
    return this.page.locator(this.locators.childSearch);
  }

  childOption(id) {
    return this.page.locator(this.locators.childOption(id));
  }

  childCap() {
    return this.page.locator(this.locators.childCap);
  }

  expressionUnused() {
    return this.page.locator(this.locators.expressionUnused);
  }

  save() {
    return this.page.locator(this.locators.save);
  }

  detailResult() {
    return this.page.locator(this.locators.detailResult);
  }

  detailExpression() {
    return this.page.locator(this.locators.detailExpression);
  }

  detailChildren() {
    return this.page.locator(this.locators.detailChildren);
  }

  detailChild(id) {
    return this.page.locator(this.locators.detailChild(id));
  }

  detailChildLink(id) {
    return this.page.locator(this.locators.detailChildLink(id));
  }

  detailLevelAt(id) {
    return this.page.locator(this.locators.detailLevelAt(id));
  }

  detailEvaluationTimestamp() {
    return this.page.locator(this.locators.detailEvaluationTimestamp);
  }

  timeline() {
    return this.page.locator(this.locators.timeline);
  }

  timelineWindow(value) {
    return this.page.locator(this.locators.timelineWindow(value));
  }

  timelineLevel(id) {
    return this.page.locator(this.locators.timelineLevel(id));
  }

  timelineEmpty() {
    return this.page.locator(this.locators.timelineEmpty);
  }

  previewError(code) {
    return this.page.locator(this.locators.previewError(code));
  }

  missingJob() {
    return this.page.locator(this.locators.missingJob);
  }

  referenceChip() {
    return this.page.locator(this.locators.referenceChip);
  }

  referenceParent(id) {
    return this.page.locator(this.locators.referenceParent(id));
  }

  referenceClose() {
    return this.page.locator(this.locators.referenceClose);
  }

  referenceConflict() {
    return this.page.locator(this.locators.referenceConflict);
  }

  expressionAnd() {
    return this.page.locator(this.locators.expressionAnd);
  }

  expressionOr() {
    return this.page.locator(this.locators.expressionOr);
  }

  expressionNot() {
    return this.page.locator(this.locators.expressionNot);
  }

  expressionOpenGroup() {
    return this.page.locator(this.locators.expressionOpenGroup);
  }

  expressionCloseGroup() {
    return this.page.locator(this.locators.expressionCloseGroup);
  }

  previewResult() {
    return this.page.locator(this.locators.previewResult);
  }

  renamedChildText(text) {
    return this.page.getByText(text);
  }

  bodyHasNoHorizontalOverflow() {
    return this.page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth);
  }

  async openCreate() {
    await this.page.goto(`/web/alerts/add?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  async openEdit(id) {
    await this.page.goto(`/web/alerts/edit/${id}?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  async openDetail(id) {
    await this.page.goto(`/web/alerts/detail/${id}?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  async chooseCompositeType() {
    await this.page.locator(this.locators.typeSelect).click();
  }

  async searchAndSelect(name, id) {
    await this.page.locator(this.locators.childSearch).fill(name);
    await this.page.locator(this.locators.childOption(id)).click();
  }

  async expectPreviewChild(id, pattern) {
    await expect(this.page.locator(this.locators.previewRow(id))).toContainText(pattern);
  }

  // ---- Composite clone dialog (AlertList.vue clone flow) ----

  cloneButton(name) {
    return this.page.locator(this.locators.cloneButton(name));
  }

  cloneDialog() {
    return this.page.locator(this.locators.cloneDialog);
  }

  cloneNameInputField() {
    return this.page.locator(this.locators.cloneNameInputField);
  }

  cloneStreamTypeSelect() {
    return this.page.locator(this.locators.cloneStreamType);
  }

  cloneStreamNameSelect() {
    return this.page.locator(this.locators.cloneStreamName);
  }

  cloneSubmitButton() {
    return this.page.locator(this.locators.cloneSubmitButton);
  }

  cloneCancelButton() {
    return this.page.locator(this.locators.cloneCancelButton);
  }

  cloneFolderPicker() {
    return this.page.locator(this.locators.cloneFolderPicker);
  }

  successToast(message) {
    return this.page.locator(this.locators.toastMessage).filter({ hasText: message }).first();
  }

  async openCompositeTab() {
    await this.listCompositeTab().click();
  }

  async clickCloneButton(name) {
    await this.cloneButton(name).click();
  }

  async fillCloneName(name) {
    await this.cloneNameInputField().fill(name);
  }

  async submitClone() {
    await this.cloneSubmitButton().click();
  }

  async cancelClone() {
    await this.cloneCancelButton().click();
  }

  async selectCloneFolder(folderId) {
    await this.cloneFolderPicker().locator('[data-test$="-trigger"]').first().click();
    const option = this.page
      .locator(`[data-test="alerts-index-dropdown-stream_type-option"][data-test-value="${folderId}"]`)
      .first();
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click();
  }

  async expectCloneDialogVisible() {
    await expect(this.cloneDialog()).toBeVisible({ timeout: 10000 });
  }

  async expectCloneDialogHidden() {
    await expect(this.cloneDialog()).toBeHidden({ timeout: 10000 });
  }

  async expectCloneNamePrefilled(name) {
    await expect(this.cloneNameInputField()).toHaveValue(name);
  }

  async expectStreamSelectsHidden() {
    await expect(this.cloneStreamTypeSelect()).toHaveCount(0);
    await expect(this.cloneStreamNameSelect()).toHaveCount(0);
  }

  async expectCloneSuccessToast() {
    await expect(this.successToast('Alert Cloned Successfully')).toBeVisible({ timeout: 30000 });
  }
}
