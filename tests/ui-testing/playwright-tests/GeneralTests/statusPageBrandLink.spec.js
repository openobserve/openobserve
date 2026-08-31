/**
 * Status Page — "Powered by OpenObserve" Brand Link
 *
 * Every status page renders a static attribution link — an
 * <a href="https://openobserve.ai/" target="_blank" rel="noopener noreferrer">
 * wrapping an SVG mark and the "OpenObserve" wordmark — exactly twice (header
 * + footer) on two surfaces: the public visitor shell (status_page.html) and
 * the editor live preview (StatusPagePreview.vue). It is pure static markup:
 * no snapshot dependency, no edition gating, no user-triggerable logic.
 *
 * Verified here: the link exists in both places on both surfaces, points at
 * the right URL, opens safely in a new tab, and is absent for an unpublished
 * (draft) page. The link is target="_blank", so every assertion reads the
 * href/target/rel attributes rather than clicking into an external tab.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe('Status Page Powered-by Brand Link testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let orgId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    orgId = process.env['ORGNAME'] || 'default';
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('should render the Powered by OpenObserve brand link twice (header + footer) on the public page', {
    tag: ['@status-page-brand-link', '@all', '@statusPages'],
  }, async () => {
    testLogger.step('Seeding and publishing a status page');
    const { id, slug } = await pm.statusPagesPage.seedStatusPage(`Brand Link Test ${Date.now()}`);
    await pm.statusPagesPage.publishStatusPage(id, 1);

    testLogger.step(`Navigating to the public page for ${slug}`);
    await pm.statusPagesPage.gotoPublicStatusPage(slug);

    testLogger.step('Asserting both brand links render with safe new-tab attributes, mark, and wordmark');
    await pm.statusPagesPage.expectPublicBrandLinksComplete();

    testLogger.info('Public page brand link validation completed', { id, slug });
  });

  test('should render the brand link twice (header + footer) in the editor live preview', {
    tag: ['@status-page-brand-link', '@all', '@statusPages'],
  }, async () => {
    testLogger.step('Seeding a status page');
    const { id } = await pm.statusPagesPage.seedStatusPage(`Brand Link Preview Test ${Date.now()}`);

    testLogger.step('Navigating to the status page editor');
    await pm.statusPagesPage.gotoEditor(id);

    testLogger.step('Waiting for the editor to finish loading');
    await pm.statusPagesPage.expectEditorLoaded();

    testLogger.step('Asserting both preview brand links render with safe new-tab attributes');
    await pm.statusPagesPage.expectPreviewBrandLinksComplete();

    testLogger.info('Editor preview brand link validation completed', { id });
  });

  test('should distinguish header and footer brand links by scope on the public page', {
    tag: ['@status-page-brand-link', '@all', '@statusPages'],
  }, async () => {
    testLogger.step('Seeding and publishing a status page');
    const { id, slug } = await pm.statusPagesPage.seedStatusPage(`Brand Link Scope Test ${Date.now()}`);
    await pm.statusPagesPage.publishStatusPage(id, 1);

    testLogger.step(`Navigating to the public page for ${slug}`);
    await pm.statusPagesPage.gotoPublicStatusPage(slug);

    testLogger.step('Asserting one brand link in the header and one in the footer');
    await pm.statusPagesPage.expectHeaderFooterBrandLinkScope();

    testLogger.info('Header/footer brand link scope validation completed', { id, slug });
  });

  test('should return 404 for a draft status page (no public shell, no brand link)', {
    tag: ['@status-page-brand-link', '@all', '@statusPages'],
  }, async () => {
    testLogger.step('Seeding a draft status page (not published)');
    const { id, slug } = await pm.statusPagesPage.seedStatusPage(`Brand Link Draft Test ${Date.now()}`);

    testLogger.step(`Asserting /status/${slug} returns 404`);
    const status = await pm.statusPagesPage.getPublicStatusPageStatus(slug);
    expect(status).toBe(404);

    testLogger.info('Draft page 404 validation completed', { id, slug, status });
  });

  test('should render the brand link on a just-published page before the first snapshot builds', {
    tag: ['@status-page-brand-link', '@all', '@statusPages'],
  }, async () => {
    testLogger.step('Seeding and publishing a status page');
    const { id, slug } = await pm.statusPagesPage.seedStatusPage(`Brand Link Unbuilt Test ${Date.now()}`);
    await pm.statusPagesPage.publishStatusPage(id, 1);

    testLogger.step(`Navigating to the public page for ${slug} without waiting for the snapshot`);
    await pm.statusPagesPage.gotoPublicStatusPage(slug);

    testLogger.step('Asserting both brand links render immediately after DOM load');
    await pm.statusPagesPage.expectPublicBrandLinkCount(2);

    testLogger.info('Unbuilt page brand link validation completed', { id, slug });
  });
});
