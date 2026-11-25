import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addUsage,
  cleanAttributeValue,
  cleanAttributes,
  experimentAttributes,
  genAiProviderName,
  genAiRequestAttributes,
  genAiResponseAttributes,
  genAiUsageAttributes,
  sha256,
} from "../telemetry.mjs";
import { MAX_SYSTEM_PROMPT_CHARS, reviewerPrompts } from "../src/arms.mjs";
import { reviewerDiff } from "../src/pr-diff.mjs";
import { MAX_USER_PROMPT_CHARS } from "../src/coordinator-input.mjs";
import { shouldRetry } from "../src/opencode.mjs";
import { mapStrings } from "../src/report.mjs";
import { RunSummary, parseTokenPrices, sessionCost, sumTokens, writeRunSummary } from "../src/run-summary.mjs";
import { scrubSecrets } from "../src/scrub.mjs";

test("request content uses standard GenAI attributes without TraceLoop prompt keys", () => {
  const attributes = genAiRequestAttributes("Follow the review policy.", "Review this diff.");

  assert.equal(
    Object.keys(attributes).some(key => key.startsWith("gen_ai.prompt.")),
    false,
  );
  assert.deepEqual(JSON.parse(attributes["gen_ai.system_instructions"]), [
    { type: "text", content: "Follow the review policy." },
  ]);
  assert.deepEqual(JSON.parse(attributes["gen_ai.input.messages"]), [
    {
      role: "user",
      parts: [{ type: "text", content: "Review this diff." }],
    },
  ]);
  assert.equal(
    attributes["ai.review.system_instructions.sha256"],
    sha256("Follow the review policy."),
  );
});

test("response content and provider-reported usage use standard attributes", () => {
  const attributes = genAiResponseAttributes(
    {
      info: {
        id: "msg-123",
        modelID: "claude-sonnet-5-5",
        finish: "stop",
        cost: 0.42,
        tokens: {
          input: 1234,
          output: 56,
          reasoning: 12,
          cache: { read: 78, write: 9 },
        },
      },
    },
    "Looks good.",
    "fallback-model",
  );

  assert.deepEqual(JSON.parse(attributes["gen_ai.output.messages"]), [
    {
      role: "assistant",
      parts: [{ type: "text", content: "Looks good." }],
    },
  ]);
  assert.deepEqual(attributes["gen_ai.response.finish_reasons"], ["stop"]);
  assert.equal(attributes["gen_ai.usage.input_tokens"], 1234 + 78 + 9);
  assert.equal(attributes["gen_ai.usage.output_tokens"], 56 + 12);
  assert.equal(attributes["gen_ai.usage.total_tokens"], 1234 + 78 + 9 + 56 + 12);
  assert.equal(attributes["gen_ai.usage.cache_read.input_tokens"], 78);
  assert.equal(attributes["gen_ai.usage.cache_creation.input_tokens"], 9);
  assert.equal(attributes["gen_ai.usage.cache_read_tokens"], undefined);
  assert.equal(attributes["gen_ai.usage.cost"], undefined, "the server prices the span from its token counts");
  assert.equal(Object.keys(attributes).some(key => key.includes("cost")), false);
  assert.equal(attributes["ai.usage.reasoning_tokens"], 12);
  assert.equal(
    Object.keys(attributes).some(key => key.startsWith("gen_ai.completion.")),
    false,
  );
});

test("usage without cache or reasoning breakdown passes through unchanged", () => {
  const attributes = genAiResponseAttributes(
    { info: { tokens: { input: 100, output: 20 } } },
    "ok",
    "claude-sonnet-5-5",
  );

  assert.equal(attributes["gen_ai.usage.input_tokens"], 100);
  assert.equal(attributes["gen_ai.usage.output_tokens"], 20);
  assert.equal(attributes["gen_ai.usage.cache_read.input_tokens"], undefined);
});

test("missing provider usage is omitted instead of replaced with synthetic counts", () => {
  const attributes = genAiResponseAttributes(
    { info: { id: "msg-456" } },
    "No usage available.",
    "requested-model",
  );

  assert.equal(attributes["gen_ai.usage.input_tokens"], undefined);
  assert.equal(attributes["gen_ai.usage.output_tokens"], undefined);
  assert.equal(attributes["gen_ai.usage.cost"], undefined);
  assert.equal(attributes["gen_ai.response.model"], "requested-model");
});

test("homogeneous primitive arrays remain native OTel attribute arrays", () => {
  assert.deepEqual(cleanAttributeValue(["security", "performance"]), [
    "security",
    "performance",
  ]);
  assert.equal(cleanAttributeValue([{ name: "security" }]), '[{"name":"security"}]');
});

