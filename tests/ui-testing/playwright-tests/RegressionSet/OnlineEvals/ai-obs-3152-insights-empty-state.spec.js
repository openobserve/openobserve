// ENT#3152: the LLM Insights empty state offers the integration guide the user came from, plus one-click guide chips.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { LlmInsightsPage } = require('../../../pages/onlineEvalsPages/llmInsightsPage.js');
const { orgIdentifier, isEnterpriseBuild, seedStaleLlmSpan, deleteTraceStream } = require('../../utils/ai-obs-seed-api.js');

const STAMP = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STREAM = `ovn_c_aie_${STAMP}`;
const DEEPSEEK_DOCS = 'https://openobserve.ai/docs/integration/ai/providers/deepseek/';

test.describe('LLM Insights empty state links to integrations (ENT#3152)', { tag: ['@aiObservability', '@regression', '@P2', '@enterprise'] }, () => {
  test.describe.configure({ mode: 'serial' });
  let enterprise = false;

  test.beforeAll(async () => {
    enterprise = await isEnterpriseBuild();
    if (!enterprise) return;
    await seedStaleLlmSpan(STREAM, STAMP);
  });

  test.afterAll(async () => {
    if (enterprise) await deleteTraceStream(STREAM);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!enterprise, 'AI observability is enterprise-only');
    await navigateToBase(page);
  });

  test('arriving from the DeepSeek docs puts the DeepSeek guide first and it opens that guide', async ({ page }) => {
    const insights = new LlmInsightsPage(page);
    await insights.goto({ org: orgIdentifier(), stream: STREAM, period: '15m', referer: DEEPSEEK_DOCS });
    await expect(insights.emptyState).toBeVisible({ timeout: 60000 });
    const suggested = insights.suggestedGuide('deepseek');
    await expect(suggested).toBeVisible();
    await expect(suggested).toContainText('DeepSeek');
    await expect(insights.integrationChip('deepseek')).toHaveCount(0);

    await suggested.click();
    await expect(page).toHaveURL(/deepseek/i, { timeout: 15000 });
  });

  test('without a docs referrer the popular guides show as chips that open their guide', async ({ page }) => {
    const insights = new LlmInsightsPage(page);
    await insights.goto({ org: orgIdentifier(), stream: STREAM, period: '15m' });
    await expect(insights.emptyState).toBeVisible({ timeout: 60000 });
    await expect(insights.anySuggestedGuide).toHaveCount(0);
    await expect(insights.allIntegrationsAction).toBeVisible();
    const chip = insights.integrationChip('deepseek');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/deepseek/i, { timeout: 15000 });
  });
});
