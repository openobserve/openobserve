const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { stringAttr, ingestOtlpTraces, waitForSearch, deleteStream } = require('../../utils/traces-api.js');

const MATCHING_SERVICES = 11;
const PAGE_SIZE = 10;

// Service `-aNN` gets NN spans, so sorting by requests has one fixed order; `-b01` is the one the search filters out.
function catalogPayload(prefix) {
  const nowNs = BigInt(Date.now()) * 1000000n;
  const names = [
    ...Array.from({ length: MATCHING_SERVICES }, (_, i) => `${prefix}-a${String(i + 1).padStart(2, '0')}`),
    `${prefix}-b01`,
  ];
  return {
    resourceSpans: names.map((name, idx) => ({
      resource: { attributes: [stringAttr('service.name', name)] },
      scopeSpans: [{
        scope: { name: 'e2e-15269' },
        spans: Array.from({ length: idx + 1 }, (_, j) => {
          const start = nowNs - BigInt(j + 1) * 1000000000n;
          return {
            traceId: generateHexId(16),
            spanId: generateHexId(8),
            name: 'GET /catalog',
            kind: 2,
            startTimeUnixNano: String(start),
            endTimeUnixNano: String(start + 20000000n),
            attributes: [],
            status: { code: 1 },
          };
        }),
      }],
    })),
  };
}

async function seedCatalog(request, stream, prefix) {
  await ingestOtlpTraces(request, stream, catalogPayload(prefix), { message: 'Precondition: catalog spans must ingest' });
  await waitForSearch(request, `SELECT COUNT(DISTINCT service_name) AS services FROM "${stream}"`, {
    size: 1,
    pick: (search) => (search.hits[0] || {}).services,
    expected: MATCHING_SERVICES + 1,
    message: 'every seeded service must be searchable',
  });
}

test.describe('Services Catalog keeps its list state across a service visit (#15269)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;
  let prefix;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const runId = generateHexId(4);
    stream = `e2e_15269_${runId}`;
    prefix = `e2e15269${runId}`;
    await seedCatalog(page.request, stream, prefix);
    await pm.tracesPage.navigateToTracesUrlWithStream(stream);
    await pm.tracesPage.navigateToServicesViaTab();
    await pm.servicesCatalogPage.waitForLoad();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('search, sort, page size and page are restored after opening a service and coming back', {
    tag: ['@bug-15269', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    const search = `${prefix}-a`;
    const lastService = `${prefix}-a01`;

    await pm.servicesCatalogPage.filterByServiceName(search);
    await pm.servicesCatalogPage.sortByColumn('total_requests');
    await pm.servicesCatalogPage.setRowsPerPage(PAGE_SIZE);
    await pm.servicesCatalogPage.goToPage(2);
    expect(await pm.servicesCatalogPage.getSortIcon('total_requests'), 'Precondition: requests sorted high to low').toBe('arrow_downward');
    await expect.poll(() => pm.servicesCatalogPage.getVisibleServiceNames(), {
      message: 'Precondition: page 2 holds only the service with the fewest requests',
    }).toEqual([lastService]);

    await pm.servicesCatalogPage.clickServiceRow(lastService);
    await pm.servicesCatalogPage.expectSidePanelVisible();
    await pm.servicesCatalogPage.viewServiceTracesFromSidePanel();
    await pm.tracesPage.navigateToServicesViaTab();
    await pm.servicesCatalogPage.waitForLoad();

    await expect.poll(() => pm.servicesCatalogPage.getFilterInputValue().catch(() => null), { message: 'the search must be restored' }).toBe(search);
    await expect.poll(() => pm.servicesCatalogPage.getSortIcon('total_requests'), { message: 'the sort must be restored' }).toBe('arrow_downward');
    await expect.poll(() => pm.servicesCatalogPage.getRowsPerPage().catch(() => null), { message: 'the page size must be restored' }).toBe(PAGE_SIZE);
    await expect.poll(() => pm.servicesCatalogPage.getCurrentPage(), { message: 'the page must be restored' }).toBe(2);
    await expect.poll(() => pm.servicesCatalogPage.getVisibleServiceNames()).toEqual([lastService]);
  });
});
