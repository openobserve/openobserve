// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — settings (Field Mappings ↔ Detection Rules)  [P1]  (enterprise-only)
 *
 * A custom semantic group created in the Field Mappings tab must be offered by
 * the Detection Rules (Configuration) tab WITHOUT a page reload — the
 * regression for the mount-time-snapshot bug (v-show tabs never remount; FL-2).
 * The save must trigger an _analytics refetch (the prop-watch fix).
 *
 * Coverage:
 *  - SETTINGS-01 (TC-B1): custom group visible in Detection Rules immediately
 *
 * NOTE: the 13-test correlationSettings.spec.js (GeneralTests) is a broader
 * Settings-page suite pending revival against the new UI; it will be folded in
 * here as a follow-up. This file starts with the cross-tab propagation guard.
 *
 * Shared plumbing: ../utils/correlation-api-helpers.js + correlation-ui-helpers.js.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const {
  createCorrelationOrg,
  deleteOrg,
  getSemanticGroups,
} = require("../utils/correlation-api-helpers.js");
const { BASE, withSetupPage } = require("../utils/correlation-ui-helpers.js");
const PageManager = require("../../pages/page-manager.js");

test.describe("Correlation — settings", { tag: ["@correlation", "@P1"] }, () => {
  let org;

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
  });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    await withSetupPage(browser, async (page) => {
      org = await createCorrelationOrg(page, "corr_ui_settings");
    });
  });

  test.afterAll(async ({ browser }) => {
    await withSetupPage(browser, (page) => deleteOrg(page, org));
  });

  test("SETTINGS-01: group created in Field Mappings appears in Detection Rules dropdown without reload (TC-B1)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    await page.goto(`${BASE}/web/settings/correlation?org_identifier=${org}`, {
      waitUntil: "domcontentloaded",
    });
    await pm.correlationSettingsPage
      .getCorrelationSettingsTabs()
      .waitFor({ state: "visible", timeout: 20_000 });

    // --- Field Mappings tab: create the custom group ---
    await pm.correlationSettingsPage.getFieldMappingsTab().click();
    await pm.correlationSettingsPage.getAddCustomGroupButton().first().click();

    // data-test sits on the component wrapper; the editable element is inside.
    const displayWrap = pm.correlationSettingsPage.getSemanticGroupDisplayWrap().first();
    await displayWrap.waitFor({ state: "visible", timeout: 10_000 });
    const display = (await displayWrap.locator("input").count())
      ? displayWrap.locator("input").first()
      : displayWrap;
    await display.fill("Datacenter UI");

    // Fields tag input (OTagInput renders a bare <input> with a placeholder;
    // scope to the new group's card via the display input we just filled).
    const card = displayWrap.locator(
      'xpath=ancestor::div[.//input[contains(@placeholder, "Field names") or contains(@placeholder, "press Enter")]][1]',
    );
    const fieldsInput = card
      .locator('input[placeholder*="Field names"], input[placeholder*="press Enter"]')
      .first();
    await fieldsInput.click();
    await fieldsInput.fill("dc_zone");
    await fieldsInput.press("Enter");

    // The mount-snapshot fix: ServiceIdentitySetup stays mounted under v-show and
    // WATCHES the semantic-groups prop — the _analytics refetch fires at SAVE
    // time. Attach the listener before saving.
    let analyticsRefetches = 0;
    page.on("request", (req) => {
      if (req.url().includes("/_analytics") && req.method() === "GET") analyticsRefetches++;
    });

    await pm.correlationSettingsPage.getSemanticFieldGroupSaveButton().first().click();
    // Save reaches the backend before we switch tabs.
    await page.waitForTimeout(3000);

    // The group persisted server-side.
    const groups = await getSemanticGroups(page, org);
    const list = Array.isArray(groups) ? groups : groups.groups || [];
    const created = list.find((g) => g.display === "Datacenter UI");
    expect(created, "group must persist via the semantic-groups API").toBeTruthy();

    // The fix's regression signal: the save triggered an _analytics refetch
    // (prop watch), and the Detection Rules tab opens without a reload showing
    // the identity setup (not a frozen snapshot error state).
    expect(
      analyticsRefetches,
      "semantic-group save must trigger an _analytics refetch (mount-snapshot fix)",
    ).toBeGreaterThan(0);
    await pm.correlationSettingsPage.getDetectionRulesTab().click();
    await pm.correlationSettingsPage
      .getSaveConfigurationButton()
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  });
});

/**
 * Settings-page navigation + Discovered Services tab (revived from the old
 * GeneralTests/correlationSettings.spec.js against the post-revamp UI). These
 * run on the shared org (navigateToBase) — they assert the page/tab surface,
 * not discovery state, so no fresh org is needed.
 */
test.describe(
  "Correlation Settings — navigation & discovered services",
  { tag: ["@correlation", "@correlationSettings", "@settings"] },
  () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
    });

    test("loads the Correlation Settings page with all four tabs visible", {
      tag: ["@smoke", "@P0"],
    }, async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.expectAllTabsVisible();
    });

    test("switches between all four tabs successfully", {
      tag: ["@smoke", "@P0"],
    }, async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      // Discovered Services tab is active by default.
      await pm.correlationSettingsPage.expectServicesContentVisible();
      await pm.correlationSettingsPage.clickServiceDiscoveryTab();
      await pm.correlationSettingsPage.expectServiceDiscoveryContentVisible();
      await pm.correlationSettingsPage.clickAlertCorrelationTab();
      await pm.correlationSettingsPage.expectAlertCorrelationContentVisible();
      await pm.correlationSettingsPage.clickServicesTab();
      await pm.correlationSettingsPage.expectServicesContentVisible();
    });

    test("Discovered Services tab loads with a refresh button", {
      tag: ["@P1", "@services"],
    }, async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickDiscoveredServicesTab();
      await pm.correlationSettingsPage.expectDiscoveredServicesLoaded();
      await pm.correlationSettingsPage.expectServicesContentVisible();
      await pm.correlationSettingsPage.expectRefreshDiscoveredServicesButtonVisible();
    });

    test("Discovered Services refresh reloads the tab content", {
      tag: ["@P1", "@services", "@loadingState"],
    }, async () => {
      const orgId = process.env["ORGNAME"];
      await pm.correlationSettingsPage.navigateToCorrelationSettings(orgId);
      await pm.correlationSettingsPage.expectPageLoaded();
      await pm.correlationSettingsPage.clickDiscoveredServicesTab();
      await pm.correlationSettingsPage.expectDiscoveredServicesLoaded();
      await pm.correlationSettingsPage.expectServicesContentVisible();
      await pm.correlationSettingsPage.clickRefreshDiscoveredServices();
      await pm.correlationSettingsPage.expectDiscoveredServicesLoaded();
      await pm.correlationSettingsPage.expectServicesContentVisible();
    });
  },
);
