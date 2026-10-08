const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestSequencedErrorSpans } = require('../../utils/trace-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ERROR_SPANS = 90;
const ERROR_FILTER = "span_status = 'ERROR'";
const RED_PANELS = ['Rate', 'Errors', 'Duration'];
const SERVICE = 'e2e-sequenced-errors';
// Search windows are microseconds; two requests of one run land within a second of each other.
const SAME_WINDOW_US = 2_000_000;
const MINUTE_US = 60_000_000;

const opRange = (from, to) =>
  Array.from({ length: to - from }, (_, k) => `err-op-${String(from + k).padStart(3, '0')}`);
const nowUs = () => Date.now() * 1000;
const baseUrl = () => (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
const org = () => getOrgIdentifier() || process.env.ORGNAME || 'default';

async function createTracesView(page, name, stream, datetime) {
  const response = await page.request.post(`${baseUrl()}/api/${org()}/savedviews`, {
    headers: getAuthHeaders(),
    data: {
      view_name: name,
      view_type: 'traces',
      data: {
        version: 1,
        stream: { label: stream, value: stream },
        editorValue: ERROR_FILTER,
        datetime,
        searchMode: 'spans',
        sortBy: 'start_time',
        sortOrder: 'desc',
        selectedFields: [],
      },
    },
  });
  expect(response.status(), 'Precondition: saved view must be created').toBe(200);
  return (await response.json()).view_id;
}

async function deleteView(page, viewId) {
  if (!viewId) return;
  await page.request.delete(`${baseUrl()}/api/${org()}/savedviews/${viewId}`, { headers: getAuthHeaders() }).catch(() => {});
}

// Waits until the results search and all three RED panels have sent their request.
async function waitForRunWindows(capture) {
  await expect.poll(() => {
    const seen = new Set(capture.requests.map((r) => r.panel));
    return ['results', ...RED_PANELS].every((p) => seen.has(p));
  }, { timeout: 30000, message: 'results and Rate/Errors/Duration requests must all be sent' }).toBe(true);
  const last = (panel) => capture.requests.filter((r) => r.panel === panel).pop();
  return Object.fromEntries(['results', ...RED_PANELS].map((p) => [p, last(p)]));
}

test.describe('Traces search window and error state (#15130, ENT#2805, ENT#2806)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = 'e2e_15130_' + Math.random().toString(36).slice(2, 7);
    const ingest = await ingestSequencedErrorSpans(page, stream, ERROR_SPANS);
    expect(ingest.status, 'Precondition: seeded spans must ingest').toBe(200);
    await pm.tracesPage.navigateToTracesUrlWithStream(stream);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.switchToSpansMode();
  });

  test('a relative saved view with old stored times puts the RED charts on a fresh window', {
    tag: ['@bug-ent2805', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const threeDaysAgo = nowUs() - 3 * 24 * 60 * MINUTE_US;
    const viewId = await createTracesView(page, `e2e-rel-${stream}`, stream, {
      type: 'relative', relativeTimePeriod: '15m', startTime: threeDaysAgo - 15 * MINUTE_US, endTime: threeDaysAgo,
    });
    try {
      await page.reload();
      const capture = pm.tracesPage.captureSearchRequests();
      const appliedAt = nowUs();
      await pm.tracesPage.applySavedView(`e2e-rel-${stream}`);
      const windows = await waitForRunWindows(capture);
      capture.stop();

      expect(Math.abs(windows.results.endTime - appliedAt), 'results must end at "now"').toBeLessThan(MINUTE_US);
      for (const panel of RED_PANELS) {
        expect(Math.abs(windows[panel].endTime - windows.results.endTime),
          `ENT#2805: ${panel} must query the same window as the results, not the one stored in the view`).toBeLessThan(SAME_WINDOW_US);
      }
    } finally {
      await deleteView(page, viewId);
    }
  });

  test('an absolute saved view keeps its stored window on the results and the RED charts', {
    tag: ['@bug-ent2805', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const endTime = nowUs() - MINUTE_US;
    const startTime = endTime - 30 * MINUTE_US;
    const viewId = await createTracesView(page, `e2e-abs-${stream}`, stream, { type: 'absolute', startTime, endTime });
    try {
      await page.reload();
      const capture = pm.tracesPage.captureSearchRequests();
      await pm.tracesPage.applySavedView(`e2e-abs-${stream}`);
      const windows = await waitForRunWindows(capture);
      capture.stop();

      for (const panel of ['results', ...RED_PANELS]) {
        expect(Math.abs(windows[panel].startTime - startTime), `${panel} must start at the stored start`).toBeLessThan(SAME_WINDOW_US);
        expect(Math.abs(windows[panel].endTime - endTime), `${panel} must end at the stored end`).toBeLessThan(SAME_WINDOW_US);
      }
    } finally {
      await deleteView(page, viewId);
    }
  });

  test('running a relative range again after time passes moves the RED charts with the results', {
    tag: ['@bug-ent2805', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    await pm.tracesPage.searchUntilResultCount('Spans Found');
    // Let the stored relative window age, so a chart that reuses it would visibly lag.
    await page.waitForTimeout(20000);
    const capture = pm.tracesPage.captureSearchRequests();
    await pm.tracesPage.runTraceSearch();
    const windows = await waitForRunWindows(capture);
    capture.stop();

    for (const panel of RED_PANELS) {
      expect(Math.abs(windows[panel].endTime - windows.results.endTime),
        `${panel} must re-resolve "Past 15 Minutes" on Run query`).toBeLessThan(SAME_WINDOW_US);
    }
  });

  test('sorting reuses the window of the last search', {
    tag: ['@bug-ent2805', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const first = pm.tracesPage.captureSearchRequests();
    await pm.tracesPage.searchUntilResultCount('Spans Found');
    first.stop();
    const lastRun = first.requests.filter((r) => r.panel === 'results').pop();
    expect(lastRun, 'Precondition: a results search must have run').toBeTruthy();

    await page.waitForTimeout(15000);
    const sort = pm.tracesPage.captureSearchRequests();
    await pm.tracesPage.clickResultColumnHeader('duration');
    await expect.poll(() => sort.requests.filter((r) => r.panel === 'results').length, { timeout: 15000 }).toBeGreaterThan(0);
    sort.stop();
    const sorted = sort.requests.filter((r) => r.panel === 'results').pop();

    expect(sorted.startTime, 'sort must keep the start of the last search window').toBe(lastRun.startTime);
    expect(sorted.endTime, 'sort must keep the end of the last search window, so the charts still match').toBe(lastRun.endTime);
  });

  test('paging keeps the submitted filter when the editor was changed but not run', {
    tag: ['@bug-ent2805', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.enterTraceQuery(ERROR_FILTER);
    await pm.tracesPage.searchUntilResultCount(`${ERROR_SPANS} Spans Found`);
    await pm.tracesPage.setResultRecordsPerPage(25);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), { timeout: 20000 }).toEqual(opRange(0, 25));

    await pm.tracesPage.replaceTraceQuery("span_status = 'OK'");
    await pm.tracesPage.goToResultPage(2);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), {
      timeout: 20000,
      message: 'page 2 must come from the submitted ERROR filter, not the unsubmitted editor text',
    }).toEqual(opRange(25, 50));
    expect(await pm.tracesPage.getResultCountBadgeText()).toContain(`${ERROR_SPANS} Spans Found`);
  });

  test('an invalid query shows the shared error state with the raw planner text collapsed', {
    tag: ['@bug-ent2806', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.enterTraceQuery('operation_name');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.expectGenericQueryError();
    await expect(pm.tracesPage.queryErrorPlannerText(), 'ENT#2806: planner text must stay behind Show details').toHaveCount(0);

    await pm.tracesPage.toggleQueryErrorDetail();
    await expect(pm.tracesPage.queryErrorDetailBody()).toContainText('Error during planning');
  });

  test('a second error starts with its details collapsed again', {
    tag: ['@bug-ent2806', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.enterTraceQuery('operation_name');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.expectGenericQueryError();
    await pm.tracesPage.toggleQueryErrorDetail();
    await expect(pm.tracesPage.queryErrorDetailBody()).toBeVisible();

    await pm.tracesPage.replaceTraceQuery('duration');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.expectGenericQueryError();
    await expect(pm.tracesPage.queryErrorDetailBody(), 'the details toggle must not stick across errors').toBeHidden();
  });

  test('switching to Traces with invalid editor text shows the shared error state, and a valid run recovers', {
    tag: ['@bug-ent2806', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.searchUntilResultCount('Spans Found');
    await pm.tracesPage.enterTraceQuery('operation_name');
    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.expectGenericQueryError();
    await expect(pm.tracesPage.queryErrorPlannerText()).toHaveCount(0);

    await pm.tracesPage.replaceTraceQuery(ERROR_FILTER);
    await pm.tracesPage.searchUntilResultCount('Traces Found');
    await pm.tracesPage.expectQueryErrorCleared();
  });

  test('the Services Catalog side panel resolves a relative range when it opens', {
    tag: ['@bug-ent2805', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    await pm.tracesPage.searchUntilResultCount('Spans Found');
    await pm.tracesPage.navigateToServicesViaTab();
    await pm.tracesPage.expectServicesCatalogServiceVisible(SERVICE);
    await page.waitForTimeout(20000);

    const capture = pm.tracesPage.captureSearchRequests();
    const openedAt = nowUs();
    await pm.tracesPage.clickServicesCatalogService(SERVICE);
    await pm.tracesPage.expectServiceSidePanelVisible();
    // Only the side panel's own queries filter on the clicked service.
    const panelRequests = () => capture.requests.filter((r) => r.endTime && r.sql.includes(`'${SERVICE}'`));
    await expect.poll(() => panelRequests().length, { timeout: 20000, message: 'the side panel must query the clicked service' }).toBeGreaterThan(0);
    const settledAt = nowUs();
    capture.stop();

    for (const request of panelRequests()) {
      expect(request.endTime, `side panel ${request.panel} query must not end before the panel opened`).toBeGreaterThanOrEqual(openedAt - 5_000_000);
      expect(request.endTime, `side panel ${request.panel} query must not end in the future`).toBeLessThanOrEqual(settledAt);
    }
  });
});
