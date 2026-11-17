// Copyright 2026 OpenObserve Inc.

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
const { getOrgIdentifier } = require("../utils/cloud-auth.js");
const {
  api,
  urls,
  uniq,
  simpleAlert,
  seedAlertFixturesOnce,
  createAlertFolder,
  findAlertIdInFolder,
  deleteAlertInFolder,
  deleteAlertFolder,
} = require("../utils/alerts-api-helpers.js");
const {
  calibrationFindingId,
  assertCalibrationFindingIdPin,
} = require("../../utils/calibrationFindingId.js");

const ZERO_ID = "0".repeat(64);

/** Real alerts and real dismissal routes; only the two digest reads are a fixture. */
test.describe("Alert Calibration dismiss and reopen", () => {
  // The Dismissed count is org-wide, so the flows run one at a time.
  test.describe.configure({ mode: "serial" });
  let pm;
  let org;
  let folderId;
  let alertId;
  let alertName;

  const dismissals = async (page, alertIdFilter) => {
    const query = alertIdFilter ? `?state=active&alert_id=${alertIdFilter}` : "?state=active";
    const response = await api(page, "get", `${urls().v2}/alert_calibration/dismissals${query}`);
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };

  const dismissViaApi = (page, findingId, body) =>
    api(page, "post", `${urls().v2}/alert_calibration/findings/${findingId}/dismiss`, body);

  const reopenViaApi = (page, id, expectedRevision) =>
    api(page, "post", `${urls().v2}/alert_calibration/dismissals/${id}/reopen`, {
      expected_revision: expectedRevision,
    });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    assertCalibrationFindingIdPin();
    await navigateToBase(page);
    pm = new PageManager(page);
    const buildType = await pm.alertCalibrationPage.detectBuildType();
    test.skip(
      buildType !== "enterprise" && buildType !== "cloud",
      `Alert calibration is enterprise/cloud-gated (build: ${buildType})`,
    );
    org = getOrgIdentifier();
    const config = await api(page, "get", `${urls().v2}/alert_calibration/config`);
    if (config.status() === 404) {
      const saved = await api(page, "put", `${urls().v2}/alert_calibration/config`, {
        enabled: true,
      });
      expect(saved.status(), await saved.text()).toBe(200);
    }
    await seedAlertFixturesOnce(page);
    folderId = await createAlertFolder(page, uniq("cal_dismiss"));
    alertName = uniq("ops_cpu");
    const created = await api(page, "post", `${urls().v2}/alerts?folder=${folderId}`, {
      ...simpleAlert(alertName),
      destinations: [],
    });
    expect(created.status(), await created.text()).toBe(200);
    alertId = await findAlertIdInFolder(page, alertName, folderId);
    expect(alertId, "the fixture alert must exist").toBeTruthy();
    testLogger.info("Test setup completed", { alertId, folderId });
  });

  test.afterEach(async ({ page }) => {
    if (alertId) {
      const open = await dismissals(page, alertId).catch(() => ({ items: [] }));
      for (const row of open.items) await reopenViaApi(page, row.id, row.revision);
      await deleteAlertInFolder(page, alertId, folderId);
    }
    await deleteAlertFolder(page, folderId);
    alertId = null;
  });

  test(
    "E1 dismisses from the dashboard row and lists it under Dismissed",
    { tag: ["@alert-calibration", "@all"] },
    async ({ page }) => {
      const findingId = calibrationFindingId(org, "no_destination", "alert", alertId);
      const before = (await dismissals(page)).total;
      await pm.alertCalibrationPage.routeDigestFixture(org, { alertId, alertName, findingId });
      await pm.alertCalibrationPage.navigateToDashboard();
      await pm.alertCalibrationPage.openNoDestinationGroup();
      await pm.alertCalibrationPage.openDismissDialog(alertId);
      await pm.alertCalibrationPage.fillDismissForm({ reason: "known_issue", duration: "30" });
      await pm.alertCalibrationPage.submitDismiss();

      await pm.alertCalibrationPage.expectDialogClosed();
      await pm.alertCalibrationPage.expectRowGone(alertId);
      await pm.alertCalibrationPage.expectDismissedCount(before + 1);
      await pm.alertCalibrationPage.showDismissed();
      const table = page.locator(pm.alertCalibrationPage.dismiss.dismissedTable);
      await expect(table).toContainText(alertName);
      await expect(table).toContainText("Will fix later");

      const stored = await dismissals(page, alertId);
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0]).toMatchObject({
        id: findingId,
        state: "active",
        revision: 1,
        reason: "known_issue",
        duration_days: 30,
      });
    },
  );

  test(
    "E2 Other with an empty note sends nothing",
    { tag: ["@alert-calibration", "@all"] },
    async ({ page }) => {
      const findingId = calibrationFindingId(org, "no_destination", "alert", alertId);
      await pm.alertCalibrationPage.routeDigestFixture(org, { alertId, alertName, findingId });
      const posts = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().includes("/dismiss")) posts.push(request);
      });
      await pm.alertCalibrationPage.navigateToDashboard();
      await pm.alertCalibrationPage.openNoDestinationGroup();
      await pm.alertCalibrationPage.openDismissDialog(alertId);
      await pm.alertCalibrationPage.fillDismissForm({ reason: "other", note: "" });
      await pm.alertCalibrationPage.submitDismiss();
      await expect(page.locator(pm.alertCalibrationPage.dismiss.dialog)).toContainText(
        "Add a note when the reason is Other.",
      );
      expect(posts).toHaveLength(0);
    },
  );

  test(
    "E3 a finding whose identity no longer matches is an amber conflict that keeps the form",
    { tag: ["@alert-calibration", "@all"] },
    async ({ page }) => {
      await pm.alertCalibrationPage.routeDigestFixture(org, {
        alertId,
        alertName,
        findingId: ZERO_ID,
      });
      await pm.alertCalibrationPage.navigateToDashboard();
      await pm.alertCalibrationPage.openNoDestinationGroup();
      await pm.alertCalibrationPage.openDismissDialog(alertId);
      await pm.alertCalibrationPage.fillDismissForm({
        reason: "not_useful",
        note: "Owned by the ingest team",
      });
      const answer = page.waitForResponse((r) => r.url().includes(`/findings/${ZERO_ID}/dismiss`));
      await pm.alertCalibrationPage.submitDismiss();
      expect((await answer).status()).toBe(409);
      await pm.alertCalibrationPage.expectNotice(
        "warning",
        "This finding's dismissal changed while you were editing.",
      );
      await expect(page.locator(pm.alertCalibrationPage.dismiss.note)).toHaveValue(
        "Owned by the ingest team",
      );
    },
  );

  test(
    "E4 a stale reopen warns and refreshes, and the next reopen succeeds",
    { tag: ["@alert-calibration", "@all"] },
    async ({ page }) => {
      const findingId = calibrationFindingId(org, "no_destination", "alert", alertId);
      const before = (await dismissals(page)).total;
      await pm.alertCalibrationPage.routeDigestFixture(org, { alertId, alertName, findingId });
      await pm.alertCalibrationPage.navigateToDashboard();
      await pm.alertCalibrationPage.openNoDestinationGroup();
      await pm.alertCalibrationPage.openDismissDialog(alertId);
      await pm.alertCalibrationPage.fillDismissForm({ reason: "expected" });
      await pm.alertCalibrationPage.submitDismiss();
      await pm.alertCalibrationPage.expectDialogClosed();
      await pm.alertCalibrationPage.showDismissed();
      await expect(page.locator(pm.alertCalibrationPage.dismiss.dismissedTable)).toContainText(
        alertName,
      );

      // Another session reopens and dismisses again, so the row on screen is two revisions old.
      expect((await reopenViaApi(page, findingId, 1)).status()).toBe(200);
      const again = await dismissViaApi(page, findingId, {
        rule_id: "no_destination",
        scope_kind: "alert",
        scope_key: alertId,
        reason: "expected",
        duration_days: 90,
      });
      expect(again.status(), await again.text()).toBe(200);
      expect((await again.json()).revision).toBe(3);

      const mine = page
        .locator("tr")
        .filter({ hasText: alertName })
        .locator(pm.alertCalibrationPage.dismiss.reopen);
      await mine.click();
      await pm.alertCalibrationPage.expectToast(
        "warning",
        "This dismissal changed since you loaded it.",
      );
      await mine.click();
      await pm.alertCalibrationPage.expectToast(
        "success",
        "Undone. The finding is shown again.",
      );
      await pm.alertCalibrationPage.expectDismissedCount(before);
      if (before === 0) {
        await expect(page.locator(pm.alertCalibrationPage.dismiss.dismissedEmpty)).toBeVisible();
      }
      expect((await dismissals(page, alertId)).items).toHaveLength(0);
    },
  );

  test(
    "E5 a failed save keeps the entries and the retry succeeds",
    { tag: ["@alert-calibration", "@all"] },
    async ({ page }) => {
      const findingId = calibrationFindingId(org, "no_destination", "alert", alertId);
      await pm.alertCalibrationPage.routeDigestFixture(org, { alertId, alertName, findingId });
      const failOnce = /\/alert_calibration\/findings\/[0-9a-f]{64}\/dismiss$/;
      await page.route(failOnce, (route) =>
        route.fulfill({ status: 500, json: { code: 500, message: "Saving the dismissal failed." } }),
      );
      await pm.alertCalibrationPage.navigateToDashboard();
      await pm.alertCalibrationPage.openNoDestinationGroup();
      await pm.alertCalibrationPage.openDismissDialog(alertId);
      await pm.alertCalibrationPage.fillDismissForm({
        reason: "known_issue",
        note: "Owned by the ingest team",
        duration: "180",
      });
      await pm.alertCalibrationPage.submitDismiss();
      await pm.alertCalibrationPage.expectNotice(
        "error",
        "The dismissal couldn't be saved. Your entries are kept; try again.",
      );
      await expect(page.locator(pm.alertCalibrationPage.dismiss.note)).toHaveValue(
        "Owned by the ingest team",
      );

      await page.unroute(failOnce);
      await pm.alertCalibrationPage.submitDismiss();
      await pm.alertCalibrationPage.expectDialogClosed();
      const stored = await dismissals(page, alertId);
      expect(stored.items[0]).toMatchObject({
        id: findingId,
        reason: "known_issue",
        note: "Owned by the ingest team",
        duration_days: 180,
      });
    },
  );

  test(
    "E6 dismisses from the digest detail card, folds it in place, and reopens it",
    { tag: ["@alert-calibration", "@all"] },
    async ({ page }) => {
      const findingId = calibrationFindingId(org, "no_destination", "alert", alertId);
      const run = await pm.alertCalibrationPage.routeDigestFixture(org, {
        alertId,
        alertName,
        findingId,
      });
      await pm.alertCalibrationPage.navigateToDigest(run);
      const { dismiss } = pm.alertCalibrationPage;
      const card = page.locator(dismiss.card);
      const fold = card.locator(dismiss.cardFold);
      await expect(fold).toHaveCount(0);
      await card.locator(dismiss.cardDismiss).click();
      await expect(page.locator(dismiss.dialog)).toBeVisible({ timeout: 10000 });
      await pm.alertCalibrationPage.fillDismissForm({ reason: "known_issue", duration: "30" });
      await pm.alertCalibrationPage.submitDismiss();
      await pm.alertCalibrationPage.expectDialogClosed();

      await expect(fold).toContainText("Dismissed by", { timeout: 15000 });
      await expect(fold).toContainText("Will fix later");
      await expect(fold).toContainText("Hidden until");
      await expect(card.locator(dismiss.cardBadge)).toHaveText("Dismissed");
      await expect(card.locator(dismiss.cardDismiss)).toHaveCount(0);
      expect((await dismissals(page, alertId)).items).toHaveLength(1);

      await fold.locator(dismiss.cardReopen).click();
      await pm.alertCalibrationPage.expectToast(
        "success",
        "Undone. The finding is shown again.",
      );
      await expect(fold).toHaveCount(0, { timeout: 15000 });
      await expect(card.locator(dismiss.cardBadge)).toHaveCount(0);
      await expect(card.locator(dismiss.cardDismiss)).toBeVisible();
      // The dialog closed itself before the fold, so unfolding must not open it again.
      await expect(page.locator(dismiss.dialog)).toBeHidden();
      expect((await dismissals(page, alertId)).items).toHaveLength(0);
    },
  );
});
