const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe("Splunk HEC Ingestion Window Warning testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Splunk HEC ingestion window test setup completed');
  });

  test("should render the ingestion-window warning banner as an alert naming both setting keys", {
    tag: ['@splunk-hec-ingestion-window', '@ingestion', '@all', '@P0']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.splunkHecPage.navigateToSplunkHec(orgId);

    await pm.splunkHecPage.expectWindowNoteVisible();

    const role = await pm.splunkHecPage.getWindowNoteRole();
    expect(role).toBe('alert');

    const text = await pm.splunkHecPage.getWindowNoteText();
    expect(text).toContain('Timestamps outside the ingestion window are discarded');
    expect(text).toContain('ZO_INGEST_ALLOWED_UPTO');
    expect(text).toContain('ZO_INGEST_ALLOWED_IN_FUTURE');

    testLogger.info('Ingestion-window warning banner verified as an alert with both setting keys');
  });

  test("should render the endpoint URL root-mounted with no org or base-uri", {
    tag: ['@splunk-hec-ingestion-window', '@ingestion', '@all', '@P0']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.splunkHecPage.navigateToSplunkHec(orgId);

    const origin = await pm.splunkHecPage.getOrigin();
    const endpoint = await pm.splunkHecPage.getEndpointContent();

    expect(endpoint).toBe(`${origin}/services/collector`);
    expect(endpoint).not.toContain(orgId);
    expect(endpoint).not.toContain('/api/');
    expect(endpoint).not.toContain('/web/');

    testLogger.info('Endpoint URL verified as root-mounted');
  });

  test("should navigate to the org-scoped Ingestion Tokens page from the tokens link", {
    tag: ['@splunk-hec-ingestion-window', '@ingestion', '@all', '@P1']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.splunkHecPage.navigateToSplunkHec(orgId);

    await pm.splunkHecPage.clickTokensLink();
    await pm.splunkHecPage.expectIngestionTokensUrl(orgId);

    testLogger.info('Tokens link navigated to the org-scoped Ingestion Tokens page');
  });

  test("should render all three warning banners (window, edge processor, TLS)", {
    tag: ['@splunk-hec-ingestion-window', '@ingestion', '@all', '@P1']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.splunkHecPage.navigateToSplunkHec(orgId);

    await pm.splunkHecPage.expectAllBannersVisible();

    const edgeText = await pm.splunkHecPage.getEdgeProcessorNoteText();
    expect(edgeText).toContain('useACK');

    const tlsText = await pm.splunkHecPage.getTlsNoteText();
    expect(tlsText).toContain('ZO_HTTP_TLS_ENABLED');

    testLogger.info('All three warning banners verified');
  });

  test("should copy all four snippets and show the success toast", {
    tag: ['@splunk-hec-ingestion-window', '@ingestion', '@all', '@P1']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.splunkHecPage.navigateToSplunkHec(orgId);

    const copyCount = await pm.splunkHecPage.getCopyButtonCount();
    expect(copyCount).toBe(4);

    for (let i = 0; i < copyCount; i++) {
      await pm.splunkHecPage.clickCopyButton(i);
      await pm.splunkHecPage.expectCopyToast('Copied Successfully');
      await pm.splunkHecPage.waitForCopyToastToHide();
    }

    testLogger.info('All four snippets copied successfully');
  });

  test("should render a live fractional payload time and omit time from the curl example", {
    tag: ['@splunk-hec-ingestion-window', '@ingestion', '@all', '@P2']
  }, async () => {
    const orgId = getOrgIdentifier();
    await pm.splunkHecPage.navigateToSplunkHec(orgId);

    const payloadText = await pm.splunkHecPage.getPayloadContent();
    expect(payloadText).toMatch(/"time":\s*\d+\.\d+/);

    const payload = await pm.splunkHecPage.getPayloadJson();
    const nowSeconds = Date.now() / 1000;
    expect(Number.isFinite(payload.time)).toBe(true);
    expect(payload.time).toBeGreaterThan(nowSeconds - 120);
    expect(payload.time).toBeLessThan(nowSeconds + 120);
    expect(payload).toHaveProperty('index');
    expect(payload).toHaveProperty('host');
    expect(payload).toHaveProperty('source');
    expect(payload).toHaveProperty('sourcetype');

    const curlData = await pm.splunkHecPage.getCurlDataJson();
    expect(curlData).not.toHaveProperty('time');
    expect(curlData).toHaveProperty('event');
    expect(curlData).toHaveProperty('index');

    testLogger.info('Payload time is a live fractional epoch; curl example omits time');
  });

  test.afterEach(async () => {
    testLogger.info('Splunk HEC ingestion window test completed');
  });
});