test("review instrumentation does not emit legacy TraceLoop content attributes", () => {
  const reviewSource = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(reviewSource, /["']gen_ai\.prompt\./);
  assert.doesNotMatch(reviewSource, /["']gen_ai\.completion\./);
});

test("usage of retried attempts is summed, and a missing side is skipped", () => {
  const a = { tokens: { input: 10, output: 2, reasoning: 5, cache: { read: 100, write: 0 } } };
  const b = { tokens: { input: 20, output: 3, reasoning: 7, cache: { read: 50, write: 1 } } };
  const sum = addUsage(a, b);
  assert.deepEqual(sum.tokens, { input: 30, output: 5, reasoning: 12, cache: { read: 150, write: 1 } });
  assert.equal(addUsage(null, b), b);
  assert.equal(addUsage(a, undefined), a);
});

test("opencode provider ids map to the OTel gen_ai.provider.name vendor value", () => {
  assert.equal(genAiProviderName("anthropic-review"), "anthropic");
  assert.equal(genAiProviderName("deepseek-review"), "deepseek");
  assert.equal(genAiProviderName("other-review"), "other-review");
});

test("neither config carries model prices, so the server's pricing table is the only price list", () => {
  for (const file of ["opencode.jsonc", "opencode.ci.jsonc"]) {
    const config = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(config, /"cost"\s*:/, file);
  }
});

test("OpenRouter provider ids map to their own gen_ai.provider.name", () => {
  assert.equal(genAiProviderName("openrouter-review"), "openrouter");
});

test("the experiment's id, arm, row and zero-based trial become openobserve.experiment attributes, and nothing else does", () => {
  assert.deepEqual(experimentAttributes({ REVIEW_EXPERIMENT_ID: "exp1", REVIEW_EXPERIMENT_ARM: "b", REVIEW_EXPERIMENT_ROW_ID: "row-9", REVIEW_EXPERIMENT_TRIAL: "0" }), {
    "openobserve.experiment.id": "exp1",
    "openobserve.experiment.arm": "b",
    "openobserve.experiment.row_id": "row-9",
    "openobserve.experiment.trial_index": 0,
  });
  assert.equal(experimentAttributes({ REVIEW_EXPERIMENT_TRIAL: "3" })["openobserve.experiment.trial_index"], 3);
  assert.deepEqual(experimentAttributes({}), {});
  assert.deepEqual(experimentAttributes({ REVIEW_EXPERIMENT_TRIAL: "-1" }), {}, "a trial that is not a whole number is left out");
  assert.deepEqual(experimentAttributes({ REVIEW_EXPERIMENT_TRIAL: "1.5", REVIEW_EXPERIMENT_ARM: " " }), {});
});

// The span-writing half of the runner's TraceRecorder, lifted from the source with a recording tracer in place of OpenTelemetry's.
function recorder({ experiment = {}, scrub = null } = {}) {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  const methods = source.slice(source.indexOf("  // Experiment coordinates ride on every span"), source.indexOf("  async flush() {"));
  const Recorder = new Function("cleanAttributes", "mapStrings", "trace", "context", "SpanKind", "SpanStatusCode", `return class { ${methods} }`)(
    cleanAttributes, mapStrings, { setSpan: () => ({}) }, { active: () => ({}) }, { INTERNAL: 0 }, { OK: 1, ERROR: 2 },
  );
  const spans = [];
  const instance = new Recorder();
  Object.assign(instance, {
    experiment,
    scrub,
    spanCount: 0,
    tracer: {
      startSpan: (name, options) => {
        const span = { name, attributes: { ...options.attributes }, exceptions: [], status: null, ended: false };
        span.setAttributes = attrs => Object.assign(span.attributes, attrs);
        span.recordException = error => span.exceptions.push(error);
        span.setStatus = status => { span.status = status; };
        span.end = () => { span.ended = true; };
        spans.push(span);
        return span;
      },
    },
  });
  return { trace: instance, spans };
}

test("every span, root and child, carries the experiment coordinates from the moment it starts, whatever else sets attributes later", () => {
  const experiment = experimentAttributes({ REVIEW_EXPERIMENT_ID: "exp1", REVIEW_EXPERIMENT_ARM: "c", REVIEW_EXPERIMENT_ROW_ID: "row-1", REVIEW_EXPERIMENT_TRIAL: "0" });
  const { trace, spans } = recorder({ experiment });
  const root = trace.startSpan("github.workflow.ai_code_review", { "github.pr.number": "5" });
  const child = trace.startSpan("ai_review.reviewer", { "review.pass": 1 }, root);
  const llm = trace.startSpan("gen_ai.chat", {}, child);
  // A caller cannot overwrite them, nor lose them on an attribute update.
  trace.setSpanAttributes(llm, { "openobserve.experiment.arm": "forged", "gen_ai.usage.input_tokens": 5 });
  trace.endSpan(llm, {}, new Error("boom"));
  trace.endSpan(child);
  trace.endSpan(root);
  assert.equal(spans.length, 3);
  for (const span of spans) {
    assert.equal(span.attributes["openobserve.experiment.id"], "exp1", span.name);
    assert.equal(span.attributes["openobserve.experiment.arm"], "c", span.name);
    assert.equal(span.attributes["openobserve.experiment.row_id"], "row-1", span.name);
    assert.equal(span.attributes["openobserve.experiment.trial_index"], 0, span.name);
    assert.equal(span.ended, true);
  }
  assert.equal(trace.spanCount, 3);
  // Without an experiment nothing is added.
  const plain = recorder();
  plain.trace.startSpan("x", { a: 1 });
  assert.deepEqual(plain.spans[0].attributes, { a: 1 });
  // And every span in the runner is started through this one method.
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  assert.equal((source.match(/tracer\.startSpan\(/g) || []).length, 1);
});

test("in a dry run span strings, error messages and recorded exceptions are scrubbed before they leave the process", () => {
  const env = { OPENROUTER_REVIEW_API_KEY: "sk-or-v1-0123456789abcdef", O2_TRACE_AUTH: "Basic dXNlcjpwYXNzd29yZA==" }; // gitleaks:allow
  const scrub = text => scrubSecrets(text, env).text;
  const { trace, spans } = recorder({ scrub });
  const span = trace.startSpan("gen_ai.chat", { "gen_ai.input.messages": `key ${env.OPENROUTER_REVIEW_API_KEY} here`, "review.agents": ["a", env.O2_TRACE_AUTH] });
  trace.endSpan(span, { "gen_ai.output.messages": `echo ${env.OPENROUTER_REVIEW_API_KEY}` }, Object.assign(new Error(`401 for ${env.OPENROUTER_REVIEW_API_KEY}`), { name: "ApiError" }));
  const everything = JSON.stringify({ attributes: spans[0].attributes, exceptions: spans[0].exceptions.map(e => ({ name: e.name, message: e.message })), status: spans[0].status });
  assert.equal(everything.includes(env.OPENROUTER_REVIEW_API_KEY), false);
  assert.equal(everything.includes(env.O2_TRACE_AUTH), false);
  assert.match(everything, /\[redacted\]/);
  assert.equal(spans[0].attributes["error.type"], "ApiError");
  assert.equal(spans[0].exceptions[0].name, "ApiError");
  // Outside a dry run nothing is rewritten.
  const live = recorder();
  const liveSpan = live.trace.startSpan("x", { text: env.OPENROUTER_REVIEW_API_KEY });
  live.trace.endSpan(liveSpan);
  assert.equal(live.spans[0].attributes.text, env.OPENROUTER_REVIEW_API_KEY);
});

const usage = (input, output, reasoning, read, write) => ({ input, output, reasoning, cache: { read, write } });
const PRICES = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 };

test("session usage keeps the five token fields apart and reports an unreported field as null, never zero", () => {
  const summary = new RunSummary({ traceId: "a".repeat(32), prices: PRICES });
  const ok = summary.startSession({ agent: "security", pass: 1, attempt: 1 });
  summary.endSession(ok, { outcome: "ok", tokens: usage(1000, 200, 50, 4000, 9000) });
  const partial = summary.startSession({ agent: "correctness", pass: 1, attempt: 1 });
  summary.endSession(partial, { outcome: "ok", tokens: { input: 10, output: 5 } });
  const [a, b] = summary.sessions;
  assert.deepEqual(a.tokens, { input: 1000, output: 200, reasoning: 50, cache_read: 4000, cache_write: 9000 });
  assert.deepEqual(b.tokens, { input: 10, output: 5, reasoning: null, cache_read: null, cache_write: null });
  assert.equal(b.cost, null, "a session with unreported usage has no cost");
  assert.ok(Math.abs(a.cost - ((1000 * 3 + 250 * 15 + 4000 * 0.3 + 9000 * 3.75) / 1e6)) < 1e-12, "reasoning is priced as output");
  assert.deepEqual(Object.keys(a), ["agent", "pass", "attempt", "duration_ms", "outcome", "tokens", "cost"]);
  const totals = summary.totals();
  assert.deepEqual(totals.tokens, { input: 1010, output: 205, reasoning: null, cache_read: null, cache_write: null }, "a total is stated only when every session reported the field");
  assert.equal(totals.cost, null);
  assert.equal(totals.complete, false);
});

test("totals include failed and retried attempts, each as its own session", () => {
  const summary = new RunSummary({ traceId: "b".repeat(32), prices: PRICES });
  for (const [agent, attempt, outcome, tokens] of [
    ["security", 1, "error", usage(100, 10, 0, 0, 500)],
    ["security", 2, "ok", usage(20, 30, 5, 400, 0)],
    ["coordinator", 1, "timeout", usage(7, 1, 0, 3, 11)],
  ]) {
    const session = summary.startSession({ agent, pass: agent === "coordinator" ? null : 1, attempt });
    summary.endSession(session, { outcome, tokens });
  }
  const built = summary.build({ outcome: "partial_success" });
  assert.deepEqual(built.sessions.map(s => [s.agent, s.pass, s.attempt, s.outcome]), [["security", 1, 1, "error"], ["security", 1, 2, "ok"], ["coordinator", null, 1, "timeout"]]);
  assert.deepEqual(built.totals.tokens, { input: 127, output: 41, reasoning: 5, cache_read: 403, cache_write: 511 });
  assert.equal(built.totals.complete, true);
  assert.equal(built.totals.sessions, 3);
  const expected = built.sessions.reduce((sum, s) => sum + s.cost, 0);
  assert.ok(Math.abs(built.totals.cost - expected) < 1e-12);
  assert.ok(built.totals.cost > 0);
});

test("a session still open at exit is recorded as interrupted with unknown usage, so the totals cannot claim to be complete", () => {
  const summary = new RunSummary({ traceId: "c".repeat(32), prices: PRICES });
  const done = summary.startSession({ agent: "security", pass: 1, attempt: 1 });
  summary.endSession(done, { outcome: "ok", tokens: usage(1, 1, 0, 0, 0) });
  summary.startSession({ agent: "correctness", pass: 1, attempt: 1 });
  const built = summary.build({ outcome: "timeout", error: "Overall timeout (2400s) reached" });
  assert.equal(built.outcome, "timeout");
  assert.equal(built.error, "Overall timeout (2400s) reached");
  assert.deepEqual(built.sessions.map(s => s.outcome), ["ok", "interrupted"]);
  assert.deepEqual(built.sessions[1].tokens, { input: null, output: null, reasoning: null, cache_read: null, cache_write: null });
  assert.equal(built.totals.complete, false);
  assert.equal(built.totals.cost, null);
  assert.equal(built.totals.tokens.input, null);
});

test("cost needs known usage and a price for every kind of token actually used", () => {
  const tokens = { input: 1_000_000, output: 500_000, reasoning: 500_000, cache_read: 2_000_000, cache_write: 1_000_000 };
  assert.equal(sessionCost(tokens, PRICES), 3 + 15 + 0.6 + 3.75);
  assert.equal(sessionCost(tokens, { ...PRICES, cache_write: null }), null, "cache writes were used and unpriced");
  assert.equal(sessionCost({ ...tokens, cache_write: 0 }, { ...PRICES, cache_write: null }), 3 + 15 + 0.6, "an unused kind needs no price");
  assert.equal(sessionCost({ ...tokens, reasoning: null }, PRICES), null, "reasoning unknown, so output is");
  assert.equal(sessionCost(tokens, null), null);
  assert.equal(sessionCost({ input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 }, { input: null, output: null, cache_read: null, cache_write: null }), 0);
  assert.deepEqual(sumTokens([]), { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 });
});

test("REVIEW_TOKEN_PRICES is USD per million tokens under four keys, and anything else is a problem", () => {
  assert.deepEqual(parseTokenPrices(undefined), { prices: null, problem: "" });
  assert.deepEqual(parseTokenPrices(JSON.stringify({ input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 })).prices, PRICES);
  assert.deepEqual(parseTokenPrices('{"input":3,"output":15}').prices, { input: 3, output: 15, cache_read: null, cache_write: null });
  for (const bad of ["not json", "[1]", '{"input":-1}', '{"input":"3"}', '{"cached":1}', "null"]) assert.notEqual(parseTokenPrices(bad).problem, "", bad);
});

// callOpencode as the runner has it, against a fake opencode client whose attempts follow a script.
function callWith(script, { prices = PRICES, summaryOptions = {} } = {}) {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function callOpencode("), source.indexOf("// ─── Run single reviewer"));
  const SUMMARY = new RunSummary({ traceId: "d".repeat(32), prices, ...summaryOptions });
  const REVIEWER_HOOKS = new AsyncLocalStorage();
  const prompts = [];
  let attempts = 0;
  const spans = [];
  const scope = {
    SUMMARY, REVIEWER_HOOKS, AGENT_TIMEOUT_MS: 1000, COORDINATOR_VARIANT: "high", MODEL_VARIANT: "high", GEN_AI_PROVIDER_NAME: "openrouter", MODEL_ID: "m", PROVIDER_ID: "p",
    MAX_SYSTEM_PROMPT_CHARS, MAX_USER_PROMPT_CHARS, SpanKind: { CLIENT: 3 }, MAX_TRANSIENT_RETRIES: 2, MIN_COORDINATOR_MS: 0, POST_RESERVE_MS: 0,
    remainingRunMs: () => 1e9, shouldRetry, addUsage, genAiRequestAttributes, genAiResponseAttributes, genAiUsageAttributes, isoNow: () => "now",
    console: { log() {}, warn() {}, error() {} },
    TRACE: { startSpan: () => ({}), setSpanAttributes: (span, attrs) => spans.push(attrs), endSpan() {} },
    opencodeClient: async () => ({
      prompt: async options => {
        prompts.push(options);
        const step = script[attempts];
        attempts += 1;
        if (step.fail) throw Object.assign(new Error(step.fail), step.error ?? {});
        return { text: "<no-issues/>", responseId: "r", info: { tokens: step.tokens, sessionTokens: step.lastMessageOnly ? undefined : step.tokens }, rejectedPermissions: 0 };
      },
    }),
  };
  const callOpencode = new Function(...Object.keys(scope), `${body}\nreturn callOpencode;`)(...Object.values(scope));
  return { callOpencode, summary: SUMMARY, prompts, hooks: REVIEWER_HOOKS };
}

test("a transient failure's usage is recorded as its own session, then the retry's, and both count in the totals", async () => {
  const { callOpencode, summary } = callWith([
    { fail: "429 Too Many Requests", error: { transient: true, usage: { tokens: usage(100, 10, 0, 0, 500) } } },
    { tokens: usage(20, 30, 5, 400, 0) },
  ]);
  await callOpencode("ai-review-security", "sys", "user", 1000, { agentKey: "security", pass: 2 });
  assert.deepEqual(summary.sessions.map(s => [s.agent, s.pass, s.attempt, s.outcome]), [["security", 2, 1, "error"], ["security", 2, 2, "ok"]]);
  assert.deepEqual(summary.sessions[0].tokens, { input: 100, output: 10, reasoning: 0, cache_read: 0, cache_write: 500 });
  assert.equal(summary.sessions[0].error, "429 Too Many Requests");
  assert.deepEqual(summary.totals().tokens, { input: 120, output: 40, reasoning: 5, cache_read: 400, cache_write: 500 });
  assert.equal(summary.totals().complete, true);
});

test("a timed-out session keeps the usage opencode read back, and is not retried", async () => {
  const { callOpencode, summary } = callWith([{ fail: "timed out", error: { name: "TimeoutError", usage: { tokens: usage(5, 6, 7, 8, 9) } } }]);
  await assert.rejects(callOpencode("ai-review-coordinator", "sys", "user", 1000, { agentKey: "coordinator" }), /timed out/);
  assert.deepEqual(summary.sessions.map(s => [s.agent, s.pass, s.attempt, s.outcome]), [["coordinator", null, 1, "timeout"]]);
  assert.deepEqual(summary.sessions[0].tokens, { input: 5, output: 6, reasoning: 7, cache_read: 8, cache_write: 9 });
});

test("a failure that left no usage reading is unknown, not zero, and spoils the totals' completeness", async () => {
  const { callOpencode, summary } = callWith([{ fail: "socket closed", error: {} }]);
  await assert.rejects(callOpencode("ai-review-security", "sys", "user", 1000, { agentKey: "security", pass: 1 }), /socket closed/);
  assert.deepEqual(summary.sessions[0].tokens, { input: null, output: null, reasoning: null, cache_read: null, cache_write: null });
  assert.equal(summary.sessions[0].cost, null);
  assert.equal(summary.totals().complete, false);
});

test("without prices a session reports its tokens and an unknown cost", async () => {
  const { callOpencode, summary } = callWith([{ tokens: usage(10, 20, 0, 30, 40) }], { prices: null });
  await callOpencode("ai-review-security", "sys", "user", 1000, { agentKey: "security", pass: 1 });
  assert.deepEqual(summary.sessions[0].tokens, { input: 10, output: 20, reasoning: 0, cache_read: 30, cache_write: 40 });
  assert.equal(summary.sessions[0].cost, null);
  assert.equal(summary.totals().cost, null);
  assert.equal(summary.totals().complete, true, "the counts are complete even though the price is not");
});

test("when the session total could not be read, the last message's counts are not reported as the session's", async () => {
  // Same shape as opencode's result after a failed totals request: `tokens` falls back to the final assistant message, `sessionTokens` is absent.
  const { callOpencode, summary } = callWith([{ tokens: usage(10, 20, 0, 30, 40), lastMessageOnly: true }]);
  await callOpencode("ai-review-security", "sys", "user", 1000, { agentKey: "security", pass: 1 });
  assert.deepEqual(summary.sessions[0].tokens, { input: null, output: null, reasoning: null, cache_read: null, cache_write: null });
  assert.equal(summary.sessions[0].cost, null);
  assert.equal(summary.totals().complete, false);
  assert.deepEqual(summary.totals().tokens, { input: null, output: null, reasoning: null, cache_read: null, cache_write: null });
  // A session whose total was read next to it still counts in full.
  const mixed = callWith([{ tokens: usage(1, 2, 0, 3, 4) }, { tokens: usage(5, 6, 0, 7, 8), lastMessageOnly: true }]);
  await mixed.callOpencode("a", "sys", "user", 1000, { agentKey: "security", pass: 1 });
  await mixed.callOpencode("a", "sys", "user", 1000, { agentKey: "correctness", pass: 1 });
  assert.equal(mixed.summary.totals().tokens.input, null, "one unknown session makes the total unknown");
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  assert.match(source, /tokens: result\.info\?\.sessionTokens/);
});

test("the first-response hook and the user preamble reach the model call, and the task keeps its own character budget", async () => {
  const { callOpencode, prompts, hooks } = callWith([{ tokens: usage(1, 1, 0, 0, 0) }, { tokens: usage(1, 1, 0, 0, 0) }, { tokens: usage(1, 1, 0, 0, 0) }]);
  await callOpencode("a", "S".repeat(MAX_SYSTEM_PROMPT_CHARS + 50), "T".repeat(MAX_USER_PROMPT_CHARS + 50), 1000, { agentKey: "k", userPreamble: "PREAMBLE" });
  assert.equal(prompts[0].system.length, MAX_SYSTEM_PROMPT_CHARS);
  assert.equal(prompts[0].text, `PREAMBLE\n\n${"T".repeat(MAX_USER_PROMPT_CHARS)}`, "the preamble sits outside the task's cap");
  assert.equal(prompts[0].onFirstResponse, undefined, "no stagger, no hook");
  await callOpencode("a", "sys", "user text", 1000, { agentKey: "k" });
  assert.equal(prompts[1].text, "user text", "without a preamble the user turn is exactly the task");
  // The hook the pool put in the async context is the one the first pass hands to opencode, and a later pass in its own context gets none.
  const hook = () => {};
  await hooks.run({ onFirstResponse: hook }, () => callOpencode("a", "sys", "user text", 1000, { agentKey: "k" }));
  assert.equal(prompts[2].onFirstResponse, hook);
});

test("a dry run writes the summary on every exit, scrubbed, and no other run writes one", () => {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("// A dry run's machine-readable result"), source.indexOf("async function main() {"));
  const dir = mkdtempSync(join(tmpdir(), "ai-review-summary-"));
  try {
    const secret = "sk-or-v1-supersecretvalue99";
    const build = (dryRun, artifactDir) => {
      const SUMMARY = new RunSummary({ traceId: "e".repeat(32), prices: PRICES });
      SUMMARY.state.tier = "full";
      SUMMARY.state.agents = ["correctness", "code-quality"];
      SUMMARY.state.kept = [{ file: "src/a.rs", line: 3, severity: "p1", category: "Correctness", title: `leaks ${secret}`, body: "b" }];
      SUMMARY.state.keptKnown = true;
      const session = SUMMARY.startSession({ agent: "correctness", pass: 1, attempt: 1 });
      SUMMARY.endSession(session, { outcome: "timeout", tokens: usage(1, 2, 3, 4, 5) });
      SUMMARY.startSession({ agent: "coordinator", pass: null, attempt: 1 });
      const warnings = [];
      const scope = {
        DRY_RUN: dryRun, REVIEW_ARTIFACT_DIR: artifactDir, SUMMARY, writeRunSummary, mapStrings, scrubSecrets, redactIdentity: text => text,
        process: { env: { OPENROUTER_REVIEW_API_KEY: secret } }, console: { warn: message => warnings.push(message) }, isoNow: () => "now",
      };
      return { write: new Function(...Object.keys(scope), `${body}\nreturn writeDryRunSummary;`)(...Object.values(scope)), warnings };
    };
    build(false, dir).write("success", null);
    assert.equal(existsSync(join(dir, "review-run-summary.json")), false, "not a dry run");
    build(true, "").write("success", null);
    const writer = build(true, dir);
    writer.write("timeout", new Error(`Overall timeout reached while using ${secret}`));
    writer.write("success", null); // main() finishing after the watchdog fired: the first outcome stays
    const text = readFileSync(join(dir, "review-run-summary.json"), "utf8");
    assert.equal(text.includes(secret), false);
    const summary = JSON.parse(text);
    assert.equal(summary.outcome, "timeout");
    assert.match(summary.error, /\[redacted\]/);
    assert.equal(summary.trace_id, "e".repeat(32));
    assert.equal(summary.tier, "full");
    assert.deepEqual(summary.agents, ["correctness", "code-quality"]);
    assert.equal(summary.kept_findings.length, 1);
    assert.match(summary.kept_findings[0].title, /leaks \[redacted\]/);
    assert.equal(typeof summary.duration_ms, "number");
    assert.deepEqual(summary.sessions.map(s => s.outcome), ["timeout", "interrupted"]);
    assert.equal(summary.totals.complete, false);
    assert.equal(summary.totals.tokens.input, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the runner writes the summary from its finally block and its timeout handler, and the watchdog's outcome and exit status are final", () => {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  assert.match(source, /OPENCODE\.stop\(\);\n    writeDryRunSummary\(outcome, rootError\);/);
  // The watchdog writes before it stops the server (which would let main() finish and write its own), and nothing may exit 0 after it fired.
  assert.match(source, /watchdogFired = true;[\s\S]*writeDryRunSummary\("timeout", err\);\n  OPENCODE\.stop\(\);/);
  assert.match(source, /function finishAndExit\(code\) \{\n.*\n  if \(watchdogFired\) return;/);
  assert.match(source, /if \(!DRY_RUN \|\| !REVIEW_ARTIFACT_DIR \|\| summaryWritten\) return;\n  summaryWritten = true;/);
});

test("under C the shared block follows the rules cut at the system cap and is never cut itself; without C the whole system is cut at the cap", async () => {
  const { callOpencode, prompts } = callWith([{ tokens: usage(1, 1, 0, 0, 0) }, { tokens: usage(1, 1, 0, 0, 0) }]);
  const block = `<untrusted_pr_data>\n${"D".repeat(MAX_USER_PROMPT_CHARS)}\n</untrusted_pr_data>`;
  await callOpencode("a", "S".repeat(MAX_SYSTEM_PROMPT_CHARS + 50), "task", 1000, { agentKey: "k", sharedBlock: block });
  assert.equal(prompts[0].system, `${"S".repeat(MAX_SYSTEM_PROMPT_CHARS)}\n\n${block}`, "rules cut as today, block whole");
  assert.ok(prompts[0].system.length > MAX_SYSTEM_PROMPT_CHARS + MAX_USER_PROMPT_CHARS);
  await callOpencode("a", "S".repeat(MAX_SYSTEM_PROMPT_CHARS + 50), "task", 1000, { agentKey: "k" });
  assert.equal(prompts[1].system.length, MAX_SYSTEM_PROMPT_CHARS, "no block: the single cut");
  assert.match(readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8"), /systemPrompt\.slice\(0, MAX_SYSTEM_PROMPT_CHARS\)\}\$\{traceOptions\.sharedBlock \?/);
});

// runReviewer as the runner has it, with the model call replaced by a recorder of what the runner would send.
function reviewerWith({ arms, diff, defs }) {
  const source = readFileSync(new URL("../run-review.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function runReviewer("), source.indexOf("// ─── Sanitization"));
  const calls = [];
  const scope = {
    passLabel: (name, pass) => `${name} ${pass}`, REVIEW_COLD_PASSES: 1, GEN_AI_PROVIDER_NAME: "p", PROVIDER_ID: "p", MODEL_ID: "m", MODEL_SLUG: "m",
    TRACE: { startSpan: () => ({}), setSpanAttributes() {}, endSpan() {} }, apiKey: () => "k", API_KEY_VAR_NAME: "K", console: { log() {}, warn() {}, error() {} }, isoNow: () => "now",
    readPrompt: name => `PROMPT ${name}`, readRepoRules: () => "REPO RULES", foldedAgentPrompt: () => "", AGENT_TIMEOUT_MS: 1000, MIN_COORDINATOR_MS: 0, POST_RESERVE_MS: 0, remainingRunMs: () => 1e9,
    reviewerDiff, logicalPath: path => path, reviewerPrompts, ARMS: arms, MAX_DIFF_TOKENS: 150_000, REVIEWER_WRAP_UP: {},
    callOpencode: async (...args) => { calls.push(args); return { text: "<no-issues/>", responseId: "r", wrappedUp: false }; },
    parseFindings: () => [], reviewerReported: () => true, UNPARSEABLE_OUTPUT: "unparseable",
  };
  const runReviewer = new Function(...Object.keys(scope), `${body}\nreturn runReviewer;`)(...Object.values(scope));
  return { calls, run: async (key, unfocused = false) => runReviewer(key, defs[key], diff, "PR CONTEXT", "", {}, "IMPACT", unfocused, 1) };
}

const fileSection = path => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;

test("under C two reviewers with different file focus send the same system prompt and block and different focus lists in their user turns", async () => {
  const diff = `${fileSection("src/a.rs")}${fileSection("web/b.ts")}`;
  const defs = {
    rust: { name: "Rust", promptFile: "rust.md", opencodeAgent: "ai-review-rust", fileFocus: path => path.endsWith(".rs") },
    web: { name: "Web", promptFile: "web.md", opencodeAgent: "ai-review-web", fileFocus: path => path.endsWith(".ts") },
    all: { name: "All", promptFile: "all.md", opencodeAgent: "ai-review-all", fileFocus: () => true },
    qa: { name: "Qa", promptFile: "qa.md", opencodeAgent: "ai-review-qa", requiresFocus: true, fileFocus: path => path.endsWith(".py") },
    docs: { name: "Docs", promptFile: "docs.md", opencodeAgent: "ai-review-docs", fileFocus: path => path.endsWith(".md") },
  };
  const c = reviewerWith({ arms: { stagger: false, sharedPrefix: true, sharedContext: true, fold: false }, diff, defs });
  const [rust, web, all, qa, docs] = [await c.run("rust"), await c.run("web"), await c.run("all"), await c.run("qa"), await c.run("docs")];
  assert.equal(qa.skipped, true, "a requiresFocus agent with no file in focus never starts a session");
  assert.equal(c.calls.length, 4);
  const [rustCall, webCall, allCall, docsCall] = c.calls;
  assert.equal(rustCall[1], webCall[1], "identical system prompt (the rules)");
  assert.equal(rustCall[4].sharedBlock, webCall[4].sharedBlock, "identical shared block");
  assert.ok(rustCall[4].sharedBlock.includes("diff --git a/web/b.ts"), "the block holds the whole diff, whatever the focus");
  assert.match(rustCall[2], /<focus_files>\nsrc\/a\.rs\n<\/focus_files>/);
  assert.match(webCall[2], /<focus_files>\nweb\/b\.ts\n<\/focus_files>/);
  assert.equal(allCall[2].includes("focus_files"), false, "a focus that selects every file names none");
  assert.equal(docsCall[2].includes("focus_files"), false, "no file matches and the agent does not require focus: the whole-diff fallback, no list");
  assert.deepEqual([rust.fullDiff, web.fullDiff, all.fullDiff, docs.fullDiff], [false, false, true, true], "fullDiff is what reviewerDiff reports");
  assert.equal(rust.sharedDiffTruncated, false);
  // A gate candidate is unfocused: every file, so no list.
  const gate = await c.run("rust", true);
  assert.equal(c.calls.at(-1)[2].includes("focus_files"), false);
  assert.equal(gate.fullDiff, true);
  // Without C nothing of this appears: the focused diff rides in the task as always.
  const b = reviewerWith({ arms: { stagger: false, sharedPrefix: true, sharedContext: false, fold: false }, diff, defs });
  await b.run("rust");
  assert.equal(b.calls[0][4].sharedBlock, "");
  assert.equal(b.calls[0][2].includes("focus_files"), false);
  assert.equal(b.calls[0][2].includes("web/b.ts"), false);
});

test("long focus paths still reach the model as whole paths with the omission count, the closing tag and the instruction", async () => {
  const { callOpencode, prompts } = callWith([{ tokens: usage(1, 1, 0, 0, 0) }]);
  const paths = Array.from({ length: 500 }, (_, i) => `src/${"deep/".repeat(60)}file${String(i).padStart(3, "0")}.rs`);
  assert.ok(paths[0].length > 300 && paths.join("\n").length > MAX_USER_PROMPT_CHARS / 2, "the raw list is far past what the task can hold");
  const got = reviewerPrompts({ arms: { stagger: false, sharedPrefix: true, sharedContext: true, fold: false }, trustedSystem: "R", agentPrompt: "A", prContext: "ctx", diff: "", commonDiff: "d", impact: "", existingReview: "P".repeat(MAX_USER_PROMPT_CHARS), maxDiffChars: 1000, focusFiles: paths });
  await callOpencode("a", got.system, got.user, 1000, { agentKey: "k", userPreamble: got.userPreamble, sharedBlock: got.sharedBlock });
  const sent = prompts[0].text;
  const list = sent.match(/<focus_files>\n([\s\S]*?)\n<\/focus_files>/);
  assert.ok(list, "the list closes before anything is cut");
  const lines = list[1].split("\n");
  const omission = lines.pop();
  assert.match(omission, /^\[and \d+ more files\]$/);
  assert.ok(lines.length > 0 && lines.every(line => paths.includes(line)), "every path shown is a whole path");
  assert.equal(lines.length + Number(omission.match(/\d+/)[0]), 500, "the count covers exactly the paths left out");
  assert.ok(list[1].length < 20_000, `${list[1].length} chars in the list`);
  assert.ok(sent.includes("Concentrate on the files listed in <focus_files> within your remit"), "the instruction arrives");
  // The previous review comes after the list, so it is what the task's cap cuts.
  assert.ok(sent.indexOf("</focus_files>") < sent.indexOf("<previous_review>"));
  // No path fits: no half list and no instruction about one.
  const huge = reviewerPrompts({ arms: { stagger: false, sharedPrefix: true, sharedContext: true, fold: false }, trustedSystem: "R", agentPrompt: "A", prContext: "ctx", diff: "", commonDiff: "d", impact: "", maxDiffChars: 1000, focusFiles: ["x".repeat(25_000)] });
  assert.equal(huge.user.includes("focus_files"), false);
  // Paths that fill the budget exactly (100 characters with their newline): the reserve keeps the omission line inside it.
  const packed = Array.from({ length: 300 }, (_, i) => `${"p".repeat(95)}${String(i).padStart(4, "0")}`);
  const full = reviewerPrompts({ arms: { stagger: false, sharedPrefix: true, sharedContext: true, fold: false }, trustedSystem: "R", agentPrompt: "A", prContext: "ctx", diff: "", commonDiff: "d", impact: "", maxDiffChars: 1000, focusFiles: packed });
  const body = full.user.match(/<focus_files>\n([\s\S]*?)\n<\/focus_files>/)[1];
  assert.ok(body.length < 20_000, `${body.length} chars including the omission line`);
  assert.match(body, /\[and \d+ more files\]$/);
});
