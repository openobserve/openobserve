const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const logData = require('../../fixtures/log.json');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe('Regression: Scroll Retention on Logs page (#9044)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await pm.logsPage.selectIndexStream('e2e_automate');
    await page.waitForTimeout(1000);

    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
    await page.waitForTimeout(500);
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.waitForResultsLoaded();

    testLogger.info('Scroll retention test setup completed');
  });

  test('Scroll resets to top when navigating from page 1 to page 2 via page number button', {
    tag: ['@regression', '@scroll', '@pagination', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing scroll reset on page 1 -> page 2 via page number click');

    await pm.logsPage.scrollToResultsBottom();
    const scrollAfterScroll = await pm.logsPage.getScrollContainerPosition();
    testLogger.info(`Scrolled to: ${scrollAfterScroll}`);
    expect(scrollAfterScroll).toBeGreaterThan(10);

    await pm.logsPage.clickPageNumber('2');
    const currentPage = await pm.logsPage.getCurrentPageNumber();
    expect(currentPage).toBe('2');

    await pm.logsPage.assertScrollAtTop();
    testLogger.info('Scroll correctly reset to top on page 2');
  });

  test('Scroll resets to top when navigating from page 2 back to page 1', {
    tag: ['@regression', '@scroll', '@pagination', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing scroll reset on page 2 -> page 1');

    await pm.logsPage.clickPageNumber('2');
    const page2Check = await pm.logsPage.getCurrentPageNumber();
    testLogger.info(`Current page: ${page2Check}`);

    await pm.logsPage.scrollToResultsBottom();
    const scrollOnPage2 = await pm.logsPage.getScrollContainerPosition();
    testLogger.info(`Scrolled to on page 2: ${scrollOnPage2}`);
    expect(scrollOnPage2).toBeGreaterThan(10);

    await pm.logsPage.clickPageNumber('1');
    const currentPage = await pm.logsPage.getCurrentPageNumber();
    expect(currentPage).toBe('1');

    await pm.logsPage.assertScrollAtTop();
    testLogger.info('Scroll correctly reset to top on page 1');
  });

  test('Scroll resets to top when navigating via Next Page (>) button', {
    tag: ['@regression', '@scroll', '@pagination', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Testing scroll reset via Next Page (>) button');

    await pm.logsPage.scrollToResultsBottom();
    const scrollBefore = await pm.logsPage.getScrollContainerPosition();
    testLogger.info(`Scrolled to: ${scrollBefore}`);
    expect(scrollBefore).toBeGreaterThan(10);

    await pm.logsPage.clickNextPage();
    const currentPage = await pm.logsPage.getCurrentPageNumber();
    expect(currentPage).toBe('2');

    await pm.logsPage.assertScrollAtTop();
    testLogger.info('Scroll correctly reset to top after Next Page button');
  });
});

test.describe('Regression: Undefined Length error on Logs -> Scheduled Search -> Streams -> Logs (#7354)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await pm.logsPage.selectIndexStream('e2e_automate');
    await page.waitForTimeout(1000);

    const orgId = getOrgIdentifier();
    const headers = getAuthHeaders();
    const now = Date.now();
    const searchJobBody = {
      query: {
        sql: 'SELECT * FROM "e2e_automate"',
        start_time: now - 60 * 1000,
        end_time: now,
        from: 0,
        size: 1000,
        quick_mode: false,
        sql_mode: 'full',
      },
    };

    const jobResponse = await page.request.post(
      `${process.env['ZO_BASE_URL']}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`,
      { data: searchJobBody, headers }
    );

    let traceId = null;
    if (jobResponse.status() === 200) {
      const body = await jobResponse.json();
      const match = body.message?.match(/\[Job_Id: (.+?)\]/);
      const jobId = match ? match[1] : null;
      testLogger.info(`Created search job: ${jobId}`);

      const listResponse = await page.request.get(
        `${process.env['ZO_BASE_URL']}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`,
        { headers }
      );
      const jobs = await listResponse.json();
      const job = jobs.find(j => j.id === jobId);
      traceId = job?.trace_id || null;
      testLogger.info(`Job trace_id: ${traceId}`);
    }

    page._jobTraceId = traceId;

    const cleanupJob = async () => {
      if (!traceId) return;
      try {
        await page.request.delete(
          `${process.env['ZO_BASE_URL']}/api/${orgId}/search_jobs/${traceId}?type=logs&search_type=UI&use_cache=true`,
          { headers }
        );
        testLogger.info(`Cleaned up search job: ${traceId}`);
      } catch (e) {
        testLogger.warn(`Failed to clean up search job: ${e.message}`);
      }
    };
    testInfo._cleanup = cleanupJob;

    testLogger.info('Undefined Length error test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo._cleanup) await testInfo._cleanup();
  });

  test('No Undefined Length error after navigating Logs -> Scheduled Search -> Streams -> Logs', {
    tag: ['@regression', '@logs', '@scheduledSearch', '@P0'],
  }, async ({ page }) => {
    const traceId = page._jobTraceId;
    testLogger.info('Starting reproduction path: Logs -> List Scheduled Search');

    await pm.logsPage.openMoreOptionsMenu();
    await pm.logsPage.clickListScheduledSearch();
    await page.waitForLoadState('domcontentloaded');

    if (traceId) {
      const searchBtn = page.locator(`[data-test="search-scheduler-table-${traceId}-row"]`).locator('button').first();
      if (await searchBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await searchBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    await pm.logsPage.navigateToStreams();
    await page.waitForLoadState('domcontentloaded');

    await pm.logsPage.navigateToLogsFromSidebar();

    const clicked = await pm.logsPage.clickRunQueryIfReady();
    testLogger.info(clicked ? 'Pressed Run Query' : 'Run Query button disabled, verifying error state');

    const hasError = await pm.logsPage.hasErrorMessage();
    expect(hasError).toBe(false);

    const pageText = await page.evaluate(() => document.body.innerText);
    const hasUndefinedLength = pageText.includes('Undefined Length') || pageText.includes('undefined length');
    expect(hasUndefinedLength).toBe(false);

    testLogger.info('No Undefined Length error found - bug is fixed');
  });

  test('No console errors after navigating the reproduction path', {
    tag: ['@regression', '@logs', '@scheduledSearch', '@P1'],
  }, async ({ page }) => {
    const traceId = page._jobTraceId;
    testLogger.info('Starting reproduction path with console error monitoring');

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await pm.logsPage.openMoreOptionsMenu();
    await pm.logsPage.clickListScheduledSearch();
    await page.waitForLoadState('domcontentloaded');

    if (traceId) {
      const searchBtn = page.locator(`[data-test="search-scheduler-table-${traceId}-row"]`).locator('button').first();
      if (await searchBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await searchBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    await pm.logsPage.navigateToStreams();
    await pm.logsPage.navigateToLogsFromSidebar();

    await pm.logsPage.clickRunQueryIfReady();

    const relevantErrors = consoleErrors.filter(
      (err) => err.toLowerCase().includes('undefined') || err.toLowerCase().includes('length'),
    );
    expect(relevantErrors).toHaveLength(0);
  });
});
