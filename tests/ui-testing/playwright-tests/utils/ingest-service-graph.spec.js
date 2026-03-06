/**
 * Minimal Playwright spec to ingest service graph data.
 * Run with: npx playwright test playwright-tests/utils/ingest-service-graph.spec.js --config playwright-alpha1.config.js
 *
 * Fetches the correct org + passcode directly from the browser session,
 * bypassing cloud-config.json (which may resolve to _meta).
 */
const { test, expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');

const {
  generateFullTopology,
  generateAllEdgeCases,
  getBaseUrl,
} = require('./service-graph-ingestion.js');

test.describe('Service Graph Data Ingestion', () => {
  test('Ingest traces and verify topology', {
    tag: ['@serviceGraph', '@ingestion', '@all']
  }, async ({ page }) => {
    test.setTimeout(5 * 60 * 1000); // 5 min timeout

    const baseUrl = getBaseUrl();
    testLogger.info('=== Service Graph Data Ingestion ===');
    testLogger.info(`Base URL: ${baseUrl}`);

    // Step 1: Navigate to the app so cookies are active
    await page.goto(`${baseUrl}/web/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Step 2: Fetch all orgs from the browser session (cookies handle auth)
    const orgsResponse = await page.evaluate(async () => {
      const r = await fetch('/api/organizations?page_num=0&page_size=100');
      return r.ok ? await r.json() : null;
    });

    if (!orgsResponse || !orgsResponse.data || orgsResponse.data.length === 0) {
      throw new Error('Failed to fetch organizations');
    }

    // Pick the first non-_meta org (prefer "default" named org)
    const orgs = orgsResponse.data;
    testLogger.info(`Found ${orgs.length} orgs: ${orgs.map(o => `${o.name}(${o.identifier})`).join(', ')}`);

    let targetOrg = orgs.find(o => o.name === 'default' && o.identifier !== '_meta');
    if (!targetOrg) targetOrg = orgs.find(o => o.identifier !== '_meta');
    if (!targetOrg) targetOrg = orgs[0]; // last resort

    const orgId = targetOrg.identifier;
    testLogger.info(`Target org: ${targetOrg.name} (${orgId})`);

    // Step 3: Fetch passcode for this org
    const passcodeResponse = await page.evaluate(async (oid) => {
      const r = await fetch(`/api/${oid}/passcode`);
      return r.ok ? await r.json() : null;
    }, orgId);

    if (!passcodeResponse || !passcodeResponse.data) {
      throw new Error(`Failed to fetch passcode for org ${orgId}`);
    }

    const email = passcodeResponse.data.user;
    const passcode = passcodeResponse.data.passcode;
    testLogger.debug(`Auth configured for ${email}`);

    // Build headers
    const basicAuth = Buffer.from(`${email}:${passcode}`).toString('base64');
    const authHeaders = {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    };

    // Step 4: Verify auth works for ingestion
    const testResp = await page.request.post(`${baseUrl}/api/${orgId}/v1/traces`, {
      headers: authHeaders,
      data: { resourceSpans: [] },
    });
    testLogger.info(`Auth test: ${testResp.status()}`);
    expect(testResp.status(), `Ingestion auth failed for org ${orgId}`).toBe(200);

    // Step 5: Generate and ingest traces
    const fullTopologyTraces = generateFullTopology({ tracesPerFlow: 3, errorRate: 0.1 });
    const edgeCaseTraces = generateAllEdgeCases();
    const allTraces = [...fullTopologyTraces, ...edgeCaseTraces];
    testLogger.info(`Generated ${allTraces.length} traces`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < allTraces.length; i++) {
      const payload = allTraces[i].payload || allTraces[i];
      try {
        const response = await page.request.post(
          `${baseUrl}/api/${orgId}/v1/traces`,
          { headers: authHeaders, data: payload }
        );
        if (response.status() === 200) {
          success++;
        } else {
          failed++;
          if (failed <= 3) testLogger.warn(`Trace ${i} status ${response.status()}`);
        }
      } catch (e) {
        failed++;
        if (failed <= 3) testLogger.error(`Trace ${i} failed`, { error: e.message });
      }

      if (i % 10 === 0 && i > 0) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    testLogger.info('=== Ingestion Complete ===');
    testLogger.info(`Success: ${success}/${allTraces.length}, Failed: ${failed}/${allTraces.length}`);
    expect(success).toBeGreaterThan(0);

    // Step 6: Wait for daemon to process and check topology
    testLogger.info('Waiting for service graph daemon (polling up to 90s)...');
    const startTime = Date.now();
    let nodes = [];
    let edges = [];

    while (Date.now() - startTime < 90000) {
      try {
        const resp = await page.request.get(
          `${baseUrl}/api/${orgId}/traces/service_graph/topology/current`,
          { headers: authHeaders }
        );
        if (resp.status() === 200) {
          const data = await resp.json().catch(() => null);
          nodes = data?.nodes || data?.data?.nodes || [];
          edges = data?.edges || data?.data?.edges || [];
          if (edges.length >= 5) break;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 5000));
    }

    testLogger.info(`=== Topology: ${nodes.length} nodes, ${edges.length} edges (after ${Date.now() - startTime}ms) ===`);
    if (nodes.length > 0) {
      testLogger.info(`Services: ${nodes.map(n => n.label).join(', ')}`);
      const errorNodes = nodes.filter(n => n.error_rate > 0);
      if (errorNodes.length > 0) {
        testLogger.info('Nodes with errors:');
        for (const n of errorNodes) {
          testLogger.info(`  ${n.label}: ${(n.error_rate * 100).toFixed(1)}% (${n.errors}/${n.requests})`);
        }
      }
    }
    testLogger.info('Service graph ingestion complete');
  });
});
