// Copyright 2026 OpenObserve Inc.
// o2-enterprise#1578 + #3126 B4: a repeated Apply & Search on one field stacked conditions and left the Traces tab.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  SpanKind,
  buildSpan,
  buildResourceSpans,
  buildTracePayload,
  generateTraceId,
  generateSpanId,
  generateHexId,
} = require('../../utils/service-graph-ingestion.js');
const { ingestOtlpTraces, waitForSearch, deleteStream } = require('../../utils/traces-api.js');

const MS = 1_000_000;

// Each trace holds both services, so a filter on either one still lists both traces.
function crossedTrace(rootService, childService, rootOperation) {
  const traceId = generateTraceId();
  const rootId = generateSpanId();
  const start = (Date.now() - 5000) * MS;
  const root = buildSpan({
    traceId, spanId: rootId, name: rootOperation, kind: SpanKind.SERVER,
    startTimeNs: start, endTimeNs: start + 100 * MS,
  });
  const child = buildSpan({
    traceId, spanId: generateSpanId(), parentSpanId: rootId, name: `${rootOperation} child`,
    kind: SpanKind.SERVER, startTimeNs: start + 10 * MS, endTimeNs: start + 50 * MS,
  });
  return [buildResourceSpans(rootService, [root]), buildResourceSpans(childService, [child])];
}

test.describe('Apply & Search from a span replaces the same field (#1578)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;
  let alpha;
  let beta;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const runId = generateHexId(4);
    stream = `e2e_1578_${runId}`;
    alpha = { service: `e2e1578${runId}-alpha`, root: `alpha root ${runId}` };
    beta = { service: `e2e1578${runId}-beta`, root: `beta root ${runId}` };
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestOtlpTraces(page.request, stream, buildTracePayload([
      ...crossedTrace(alpha.service, beta.service, alpha.root),
      ...crossedTrace(beta.service, alpha.service, beta.root),
    ]));
    await waitForSearch(page.request, `SELECT COUNT(DISTINCT trace_id) AS traces FROM "${stream}"`, {
      size: 1,
      pick: (search) => (search.hits[0] || {}).traces,
      expected: 2,
      message: 'both fixture traces must be searchable',
    });
    await pm.tracesPage.navigateToTracesTab(stream, 'traces');
    await pm.tracesPage.expectTraceResultWithOperationName(alpha.root);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('Table view: a second = on service_name replaces the first and stays on the Traces tab', {
    tag: ['@bug-ent1578', '@bug-ent3126', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openTraceResultByOperationName(alpha.root);
    await pm.tracesPage.selectWaterfallSpan(alpha.root);
    await pm.tracesPage.expectSidebarServiceName(alpha.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', view: 'table' });

    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name = '${alpha.service}'`);
    expect(pm.tracesPage.getUrlSearchTab()).toBe('traces');

    await pm.tracesPage.openTraceResultByOperationName(beta.root);
    await pm.tracesPage.selectWaterfallSpan(beta.root);
    await pm.tracesPage.expectSidebarServiceName(beta.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', view: 'table' });

    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name = '${beta.service}'`);
    expect(pm.tracesPage.getUrlSearchTab()).toBe('traces');
    // The stacked query matched nothing; the replaced one finds both traces again.
    await pm.tracesPage.expectTraceResultWithOperationName(alpha.root);
    await pm.tracesPage.expectTraceResultWithOperationName(beta.root);
    await pm.tracesPage.expectQueryEditorEventuallyContains(`service_name = '${beta.service}'`);
    expect(await pm.tracesPage.getQueryEditorContent()).not.toContain(alpha.service);
  });

  test('JSON view: a second = on service_name replaces the first', {
    tag: ['@bug-ent1578', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openTraceResultByOperationName(alpha.root);
    await pm.tracesPage.selectWaterfallSpan(alpha.root);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', view: 'json' });
    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name = '${alpha.service}'`);

    await pm.tracesPage.openTraceResultByOperationName(beta.root);
    await pm.tracesPage.selectWaterfallSpan(beta.root);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', view: 'json' });

    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name = '${beta.service}'`);
    expect(pm.tracesPage.getUrlSearchTab()).toBe('traces');
    await pm.tracesPage.expectTraceResultWithOperationName(beta.root);
  });

  test('Flame Graph: a second = on service_name replaces the first', {
    tag: ['@bug-ent1578', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openTraceResultByOperationName(alpha.root);
    await pm.tracesPage.selectFlameGraphRootSpan();
    await pm.tracesPage.expectSidebarServiceName(alpha.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', view: 'table' });
    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name = '${alpha.service}'`);

    await pm.tracesPage.openTraceResultByOperationName(beta.root);
    await pm.tracesPage.selectFlameGraphRootSpan();
    await pm.tracesPage.expectSidebarServiceName(beta.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', view: 'table' });

    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name = '${beta.service}'`);
    expect(pm.tracesPage.getUrlSearchTab()).toBe('traces');
    await pm.tracesPage.expectTraceResultWithOperationName(beta.root);
  });

  test('!= keeps earlier exclusions, never repeats one, and = on another field is ANDed in', {
    tag: ['@bug-ent1578', '@P3', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openTraceResultByOperationName(alpha.root);
    await pm.tracesPage.selectWaterfallSpan(alpha.root);
    await pm.tracesPage.expectSidebarServiceName(alpha.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', operator: '!=', view: 'table' });
    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name != '${alpha.service}'`);

    // The beta-rooted trace's child span belongs to alpha, so this repeats the same exclusion.
    await pm.tracesPage.openTraceResultByOperationName(beta.root);
    await pm.tracesPage.selectWaterfallSpan(`${beta.root} child`);
    await pm.tracesPage.expectSidebarServiceName(alpha.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', operator: '!=', view: 'table' });
    expect(pm.tracesPage.getUrlQueryText()).toBe(`service_name != '${alpha.service}'`);

    await pm.tracesPage.openTraceResultByOperationName(beta.root);
    await pm.tracesPage.selectWaterfallSpan(beta.root);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'operation_name', view: 'table' });
    expect(pm.tracesPage.getUrlQueryText())
      .toBe(`service_name != '${alpha.service}' and operation_name = '${beta.root}'`);
    expect(pm.tracesPage.getUrlSearchTab()).toBe('traces');

    await pm.tracesPage.openTraceResultByOperationName(beta.root);
    await pm.tracesPage.selectWaterfallSpan(beta.root);
    await pm.tracesPage.expectSidebarServiceName(beta.service);
    await pm.tracesPage.applyAndSearchFromSpanAttributes({ field: 'service_name', operator: '!=', view: 'table' });
    expect(pm.tracesPage.getUrlQueryText()).toBe(
      `service_name != '${alpha.service}' and operation_name = '${beta.root}' and service_name != '${beta.service}'`,
    );
  });
});
