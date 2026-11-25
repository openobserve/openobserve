// REST seeding, lookups and cleanup for AI observability regression specs: gen_ai OTLP spans, agents and prompts.
const crypto = require('crypto');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

const orgIdentifier = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const str = (key, v) => ({ key, value: { stringValue: v } });
const int = (key, v) => ({ key, value: { intValue: String(v) } });

async function isEnterpriseBuild() {
  const cfg = await (await fetch(`${BASE}/api/${orgIdentifier()}/config`, { headers: getAuthHeaders() })).json().catch(() => ({}));
  return cfg.build_type === 'enterprise';
}

async function ingestOtlpTraces(stream, resourceSpans) {
  const res = await fetch(`${BASE}/api/${orgIdentifier()}/v1/traces`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json', 'stream-name': stream },
    body: JSON.stringify({ resourceSpans }),
  });
  if (!res.ok) throw new Error(`OTLP ingest ${res.status}`);
}

async function deleteTraceStream(stream) {
  await fetch(`${BASE}/api/${orgIdentifier()}/streams/${stream}?type=traces`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
}

function agentResourceSpans(agent, offsetMs) {
  const start = BigInt(Date.now() - offsetMs) * 1000000n;
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

const seedAgentSpans = (stream, agents) => ingestOtlpTraces(stream, agents.map((a, i) => agentResourceSpans(a, i * 1000)));

async function registeredAgentsFrom(stream) {
  const res = await fetch(`${BASE}/api/${orgIdentifier()}/gen_ai/agents`, { headers: getAuthHeaders() });
  const body = await res.json().catch(() => ({}));
  return (body.agents || []).filter((a) => a.source_stream === stream);
}

function llmChatSpan({ model, error = false, errorMessage, offsetMs }) {
  const start = BigInt(Date.now() - offsetMs) * 1000000n;
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
    status: error ? { code: 2, message: errorMessage } : { code: 1 },
  };
}

// two good and two failed gpt-4o-mini calls plus one call to a model with no pricing
function seedInsightsPanelSpans({ stream, stamp, errorMessage, unpricedModel }) {
  const spans = [
    llmChatSpan({ model: 'gpt-4o-mini', offsetMs: 1000 }),
    llmChatSpan({ model: 'gpt-4o-mini', offsetMs: 2000 }),
    llmChatSpan({ model: 'gpt-4o-mini', error: true, errorMessage, offsetMs: 3000 }),
    llmChatSpan({ model: 'gpt-4o-mini', error: true, errorMessage, offsetMs: 4000 }),
    llmChatSpan({ model: unpricedModel, offsetMs: 5000 }),
  ];
  return ingestOtlpTraces(stream, [{ resource: { attributes: [str('service.name', `svc_${stamp}`)] }, scopeSpans: [{ scope: { name: 'ovn-c-aip' }, spans }] }]);
}

// an LLM stream whose only span is 90 minutes old, so a 15-minute window is empty
function seedStaleLlmSpan(stream, stamp) {
  const start = BigInt(Date.now() - 90 * 60 * 1000) * 1000000n;
  return ingestOtlpTraces(stream, [{
    resource: { attributes: [str('service.name', `svc_${stamp}`)] },
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
          str('gen_ai.operation.name', 'chat'),
          str('gen_ai.request.model', 'gpt-4o-mini'),
          int('gen_ai.usage.input_tokens', 5),
        ],
        status: { code: 1 },
      }],
    }],
  }]);
}

// the UI may send the SQL base64-encoded
function decodeSearchSql(postData) {
  let parsed;
  try { parsed = JSON.parse(postData || '{}'); } catch { return postData || ''; }
  const sql = parsed?.query?.sql || '';
  if (parsed?.encoding === 'base64' || !/\s/.test(sql)) {
    try { return Buffer.from(sql, 'base64').toString('utf8'); } catch { return sql; }
  }
  return sql;
}

function genAiAgentRecord(name, env) {
  const now = Date.now() * 1000;
  return { name, id: `${name}_id`, source_stream: 'default', source_stream_type: 'traces', env, version: '1', first_seen: now - 3.6e9, last_seen: now };
}

async function findPromptByName(name) {
  const res = await fetch(`${BASE}/api/${orgIdentifier()}/prompts`, { headers: getAuthHeaders() });
  const body = await res.json().catch(() => ({}));
  return (body.list || body.prompts || body || []).find?.((p) => p.name === name) || null;
}

async function archivePrompt(entityId) {
  await fetch(`${BASE}/api/${orgIdentifier()}/prompts/${entityId}/archive`, { method: 'POST', headers: getAuthHeaders() }).catch(() => {});
}

module.exports = {
  orgIdentifier,
  isEnterpriseBuild,
  deleteTraceStream,
  seedAgentSpans,
  registeredAgentsFrom,
  seedInsightsPanelSpans,
  seedStaleLlmSpan,
  decodeSearchSql,
  genAiAgentRecord,
  findPromptByName,
  archivePrompt,
};
