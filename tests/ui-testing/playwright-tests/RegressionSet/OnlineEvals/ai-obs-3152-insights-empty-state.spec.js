// ENT#3152: the LLM Insights empty state offers the integration guide the user came from, plus one-click guide chips.
const crypto = require('crypto');
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { LlmInsightsPage } = require('../../../pages/onlineEvalsPages/llmInsightsPage.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const STAMP = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STREAM = `ovn_c_aie_${STAMP}`;
const DEEPSEEK_DOCS = 'https://openobserve.ai/docs/integration/ai/providers/deepseek/';

test.describe('LLM Insights empty state links to integrations (ENT#3152)', { tag: ['@aiObservability', '@regression', '@P2', '@enterprise'] }, () => {
  test.describe.configure({ mode: 'serial' });
  let enterprise = false;

  test.beforeAll(async () => {
    const cfg = await (await fetch(`${BASE}/api/${ORG()}/config`, { headers: getAuthHeaders() })).json().catch(() => ({}));
    enterprise = cfg.build_type === 'enterprise';
    if (!enterprise) return;
    // an LLM stream whose only span is 90 minutes old, so a 15-minute window is empty
    const start = BigInt(Date.now() - 90 * 60 * 1000) * 1000000n;
    const res = await fetch(`${BASE}/api/${ORG()}/v1/traces`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json', 'stream-name': STREAM },
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: `svc_${STAMP}` } }] },
          scopeSpans: [{
            scope: { name: 'ovn-c-aie' },
            spans: [{
              traceId: crypto.randomBytes(16).toString('hex'),
              spanId: crypto.randomBytes(8).toString('hex'),
              name: 'chat old',
              kind: 3,
              startTimeUnixNano: String(start),
              endTimeUnixNano: String(start + 300000000n),
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o-mini' } },
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '5' } },
              ],
              status: { code: 1 },
            }],
          }],
        }],
      }),
    });
    expect(res.ok, `OTLP ingest ${res.status}`).toBeTruthy();
  });

  test.afterAll(async () => {
    if (enterprise) await fetch(`${BASE}/api/${ORG()}/streams/${STREAM}?type=traces`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!enterprise, 'AI observability is enterprise-only');
    await navigateToBase(page);
  });

  test('arriving from the DeepSeek docs puts the DeepSeek guide first and it opens that guide', async ({ page }) => {
    const insights = new LlmInsightsPage(page);
    await insights.goto({ org: ORG(), stream: STREAM, period: '15m', referer: DEEPSEEK_DOCS });
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
    await insights.goto({ org: ORG(), stream: STREAM, period: '15m' });
    await expect(insights.emptyState).toBeVisible({ timeout: 60000 });
    await expect(insights.anySuggestedGuide).toHaveCount(0);
    await expect(insights.allIntegrationsAction).toBeVisible();
    const chip = insights.integrationChip('deepseek');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/deepseek/i, { timeout: 15000 });
  });
});
