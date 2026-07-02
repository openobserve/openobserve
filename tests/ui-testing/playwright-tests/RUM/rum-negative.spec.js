/**
 * RUM Negative / Edge Cases — End-to-End
 *
 * Guards the ingestion auth boundary and the empty-result path:
 *   - ingestion without a token is rejected (no anonymous writes)
 *   - ingestion with an invalid token is rejected
 *   - querying a stream for a non-existent service returns empty, not an error
 *
 * The RUM ingest routes are POST /rum/v1/{org}/{rum,logs,replay}, guarded by
 * rum_auth_middleware which reads the token from the `oo-api-key` (or
 * `o2-api-key`) query param.
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080)
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { searchStream } = require('../utils/rum-stream-verify.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';

// Minimal RUM-shaped event payload; content is irrelevant since auth runs first.
const SAMPLE_EVENT = [{ type: 'view', service: 'e2e-negative', date: 1 }];

test.describe('RUM Negative Cases', { tag: '@enterprise' }, () => {
  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('rejects RUM ingestion with no token', {
    tag: ['@rum', '@negative', '@security', '@P1'],
  }, async ({ page }) => {
    const res = await page.request.post(`${BASE}/rum/v1/${ORG}/rum`, {
      headers: { 'Content-Type': 'application/json' },
      data: SAMPLE_EVENT,
    });

    expect(res.ok(), 'anonymous RUM ingestion must be rejected').toBe(false);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('rejects RUM ingestion with an invalid token', {
    tag: ['@rum', '@negative', '@security', '@P1'],
  }, async ({ page }) => {
    const res = await page.request.post(
      `${BASE}/rum/v1/${ORG}/rum?oo-api-key=definitely-not-a-real-token`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: SAMPLE_EVENT,
      },
    );

    expect(res.ok(), 'ingestion with a bogus token must be rejected').toBe(false);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('rejects RUM log ingestion with no token', {
    tag: ['@rum', '@negative', '@security', '@P1'],
  }, async ({ page }) => {
    const res = await page.request.post(`${BASE}/rum/v1/${ORG}/logs`, {
      headers: { 'Content-Type': 'application/json' },
      data: SAMPLE_EVENT,
    });

    expect(res.ok(), 'anonymous log ingestion must be rejected').toBe(false);
    expect([400, 401, 403]).toContain(res.status());
  });

  test('querying a stream for a non-existent service returns empty, not an error', {
    tag: ['@rum', '@negative', '@P2'],
  }, async ({ page }) => {
    const hits = await searchStream(page, {
      sql: `SELECT * FROM "_rumdata" WHERE service = 'service-that-does-not-exist-${Date.now()}'`,
      lookbackMinutes: 60,
    });

    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBe(0);
  });
});
