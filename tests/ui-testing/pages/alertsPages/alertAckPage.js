// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class AlertAckPage {
  constructor(page) {
    this.page = page;
    this.detail = {
      title: '[data-test="alerts-alertdetail-title"]',
      ack: '[data-test="alerts-alertdetail-ack"]',
      ackChip: '[data-test="alerts-alertdetail-ack-chip"]',
      mutedChip: '[data-test="alerts-alertdetail-muted-chip"]',
      ackMenu: '[data-test="alerts-alertdetail-ack-menu"]',
      unack: '[data-test="alerts-alertdetail-unack"]',
      takeOver: '[data-test="alerts-alertdetail-take-over"]',
      mute: '[data-test="alerts-alertdetail-mute"]',
      extend: '[data-test="alerts-alertdetail-extend"]',
      endMute: '[data-test="alerts-alertdetail-end-mute"]',
      groupsTab: '[data-test="alerts-alertdetail-tab-groups"]',
      groupsTable: '[data-test="alerts-alertgroupstable-table"]',
    };
    this.dialog = {
      root: '[data-test="quick-mute-dialog"]',
      preset: (key) => `[data-test="quick-mute-preset-${key}"]`,
      untilClearHint: '[data-test="quick-mute-until-clear-hint"]',
      endsIn: '[data-test="quick-mute-ends-in"]',
      confirm24h: '[data-test="quick-mute-confirm-24h"]',
      groups: '[data-test="quick-mute-groups"]',
      groupsThis: '[data-test="quick-mute-groups-this"]',
      groupsAll: '[data-test="quick-mute-groups-all"]',
      groupSelect: '[data-test="quick-mute-group-select"]',
      reason: '[data-test="quick-mute-reason"] textarea',
      primary: '[data-test="quick-mute-dialog"] [data-test="o-dialog-primary-btn"]',
      secondary: '[data-test="quick-mute-dialog"] [data-test="o-dialog-secondary-btn"]',
    };
    this.toast = '[data-test^="o-toast-"]';
  }

  async openDetail(alertId) {
    await this.page.goto(`/web/alerts/detail/${alertId}?org_identifier=${getOrgIdentifier()}&folder=default`);
    await expect(this.page.locator(this.detail.title)).toBeVisible({ timeout: 30000 });
  }

  async openList() {
    await this.page.goto(`/web/alerts?org_identifier=${getOrgIdentifier()}&folder=default`);
    await expect(this.page.locator('[data-test="alert-summary-acknowledged"]')).toBeVisible({ timeout: 30000 });
  }

  async openDowntimes() {
    await this.page.goto(`/web/downtimes?org_identifier=${getOrgIdentifier()}`);
    await expect(this.page.locator('[data-test="downtime-list-page"]')).toBeVisible({ timeout: 30000 });
  }

  async reload() {
    await this.page.reload();
    await expect(this.page.locator(this.detail.title)).toBeVisible({ timeout: 30000 });
  }

  ackButton() { return this.page.locator(this.detail.ack); }
  ackChip() { return this.page.locator(this.detail.ackChip); }
  mutedChip() { return this.page.locator(this.detail.mutedChip); }

  async acknowledgeFromHeader() { await this.ackButton().click(); }

  async openAckMenu() { await this.page.locator(this.detail.ackMenu).click(); }

  async unackFromHeader() {
    await this.openAckMenu();
    await this.page.locator(this.detail.unack).click();
  }

  async takeOverFromHeader() {
    await this.openAckMenu();
    await this.page.locator(this.detail.takeOver).click();
  }

  async openHeaderMute() { await this.page.locator(this.detail.mute).click(); }

  async headerMute(key) {
    await this.openHeaderMute();
    await this.page.locator(`[data-test="alerts-alertdetail-mute-${key}"]`).click();
  }

  async headerExtend(key) {
    await this.page.locator(this.detail.extend).click();
    await this.page.locator(`[data-test="alerts-alertdetail-extend-${key}"]`).click();
  }

  async headerEndMute() { await this.page.locator(this.detail.endMute).click(); }

  async openGroupsTab() {
    await this.page.locator(this.detail.groupsTab).click();
    await expect(this.page.locator(this.detail.groupsTable)).toBeVisible({ timeout: 15000 });
  }

  groupOutcome(key) { return this.page.locator(`[data-test="alerts-alertgroupstable-outcome-${key}"]`); }
  groupMuted(key) { return this.page.locator(`[data-test="alerts-alertgroupstable-muted-${key}"]`); }

  async openGroupMenu(key) { await this.page.locator(`[data-test="alerts-alertgroupstable-menu-${key}"]`).click(); }

  async groupAction(key, action) {
    await this.openGroupMenu(key);
    await this.page.locator(`[data-test="alerts-alertgroupstable-${action}-${key}"]`).click();
  }

  async groupMute(key, preset) {
    await this.openGroupMenu(key);
    await this.page.locator(`[data-test="alerts-alertgroupstable-mute-${key}-${preset}"]`).click();
  }

  listRow(name) { return this.page.locator('tr', { has: this.page.locator(`[data-test="alert-list-${name}-more-options"]`) }); }
  listAcked(name) { return this.page.locator(`[data-test="alert-list-${name}-acked"]`); }
  listMuted(name) { return this.page.locator(`[data-test="alert-list-${name}-muted"]`); }

  async openRowMenu(name) { await this.page.locator(`[data-test="alert-list-${name}-more-options"]`).click(); }

  async rowAcknowledge(name) {
    await this.openRowMenu(name);
    await this.page.locator(`[data-test="alert-list-${name}-acknowledge"]`).click();
  }

  async rowMute(name, preset) {
    await this.openRowMenu(name);
    await this.page.locator(`[data-test="alert-list-${name}-mute-${preset}"]`).click();
  }

  async rowExtend(name, preset) {
    await this.openRowMenu(name);
    await this.page.locator(`[data-test="alert-list-${name}-extend-${preset}"]`).click();
  }

  async rowEndMute(name) {
    await this.openRowMenu(name);
    await this.page.locator(`[data-test="alert-list-${name}-end-mute"]`).click();
  }

  async clickAcknowledgedTile() { await this.page.locator('[data-test="alert-summary-acknowledged"]').click(); }

  async searchList(text) {
    const search = this.page.locator('[data-test="alert-list-search-input"]');
    if (await search.count()) await search.fill(text);
  }

  dialogRoot() { return this.page.locator(this.dialog.root); }

  async expectDialogOpen() { await expect(this.dialogRoot()).toBeVisible({ timeout: 15000 }); }

  presetItem(key) { return this.page.locator(this.dialog.preset(key)); }

  async choosePreset(key) { await this.presetItem(key).click(); }

  async dialogSubmit() { await this.page.locator(this.dialog.primary).click(); }

  async dialogSecondary() { await this.page.locator(this.dialog.secondary).click(); }

  async chooseGroupScope(scope) {
    await this.page.locator(scope === 'all' ? this.dialog.groupsAll : this.dialog.groupsThis).click();
  }

  async fillReason(text) { await this.page.locator(this.dialog.reason).fill(text); }

  downtimeCell(id, cell) { return this.page.locator(`[data-test="downtime-list-${id}-${cell}"]`); }

  async downtimeAction(id, action) {
    await this.page.locator(`[data-test="downtime-list-${id}-more"]`).click();
    await this.page.locator(`[data-test="downtime-list-${id}-${action}"]`).click();
  }

  async chooseDowntimeType(value) { await this.page.locator(`[data-test="downtime-list-type-${value}"]`).click(); }

  async refreshDowntimes() { await this.page.locator('[data-test="downtime-list-refresh"]').click(); }

  async expectToast(text) {
    await expect(this.page.locator(this.toast).filter({ hasText: text }).first()).toBeVisible({ timeout: 15000 });
  }
}
