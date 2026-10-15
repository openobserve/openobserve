// Trace details pages a trace in keyset pages: a forced page size of 10 must show the truncation banner until Load more completes it.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { generateHexId } = require('../utils/trace-ingestion.js');

const BASE = (process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = getOrgIdentifier() || 'default';
const AUTH_HEADERS = getAuthHeaders();
const PAGE_SIZE = 10;
// Between 30 and 60 spans: several pages at size 10, and below the 1,000 at which the span-count badge abbreviates.
const SPAN_COUNT_SEEDED = 42;
const WINDOW_US = 15 * 60 * 1000 * 1000;

const TRUNCATED_BANNER = '[data-test="trace-details-truncated-banner"]';
const LOAD_MORE = '[data-test="trace-details-load-more-btn"]';
const SPAN_COUNT = '[data-test="span-count-text"]';

// Ingests one trace of SPAN_COUNT_SEEDED spans, a root and its children, into the "default" traces stream.
async function ingestLargeTrace(page) {
  const traceId = generateHexId(16);
  const rootId = generateHexId(8);
  const nowNs = BigInt(Date.now()) * 1000000n;
  const rootStart = nowNs - 60000000000n;
  const spans = Array.from({ length: SPAN_COUNT_SEEDED }, (_, i) => {
    const start = rootStart + BigInt(i) * 1000000n;
    return {
      traceId,
      spanId: i === 0 ? rootId : generateHexId(8),
      ...(i === 0 ? {} : { parentSpanId: rootId }),
      name: i === 0 ? 'e2e-paging-root' : `e2e-paging-child-${String(i).padStart(2, '0')}`,
      kind: 2,
      startTimeUnixNano: String(start),
      endTimeUnixNano: String(start + (i === 0 ? 500000000n : 1000000n)),
      attributes: [],
      status: { code: 1 },
    };
  });
  const res = await page.request.post(`${BASE}/api/${ORG}/v1/traces`, {
    headers: AUTH_HEADERS,
    data: {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'e2e-trace-paging' } }] },
        scopeSpans: [{ scope: { name: 'e2e' }, spans }],
      }],
    },
  });
  expect(res.status(), 'trace ingestion should succeed').toBe(200);
  return traceId;
}

test.describe('Trace details keyset paging', () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('pages a large trace with Load more until every span is shown', {
    tag: ['@traceDetails', '@traces', '@all', '@P1'],
  }, async ({ page }) => {
    const traceId = await ingestLargeTrace(page);
    const endUs = Date.now() * 1000 + 60 * 1000 * 1000;
    const startUs = endUs - WINDOW_US;

    // The details endpoint widens the caller range to the trace's own, so it gives the true total once all spans are searchable.
    const detailsUrl = `${BASE}/api/${ORG}/default/traces/${traceId}/details?start_time=${startUs}&end_time=${endUs}`;
    await expect
      .poll(
        async () => {
          const res = await page.request.get(detailsUrl, { headers: AUTH_HEADERS });
          return res.ok() ? (await res.json()).hits?.length ?? 0 : -res.status();
        },
        { message: `the seeded trace ${traceId} should become searchable with every span`, timeout: 60000, intervals: [1000, 2000, 5000] },
      )
      .toBe(SPAN_COUNT_SEEDED);
    const total = SPAN_COUNT_SEEDED;
    testLogger.info(`trace ${traceId} has ${total} spans`);

    await page.route('**/traces/*/details*', (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set('size', String(PAGE_SIZE));
      return route.continue({ url: url.toString() });
    });
    await pm.tracesPage.navigateToTraceDetailsUrl({ traceId, fromUs: startUs, toUs: endUs, org: ORG });
    await pm.tracesPage.expectTraceDetailsVisible();

    await expect(page.locator(TRUNCATED_BANNER)).toContainText(`first ${PAGE_SIZE} spans`);
    const clicks = Math.ceil(total / PAGE_SIZE) - 1;
    for (let i = 0; i < clicks; i++) {
      const loaded = PAGE_SIZE * (i + 2);
      await page.locator(LOAD_MORE).click();
      if (loaded < total) {
        await expect(page.locator(TRUNCATED_BANNER)).toContainText(`first ${loaded} spans`);
      }
    }
    await expect(page.locator(TRUNCATED_BANNER)).toHaveCount(0);
    await expect(page.locator(SPAN_COUNT)).toContainText(String(total));
  });
});
