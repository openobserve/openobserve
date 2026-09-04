#!/usr/bin/env node
/**
 * Standalone service graph data ingestion script.
 * Uses native fetch (Node 18+) instead of Playwright page.request.
 *
 * Usage: node scripts/ingest-service-graph.js
 * Reads credentials from ../.env
 */

const path = require('path');

// Load .env from the ui-testing directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const testLogger = require('../playwright-tests/utils/test-logger.js');

const {
  generateFullTopology,
  generateAllEdgeCases,
} = require('../playwright-tests/utils/service-graph-ingestion.js');

// Build auth headers — cloud envs use passcode from cloud-config.json
let _headers = null;
function getHeaders() {
  if (_headers) return _headers;

  const configFile = path.join(__dirname, '..', 'playwright-tests', 'utils', 'auth', 'cloud-config.json');
  let email, secret;

  try {
    const config = JSON.parse(require('fs').readFileSync(configFile, 'utf-8'));
    if (config.passcode) {
      email = config.userEmail;
      secret = config.passcode;
    }
  } catch (_) { /* no cloud config */ }

  if (!email) {
    email = process.env.ZO_ROOT_USER_EMAIL;
    secret = process.env.ZO_ROOT_USER_PASSWORD;
  }

  const basicAuth = Buffer.from(`${email}:${secret}`).toString('base64');
  _headers = {
    'Authorization': `Basic ${basicAuth}`,
    'Content-Type': 'application/json',
  };
  return _headers;
}

function getBaseUrl() {
  const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getOrgId() {
  return process.env.ORGNAME || 'default';
}

async function ingestTrace(traceData) {
  const headers = getHeaders();
  const baseUrl = getBaseUrl();
  const orgId = getOrgId();
  const payload = traceData.payload || traceData;
  const url = `${baseUrl}/api/${orgId}/v1/traces`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  return { status: response.status };
}

async function main() {
  const baseUrl = getBaseUrl();
  const orgId = getOrgId();

  testLogger.info('=== Service Graph Data Ingestion ===');
  testLogger.info(`Target: ${baseUrl}`);
  testLogger.info(`Org:    ${orgId}`);

  // Step 1: Generate full topology traces
  testLogger.info('Generating full topology traces...');
  const fullTopologyTraces = generateFullTopology({ tracesPerFlow: 3, errorRate: 0.1 });
  testLogger.info(`  Generated ${fullTopologyTraces.length} topology traces`);

  // Step 2: Generate edge case traces
  testLogger.info('Generating edge case traces...');
  const edgeCaseTraces = generateAllEdgeCases();
  testLogger.info(`  Generated ${edgeCaseTraces.length} edge case traces`);

  const allTraces = [...fullTopologyTraces, ...edgeCaseTraces];
  testLogger.info(`Ingesting ${allTraces.length} total traces...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < allTraces.length; i++) {
    try {
      const result = await ingestTrace(allTraces[i]);
      if (result.status === 200) {
        success++;
      } else {
        failed++;
        if (failed <= 3) testLogger.warn(`Trace ${i} returned status ${result.status}`);
      }
    } catch (e) {
      failed++;
      if (failed <= 3) testLogger.error(`Trace ${i} failed`, { error: e.message });
    }

    // Small delay between requests
    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  testLogger.info('=== Ingestion Complete ===');
  testLogger.info(`Success: ${success}/${allTraces.length}, Failed: ${failed}/${allTraces.length}`);

  // Step 3: Verify topology appears
  testLogger.info('Waiting 10s for daemon to process...');
  await new Promise(r => setTimeout(r, 10000));

  const headers = getHeaders();
  try {
    const topoResponse = await fetch(
      `${baseUrl}/api/${orgId}/traces/service_graph/topology/current`,
      { headers }
    );
    const topoData = await topoResponse.json();
    const data = topoData?.nodes ? topoData : topoData?.data;
    testLogger.info(`Topology: ${data?.nodes?.length || 0} nodes, ${data?.edges?.length || 0} edges`);
  } catch (e) {
    testLogger.error(`Topology check failed`, { error: e.message });
  }

  testLogger.info('Done!');
}

main().catch(e => {
  testLogger.error('Fatal error', { error: e.message });
  process.exit(1);
});
