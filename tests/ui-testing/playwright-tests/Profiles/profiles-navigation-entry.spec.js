// Continuous Profiling entry points: left menu, feature flag, Data page, Data Sources, no-stream CTA, Trace span link.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedReferenceStream,
  deleteProfilesStream,
  ingestTraceSpans,
  deleteTracesStream,
  randomHex,
  MINUTE_MS,
} = require('../utils/profiles-ingestion.js');

test.describe('Profiles navigation and entry points', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let trace;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'nav');
    const startMs = ref.t0Ms + 4 * MINUTE_MS - 500;
    trace = {
      stream: `e2e_prof_trace_${randomHex(4)}`,
      startMs,
      traceId: ref.link.traceId,
      linkedSpanId: ref.link.spanId,
      unlinkedSpanId: randomHex(8),
    };
    await ingestTraceSpans(api, trace.stream, {
      traceId: trace.traceId,
      spanIds: [trace.linkedSpanId, trace.unlinkedSpanId],
      startMs,
    });
  });

  test.afterAll(async () => {
    await deleteProfilesStream(api, ref.stream);
    await deleteTracesStream(api, trace.stream);
    await api.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await pm.profilesPage.hideFlameZoomHint();
  });

  test.afterEach(async ({}, testInfo) => {
    await pm.profilesPage.teardown();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('The left menu opens Profiles with its Beta tag', { tag: ['@all', '@profiles', '@P0'] }, async ({ page }) => {
    await navigateToBase(page);
    await pm.profilesPage.clickMenuProfiles();
    expect(new URL(page.url()).pathname).toBe('/web/profiles');
    await pm.profilesPage.expectPageHeader();
  });

  test('Profiles sits right after Traces in the menu', { tag: ['@all', '@profiles', '@P2'] }, async ({ page }) => {
    await navigateToBase(page);
    await pm.profilesPage.expectMenuProfilesVisible(true);
    const order = await pm.profilesPage.visibleMenuOrder();
    testLogger.info('Menu order', { order });
    expect(order.indexOf('menu-link-/profiles-item')).toBe(order.indexOf('menu-link-/traces-item') + 1);
  });

  test('With profiling off the menu hides Profiles and the route goes home', { tag: ['@all', '@profiles', '@P1'] }, async ({ page }) => {
    await pm.profilesPage.mockServerConfig({ profiling: false });
    await navigateToBase(page);
    await pm.profilesPage.expectMenuProfilesVisible(false);
    await pm.profilesPage.routerPush({ name: 'profiles', query: { org_identifier: pm.profilesPage.orgName() } });
    await expect.poll(() => new URL(page.url()).pathname).toBe('/web/');
    expect(pm.profilesPage.currentQuery().org_identifier).toBe(pm.profilesPage.orgName());
  });

  test('The Data page Profiles filter lists the stream', { tag: ['@all', '@profiles', '@P1'] }, async ({ page }) => {
    await navigateToBase(page);
    await pm.profilesPage.gotoDataPageProfiles(ref.stream);
  });

  test('The Data page explore button opens Logs search on the profiles stream', { tag: ['@all', '@profiles', '@P1'] }, async ({ page }) => {
    await navigateToBase(page);
    await pm.profilesPage.gotoDataPageProfiles(ref.stream);
    await pm.profilesPage.clickDataPageExplore(ref.stream);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/web/logs');
    const query = pm.profilesPage.currentQuery();
    expect(query.stream_type).toBe('profiles');
    expect(query.stream).toBe(ref.stream);
    expect(query.type).toBe('stream_explorer');
    await pm.profilesPage.expectLogsExplorerRows();
  });

  test('Data Sources shows the profiles collector snippets', { tag: ['@all', '@profiles', '@P2'] }, async ({ page }) => {
    await navigateToBase(page);
    await pm.profilesPage.gotoProfilesIngestion();
    await pm.profilesPage.expectIngestionProfilesTabsActive();
    const otel = await pm.profilesPage.ingestionSnippetText('otel');
    expect(otel).toContain(`/api/${pm.profilesPage.orgName()}/v1/profiles`);
    expect(otel).toContain('stream-name');
    expect(await pm.profilesPage.ingestionSnippetText('start')).toMatch(/otelcol/);
    expect(await pm.profilesPage.ingestionSnippetText('grpc')).toContain('stream-name');
  });

  test('With no profile streams the empty state links to ingestion setup', { tag: ['@all', '@profiles', '@P2'] }, async ({ page }) => {
    await pm.profilesPage.mockStreamList([]);
    await navigateToBase(page);
    await pm.profilesPage.gotoProfiles();
    await pm.profilesPage.expectState('noStream', { title: 'No profile streams available' });
    await pm.profilesPage.clickStateAction('noStream');
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/web\/ingestion\/custom\/profiles/);
  });

  test('A linked trace span opens its profile', { tag: ['@all', '@profiles', '@P1'] }, async ({ page }) => {
    await pm.profilesPage.mockStreamList([ref.stream]);
    await navigateToBase(page);
    await pm.profilesPage.gotoTraceDetails({
      traceId: trace.traceId,
      stream: trace.stream,
      fromUs: (trace.startMs - 5 * MINUTE_MS) * 1000,
      toUs: (trace.startMs + 5 * MINUTE_MS) * 1000,
    });
    await pm.profilesPage.clickTraceSpanAndAwaitProbe(ref.stream, trace.linkedSpanId);
    await pm.profilesPage.expectViewProfileButton(true);
    await pm.profilesPage.clickViewProfile();
    const query = pm.profilesPage.currentQuery();
    expect(query.stream).toBe(ref.stream);
    expect(query.view).toBe('flame');
    expect(query.service_name).toBe('checkout');
    expect(query.profile_type).toBe('cpu');
    expect(Math.abs(Number(query.from) - (trace.startMs * 1000 - 60_000_000))).toBeLessThan(1_000_000);
    expect(Math.abs(Number(query.to) - ((trace.startMs + 1000) * 1000 + 60_000_000))).toBeLessThan(1_000_000);
    await pm.profilesPage.expectFilterChip('trace_id', trace.traceId);
    await pm.profilesPage.expectFilterChip('span_id', trace.linkedSpanId);
    await pm.profilesPage.expectFlameRootSummary('Total: 250 ms (CPU duration)');
  });

  test('A span without a linked profile has no View Profile', { tag: ['@all', '@profiles', '@P2'] }, async ({ page }) => {
    await pm.profilesPage.mockStreamList([ref.stream]);
    await navigateToBase(page);
    await pm.profilesPage.gotoTraceDetails({
      traceId: trace.traceId,
      stream: trace.stream,
      fromUs: (trace.startMs - 5 * MINUTE_MS) * 1000,
      toUs: (trace.startMs + 5 * MINUTE_MS) * 1000,
    });
    await pm.profilesPage.clickTraceSpanAndAwaitProbe(ref.stream, trace.unlinkedSpanId);
    await pm.profilesPage.clickTraceSpanAndAwaitProbe(ref.stream, trace.linkedSpanId);
    await pm.profilesPage.expectViewProfileButton(true);
    // The unlinked span's probe finished before the linked one started, so its cached miss now renders synchronously.
    await pm.profilesPage.openTraceSpan(trace.unlinkedSpanId);
    await pm.profilesPage.expectTraceSidebarSpan(trace.unlinkedSpanId);
    await pm.profilesPage.expectViewProfileButton(false);
  });
});
