const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { generateHexId, getTimestampNs } = require('../utils/trace-ingestion.js');
const fetch = require('node-fetch');

// ============================================================
// Model Pricing — Cost Verification
//
// These tests verify that pricing definitions configured in
// Settings > Model Pricing are actually applied at ingestion
// time: when a span carrying a matching gen_ai.request.model
// arrives, OpenObserve must write the calculated cost back into
// gen_ai_usage_cost (and the input/output breakdown fields)
// stored in the trace stream.
//
// Pattern:
//   1. Create a pricing model with a unique regex and known prices
//   2. Ingest a synthetic OTLP span with a matching model name
//      and exact token counts
//   3. Poll the search API until the span appears (up to 30 s)
//   4. Assert gen_ai_usage_cost matches the expected arithmetic
//
// Stream: "default" (the trace stream used by the OTLP endpoint
//         when no stream name is specified in the request URL)
// ============================================================

test.describe.configure({ mode: 'serial' });

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function base() {
    return `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}`;
}

function headers() {
    return getAuthHeaders();
}

async function createPricingModel(body) {
    const res = await fetch(`${base()}/llm/models`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createPricingModel failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function deletePricingModel(id) {
    await fetch(`${base()}/llm/models/${id}`, { method: 'DELETE', headers: headers() });
}

/** Build a minimal OTLP JSON span that OpenObserve recognises as an LLM span. */
function buildLlmOtlpPayload({ traceId, spanId, modelName, inputTokens, outputTokens, durationMs = 1000 }) {
    const startNs = BigInt(Date.now()) * 1_000_000n;
    const endNs   = startNs + BigInt(durationMs) * 1_000_000n;

    return {
        resourceSpans: [{
            resource: {
                attributes: [
                    { key: 'service.name',                  value: { stringValue: 'e2e-pricing-verifier' } },
                    { key: 'service.version',               value: { stringValue: '1.0.0' } },
                    { key: 'telemetry.sdk.language',        value: { stringValue: 'nodejs' } },
                    { key: 'telemetry.sdk.name',            value: { stringValue: 'opentelemetry' } },
                ],
            },
            scopeSpans: [{
                scope: { name: 'opentelemetry-instrumentation-genai', version: '1.0.0' },
                spans: [{
                    traceId,
                    spanId,
                    name:                `gen_ai.chat.completions ${modelName}`,
                    kind:                3,  // CLIENT
                    startTimeUnixNano:   String(startNs),
                    endTimeUnixNano:     String(endNs),
                    attributes: [
                        { key: 'gen_ai.operation.name',       value: { stringValue: 'chat' } },
                        { key: 'gen_ai.system',               value: { stringValue: 'anthropic' } },
                        { key: 'gen_ai.request.model',        value: { stringValue: modelName } },
                        { key: 'gen_ai.response.model',       value: { stringValue: modelName } },
                        { key: 'gen_ai.usage.input_tokens',   value: { intValue: inputTokens } },
                        { key: 'gen_ai.usage.output_tokens',  value: { intValue: outputTokens } },
                        {
                            key: 'gen_ai.input.messages',
                            value: { stringValue: JSON.stringify([{ role: 'user', content: 'hello' }]) },
                        },
                        {
                            key: 'gen_ai.output.messages',
                            value: { stringValue: JSON.stringify([{ role: 'assistant', content: 'hi' }]) },
                        },
                    ],
                    status: { code: 1 },  // OK
                }],
            }],
        }],
    };
}

/** Ingest a single OTLP span via the traces HTTP endpoint. */
async function ingestSpan(page, payload) {
    const res = await page.request.post(`${base()}/v1/traces`, {
        headers: headers(),
        data: payload,
    });
    if (res.status() !== 200) {
        throw new Error(`Trace ingestion returned ${res.status()}: ${await res.text()}`);
    }
}

/**
 * Poll the trace search API until the span with the given spanId appears,
 * OR until timeoutMs is reached.  Returns the first matching hit, or null.
 */
async function pollForSpan(page, spanId, timeoutMs = 30_000, intervalMs = 3_000) {
    const org     = getOrgIdentifier();
    const nowUs   = Date.now() * 1000;
    const startUs = nowUs - 2 * 60 * 1_000_000;  // 2 min back
    const endUs   = nowUs + 5 * 60 * 1_000_000;  // 5 min forward

    const searchUrl = `${process.env.ZO_BASE_URL}/api/${org}/_search?type=traces`;
    const body = {
        query: {
            sql: `SELECT span_id, gen_ai_usage_cost, gen_ai_usage_input_tokens, gen_ai_usage_output_tokens
                  FROM default
                  WHERE span_id = '${spanId}'`,
            start_time: startUs,
            end_time:   endUs,
            size:       10,
        },
    };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await fetch(searchUrl, {
            method:  'POST',
            headers: headers(),
            body:    JSON.stringify(body),
        });
        if (res.ok) {
            const data = await res.json();
            const hits = data?.hits ?? [];
            if (hits.length > 0) return hits[0];
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return null;
}

// ============================================================
// Journey 1 — Custom pricing cost is applied to an ingested
// matching LLM span
// ============================================================

test.describe('Model Pricing — Cost Applied to Ingested LLM Span', () => {

    test('Custom pricing cost is correctly calculated and stored when a matching LLM span is ingested', {
        tag: ['@modelPricing', '@costVerification', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        const ts      = Date.now();
        const pattern = `^e2e-llm-pricing-${ts}-.*`;
        const model   = `e2e-llm-pricing-${ts}-gpt`;

        // Prices: $3/M input, $15/M output — stored as per-token values
        const inputPricePerToken  = 3  / 1_000_000;  // 0.000003
        const outputPricePerToken = 15 / 1_000_000;  // 0.000015
        const inputTokens  = 1_000;
        const outputTokens = 500;
        const expectedInputCost  = inputTokens  * inputPricePerToken;   // 0.003
        const expectedOutputCost = outputTokens * outputPricePerToken;  // 0.0075
        const expectedTotalCost  = expectedInputCost + expectedOutputCost; // 0.0105

        let modelId = null;

        try {
            // ── Step 1: create the pricing model ──────────────────
            const created = await createPricingModel({
                name:          `E2E Pricing Verifier ${ts}`,
                match_pattern: pattern,
                enabled:       true,
                tiers: [{
                    name:      'Default',
                    condition: null,
                    prices: {
                        input:  inputPricePerToken,
                        output: outputPricePerToken,
                    },
                }],
            });
            modelId = created?.id;
            expect(modelId, 'pricing model must be created with an ID').toBeTruthy();
            testLogger.info('Pricing model created', { modelId, pattern });

            // ── Step 2: wait for the in-memory pricing cache to pick up
            //    the new definition before ingesting
            await page.waitForTimeout(5_000);

            // ── Step 3: ingest a synthetic LLM span ───────────────
            const traceId = generateHexId(16);
            const spanId  = generateHexId(8);
            const payload = buildLlmOtlpPayload({ traceId, spanId, modelName: model, inputTokens, outputTokens });
            await ingestSpan(page, payload);
            testLogger.info('LLM span ingested', { spanId, model, inputTokens, outputTokens });

            // ── Step 4: poll search API until the span is queryable ─
            const hit = await pollForSpan(page, spanId);
            expect(hit, `span ${spanId} must appear in the default trace stream within 30 s`).not.toBeNull();
            testLogger.info('Span found in stream', { hit });

            // ── Step 5: verify cost fields ─────────────────────────
            const actualCost = Number(hit.gen_ai_usage_cost);
            expect(actualCost, 'gen_ai_usage_cost must be > 0').toBeGreaterThan(0);
            expect(
                Math.abs(actualCost - expectedTotalCost),
                `total cost must be ~${expectedTotalCost} (got ${actualCost})`
            ).toBeLessThan(1e-9);

            // Input/output breakdown fields (written for user-defined pricing)
            if (hit.gen_ai_usage_cost_input != null) {
                expect(
                    Math.abs(Number(hit.gen_ai_usage_cost_input) - expectedInputCost)
                ).toBeLessThan(1e-9);
            }
            if (hit.gen_ai_usage_cost_output != null) {
                expect(
                    Math.abs(Number(hit.gen_ai_usage_cost_output) - expectedOutputCost)
                ).toBeLessThan(1e-9);
            }

            testLogger.info('Cost assertion passed', {
                expectedTotal:  expectedTotalCost,
                actualTotal:    actualCost,
                expectedInput:  expectedInputCost,
                expectedOutput: expectedOutputCost,
            });

        } finally {
            if (modelId) await deletePricingModel(modelId);
        }

        testLogger.info('Test completed successfully');
    });

});

// ============================================================
// Journey 2 — LLM span with no matching pricing model stores
// zero cost (no built-in entry for the model name)
// ============================================================

test.describe('Model Pricing — No Matching Model Stores Zero Cost', () => {

    test('LLM span with a completely unknown model name is stored with no cost applied', {
        tag: ['@modelPricing', '@costVerification', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        const ts      = Date.now();
        // Deliberately bizarre name — will never match any built-in or user-defined pricing
        const model   = `e2e-unknown-model-${ts}-xqz`;
        const traceId = generateHexId(16);
        const spanId  = generateHexId(8);

        const payload = buildLlmOtlpPayload({
            traceId, spanId, modelName: model,
            inputTokens: 500, outputTokens: 200,
        });
        await ingestSpan(page, payload);
        testLogger.info('LLM span with unknown model ingested', { spanId, model });

        const hit = await pollForSpan(page, spanId);
        expect(hit, `span ${spanId} must appear in the default trace stream within 30 s`).not.toBeNull();

        // Cost must be absent or zero for an unrecognised model
        const cost = hit.gen_ai_usage_cost;
        const costIsAbsent = cost == null || cost === '' || cost === undefined;
        const costIsZero   = Number(cost) === 0;
        expect(
            costIsAbsent || costIsZero,
            `gen_ai_usage_cost must be absent or 0 for an unrecognised model (got: ${cost})`
        ).toBe(true);

        testLogger.info('Zero-cost assertion passed', { cost });
        testLogger.info('Test completed successfully');
    });

});
