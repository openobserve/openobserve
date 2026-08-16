/**
 * Announcement Banners E2E
 *
 * Covers the Settings > General > "Announcement Banners" authoring surface (the
 * ODrawer editor + add/edit ODialog) and the live header strip rendered in
 * MainLayout on every page. The whole feature is enterprise-gated: the backend
 * routes are `#[cfg(feature = "enterprise")]` (OSS returns `{"banners":[]}` for
 * reads and 403 for config) and the frontend gates the strip + settings row on
 * `config.isEnterprise === 'true'`. Every test therefore detects the edition
 * from the header button and skips on OSS (mirrors edition-features.spec.js).
 *
 * Each test authors its own uniquely-named banner(s) against the `_meta` org and
 * asserts on that exact message, so parallel workers never collide on a shared
 * name. A single `afterAll` publishes an empty config to `_meta` so leftover
 * banners don't leak into other shards' screenshots.
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const META_ORG = '_meta';

async function goToMetaSettings(page, pm) {
  await pm.logoManagementPage.managementOrg(META_ORG);
  await page.goto(`${process.env.ZO_BASE_URL}/web/settings/general?org_identifier=${META_ORG}`);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('Announcement Banners testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let isEnterprise;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const edition = await pm.editionFeaturesPage.detectEdition();
    isEnterprise = edition === 'enterprise';
    testLogger.info(`Detected edition: ${edition}`);
  });

  test.afterAll(async ({ browser }) => {
    // Reset the _meta announcement config so a leftover "all organizations"
    // banner never leaks into other shards' screenshots. Basic auth mirrors the
    // global-setup credential (self-hosted API auth); OSS returns 403 and the
    // write is swallowed (the suite skips on OSS anyway).
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const auth = Buffer.from(
      `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`,
    ).toString('base64');
    const page = await browser.newPage();
    await page.request
      .put(`${baseUrl}/api/_meta/announcements/config`, {
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        data: { banners: [] },
      })
      .catch(() => {});
    await page.close();
  });

  test('should author a banner in Settings and render it in the app header', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P0'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    const message = `E2E banner ${Date.now()}`;
    await pm.announcementBannersPage.openEditor();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(message);
    await pm.announcementBannersPage.selectVariant('Warning');
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.expectBannerCard(0, message);
    await pm.announcementBannersPage.expectPreviewContains(message);
    await pm.announcementBannersPage.publish();

    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${META_ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectBannerBar('warning', message);
    testLogger.info('P0 authoring flow completed');
  });

  test('should dismiss a banner and keep it hidden across a reload', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P1'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    const message = `E2E dismiss ${Date.now()}`;
    await pm.announcementBannersPage.openEditor();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(message);
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.publish();

    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${META_ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectBannerBar('info', message);
    await pm.announcementBannersPage.dismissBanner('info', message);
    // The dismissal must be written to localStorage, or it would reappear below.
    await pm.announcementBannersPage.expectDismissalPersisted();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectBannerBarAbsent('info', message);
    testLogger.info('Dismiss + reload test completed');
  });

  test('should render a CTA link with the authored text and URL', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P1'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    const message = `E2E cta ${Date.now()}`;
    const ctaText = `Status page ${Date.now()}`;
    const ctaUrl = 'https://status.example.com';

    await pm.announcementBannersPage.openEditor();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(message);
    await pm.announcementBannersPage.toggleHasCta();
    await pm.announcementBannersPage.fillCtaText(ctaText);
    await pm.announcementBannersPage.fillCtaUrl(ctaUrl);
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.publish();

    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${META_ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectCtaLink(ctaText, ctaUrl);
    testLogger.info('CTA link test completed');
  });

  test('should order banners by severity and suppress promo while a critical banner is up', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P1'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    const runId = Date.now();
    const infoMsg = `notice ${runId}`;
    const warningMsg = `warning ${runId}`;
    const promoMsg = `promo ${runId}`;
    const criticalMsg = `outage ${runId}`;

    await pm.announcementBannersPage.openEditor();

    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(infoMsg);
    await pm.announcementBannersPage.clickApply();

    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(warningMsg);
    await pm.announcementBannersPage.selectVariant('Warning');
    await pm.announcementBannersPage.clickApply();

    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(promoMsg);
    await pm.announcementBannersPage.selectVariant('Promotion');
    await pm.announcementBannersPage.clickApply();

    await pm.announcementBannersPage.expectPreviewOrder([warningMsg, infoMsg, promoMsg]);
    await pm.announcementBannersPage.publish();

    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${META_ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectBannerBar('warning', warningMsg);
    await pm.announcementBannersPage.expectLiveBarOrder([warningMsg, infoMsg, promoMsg]);

    // Add a critical banner and re-publish: promo must disappear while the rest stay.
    await goToMetaSettings(page, pm);
    await pm.announcementBannersPage.openEditor();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(criticalMsg);
    await pm.announcementBannersPage.selectVariant('Critical');
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.publish();

    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${META_ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectBannerBar('critical', criticalMsg);
    await pm.announcementBannersPage.expectLiveBarOrder([criticalMsg, warningMsg, infoMsg]);
    await pm.announcementBannersPage.expectBannerBarAbsent('promo', promoMsg);
    testLogger.info('Severity ordering + promo suppression test completed');
  });

  test('should block a banner with an empty message and recover without hanging', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P1'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    await pm.announcementBannersPage.openEditor();
    await pm.announcementBannersPage.clickAddBanner();
    // Apply with an empty message — Zod validation must reject it and keep the dialog open.
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.expectDialogVisible();
    await pm.announcementBannersPage.expectMessageError('Enter the message people will see.');

    // Recovery path: fill a message, apply again, dialog closes.
    await pm.announcementBannersPage.fillMessage(`E2E recovery ${Date.now()}`);
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.expectDialogClosed();
    testLogger.info('Empty-message validation + recovery test completed');
  });

  test('should edit an existing banner and remove it (list round-trip)', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P2'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    const runId = Date.now();
    const firstMsg = `first ${runId}`;
    const secondMsg = `second ${runId}`;
    const editedMsg = `edited ${runId}`;

    await pm.announcementBannersPage.openEditor();

    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(firstMsg);
    await pm.announcementBannersPage.clickApply();

    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(secondMsg);
    await pm.announcementBannersPage.clickApply();

    await pm.announcementBannersPage.editBanner(0);
    await pm.announcementBannersPage.fillMessage(editedMsg);
    await pm.announcementBannersPage.clickApply();

    await pm.announcementBannersPage.removeBanner(1);
    await pm.announcementBannersPage.publish();

    // publish() reloads the list from the server — only the edited banner remains.
    await pm.announcementBannersPage.expectBannerCard(0, editedMsg);
    await pm.announcementBannersPage.expectCardAbsent(1);
    testLogger.info('Edit/remove round-trip test completed');
  });

  test('should render no dismiss control for a non-dismissible banner', {
    tag: ['@announcement-banners', '@all', '@enterprise', '@P2'],
  }, async ({ page }) => {
    test.skip(!isEnterprise, 'Runs only on Enterprise build');
    await goToMetaSettings(page, pm);

    const message = `E2E nodismiss ${Date.now()}`;
    await pm.announcementBannersPage.openEditor();
    await pm.announcementBannersPage.clickAddBanner();
    await pm.announcementBannersPage.fillMessage(message);
    await pm.announcementBannersPage.toggleDismissible(); // default on → off
    await pm.announcementBannersPage.clickApply();
    await pm.announcementBannersPage.publish();

    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${META_ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.announcementBannersPage.expectNoDismissControl('info', message);
    testLogger.info('Non-dismissible banner test completed');
  });
});
