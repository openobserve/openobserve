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
      listCompositeTab: '[data-test="tab-composite"]',
      listBadge: (id) => `[data-test="alert-list-composite-badge-${id}"]`,
      listChildCount: (id) => `[data-test="alert-list-child-count-${id}"]`,
      listReferenceCount: (id) => `[data-test="alert-list-reference-count-${id}"]`,
      detailResult: '[data-test="alerts-composite-detail-result"]',
      detailExpression: '[data-test="alerts-composite-detail-expression"]',
      detailChildren: '[data-test="alerts-composite-detail-children-table"]',
      detailChild: (id) => `[data-test="alerts-composite-detail-child-${id}"]`,
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
}
