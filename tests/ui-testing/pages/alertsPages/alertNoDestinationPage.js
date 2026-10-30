// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
import { expandAlertSettingGroups, settleIntoView } from './alertSectionHelpers.js';
const {
  simpleAlert, createAlert, findAlertId, getAlert, deleteAlertInFolder,
} = require('../../playwright-tests/utils/alerts-api-helpers.js');

/**
 * AlertNoDestinationPage — the alert-form surfaces that change when an alert has
 * nowhere to send (#15267): the destinations status line, the notify-on-recovery
 * gate, and alert import. The editor itself is driven by AlertSaveQueryModePage.
 */
export class AlertNoDestinationPage {
  constructor(page) {
    this.page = page;
    this.createdAlertIds = [];
    this.locators = {
      destinationTrigger: '[data-test="alert-destinations-select-trigger"]',
      selectedOption: '[role="option"][aria-selected="true"]',
      noDestinationNote: '[data-test="alert-settings-destinations-note"]',
      destinationStatus: '[data-test="alert-settings-destinations-status"]',
      destinationError: '[data-test="alert-settings-destinations-error"]',
      recoveryToggle: '[data-test="alert-notify-on-recovery-toggle-btn"]',
      alertImportButton: '[data-test="alert-import"]',
      importFileTab: '[data-test="tab-import_json_file"]',
      importFileInput: '[data-test="alert-import-json-file-input-field"]',
      importSubmit: '[data-test="alert-import-json-btn"]',
      importEditor: '[data-test="query-editor"]:visible',
      importCreated: '[data-test="alert-import-creation-0-message"]',
      importErrors: '[data-test="alert-import-error-0"]',
    };
  }

  // ── API setup / verification ───────────────────────────────────────────

  /** Creates a canonical alert (with a destination) through the API and tracks it for cleanup. */
  async seedAlert(name) {
    const response = await createAlert(this.page, simpleAlert(name));
    expect(response.status(), await response.text()).toBe(200);
    return this.trackCreatedAlert(name);
  }

  /** Resolves the id of an alert the test just saved and tracks it for cleanup. */
  async trackCreatedAlert(name) {
    const id = await findAlertId(this.page, name);
    expect(id, `alert ${name} must exist after save`).toBeTruthy();
    this.createdAlertIds.push(id);
    return id;
  }

  async deleteCreatedAlerts() {
    for (const id of [...this.createdAlertIds].reverse()) {
      await deleteAlertInFolder(this.page, id, 'default');
    }
    this.createdAlertIds = [];
  }

  async expectStoredDestinations(alertId, expected) {
    expect((await getAlert(this.page, alertId)).destinations).toEqual(expected);
  }

  async expectAlertNotCreated(name) {
    expect(await findAlertId(this.page, name), `alert ${name} must not exist`).toBeFalsy();
  }

  /** An importable alert for this org; `destinations` undefined leaves the key out entirely. */
  importPayload(name, destinations) {
    const alert = { ...simpleAlert(name), org_id: getOrgIdentifier() };
    if (destinations === undefined) delete alert.destinations;
    else alert.destinations = destinations;
    return alert;
  }

  // ── form ───────────────────────────────────────────────────────────────

  /** Unpicks every selected destination; the multi-select toggles an option off when it is re-picked. */
  async clearDestinations() {
    await settleIntoView(this.page, this.page.locator(this.locators.destinationTrigger));
    await this.page.locator(this.locators.destinationTrigger).click();
    const selected = this.page.locator(this.locators.selectedOption);
    await expect(selected.first()).toBeVisible({ timeout: 15000 });
    while (await selected.count()) {
      await selected.first().click();
    }
    await this.page.keyboard.press('Escape');
  }

  async expectNoDestinationNote() {
    await expect(this.page.locator(this.locators.noDestinationNote)).toHaveText(
      'Optional. The alert still runs and records its history, but no destination is notified.',
      { timeout: 15000 },
    );
    await expect(this.page.locator(this.locators.destinationError)).toHaveCount(0);
  }

  async expectDestinationStatus() {
    await expect(this.page.locator(this.locators.destinationStatus)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.locators.noDestinationNote)).toHaveCount(0);
  }

  async expectRecoveryToggleDisabled() {
    await expandAlertSettingGroups(this.page, ['notify']);
    await expect(this.page.locator(this.locators.recoveryToggle)).toBeDisabled({ timeout: 15000 });
  }

  async expectRecoveryToggleEnabled() {
    await expandAlertSettingGroups(this.page, ['notify']);
    await expect(this.page.locator(this.locators.recoveryToggle)).toBeEnabled({ timeout: 15000 });
  }

  // ── import ─────────────────────────────────────────────────────────────

  async openImport() {
    await this.page.goto(`/web/alerts?org_identifier=${getOrgIdentifier()}&folder=default`);
    await this.page.locator(this.locators.alertImportButton).click();
    await expect(this.page.locator(this.locators.importSubmit)).toBeVisible({ timeout: 15000 });
  }

  /** Writes `alerts` to a temp file and imports it through the JSON-file tab. */
  async importAlerts(alerts) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alert-import-')), 'alerts.json');
    fs.writeFileSync(file, JSON.stringify(alerts));
    await this.page.locator(this.locators.importFileTab).click();
    await this.page.locator(this.locators.importFileInput).setInputFiles(file);
    // The file is read asynchronously; a submit before it lands imports nothing.
    await expect(this.page.locator(this.locators.importEditor)).toContainText(alerts[0].name, {
      timeout: 15000,
    });
    await this.page.locator(this.locators.importSubmit).click();
    testLogger.info('Submitted alert import', { count: alerts.length });
  }

  async expectImportCreated(name) {
    await expect(this.page.locator(this.locators.importCreated)).toContainText(
      `"${name}" created successfully`,
      { timeout: 20000 },
    );
  }

  async expectImportRejected(text) {
    await expect(this.page.locator(this.locators.importErrors)).toContainText(text, { timeout: 20000 });
    await expect(this.page.locator(this.locators.importCreated)).toHaveCount(0);
  }
}
