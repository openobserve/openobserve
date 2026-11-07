// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
import { selectOSelectOption } from './oselectHelpers.js';
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class AlertFiringPage {
  constructor(page) {
    this.page = page;
    this.tabs = page.locator('[data-test="alert-section-tabs"]');
    this.table = page.locator('[data-test="alerts-firing-table"]');
    this.drawer = page.locator('[data-test="alerts-firing-drawer"]');
    this.drawerTitle = page.locator('[data-test="alerts-firing-drawer-title"]');
    this.banner = page.locator('[data-test="alerts-firing-stale-banner"]');
    this.retry = page.locator('[data-test="alerts-firing-retry"]');
    this.staleTag = page.locator('[data-test="alerts-firing-stale"]');
    this.refresh = page.locator('[data-test="alerts-firing-refresh"]');
    this.search = page.locator('[data-test="alerts-firing-search"] input');
    this.bulkAck = page.locator('[data-test="alerts-firing-bulk-ack"]');
    this.empty = page.locator('[data-test="alerts-firing-empty"]');
    this.historyEvents = page.locator('[data-test="alerts-firing-history-event"]');
    this.viewAll = page.locator('[data-test="alerts-firing-history-view-all"]');
    this.takeOver = page.locator('[data-test="alerts-firing-drawer-take-over"]');
    this.drawerAck = page.locator('[data-test="alerts-firing-drawer-ack"]');
    this.logs = page.locator('[data-test="alerts-firing-drawer-logs"]');
    this.ackChip = page.locator('[data-test="alerts-firing-drawer-ack-chip"]');
    this.toast = page.locator('[data-test^="o-toast-"][data-test-message]');
  }

  url(extra = '') {
    return `/web/alerts/firing?org_identifier=${getOrgIdentifier()}${extra}`;
  }

  async open(extra = '') {
    await this.page.goto(this.url(extra));
    await expect(this.table).toBeVisible({ timeout: 30000 });
  }

  chip(state) {
    return this.page.locator(`[data-test="alerts-firing-chip-${state}"]`);
  }

  tab(key) {
    return this.page.locator(`[data-test="alert-section-tab-${key}"]`);
  }

  tabOrder() {
    return this.tabs.locator('[data-test^="alert-section-tab-alert"]').evaluateAll((tabs) =>
      tabs
        .map((tab) => tab.getAttribute('data-test').replace('alert-section-tab-', ''))
        .filter((key) => !key.endsWith('-badge') && !key.endsWith('-lock')));
  }

  rowName(id) {
    return this.page.locator(`[data-test="alerts-firing-row-name-${id}"]`);
  }

  row(id) {
    return this.page.locator('tbody tr', { has: this.rowName(id) });
  }

  rowCheckbox(id) {
    return this.row(id).locator('label[data-test^="o2-table-select-"]');
  }

  async dragTab(from, to) {
    await this.tab(from).hover();
    await this.tab(from).locator('[data-otab-grip]').dragTo(this.tab(to), { targetPosition: { x: 4, y: 10 } });
  }

  // The no-folder list read that feeds the tab, its badge and the drawer.
  isListRequest(url) {
    return url.pathname.endsWith('/alerts') && !url.searchParams.has('folder');
  }
}
