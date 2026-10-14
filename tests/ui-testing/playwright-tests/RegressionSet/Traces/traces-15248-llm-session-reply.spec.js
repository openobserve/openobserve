const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { LlmSessionDetailsPage } = require('../../../pages/tracesPages/llmSessionDetailsPage.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const HOUR_US = 60 * 60 * 1000 * 1000;
const QUESTION = 'What is the capital of France?';
const REPLY = 'Paris is the capital of France.';

const org = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const baseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
const stringAttr = (key, value) => ({ key, value: { stringValue: value } });
const intAttr = (key, value) => ({ key, value: { intValue: String(value) } });

// One chat span and nothing else: no execute_tool span, no gen_ai.tool.* attribute.
async function ingestChatTurnWithoutTools(page, stream) {
  const sessionId = `e2e-15248-${generateHexId(6)}`;
  const traceId = generateHexId(16);
  const nowNs = BigInt(Date.now()) * 1000000n;
  const response = await page.request.post(`${baseUrl()}/api/${org()}/v1/traces`, {
    headers: { ...getAuthHeaders(), 'stream-name': stream },
    data: {
      resourceSpans: [{
        resource: { attributes: [stringAttr('service.name', 'e2e-15248-chat')] },
        scopeSpans: [{
          scope: { name: 'e2e-15248' },
          spans: [{
            traceId,
            spanId: generateHexId(8),
            name: 'chat gpt-4o',
            kind: 3,
            startTimeUnixNano: String(nowNs - 3000000000n),
            endTimeUnixNano: String(nowNs - 2000000000n),
            attributes: [
              stringAttr('gen_ai.operation.name', 'chat'),
              stringAttr('gen_ai.provider.name', 'openai'),
              stringAttr('gen_ai.request.model', 'gpt-4o'),
              stringAttr('gen_ai.response.model', 'gpt-4o'),
              stringAttr('gen_ai.conversation.id', sessionId),
              stringAttr('gen_ai.input.messages', JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: QUESTION }] }])),
              stringAttr('gen_ai.output.messages', JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: REPLY }], finish_reason: 'stop' }])),
              intAttr('gen_ai.usage.input_tokens', 12),
              intAttr('gen_ai.usage.output_tokens', 8),
            ],
            status: { code: 1 },
          }],
        }],
      }],
    },
  });
  expect(response.status(), 'Precondition: the chat span must ingest').toBe(200);
  const nowUs = Date.now() * 1000;
  return { sessionId, traceId, fromUs: nowUs - HOUR_US, toUs: nowUs + 60_000_000 };
}

async function searchTraces(page, sql, turn) {
  const response = await page.request.post(`${baseUrl()}/api/${org()}/_search?type=traces`, {
    headers: getAuthHeaders(),
    data: { query: { sql, start_time: turn.fromUs, end_time: turn.toUs, from: 0, size: 100 } },
  });
  return { status: response.status(), text: await response.text() };
}

async function waitForChatSpan(page, stream, turn) {
  await expect.poll(async () => {
    const result = await searchTraces(page, `SELECT trace_id FROM "${stream}" WHERE trace_id = '${turn.traceId}'`, turn);
    return result.status === 200 ? (JSON.parse(result.text).hits || []).length : 0;
  }, { timeout: 60000, intervals: [2000], message: 'the chat span must become searchable' }).toBe(1);
}

async function streamFieldNames(page, stream) {
  const response = await page.request.get(`${baseUrl()}/api/${org()}/streams/${stream}/schema?type=traces`, { headers: getAuthHeaders() });
  if (!response.ok()) return [];
  return ((await response.json()).schema || []).map((f) => f.name);
}

// Same SELECT as fetchSessionSpans in web/src/plugins/traces/composables/useSessions.ts.
const sessionSpansSql = (stream, traceId) =>
  'SELECT span_id, trace_id, operation_name, gen_ai_operation_name, gen_ai_tool_name, duration, start_time, end_time, ' +
  'span_status, status_message, gen_ai_request_model, gen_ai_response_model, gen_ai_usage_cost, gen_ai_usage_total_tokens, ' +
  `gen_ai_input_messages, gen_ai_output_messages FROM "${stream}" WHERE trace_id IN ('${traceId}') ` +
  'AND gen_ai_operation_name IS NOT NULL ORDER BY start_time ASC LIMIT 2000';

async function deleteStream(page, stream) {
  await page.request
    .delete(`${baseUrl()}/api/${org()}/streams/${stream}?type=traces`, { headers: getAuthHeaders() })
    .catch(() => {});
}

test.describe('LLM session detail shows the reply of a chat with no tool call (#15248)', () => {
  test.describe.configure({ mode: 'parallel' });
  let stream;

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    stream = `e2e_15248_${generateHexId(4)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a chat with no tool call gets a gen_ai_tool_name column, so the session span query returns the reply', {
    tag: ['@bug-15248', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const turn = await ingestChatTurnWithoutTools(page, stream);
    // gen_ai_system_instructions is provisioned but never ingested here, so it proves the LLM schema was applied.
    await expect.poll(() => streamFieldNames(page, stream), {
      timeout: 30000,
      intervals: [1000, 2000],
      message: 'Precondition: the stream must be provisioned as an LLM stream',
    }).toContain('gen_ai_system_instructions');
    await expect.poll(() => streamFieldNames(page, stream), {
      timeout: 20000,
      intervals: [1000, 2000],
      message: '#15248: the LLM stream must have gen_ai_tool_name before any tool call',
    }).toContain('gen_ai_tool_name');

    await waitForChatSpan(page, stream, turn);
    const spans = await searchTraces(page, sessionSpansSql(stream, turn.traceId), turn);
    testLogger.info('Session span query', { status: spans.status, text: spans.text.slice(0, 200) });
    expect(spans.status, '#15248: the session span query must not fail on gen_ai_tool_name').toBe(200);
    const hits = JSON.parse(spans.text).hits || [];
    expect(hits, 'the session span query must return the chat span').toHaveLength(1);
    expect(hits[0].gen_ai_output_messages, 'the chat span must carry the assistant reply').toContain(REPLY);
  });

  test('the session detail turn shows the assistant reply when the chat made no tool call', {
    tag: ['@bug-15248', '@P1', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const turn = await ingestChatTurnWithoutTools(page, stream);
    await waitForChatSpan(page, stream, turn);

    await navigateToBase(page);
    const sessionPage = new LlmSessionDetailsPage(page);
    await sessionPage.open({ stream, sessionId: turn.sessionId, fromUs: turn.fromUs, toUs: turn.toUs, org: org() });
    await sessionPage.expandTurn(turn.traceId);
    await sessionPage.expectTurnReply(turn.traceId, REPLY);
    testLogger.info('Session turn shows the reply', { sessionId: turn.sessionId, traceId: turn.traceId });
  });
});
