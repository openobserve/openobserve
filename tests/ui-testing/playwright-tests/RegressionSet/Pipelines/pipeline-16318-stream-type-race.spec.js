const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestRows, waitForSearchable } = require('../../utils/auto-run-helpers.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ORG = getOrgIdentifier() || 'default';
const LOGS_STREAM = `e2e_16318_${Math.random().toString(36).slice(2, 7)}`;
const STREAM_LIST = /\/api\/[^/]+\/streams\?/;
const apiBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

// Holds the first logs stream-list request until release(), so the traces answer lands first.
async function holdLogsStreamList(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(STREAM_LIST, async (route) => {
    if (!route.request().url().includes('type=logs') || held > 0) return route.continue();
    held += 1;
    await gate;
    await route.continue();
  });
  return { release: () => release(), held: () => held };
}

// openobserve#16318 (issue #15545): a stale logs stream-list answer overwrote the list of the stream type picked meanwhile.
test.describe('Pipeline stream node keeps the selected stream type (#16318)', () => {
  let traceStream;

  test.beforeAll(async ({ request }) => {
    await ingestRows(request, ORG, LOGS_STREAM, [{ _timestamp: Date.now() * 1000, message: 'route hold race' }]);
    await waitForSearchable(request, ORG, LOGS_STREAM, 1);
    const res = await request.get(`${apiBase()}/api/${ORG}/streams?type=traces`, { headers: getAuthHeaders() });
    traceStream = ((await res.json()).list || [])[0]?.name;
  });

  test('a logs stream list that answers after the switch to traces does not replace the traces list', {
    tag: ['@bug-16318', '@bug-15545', '@P2', '@regression', '@pipelinesRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    expect(traceStream, 'global setup ingests a traces stream').toBeTruthy();
    const pm = new PageManager(page);

    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.addPipeline();
    await pm.pipelinesPage.selectStream();
    const hold = await holdLogsStreamList(page);
    await pm.pipelinesPage.dragStreamToTarget(pm.pipelinesPage.streamButton);
    await expect.poll(hold.held, { timeout: 15000, message: 'the stream node never asked for the logs list' }).toBe(1);

    const tracesList = page.waitForResponse((r) => STREAM_LIST.test(r.url()) && r.url().includes('type=traces'), { timeout: 30000 });
    await pm.pipelinesPage.selectTraces();
    await tracesList;
    const logsList = page.waitForResponse((r) => STREAM_LIST.test(r.url()) && r.url().includes('type=logs'), { timeout: 30000 });
    hold.release();
    await logsList;

    await pm.pipelinesPage.enterStreamName(traceStream);
    await pm.pipelinesPage.expectStreamNameOptionVisible(traceStream);
    await pm.pipelinesPage.enterStreamName(LOGS_STREAM);
    // The traces row leaving proves the search filter ran, so the next count is not read too early.
    await pm.pipelinesPage.expectStreamNameOptionCount(traceStream, 0);
    await pm.pipelinesPage.expectStreamNameOptionCount(LOGS_STREAM, 0);
  });
});
