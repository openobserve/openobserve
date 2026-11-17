// ENT#3145: Top errors shows loading, not its empty message, until its query answers. ENT#3154: the AI data health strip flags real ingested gaps.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { LlmInsightsPage } = require('../../../pages/onlineEvalsPages/llmInsightsPage.js');
const {
  orgIdentifier,
  isEnterpriseBuild,
  seedInsightsPanelSpans,
  decodeSearchSql,
  deleteTraceStream,
} = require('../../utils/ai-obs-seed-api.js');

const STAMP = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STREAM = `ovn_c_aip_${STAMP}`;
const ERROR_MESSAGE = `ovnc upstream timeout ${STAMP}`;
const UNPRICED_MODEL = `ovnc-unpriced-model-${STAMP}`;
const EMPTY_TEXT = 'No errors in this window';

test.describe('LLM Insights panels with real LLM traces (ENT#3145, ENT#3154)', { tag: ['@aiObservability', '@regression', '@P2', '@enterprise'] }, () => {
  test.describe.configure({ mode: 'serial' });
  let enterprise = false;

  test.beforeAll(async () => {
    enterprise = await isEnterpriseBuild();
    if (!enterprise) return;
    await seedInsightsPanelSpans({ stream: STREAM, stamp: STAMP, errorMessage: ERROR_MESSAGE, unpricedModel: UNPRICED_MODEL });
  });

  test.afterAll(async () => {
    if (enterprise) await deleteTraceStream(STREAM);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!enterprise, 'AI observability is enterprise-only');
    await navigateToBase(page);
  });

  test('Top errors shows loading until its query answers, then the real errors (ENT#3145)', async ({ page }) => {
    let release;
    const held = new Promise((r) => { release = r; });
    let heldCount = 0;
    await page.route(/\/_search(_stream)?(\?|$)/, async (route) => {
      const body = decodeSearchSql(route.request().postData());
      if (body.includes(STREAM) && body.includes('status_message') && body.includes("span_status = 'ERROR'")) {
        heldCount += 1;
        await held;
      }
      await route.continue().catch(() => {});
    });

    const insights = new LlmInsightsPage(page);
    await insights.goto({ org: orgIdentifier(), stream: STREAM, period: '1h' });
    const panel = insights.topErrorsPanel;
    await expect(panel).toBeAttached({ timeout: 60000 });
    await expect.poll(() => heldCount, { timeout: 30000, message: 'Top errors should query as soon as it mounts' }).toBeGreaterThan(0);
    await page.waitForTimeout(2000);
    await expect(panel, 'no empty message while the query is in flight').not.toContainText(EMPTY_TEXT);

    release();
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toContainText(ERROR_MESSAGE, { timeout: 30000 });
    await expect(panel).not.toContainText(EMPTY_TEXT);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('the AI data health strip flags the unpriced model and missing session ids (ENT#3154)', async ({ page }) => {
    const insights = new LlmInsightsPage(page);
    await insights.goto({ org: orgIdentifier(), stream: STREAM, period: '1h' });
    await expect(insights.dataHealthStrip).toBeVisible({ timeout: 60000 });
    await expect(insights.dataHealthChip('unpriced_models')).toBeVisible();
    await expect(insights.dataHealthChip('missing_session_id')).toBeVisible();
    await expect(insights.dataHealthError).toHaveCount(0);

    await insights.openDataHealthChip('unpriced_models');
    await expect(insights.dataHealthDrawer).toContainText(UNPRICED_MODEL, { timeout: 30000 });
  });
});
