// Metrics explorer exemplars E2E (openobserve#14894, AC-20): a heatmap histogram card swaps to percentiles while on.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { newRun, ingestExemplarFixtures, waitForExemplars, requestLog, deleteRunStreams } = require('../utils/exemplar-fixtures.js');

const RUN = newRun();
const { PREFIX, HIST, COUNTER } = RUN;

const CARD = `${HIST}_bucket`;
const cardSel = (name) => `[data-test="metrics-explorer-card-${name}"]`;
const toggleSel = (name) => `[data-test="metrics-explorer-card-exemplars-${name}"]`;

test.describe('Metrics explorer exemplars', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await ingestExemplarFixtures(RUN, 32);
    await waitForExemplars(RUN);
  });

  test.afterAll(async () => {
    await deleteRunStreams(RUN);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.evaluate(() => sessionStorage.clear());
  });

  test('one card on, others silent', { tag: ['@exemplars', '@metrics-explorer', '@P0', '@all'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const log = requestLog(page);
    await pm.metricsExplorerPage.gotoExplorer();
    await page.locator('[data-test="metrics-explorer-search"] input').fill(PREFIX);
    await expect(page.locator(cardSel(CARD))).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(cardSel(COUNTER))).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    expect(log.exemplars()).toHaveLength(0);

    const restInfo = page.locator(`[data-test="metrics-explorer-card-rest-info-${CARD}"]`);
    await expect(restInfo).toContainText('heatmap');

    await page.locator(cardSel(CARD)).hover();
    const toggle = page.locator(toggleSel(CARD));
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('data-swaps-variant', 'percentiles');
    await toggle.click();

    await expect(page.locator(toggleSel(CARD))).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => {
      const list = page.locator(`${cardSel(CARD)} [data-test="dashboard-panel-exemplar-points"]`);
      return (await list.count()) ? Number(await list.getAttribute('data-count')) : 0;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.mouse.move(0, 0);
    await expect(restInfo).toContainText('percentiles');

    const requests = log.exemplars();
    expect(requests.length).toBe(3);
    expect(requests.every((u) => u.searchParams.get('query').includes(CARD))).toBe(true);
    await expect(page.locator(`${cardSel(COUNTER)} [data-test="dashboard-panel-exemplar-points"]`)).toHaveCount(0);
  });

  test('turning the card off restores heatmap and aborts on filter change', { tag: ['@exemplars', '@metrics-explorer', '@P1', '@all'] }, async ({ page }) => {
    const pm = new PageManager(page);
    const aborted = [];
    page.on('requestfailed', (req) => {
      if (req.url().includes('/query_exemplars')) aborted.push(req.url());
    });
    await page.route('**/prometheus/api/v1/query_exemplars**', async (route) => {
      await new Promise((r) => setTimeout(r, 5_000));
      await route.continue().catch(() => {});
    });
    await pm.metricsExplorerPage.gotoExplorer();
    const search = page.locator('[data-test="metrics-explorer-search"] input');
    await search.fill(PREFIX);
    await page.locator(cardSel(CARD)).hover();
    await page.locator(toggleSel(CARD)).click();
    await expect(page.locator(`[data-test="metrics-explorer-card-exemplars-loading-${CARD}"]`)).toBeVisible();
    await search.fill(`${PREFIX}_requests`);
    await expect.poll(() => aborted.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.unroute('**/prometheus/api/v1/query_exemplars**');

    await search.fill(PREFIX);
    await page.locator(toggleSel(CARD)).click();
    await expect(page.locator(`[data-test="metrics-explorer-card-rest-info-${CARD}"]`)).toContainText('heatmap');
  });
});
