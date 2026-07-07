/**
 * RUM Onboarding Snippets — End-to-End
 *
 * Verifies the Frontend Monitoring onboarding page renders correct, copy-ready
 * instrumentation snippets for BOTH integration paths (NPM install + SDK init),
 * with the real org identifier / ingestion site / insecureHTTP flag injected.
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080); the
 *     RUM token/onboarding routes are part of the standard (OSS) router.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const SITE_HOST = BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const INSECURE = BASE.startsWith('http://');

test.describe('RUM Onboarding Snippets', () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    // Ensure a token exists so the snippet block (v-if="rumToken") renders.
    // getOrCreateRumToken talks to the API directly — no page readiness needed.
    await getOrCreateRumToken(page);

    await pm.rumIngestionPage.gotoFrontendMonitoring();
    await pm.rumIngestionPage.expectPageLoaded();
  });

  test('shows the NPM install command for both browser packages', {
    tag: ['@rum', '@rumOnboarding', '@P1'],
  }, async () => {
    await pm.rumIngestionPage.expectNpmSnippetContains(
      'npm i @openobserve/browser-rum @openobserve/browser-logs',
    );
  });

  test('init snippet injects the current organization identifier', {
    tag: ['@rum', '@rumOnboarding', '@P0'],
  }, async () => {
    await pm.rumIngestionPage.expectInitSnippetContains(`organizationIdentifier: '${ORG}'`);
  });

  test('init snippet injects the ingestion site host without protocol', {
    tag: ['@rum', '@rumOnboarding', '@P1'],
  }, async () => {
    await pm.rumIngestionPage.expectInitSnippetContains(`site: '${SITE_HOST}'`);
  });

  test('init snippet sets insecureHTTP to match the endpoint protocol', {
    tag: ['@rum', '@rumOnboarding', '@P1'],
  }, async () => {
    await pm.rumIngestionPage.expectInitSnippetContains(`insecureHTTP: ${INSECURE}`);
  });

  test('init snippet exposes a copy control', {
    tag: ['@rum', '@rumOnboarding', '@P2'],
  }, async () => {
    // Two copy buttons: npm command + init config.
    await pm.rumIngestionPage.expectCopyControlsPresent(2);
  });
});
