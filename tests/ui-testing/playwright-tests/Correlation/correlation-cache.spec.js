// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — FE cache invalidation  [P1]  (enterprise-only)
 *
 * CACHE-01: semantic-group edits vs the FE 5-min module cache (KNOWN GAP —
 *   nothing calls clearCache() cross-page; marked test.fail so the suite stays
 *   green while the bug stands — an unexpected pass means it was fixed).
 * CACHE-02: identity-config edits saved through the settings UI must reach the
 *   next correlate from the logs page in the same SPA session (fixed behavior).
 *
 * Shared plumbing: ../utils/correlation-api-helpers.js + correlation-ui-helpers.js.
 */

const { test, expect } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const {
  createCorrelationOrg,
  deleteOrg,
  ingestLogs,
  saveIdentity,
  getIdentity,
  addSemanticGroup,
  waitForServices,
} = require("../utils/correlation-api-helpers.js");
const {
  BASE,
  withSetupPage,
  openLogsAndQuery,
  openFirstRowDialog,
  sniff,
  waitFor,
} = require("../utils/correlation-ui-helpers.js");
const PageManager = require("../../pages/page-manager.js");

test.describe.configure({ mode: "serial" });

test.describe("Correlation — FE cache invalidation", { tag: ["@correlation", "@P1"] }, () => {
  let org;

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
  });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    await withSetupPage(browser, async (page) => {
      org = await createCorrelationOrg(page, "corr_ui_cache");
      const save = await saveIdentity(page, org, {
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["host"],
        service_optional: false,
      });
      if (save.status !== 200) throw new Error(`cfg save failed: ${JSON.stringify(save.body)}`);
      await ingestLogs(page, org, "d_ui_logs", [
        { service: "duisvc", host: "duih1", dc: "eu-9", environment: "prod", message: "m1" },
        { service: "duisvc", host: "duih1", dc: "eu-9", environment: "prod", message: "m2" },
      ]);
      await waitForServices(
        page,
        org,
        (r) => r.some((row) => row.service_name === "duisvc"),
        "duisvc discovered",
      );
    });
  });

  test.afterAll(async ({ browser }) => {
    await withSetupPage(browser, (page) => deleteOrg(page, org));
  });

  async function correlateViaDialog(page) {
    const pm = new PageManager(page);
    await openFirstRowDialog(page);
    const metricsTab = pm.correlationDrawerPage.getCorrelatedMetricsTab();
    await metricsTab.waitFor({ state: "visible", timeout: 15_000 });
    await metricsTab.click();
    await page.waitForTimeout(5000);
  }

  async function closeDialog(page) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  }

  test("CACHE-01: semantic-group change within the 5-min cache window reaches the next correlate (KNOWN GAP) (TC-D3)", async ({
    page,
  }) => {
    // Expected to FAIL today: no cross-page clearCache() caller exists, so the
    // stale module cache wins. An unexpected pass = the invalidation got fixed.
    test.fail(
      true,
      "FE semantic-groups module cache is never invalidated cross-page (plan CACHE-01)",
    );

    const traffic = sniff(page);
    await openLogsAndQuery(page, org, "d_ui_logs");

    // Correlate #1 primes the module caches; 'dc' maps to no group yet.
    await correlateViaDialog(page);
    await waitFor(() => traffic.correlateRequests.length >= 1, { label: "first correlate request" });
    const req1 = traffic.correlateRequests[0];
    expect(req1.available_dimensions.datacenter).toBeUndefined();
    await closeDialog(page);

    // Server-side truth changes (API): new group maps 'dc' → datacenter, and the
    // identity config tracks it. The FE page is untouched.
    await addSemanticGroup(page, org, {
      id: "datacenter",
      display: "Datacenter",
      group: "Custom",
      fields: ["dc"],
    });
    const upd = await saveIdentity(page, org, {
      sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
      tracked_alias_ids: ["host", "datacenter"],
      service_optional: false,
    });
    expect(upd.status).toBe(200);

    // Correlate #2, same page, well inside the 5-min TTL.
    const before = traffic.correlateRequests.length;
    await correlateViaDialog(page);
    await waitFor(() => traffic.correlateRequests.length > before, {
      label: "second correlate request",
    });
    const req2 = traffic.correlateRequests[traffic.correlateRequests.length - 1];

    // Fresh-config behavior: the new group extracts dc=eu-9 into the request.
    expect(
      req2.available_dimensions.datacenter,
      "correlate must use fresh semantic groups (stale 5-min cache if undefined)",
    ).toBe("eu-9");
  });

  test("CACHE-02: identity-config saved via settings UI reaches the next correlate in the same SPA session (TC-D4)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const traffic = sniff(page);
    await openLogsAndQuery(page, org, "d_ui_logs");

    // Baseline correlate: 'environment' is extracted (default group) but the
    // identity config doesn't track it → filtered out of the request.
    await correlateViaDialog(page);
    await waitFor(() => traffic.correlateRequests.length >= 1, {
      label: "baseline correlate request",
    });
    const req1 = traffic.correlateRequests[0];
    expect(
      req1.available_dimensions.environment,
      "baseline: environment must be filtered out (not tracked)",
    ).toBeUndefined();
    await closeDialog(page);

    // SPA-navigate to settings (same JS runtime) and add 'environment' to
    // tracked aliases through the UI, then save.
    await page.goto(`${BASE}/web/settings/correlation?org_identifier=${org}`, {
      waitUntil: "domcontentloaded",
    });
    await pm.correlationSettingsPage.getDetectionRulesTab().click();
    await page.waitForTimeout(2500);

    const addFieldBtn = pm.correlationSettingsPage.getAddFieldButton();
    await addFieldBtn.waitFor({ state: "visible", timeout: 15_000 });
    await addFieldBtn.click();
    const fieldTrigger = pm.correlationSettingsPage.getSelectAFieldTrigger().first();
    await fieldTrigger.waitFor({ state: "visible", timeout: 10_000 });
    await fieldTrigger.click();
    await page.waitForTimeout(600);
    await page.keyboard.type("Environment");
    await page.waitForTimeout(800);
    await pm.correlationSettingsPage
      .getOptionByName(/Environment/i)
      .first()
      .click()
      .catch(async () => {
        await pm.correlationSettingsPage.getTextByPattern(/^Environment$/).first().click();
      });
    await page.waitForTimeout(500);
    const saveBtn = pm.correlationSettingsPage.getSaveConfigurationButton().first();
    await saveBtn.waitFor({ state: "visible", timeout: 10_000 });
    await saveBtn.click();
    await page.waitForTimeout(2500);

    // The save landed server-side (environment now part of the identity).
    const cfg = await getIdentity(page, org);
    const identityIds = new Set([
      ...(cfg.tracked_alias_ids || []),
      ...(cfg.sets || []).flatMap((s) => s.distinguish_by || []),
    ]);
    expect(identityIds.has("environment"), JSON.stringify(cfg)).toBe(true);

    // Back to logs (SPA route change, no reload) → correlate again.
    await openLogsAndQuery(page, org, "d_ui_logs");
    const before = traffic.correlateRequests.length;
    await correlateViaDialog(page);
    await waitFor(() => traffic.correlateRequests.length > before, {
      label: "post-save correlate request",
    });
    const req2 = traffic.correlateRequests[traffic.correlateRequests.length - 1];
    expect(
      req2.available_dimensions.environment,
      "identity-config save must invalidate the FE cache (clearIdentityConfigCache)",
    ).toBe("prod");
  });
});
