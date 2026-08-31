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
    };
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
