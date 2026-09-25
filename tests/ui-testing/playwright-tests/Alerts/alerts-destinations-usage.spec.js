const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

/**
 * Alert Destination Usage (Dependency Impact) E2E Tests
 *
 * Covers the read-only "Used by" reporting surface plus the delete-guard (409) and
 * in-dialog delete paths of the dependency-impact feature:
 *   - a used destination renders a per-kind alert count badge in the "Used by" cell;
 *   - clicking the cell opens the impact dialog listing the same downstream alerts;
 *   - an orphan destination shows the "Unused" chip and a "No consumers." dialog;
 *   - deleting an in-use destination surfaces the 409 "is used by" error toast and
 *     leaves the row in place;
 *   - deleting an alert from inside the dialog decrements the parent count in place.
 *
 * Data fixtures use the existing pm.apiCleanup helpers (see the setup contract);
 * every test seeds its own uniquely-named resources — a folder/destination/template/
 * stream for in-use destinations, or just a template + destination for the orphan
 * case — and tears them down in afterEach, so the suite stays fully parallel-safe.
 */

// Unique per-test seed prefix. Tests run in parallel against a shared org, so
// every test seeds its own resources and tears them down in afterEach.
const uniqueSeed = () =>
  `e2e_dest_usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Alert Destination Usage (Dependency Impact) testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;
  // Per-test seeded resources, reset in beforeEach so parallel workers never collide.
  let folderId = null;
  let streamName = null;
  let templateName = null;
  let destinationName = null;
  let standaloneTemplateName = null;
  let standaloneDestinationName = null;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    folderId = null;
    streamName = null;
    templateName = null;
    destinationName = null;
    standaloneTemplateName = null;
    standaloneDestinationName = null;
    testLogger.info("Test setup completed");
  });

  test.afterEach(async () => {
    // Cleanup ordering matters: alerts first (folder delete is rejected while it
    // still contains alerts), then destination/template, then folder, then stream.
    if (folderId) {
      const alerts = await pm.apiCleanup.fetchAlertsInFolder(folderId);
      for (const alert of alerts) {
        await pm.apiCleanup.deleteAlert(alert.alert_id, folderId);
      }
    }
    if (destinationName) await pm.apiCleanup.deleteAlertDestination(destinationName);
    if (templateName) await pm.apiCleanup.deleteAlertTemplate(templateName);
    if (folderId) await pm.apiCleanup.deleteFolder(folderId);
    if (streamName) await pm.apiCleanup.deleteStream(streamName);
    if (standaloneDestinationName) await pm.apiCleanup.deleteAlertDestination(standaloneDestinationName);
    if (standaloneTemplateName) await pm.apiCleanup.deleteAlertTemplate(standaloneTemplateName);
  });

  // Seed a destination used by `count` alerts (folder + stream + template +
  // destination + alerts), recording the resources for afterEach cleanup.
  async function seedUsedDestination(count) {
    const seed = uniqueSeed();
    const folder = await pm.apiCleanup.createAlertFolder(`${seed}_folder`);
    folderId = folder.folderId;
    const seeded = await pm.apiCleanup.seedAlertsInFolder(folderId, count, seed);
    destinationName = seeded.destinationName;
    templateName = seeded.templateName;
    streamName = seeded.streamName;
    return seeded;
  }

  // Navigate to the destinations list cold and scope it to one destination so the
  // "Used by" cell is unambiguously on screen (the list is paginated at 20 rows).
  async function navigateToListAndScope(name) {
    await pm.alertDestinationsPage.navigateToDestinations();
    await pm.alertDestinationsPage.waitForDestinationListReady();
    await pm.alertDestinationsPage.searchDestinations(name);
  }

  test(
    "should render the alert count badge in the Used by cell for a used destination",
    { tag: ["@alert-destination-usage", "@all"] },
    async ({ page }) => {
      testLogger.info("Seeding a destination used by 3 alerts");
      await seedUsedDestination(3);

      await navigateToListAndScope(destinationName);

      testLogger.info("Asserting the alert badge shows count 3 and no Unused chip");
      await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, "alert", 3);
      await pm.alertDestinationsPage.expectUnusedChipAbsent(destinationName);
      testLogger.info("Test completed");
    },
  );

  test(
    "should open the impact dialog and list the destination's downstream alerts without disagreement",
    { tag: ["@alert-destination-usage", "@all"] },
    async ({ page }) => {
      testLogger.info("Seeding a destination used by 3 alerts");
      const seeded = await seedUsedDestination(3);

      await navigateToListAndScope(destinationName);

      testLogger.info("Opening the impact dialog and asserting cell/dialog agreement");
      await pm.alertDestinationsPage.openImpactDialog(destinationName);
      await pm.alertDestinationsPage.expectImpactSubtitleToContain("Used by 3");
      await pm.alertDestinationsPage.expectAlertLaneRowCount(3);
      for (const alert of seeded.alerts) {
        await pm.alertDestinationsPage.expectAlertRowVisible(alert.name);
      }
      await pm.alertDestinationsPage.closeImpactDialog();
      testLogger.info("Test completed");
    },
  );

  test(
    "should show the Unused chip and a No consumers dialog for an orphan destination",
    { tag: ["@alert-destination-usage", "@all"] },
    async ({ page }) => {
      testLogger.info("Seeding an orphan destination (no referencing alerts)");
      const seed = uniqueSeed();
      standaloneTemplateName = `${seed}_tmpl`;
      standaloneDestinationName = `${seed}_dest`;
      await pm.apiCleanup.createAlertTemplate(standaloneTemplateName);
      await pm.apiCleanup.createAlertDestination(standaloneDestinationName, standaloneTemplateName);

      await navigateToListAndScope(standaloneDestinationName);

      testLogger.info("Asserting the Unused chip and no-consumers dialog");
      await pm.alertDestinationsPage.expectUnusedChipVisible(standaloneDestinationName);
      await pm.alertDestinationsPage.openImpactDialog(standaloneDestinationName);
      await pm.alertDestinationsPage.expectNoConsumersVisible();
      await pm.alertDestinationsPage.closeImpactDialog();
      testLogger.info("Test completed");
    },
  );

  test(
    "should surface the 409 in-use error when deleting a destination referenced by alerts",
    { tag: ["@alert-destination-usage", "@all"] },
    async ({ page }) => {
      testLogger.info("Seeding a destination used by 2 alerts");
      await seedUsedDestination(2);

      await navigateToListAndScope(destinationName);

      testLogger.info("Attempting delete and asserting the in-use error toast + retained row");
      await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
      await pm.alertDestinationsPage.expectInUseErrorToast();
      await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
      testLogger.info("Test completed");
    },
  );

  test(
    "should decrement the Used by count when an alert is deleted from the impact dialog",
    { tag: ["@alert-destination-usage", "@all"] },
    async ({ page }) => {
      testLogger.info("Seeding a destination used by 2 alerts");
      const seeded = await seedUsedDestination(2);
      const victimName = seeded.alerts[0].name;

      await navigateToListAndScope(destinationName);

      testLogger.info("Deleting one alert from the dialog and asserting the count decrements");
      await pm.alertDestinationsPage.openImpactDialog(destinationName);
      await pm.alertDestinationsPage.deleteEntityFromDialog(victimName);
      await pm.alertDestinationsPage.expectAlertRowAbsent(victimName);
      await pm.alertDestinationsPage.expectSuccessToastMessageContaining("deleted");
      await pm.alertDestinationsPage.closeImpactDialog();
      await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, "alert", 1);
      testLogger.info("Test completed");
    },
  );
});
