const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Announcement Banners management UI.
 *
 * These tests cover the create / list / edit / validation / delete flow of the
 * operator-authored announcement banners, plus the live preview strip shown in
 * the settings list.
 *
 * NOTE: the whole feature is enterprise-gated. The settings route is only
 * registered when `config.isEnterprise === "true"`
 * (web/src/composables/shared/useManagementRoutes.ts:70), the tab only renders
 * for the meta org (web/src/components/settings/index.vue:95), and the backend
 * endpoints return 403 without the `enterprise` cargo feature
 * (src/handler/http/request/announcements/mod.rs:347-348). The OSS CI builds the
 * binary without `--features enterprise` and the frontend without
 * `VITE_OPENOBSERVE_ENTERPRISE`, so these tests are recorded as `fixme` with
 * their real assertion bodies intact — they go green as soon as an
 * enterprise-enabled environment (meta org) runs them.
 */
test.describe("Announcement Banners testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Announcement banners test setup completed');
  });

  test.fixme("should render the announcement banners settings page with the add banner action — not wired: web/src/composables/shared/useManagementRoutes.ts:70", { tag: ['@announcement-banners', '@all'] }, async ({ page }) => {
    testLogger.info('Navigating to announcement banners settings');
    await pm.announcementBannersPage.navigateToAnnouncements();
    await pm.announcementBannersPage.expectSettingsVisible();
    await pm.announcementBannersPage.expectAddBannerButtonVisible();
    testLogger.info('Announcement banners settings page rendered');
  });

  test.fixme("should create and publish a new announcement banner — not wired: web/src/composables/shared/useManagementRoutes.ts:70", { tag: ['@announcement-banners', '@all'] }, async ({ page }) => {
    const uniqueMessage = `E2E banner ${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    testLogger.info(`Creating announcement banner: ${uniqueMessage}`);

    await pm.announcementBannersPage.navigateToAnnouncements();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.expectEditorVisible();

    await pm.announcementBannersPage.fillMessage(uniqueMessage);
    await pm.announcementBannersPage.saveBanner();

    await pm.announcementBannersPage.expectRowVisible(0);
    await pm.announcementBannersPage.expectRowMessage(0, uniqueMessage);
    await pm.announcementBannersPage.expectRowStatus(0, 'Live');
    await pm.announcementBannersPage.expectLivePreviewContains(uniqueMessage);

    // Cleanup: remove the banner so sibling tests stay independent.
    await pm.announcementBannersPage.deleteBanner(0);
    await pm.announcementBannersPage.expectRowHidden(0);
    testLogger.info('Created, verified and cleaned up announcement banner');
  });

  test.fixme("should edit an existing announcement banner — not wired: web/src/composables/shared/useManagementRoutes.ts:70", { tag: ['@announcement-banners', '@all'] }, async ({ page }) => {
    const originalMessage = `E2E edit ${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const updatedMessage = `${originalMessage} updated`;
    testLogger.info('Editing announcement banner');

    await pm.announcementBannersPage.navigateToAnnouncements();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.expectEditorVisible();
    await pm.announcementBannersPage.fillMessage(originalMessage);
    await pm.announcementBannersPage.saveBanner();
    await pm.announcementBannersPage.expectRowVisible(0);

    await pm.announcementBannersPage.clickEditBanner(0);
    await pm.announcementBannersPage.expectEditorVisible();
    await pm.announcementBannersPage.fillMessage(updatedMessage);
    await pm.announcementBannersPage.saveBanner();

    await pm.announcementBannersPage.expectRowMessage(0, updatedMessage);

    // Cleanup.
    await pm.announcementBannersPage.deleteBanner(0);
    await pm.announcementBannersPage.expectRowHidden(0);
    testLogger.info('Edited, verified and cleaned up announcement banner');
  });

  test.fixme("should block saving a banner with an empty message — not wired: web/src/composables/shared/useManagementRoutes.ts:70", { tag: ['@announcement-banners', '@all'] }, async ({ page }) => {
    testLogger.info('Attempting to save a banner with an empty message');

    await pm.announcementBannersPage.navigateToAnnouncements();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.expectEditorVisible();

    await pm.announcementBannersPage.saveBanner();

    // Saving must not navigate away from the editor...
    await pm.announcementBannersPage.expectEditorVisible();
    // ...and the message field must be flagged as required.
    await pm.announcementBannersPage.expectMessageRequiredError();
    testLogger.info('Empty message was correctly rejected');
  });

  test.fixme("should delete an announcement banner after confirmation — not wired: web/src/composables/shared/useManagementRoutes.ts:70", { tag: ['@announcement-banners', '@all'] }, async ({ page }) => {
    const uniqueMessage = `E2E delete ${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    testLogger.info(`Deleting announcement banner: ${uniqueMessage}`);

    await pm.announcementBannersPage.navigateToAnnouncements();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.expectEditorVisible();
    await pm.announcementBannersPage.fillMessage(uniqueMessage);
    await pm.announcementBannersPage.saveBanner();
    await pm.announcementBannersPage.expectRowVisible(0);

    await pm.announcementBannersPage.deleteBanner(0);
    await pm.announcementBannersPage.expectRowHidden(0);
    testLogger.info('Announcement banner deleted after confirmation');
  });
});
