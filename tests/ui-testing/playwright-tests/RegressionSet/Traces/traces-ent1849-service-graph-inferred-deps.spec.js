// traces-ent1849-service-graph-inferred-deps.spec.js
// Traces Regression — Service Graph inferred dependencies (o2-enterprise#1849)
//
// Databases, queues and external APIs
// were invisible in the Service Graph. The topology was built by joining a SERVER
// span to its CLIENT parent, and an uninstrumented dependency never emits a SERVER
// span: only the caller's CLIENT/PRODUCER span exists. Every such dependency was
// therefore dropped, and a service that talked to Redis or MySQL showed no edge to it.
//
// The fix derives the dependency's identity at ingest (infer_service_name /
// _type / _system, src/core/src/traces/inferred.rs) and folds those edges into
// the topology, classified as datastore / queue / external.
//
// `service-graph.spec.js` cannot catch a regression here: its `database` node
// comes from `generateDatabaseTrace`, which emits a SERVER span for the database
// too, so that node arrives through the ordinary join and would survive the
// inference path being removed entirely.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  generateUninstrumentedDependencyTrace,
  ingestTraces,
} = require('../../utils/service-graph-ingestion.js');

// The v4 resolver stages a peer that carries no explicit `peer.service` until it
// can finalise its identity, and the daemon only processes windows older than
// ZO_CACHE_DELAY_SECS. Inferred nodes therefore appear minutes after ingestion —
// reading the topology too early looks exactly like "still broken".
const TOPOLOGY_WAIT_MS = 480000;
const TOPOLOGY_POLL_MS = 15000;

// Named so a failure says which dependency went missing.
const EXPECTED_DATASTORES = ['cart', 'orders'];
const EXPECTED_QUEUE = 'checkout.events';

async function pollForInferredNodes(pm, names) {
  const deadline = Date.now() + TOPOLOGY_WAIT_MS;
  let nodes = [];
  while (Date.now() < deadline) {
    const result = await pm.serviceGraphPage.getTopologyViaAPI();
    const data = result.data?.nodes ? result.data : result.data?.data;
    nodes = data?.nodes || [];
    const present = new Set(nodes.map((n) => n.id || n.label));
    if (names.every((n) => present.has(n))) return nodes;
    await new Promise((resolve) => setTimeout(resolve, TOPOLOGY_POLL_MS));
  }
  return nodes;
}

test.describe('Service Graph — uninstrumented dependencies', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  let pm;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(TOPOLOGY_WAIT_MS + 120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      // Both peer shapes: with `peer.service` (resolved immediately) and without
      // (the plain OTel database convention, which takes the staged path).
      const traces = [];
      for (let i = 0; i < 6; i++) {
        traces.push(generateUninstrumentedDependencyTrace({ peerService: i % 2 === 0 }));
      }
      const result = await ingestTraces(page, traces, { delayMs: 50 });
      expect(result.successful, 'all fixture traces must ingest').toBe(traces.length);
      testLogger.info('Ingested uninstrumented-dependency traces', { count: result.successful });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await navigateToBase(page);
    await page.evaluate(() => localStorage.setItem('serviceGraph_streamFilter', 'default'));
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: a database that emits no server span still becomes a topology node', {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all'],
  }, async () => {
    test.setTimeout(TOPOLOGY_WAIT_MS + 120000);

    const nodes = await pollForInferredNodes(pm, EXPECTED_DATASTORES);
    const byId = new Map(nodes.map((n) => [n.id || n.label, n]));
    testLogger.info('Topology nodes', { count: nodes.length });

    for (const name of EXPECTED_DATASTORES) {
      const node = byId.get(name);
      expect(node, `'${name}' is reached only by a CLIENT span, so it must be inferred`).toBeDefined();
      // Classified, not merely present — a datastore drawn as a plain service
      // loses the distinction the fix exists to make.
      expect(node.kind || node.service_type).toBe('database');
    }
  });

  test('P1: a queue a service only produces to becomes a topology node', {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all'],
  }, async () => {
    test.setTimeout(TOPOLOGY_WAIT_MS + 120000);

    const nodes = await pollForInferredNodes(pm, [EXPECTED_QUEUE]);
    const node = nodes.find((n) => (n.id || n.label) === EXPECTED_QUEUE);

    expect(node, `'${EXPECTED_QUEUE}' is reached only by a PRODUCER span`).toBeDefined();
    expect(node.kind || node.service_type).toBe('queue');
  });

  test('P2: the caller has an edge to each inferred dependency', {
    tag: ['@serviceGraph', '@traces', '@functional', '@P2', '@all'],
  }, async () => {
    test.setTimeout(TOPOLOGY_WAIT_MS + 120000);

    await pollForInferredNodes(pm, EXPECTED_DATASTORES);
    const result = await pm.serviceGraphPage.getTopologyViaAPI();
    const data = result.data?.nodes ? result.data : result.data?.data;
    const edges = data?.edges || [];

    for (const name of EXPECTED_DATASTORES) {
      const edge = edges.find((e) => e.to === name || e.target === name);
      expect(edge, `no edge reaches '${name}', so the node is orphaned in the graph`).toBeDefined();
      expect(edge.from || edge.source).toBe('checkout-service');
    }
  });
});
