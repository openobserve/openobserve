// configBootstrap.spec.js
//
// Covers the config endpoint split: the unauthenticated bootstrap `GET /config`
// (login-page fields only) vs the authenticated, org-scoped full config
// `GET /api/{org_id}/config` (version, build_date, query defaults, feature flags).
//
// Security contract: the unauthenticated bootstrap must expose EXACTLY the
// login-page keys (no version / license_expiry / instance). Source of truth:
// src/api/http/src/handler/http/router/mod.rs:1626-1677 (bootstrap) and
// 1700-1745 (full config).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier, authedRequest, isCloudEnvironment } = require('../utils/cloud-auth.js');

// Exact key set the unauthenticated bootstrap must expose (load-bearing security
// contract — pinned by the backend unit test at router/mod.rs:1626-1677). Any key
// added to ConfigBootstrapResponse must update this list in lockstep.
const BOOTSTRAP_EXACT_KEYS = [
  'build_type',
  'commit_hash',
  'custom_hide_self_logo',
  'custom_logo_dark_img',
  'custom_logo_img',
  'custom_logo_text',
  'native_login_enabled',
  'rum',
  'sso_enabled',
  'telemetry_enabled',
];

test.describe('Config Endpoint Split: Login Bootstrap vs Authenticated Full Config testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('unauthenticated bootstrap exposes exactly the login-page keys and no version/instance', {
    tag: ['@config-bootstrap', '@all', '@api', '@P0'],
  }, async ({ request }) => {
    testLogger.info('Requesting GET /config with no auth headers (fresh request context)');
    const resp = await request.get(`${process.env['ZO_BASE_URL']}/config`);
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(Object.keys(body).sort()).toEqual([...BOOTSTRAP_EXACT_KEYS].sort());
    expect(['opensource', 'enterprise']).toContain(body.build_type);
    expect(typeof body.commit_hash).toBe('string');
    expect(body.commit_hash.length).toBeGreaterThan(0);
    expect(body.version).toBeUndefined();
    expect(body.license_expiry).toBeUndefined();
    expect(body.instance).toBeUndefined();
    testLogger.info('Bootstrap exact-key contract verified');
  });

  test('authenticated full config returns version and reserved keywords without instance', {
    tag: ['@config-bootstrap', '@all', '@api', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Requesting GET /api/{org}/config with the shared authenticated session');
    const org = getOrgIdentifier();
    const resp = await authedRequest(page, 'get', `${process.env['ZO_BASE_URL']}/api/${org}/config`);
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(['opensource', 'enterprise']).toContain(body.build_type);
    expect(Array.isArray(body.sql_reserved_keywords)).toBe(true);
    expect(body.sql_reserved_keywords.length).toBeGreaterThan(0);
    expect(body.instance).toBeUndefined();
    testLogger.info('Full-config contract verified');
  });

  test('login page renders from bootstrap; sign-in loads full config and About shows version', {
    tag: ['@config-bootstrap', '@all', '@P0'],
  }, async ({ browser }) => {
    test.skip(isCloudEnvironment(), 'No internal login form on cloud (Dex OIDC)');
    testLogger.info('Opening a fresh unauthenticated context to observe the bootstrap fetch');
    const context = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
    const page = await context.newPage();
    try {
      const baseUrl = process.env['ZO_BASE_URL'];

      // Observe the unauthenticated bootstrap the SPA fires on startup.
      const bootstrapResponsePromise = page.waitForResponse(
        (resp) =>
          resp.request().method() === 'GET' &&
          resp.url().includes('/config') &&
          !resp.url().includes('/api/'),
        { timeout: 60000 },
      );

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const bootstrapResp = await bootstrapResponsePromise;
      expect(bootstrapResp.status()).toBe(200);
      const bootstrapBody = await bootstrapResp.json();
      expect(bootstrapBody.version).toBeUndefined();

      // The login form must render from the bootstrap alone (no full config yet).
      const localPm = new PageManager(page);
      await localPm.loginPage.expectLoginFormVisible();

      const loginResponsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/auth/login') && resp.status() === 200,
        { timeout: 60000 },
      );
      await localPm.loginPage.fillLoginForm(
        process.env['ZO_ROOT_USER_EMAIL'],
        process.env['ZO_ROOT_USER_PASSWORD'],
      );
      await localPm.loginPage.submitLoginForm();
      await loginResponsePromise;

      // Full config resolves after sign-in → the left nav rail appears.
      await localPm.aboutPage.expectNavRailVisible(30000);

      // About page shows the full-config canary (non-empty version + opensource).
      await localPm.aboutPage.gotoAboutPageByUrl(getOrgIdentifier());
      await localPm.aboutPage.waitForVersionNonEmpty();
      await localPm.aboutPage.expectBuildType(bootstrapBody.build_type);
      testLogger.info('Bootstrap → login → full config → About version canary verified');
    } finally {
      await context.close();
    }
  });

  test('bootstrap re-fire does not clobber the already-loaded full config', {
    tag: ['@config-bootstrap', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Loading the full config via an authenticated navigation');
    await navigateToBase(page);
    const org = getOrgIdentifier();

    await pm.aboutPage.gotoAboutPageByUrl(org);
    await pm.aboutPage.waitForVersionNonEmpty();
    const versionBefore = await pm.aboutPage.getVersionText();
    expect(versionBefore.length).toBeGreaterThan(0);

    testLogger.info('Revisiting the login route to re-fire the bootstrap fetch');
    await page.goto(`${process.env['ZO_BASE_URL']}/web/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Returning to About — the full config must not have been clobbered');
    await pm.aboutPage.gotoAboutPageByUrl(org);
    await pm.aboutPage.waitForVersionNonEmpty();
    const versionAfter = await pm.aboutPage.getVersionText();
    expect(versionAfter).toBe(versionBefore);
    testLogger.info('Clobber guard verified — version unchanged after bootstrap re-fire');
  });

  test('POST on the full-config endpoint is rejected with 405', {
    tag: ['@config-bootstrap', '@all', '@api', '@P1', '@negative'],
  }, async ({ page }) => {
    testLogger.info('POSTing to GET /api/{org}/config');
    const org = getOrgIdentifier();
    const resp = await authedRequest(page, 'post', `${process.env['ZO_BASE_URL']}/api/${org}/config`);
    expect(resp.status()).toBe(405);
    testLogger.info('POST /api/{org}/config rejected with 405 Method Not Allowed');
  });

  test('config reload endpoint is 401 when unauthenticated', {
    tag: ['@config-bootstrap', '@all', '@api', '@P1', '@negative'],
  }, async ({ request }) => {
    testLogger.info('Requesting GET /config/reload with no auth headers');
    const resp = await request.get(`${process.env['ZO_BASE_URL']}/config/reload`);
    expect(resp.status()).toBe(401);
    testLogger.info('GET /config/reload rejected with 401 Unauthorized');
  });

  test('About page copy-commit-hash shows a success toast', {
    tag: ['@config-bootstrap', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to About and copying the commit hash');
    await navigateToBase(page);
    await pm.aboutPage.gotoAboutPageByUrl(getOrgIdentifier());
    await pm.aboutPage.waitForCommitHashNonEmpty();
    await pm.aboutPage.copyCommitHash();
    await pm.aboutPage.expectCopySuccessToast();
    testLogger.info('Commit-hash copy success toast verified');
  });

  // ENT-only gap placeholder. ingestion_quota is never returned by the backend
  // full config, so the no-license badge always falls back to the hardcoded 50
  // (EnterpriseUpgradeDialog.vue:512). fixme surfaces it in the feature-gap report
  // for enterprise runs; excluded from this OSS run via the @enterprise tag.
  test.fixme(
    'Enterprise upgrade quota badge shows the configured ingestion quota — not wired: ingestion_quota never returned by backend (EnterpriseUpgradeDialog.vue:512)',
    { tag: ['@enterprise'] },
    async ({ page }) => {
      testLogger.info('Opening the enterprise upgrade dialog to check the quota badge');
      await navigateToBase(page);
      pm = new PageManager(page);
      await pm.editionFeaturesPage.openDialog();
      await pm.editionFeaturesPage.expectOfferBadgeNotContaining('50');
      testLogger.info('Quota badge shows the configured quota (not the hardcoded 50 fallback)');
    },
  );
});
