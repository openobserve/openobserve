// ENT#3145: Top errors shows loading, not its empty message, until its query answers. ENT#3154: the AI data health strip flags real ingested gaps.
const crypto = require('crypto');
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { LlmInsightsPage } = require('../../../pages/onlineEvalsPages/llmInsightsPage.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const STAMP = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STREAM = `ovn_c_aip_${STAMP}`;
const ERROR_MESSAGE = `ovnc upstream timeout ${STAMP}`;
const UNPRICED_MODEL = `ovnc-unpriced-model-${STAMP}`;
const EMPTY_TEXT = 'No errors in this window';

function span({ model, error = false, offsetMs }) {
  const start = BigInt(Date.now() - offsetMs) * 1000000n;
  const str = (key, v) => ({ key, value: { stringValue: v } });
  const int = (key, v) => ({ key, value: { intValue: String(v) } });
  return {
    traceId: crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    name: `chat ${model}`,
    kind: 3,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + 400000000n),
    attributes: [
      str('gen_ai.operation.name', 'chat'),
      str('gen_ai.system', 'openai'),
      str('gen_ai.request.model', model),
      str('gen_ai.response.model', model),
      int('gen_ai.usage.input_tokens', 20),
      int('gen_ai.usage.output_tokens', 10),
    ],
    status: error ? { code: 2, message: ERROR_MESSAGE } : { code: 1 },
  };
}

// the UI may send the SQL base64-encoded
function sqlOf(postData) {
  let parsed;
  try { parsed = JSON.parse(postData || '{}'); } catch { return postData || ''; }
  const sql = parsed?.query?.sql || '';
  if (parsed?.encoding === 'base64' || !/\s/.test(sql)) {
    try { return Buffer.from(sql, 'base64').toString('utf8'); } catch { return sql; }
  }
  return sql;
}

test.describe('LLM Insights panels with real LLM traces (ENT#3145, ENT#3154)', { tag: ['@aiObservability', '@regression', '@P2', '@enterprise'] }, () => {
  test.describe.configure({ mode: 'serial' });
  let enterprise = false;

  test.beforeAll(async () => {
    const cfg = await (await fetch(`${BASE}/api/${ORG()}/config`, { headers: getAuthHeaders() })).json().catch(() => ({}));
    enterprise = cfg.build_type === 'enterprise';
    if (!enterprise) return;
    const spans = [
      span({ model: 'gpt-4o-mini', offsetMs: 1000 }),
      span({ model: 'gpt-4o-mini', offsetMs: 2000 }),
      span({ model: 'gpt-4o-mini', error: true, offsetMs: 3000 }),
      span({ model: 'gpt-4o-mini', error: true, offsetMs: 4000 }),
      span({ model: UNPRICED_MODEL, offsetMs: 5000 }),
    ];
    const res = await fetch(`${BASE}/api/${ORG()}/v1/traces`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json', 'stream-name': STREAM },
      body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: `svc_${STAMP}` } }] }, scopeSpans: [{ scope: { name: 'ovn-c-aip' }, spans }] }] }),
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

  test('Top errors shows loading until its query answers, then the real errors (ENT#3145)', async ({ page }) => {
    let release;
    const held = new Promise((r) => { release = r; });
    let heldCount = 0;
    await page.route(/\/_search(_stream)?(\?|$)/, async (route) => {
      const body = sqlOf(route.request().postData());
      if (body.includes(STREAM) && body.includes('status_message') && body.includes("span_status = 'ERROR'")) {
        heldCount += 1;
        await held;
      }
      await route.continue().catch(() => {});
    });

    const insights = new LlmInsightsPage(page);
    await insights.goto({ org: ORG(), stream: STREAM, period: '1h' });
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
    await insights.goto({ org: ORG(), stream: STREAM, period: '1h' });
    await expect(insights.dataHealthStrip).toBeVisible({ timeout: 60000 });
    await expect(insights.dataHealthChip('unpriced_models')).toBeVisible();
    await expect(insights.dataHealthChip('missing_session_id')).toBeVisible();
    await expect(insights.dataHealthError).toHaveCount(0);

    await insights.openDataHealthChip('unpriced_models');
    await expect(insights.dataHealthDrawer).toContainText(UNPRICED_MODEL, { timeout: 30000 });
  });
});
