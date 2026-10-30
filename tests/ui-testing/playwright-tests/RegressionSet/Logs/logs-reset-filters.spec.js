const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require("../../../fixtures/log.json");
const { ingestTestData } = require('../../utils/data-ingestion.js');

// The UI sends URL-safe base64 SQL ('.' padding) when sql_base64_enabled is on.
function decodeSql(body) {
  const query = body && typeof body.query === 'object' ? body.query : body;
  const sql = typeof query?.sql === 'string' ? query.sql : '';
  if (body?.encoding !== 'base64') return sql;
  return Buffer.from(sql.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64').toString('utf8');
}

function trackHitsSql(page) {
  const sent = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() !== 'POST' || !/\/_search(_multi)?_stream\b/.test(url) || url.includes('is_ui_histogram=true')) return;
    try {
      sent.push(decodeSql(JSON.parse(request.postData() || '{}')));
    } catch {
      sent.push('');
    }
  });
  return { count: () => sent.length, since: (n) => sent.slice(n) };
}

// o2-enterprise#1734 regression lock: Reset Filters empties the editor, drops URL query= and the next search runs unfiltered.
test.describe("Logs Reset Filters button (o2-enterprise#1734)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
    await ingestTestData(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.ensureQuickModeState(false);
    await pm.logsPage.runQueryAndWaitForResults();
  });

  test("reset clears filter from editor, URL and restores baseline results", {
    tag: ['@bug-ent-1734', '@P2', '@regression', '@logsRegression', '@logsRegressionResetFilters']
  }, async ({ page }) => {
    const searches = trackHitsSql(page);

    const filter = "kubernetes_container_name='ziox'";
    const beforeFilter = searches.count();
    await pm.logsPage.typeQuery(filter);
    await pm.logsPage.runQueryAndWaitForResults();

    const filteredEditor = await pm.logsPage.getQueryEditorTextWhenReady('ziox');
    expect(filteredEditor).toContain('ziox');
    await expect.poll(() => new URL(page.url()).searchParams.has('query'), { timeout: 10000 }).toBe(true);
    // Proves the capture sees the filter, so its absence after reset means something.
    const filteredSql = searches.since(beforeFilter);
    testLogger.info('Filtered search SQL', { filteredSql });
    expect(filteredSql.some((sql) => sql.includes('ziox')), 'filtered search must send the filter').toBe(true);

    await pm.logsPage.clickResetFiltersButton();

    await expect.poll(async () => ((await pm.logsPage.getQueryEditorText()) || '').trim(), { timeout: 10000 }).toBe('');

    // The URL mirrors the last executed search (#15234), so query= only drops once the reset search runs.
    const beforeReset = searches.count();
    await pm.logsPage.runQueryAndWaitForResults();
    await expect.poll(() => new URL(page.url()).searchParams.has('query'), { timeout: 10000 }).toBe(false);
    expect(((await pm.logsPage.getQueryEditorText()) || '').trim()).toBe('');

    const resetSql = searches.since(beforeReset);
    testLogger.info('Post-reset search SQL', { resetSql });
    expect(resetSql.length, 'running after reset must send a search').toBeGreaterThan(0);
    expect(resetSql.filter((sql) => sql.includes('ziox')), 'Bug #1734: the reset filter must not stick to the next search').toEqual([]);
    expect(await pm.logsPage.getResultHitsCount()).toBeGreaterThan(0);
  });
});
