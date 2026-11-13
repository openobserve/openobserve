// ENT#3133: entering LLM Insights cancels nothing; ENT#3141: Agent Graph and Agent Behavior honour agent and env from the URL.
const crypto = require('crypto');
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { AiAgentScopePage } = require('../../../pages/onlineEvalsPages/aiAgentScopePage.js');
const { LlmInsightsPage } = require('../../../pages/onlineEvalsPages/llmInsightsPage.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const STAMP = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STREAM = `ovn_c_ai_${STAMP}`;
// sorted so the target is never the list's first entry, which is what the old pages fell back to
const AGENTS = [
  { name: `ovnc_a_${STAMP}`, env: `ovncenva${STAMP}` },
  { name: `ovnc_b_${STAMP}`, env: `ovncenva${STAMP}` },
  { name: `ovnc_z_${STAMP}`, env: `ovncenvz${STAMP}` },
];
const TARGET = AGENTS[2];

function agentSpans(agent, offsetMs) {
  const start = BigInt(Date.now() - offsetMs) * 1000000n;
  const str = (key, v) => ({ key, value: { stringValue: v } });
  const int = (key, v) => ({ key, value: { intValue: String(v) } });
  return {
    resource: { attributes: [str('service.name', `svc_${agent.name}`), str('deployment.environment.name', agent.env)] },
    scopeSpans: [{
      scope: { name: 'ovn-c-ai' },
      spans: [{
        traceId: crypto.randomBytes(16).toString('hex'),
        spanId: crypto.randomBytes(8).toString('hex'),
        name: `chat ${agent.name}`,
        kind: 3,
        startTimeUnixNano: String(start),
        endTimeUnixNano: String(start + 500000000n),
        attributes: [
          str('gen_ai.agent.name', agent.name),
          str('gen_ai.operation.name', 'chat'),
          str('gen_ai.system', 'openai'),
          str('gen_ai.request.model', 'gpt-4o-mini'),
          int('gen_ai.usage.input_tokens', 12),
          int('gen_ai.usage.output_tokens', 7),
        ],
        status: { code: 1 },
      }],
    }],
  };
}

async function registeredAgents() {
  const res = await fetch(`${BASE}/api/${ORG()}/gen_ai/agents`, { headers: getAuthHeaders() });
  const body = await res.json().catch(() => ({}));
  return (body.agents || []).filter((a) => a.source_stream === STREAM);
}

test.describe('AI observability scope (ENT#3133, ENT#3141)', { tag: ['@aiObservability', '@regression', '@P2', '@enterprise'] }, () => {
  test.describe.configure({ mode: 'serial' });

  let enterprise = false;

  test.beforeAll(async () => {
    test.setTimeout(240000);
    const cfg = await (await fetch(`${BASE}/api/${ORG()}/config`, { headers: getAuthHeaders() })).json().catch(() => ({}));
    enterprise = cfg.build_type === 'enterprise';
    if (!enterprise) return;
    const res = await fetch(`${BASE}/api/${ORG()}/v1/traces`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json', 'stream-name': STREAM },
      body: JSON.stringify({ resourceSpans: AGENTS.map((a, i) => agentSpans(a, i * 1000)) }),
    });
    expect(res.ok, `OTLP ingest ${res.status}`).toBeTruthy();
    // the agent registry flushes on O2_GEN_AI_AGENT_REGISTRY_BATCH_FLUSH_INTERVAL_SECS (60s default)
    await expect.poll(async () => (await registeredAgents()).length, { timeout: 180000, intervals: [5000] }).toBe(AGENTS.length);
  });

  test.afterAll(async () => {
    await fetch(`${BASE}/api/${ORG()}/streams/${STREAM}?type=traces`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!enterprise, 'AI observability is enterprise-only');
    await navigateToBase(page);
  });

  test('entering LLM Insights sends no query cancel and aborts no search (ENT#3133)', async ({ page }) => {
    const cancels = [];
    const aborted = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && /\/query_manager\/cancel/.test(r.url())) cancels.push(r.url()); });
    page.on('requestfailed', (r) => { if (/_search/.test(r.url())) aborted.push(`${r.url()} ${r.failure()?.errorText}`); });
    let searches = 0;
    let inFlight = 0;
    page.on('request', (r) => { if (/_search/.test(r.url())) { searches += 1; inFlight += 1; } });
    page.on('requestfinished', (r) => { if (/_search/.test(r.url())) inFlight -= 1; });
    page.on('requestfailed', (r) => { if (/_search/.test(r.url())) inFlight -= 1; });

    await new LlmInsightsPage(page).goto({ org: ORG() });
    await expect.poll(() => searches, { timeout: 60000, message: 'Insights should run its panel searches' }).toBeGreaterThan(0);
    await expect.poll(() => inFlight, { timeout: 60000, message: 'every panel search must settle' }).toBe(0);
    // a mode flip that aborts panels happens after the first wave, so watch a quiet window too
    await page.waitForTimeout(3000);

    expect(cancels, 'no query_manager/cancel caused by entering Insights').toEqual([]);
    expect(aborted, 'no aborted _search while Insights settles').toEqual([]);
  });

  for (const view of [
    { path: 'agent-graph' },
    { path: 'agent-behavior' },
  ]) {
    test(`${view.path} opens on the agent and env named in the URL (ENT#3141)`, async ({ page }) => {
      const scope = new AiAgentScopePage(page);
      await scope.gotoView(view.path, { org: ORG(), agent: TARGET.name, env: TARGET.env });
      const agentSel = scope.agentSelection(view.path);
      const envSel = scope.envSelection(view.path);
      await expect(agentSel).toHaveAttribute('data-test-selected-value', TARGET.name, { timeout: 60000 });
      await expect(envSel).toHaveAttribute('data-test-selected-value', TARGET.env);
      await page.waitForTimeout(2000);
      await expect(agentSel, 'the page must not fall back to the first agent').toHaveAttribute('data-test-selected-value', TARGET.name);
      const url = new URL(page.url());
      expect(url.searchParams.get('agent')).toBe(TARGET.name);
      expect(url.searchParams.get('env')).toBe(TARGET.env);
    });
  }
});
