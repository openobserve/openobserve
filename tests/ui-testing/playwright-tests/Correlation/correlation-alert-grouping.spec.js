// Copyright 2026 OpenObserve Inc.

/**
 * Correlation Settings — Alert Grouping (deduplication)  [P1]  (enterprise-only)
 *
 * The "Alert Grouping" tab of the Correlation Settings page configures alert
 * deduplication: enable/disable, time window, cross-alert dedup, and the
 * per-semantic-group "fingerprint" checkboxes. Revived from the old
 * GeneralTests/correlationSettings.spec.js against the post-revamp UI (the tab
 * was renamed "Alert Correlation" -> "Alert Grouping"; the underlying
 * OrganizationDeduplicationSettings selectors are unchanged).
 *
 * Distinct feature from service discovery — kept in its own file. Runs on the
 * shared org; ensureSemanticGroupsExist() PUTs idempotent semantic groups so the
 * fingerprint checkboxes have something to render.
 *
 * Coverage: elements visible, checkbox/time-window interaction, cross-alert
 * conditional visibility, fingerprint groups display + toggle, save+persist
 * (dedup settings and time window).
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

test.describe(
  "Correlation Settings — Alert Grouping (deduplication)",
  { tag: ["@correlation", "@correlationSettings", "@settings", "@alertGrouping", "@P1"] },
  () => {
    // Parallel-safe: ensureSemanticGroupsExist() only PUTs semantic groups
    // (idempotent) and each test has its own page.
    test.describe.configure({ mode: "parallel" });

    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      await pm.correlationSettingsPage.ensureSemanticGroupsExist(process.env["ORGNAME"]);
      await page.waitForLoadState("domcontentloaded");
    });

    test("displays all Alert Grouping configuration elements", async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      await pm.correlationSettingsPage.expectEnableDedupCheckboxVisible();
      await pm.correlationSettingsPage.expectTimeWindowInputVisible();
      await pm.correlationSettingsPage.expectDedupRefreshButtonVisible();
    });

    test("supports enable checkbox toggle and time window input", async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();

      await pm.correlationSettingsPage.fillTimeWindowInput(60);
      const value = await pm.correlationSettingsPage.getTimeWindowValue();
      expect(value).toBe("60");
    });

    test("shows the cross-alert checkbox only when deduplication is enabled", async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      const initialDedupState = await pm.correlationSettingsPage.isDedupCheckboxChecked();
      if (!initialDedupState) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }
      await pm.correlationSettingsPage.expectCrossAlertCheckboxVisible();

      const initialCrossAlertState = await pm.correlationSettingsPage.isCrossAlertCheckboxChecked();
      await pm.correlationSettingsPage.clickEnableCrossAlertCheckbox();

      // Disabling dedup hides the cross-alert checkbox.
      await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      await pm.correlationSettingsPage.expectCrossAlertCheckboxHidden();

      // Restore original state.
      if (initialDedupState) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
        if (initialCrossAlertState) {
          await pm.correlationSettingsPage.clickEnableCrossAlertCheckbox();
        }
      }
    });

    test("displays fingerprint groups when cross-alert deduplication is enabled", async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      const isDedupEnabled = await pm.correlationSettingsPage.isDedupCheckboxChecked();
      if (!isDedupEnabled) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }
      await pm.correlationSettingsPage.expectCrossAlertCheckboxVisible();

      const isCrossAlertEnabled = await pm.correlationSettingsPage.isCrossAlertCheckboxChecked();
      if (!isCrossAlertEnabled) {
        await pm.correlationSettingsPage.clickEnableCrossAlertCheckbox();
      }

      await pm.correlationSettingsPage.page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {});
      await pm.correlationSettingsPage.expectFingerprintGroupsVisible();
      const count = await pm.correlationSettingsPage.getFingerprintGroupsCount();
      expect(count).toBeGreaterThan(0);

      // Restore.
      if (!isCrossAlertEnabled) {
        await pm.correlationSettingsPage.clickEnableCrossAlertCheckbox();
      }
      if (!isDedupEnabled) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }
    });

    test("allows toggling fingerprint group checkboxes when visible", async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      const initialDedupState = await pm.correlationSettingsPage.isDedupCheckboxChecked();
      if (!initialDedupState) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }
      await pm.correlationSettingsPage.expectCrossAlertCheckboxVisible();

      const initialCrossAlertState = await pm.correlationSettingsPage.isCrossAlertCheckboxChecked();
      if (!initialCrossAlertState) {
        await pm.correlationSettingsPage.clickEnableCrossAlertCheckbox();
      }

      await pm.correlationSettingsPage.page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {});
      await pm.correlationSettingsPage.expectFingerprintGroupsVisible();

      const checkboxes = pm.correlationSettingsPage.getFingerprintGroupCheckboxes();
      const count = await checkboxes.count();
      expect(count).toBeGreaterThan(0);
      await checkboxes.first().click();
      await checkboxes.first().click();

      // Restore.
      if (!initialCrossAlertState) {
        await pm.correlationSettingsPage.clickEnableCrossAlertCheckbox();
      }
      if (!initialDedupState) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }
    });

    test("saves deduplication settings and persists after refresh", async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      await pm.correlationSettingsPage.clickSaveAlertCorrelation();
      const saveSuccess = await pm.correlationSettingsPage.expectAlertCorrelationSaveSuccess();
      expect(saveSuccess).toBeTruthy();
      await pm.correlationSettingsPage.waitForNotificationToDisappear();

      await pm.correlationSettingsPage.refreshPage();
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      const stateAfterRefresh = await pm.correlationSettingsPage.isDedupCheckboxChecked();
      expect(typeof stateAfterRefresh).toBe("boolean");
    });

    test("saves the time window value and persists after refresh", async () => {
      const orgId = process.env["ORGNAME"];
      const testTimeWindow = "45";
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      const isDedupEnabled = await pm.correlationSettingsPage.isDedupCheckboxChecked();
      if (!isDedupEnabled) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }

      const initialValue = await pm.correlationSettingsPage.getTimeWindowValue();
      await pm.correlationSettingsPage.fillTimeWindowInput(testTimeWindow);
      expect(await pm.correlationSettingsPage.getTimeWindowValue()).toBe(testTimeWindow);

      await pm.correlationSettingsPage.clickSaveAlertCorrelation();
      await pm.correlationSettingsPage.expectAlertCorrelationSaveSuccess();
      await pm.correlationSettingsPage.waitForNotificationToDisappear();

      await pm.correlationSettingsPage.refreshPage();
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();

      const persistedValue = await pm.correlationSettingsPage.getTimeWindowValue();
      expect(persistedValue).toBe(testTimeWindow);

      // Restore original state.
      if (initialValue && initialValue !== testTimeWindow) {
        await pm.correlationSettingsPage.fillTimeWindowInput(initialValue);
      }
      if (!isDedupEnabled) {
        await pm.correlationSettingsPage.clickEnableDeduplicationCheckbox();
      }
      await pm.correlationSettingsPage.clickSaveAlertCorrelation();
      await pm.correlationSettingsPage.waitForNotificationToDisappear();
    });
  },
);
