/**
 * SDK-shaped RUM error events whose stacks point at the committed sourcemaps
 * fixture bundle (fixtures/sourcemaps), plus an ingest-and-wait helper that
 * can target any org.
 */

const path = require('path');
const { expect } = require('@playwright/test');
const { waitForStreamRows } = require('./rum-stream-verify.js');
const { rumTestContext, basicAuthHeader } = require('./rum-env.js');
const { ingestBase } = require('./ingest-url.js');

const manifest = require(path.resolve(__dirname, '../../fixtures/sourcemaps/manifest.json'));

/** One error event for a manifest error key; `source` is the SDK platform (browser, ios, android). */
function sourcemapErrorEvent(errorKey, { service, runId, sourceFile = manifest.bundle, source = 'browser' }) {
  const e = manifest.errors[errorKey];
  const [type, ...msg] = e.message.split(': ');
  return {
    date: Date.now() - 30000,
    type: 'error',
    source,
    error_id: `${service}-${errorKey}`,
    error: {
      message: msg.join(': '),
      type,
      stack: `${e.message}\n    at fn @ ${manifest.bundleUrlPrefix}/${sourceFile}:1:${e.generatedColumn}`,
      source: 'source',
      is_crash: false,
      resource: { url: `${manifest.bundleUrlPrefix}/` },
    },
    service,
    version: '1.0.0-e2e',
    env: 'e2e',
    session: { id: `smap-session-${runId}` },
    view: { id: `smap-view-${runId}`, referrer: '', url: `${manifest.bundleUrlPrefix}/` },
    application: { id: 'e2e-sourcemap-fixture' },
    context: { browser: { name: 'Chrome', version: '120.0.0' }, os: { name: 'Mac OS', version: '14.0' } },
  };
}

/** Ingest events into `org`'s _rumdata and wait until the service's errors are searchable. */
async function ingestRumErrorEvents(page, events, { service, org }) {
  const { baseUrl, email, password } = rumTestContext();
  const res = await page.request.post(`${ingestBase(baseUrl)}/api/${org}/_rumdata/_json`, {
    headers: { Authorization: basicAuthHeader(email, password), 'Content-Type': 'application/json' },
    data: events,
  });
  expect(res.ok(), `RUM ingest for ${service} should succeed (HTTP ${res.status()})`).toBe(true);
  const rows = await waitForStreamRows(page, {
    sql: `SELECT * FROM "_rumdata" WHERE service = '${service}' AND type = 'error'`,
    minRows: events.length,
    timeoutMs: 45000,
    org,
  });
  expect(rows.length, `ingested errors for ${service} should be searchable`).toBeGreaterThanOrEqual(events.length);
}

module.exports = { sourcemapErrorEvent, ingestRumErrorEvents };
