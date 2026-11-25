import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  BUILTIN_TOOL_IDS,
  OPENCODE_CONFIGS,
  OpencodeClient,
  OpencodeServer,
  buildServerEnv,
  ciFullProblems,
  createSseParser,
  externalDirectoryProblem,
  httpRequest,
  deriveSelectedConfig,
  isTransientError,
  modelVariantIds,
  resolveOpencodeConfig,
  selfCheck,
  shouldRetry,
  toolAllowedWithoutAsking,
  toolEnabled,
  wildcardMatch,
  wrapUpStartMs,
} from "../src/opencode.mjs";
import { stripJsonc } from "./jsonc.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const AGENT_RUN_MS = 1500;
const HEADERS_TIMEOUT_MS = 1000;

function fakeOpencode({ idleAfterMs = AGENT_RUN_MS, finalEvent = "session.execution.succeeded", error = null, errorBeforeAck = null, eventStream = true, wrapUpAfterMs = null, interruptEventDelayMs = 50, stepEndedAfterMs = null, sessionTotals = true, lastTokens = null } = {}) {
  const calls = [];
  let prompts = 0;
  const streams = new Set();
  let idle = null;
  const emit = (type, data) => {
    for (const res of streams) res.write(`data: ${JSON.stringify({ id: "evt", type, data })}\n\n`);
  };
  const finishRun = () => {
    idle = { id: `idle_${prompts}`, type: "idle", outcome: finalEvent === "session.execution.succeeded" ? "succeeded" : "failed", ...(error ? { error } : {}) };
    if (eventStream) emit(finalEvent, { sessionID: "ses_1", ...(error ? { error } : {}) });
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };
      if (req.url === "/api/event") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ id: "evt", type: "server.connected", data: {} })}\n\n: heartbeat\n\n`);
        if (eventStream) streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      // 2.x serves its web app for every unknown route, including all of 1.x's.
      if (!req.url.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<!doctype html><html></html>");
        return;
      }
      if (req.method === "POST" && req.url === "/api/session") return send(200, { data: { id: "ses_1" } });
      if (req.method === "PUT" && req.url === "/api/experimental/session/ses_1/instructions/entries/review-instructions") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/api/session/ses_1/prompt") {
        if (errorBeforeAck) {
          emit("session.execution.failed", { sessionID: "ses_1", error: errorBeforeAck });
          setTimeout(() => send(200, { data: { id: "msg_u1" } }), 200);
          return;
        }
        prompts += 1;
        send(200, { data: { id: `msg_u${prompts}` } });
        // The first model response of the run completes (twice, to show only the first counts) well before the session itself ends.
        if (stepEndedAfterMs !== null && prompts === 1) {
          for (const delay of [stepEndedAfterMs, stepEndedAfterMs + 30]) setTimeout(() => emit("session.step.ended", { sessionID: "ses_1", finish: "tool-calls", tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 7 } } }), delay);
        }
        // The second prompt is the wrap-up: it answers, where the first ran on until interrupted.
        if (wrapUpAfterMs !== null && prompts > 1) {
          setTimeout(finishRun, wrapUpAfterMs);
          return;
        }
        setTimeout(() => emit("permission.asked", { id: "per_1", sessionID: "ses_1", action: "shell", resources: ["*"] }), 50);
        if (idleAfterMs !== null) setTimeout(finishRun, idleAfterMs);
        return;
      }
      // A blocking call: no headers until the agent run ends (what 1.x's /session/:id/message did).
      if (req.method === "POST" && req.url === "/api/slow") {
        setTimeout(() => send(200, { data: {} }), AGENT_RUN_MS);
        return;
      }
      if (req.method === "GET" && req.url === "/api/session/ses_1/message?type=assistant&order=desc&limit=1") {
        return send(200, {
          data: [{
            id: "msg_a2",
            type: "assistant",
            model: { id: "m", providerID: "p" },
            time: { created: 1, completed: 2 },
            content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "<no-issues/>" }],
            finish: "stop",
            ...(lastTokens ? { tokens: lastTokens } : {}),
            ...(error && finalEvent === "session.execution.succeeded" ? { error } : {}),
          }],
        });
      }
      if (req.method === "GET" && req.url === "/api/session/ses_1/message?type=idle&order=desc&limit=1") return send(200, { data: idle ? [idle] : [] });
      if (req.method === "GET" && req.url === "/api/session/ses_1") return sessionTotals ? send(200, { data: { id: "ses_1", tokens: { input: 2000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } } } }) : send(500, { message: "totals unavailable" });
      if (req.method === "POST" && req.url === "/api/session/ses_1/permission/per_1/reply") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/api/session/ses_1/interrupt") {
        idle = { id: `idle_${prompts}`, type: "idle", outcome: "interrupted" };
        setTimeout(() => emit("session.execution.interrupted", { sessionID: "ses_1" }), interruptEventDelayMs);
        return send(200, { interrupted: true });
      }
      if (req.method === "DELETE" && req.url === "/api/session/ses_1") {
        res.writeHead(204);
        res.end();
        return;
      }
      send(404, { _tag: "NotFound" });
    });
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise(done => {
          for (const res of streams) res.end();
          server.closeAllConnections();
          server.close(done);
        }),
      });
    });
  });
}

const PROMPT = { agent: "a", model: { providerID: "p", modelID: "m" }, system: "", text: "", title: "t" };

test("C12 regression: a blocking request dies on the headers timeout, the async transport does not", async () => {
  const fake = await fakeOpencode();
  try {
    await assert.rejects(
      httpRequest(fake.baseUrl, "POST", "/api/slow", { body: {}, headersTimeoutMs: HEADERS_TIMEOUT_MS }),
      err => err.name === "HeadersTimeoutError",
    );

    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", headersTimeoutMs: HEADERS_TIMEOUT_MS });
    const result = await client.prompt({
      agent: "ai-review-security",
      model: { providerID: "anthropic-review", modelID: "claude-sonnet-5-5" },
      variant: "high",
      system: "rules",
      text: "diff",
      title: "t",
      timeoutMs: 10_000,
    });
    client.close();

    assert.equal(result.text, "<no-issues/>");
    assert.equal(result.responseId, "msg_a2");
    assert.equal(result.info.tokens.input, 2000, "tokens are the session total, not the last step");
    assert.equal(result.rejectedPermissions, 1);
    const reply = fake.calls.find(c => c.url === "/api/session/ses_1/permission/per_1/reply");
    assert.equal(reply.body.decision, "reject");
    const create = fake.calls.find(c => c.method === "POST" && c.url === "/api/session");
    assert.equal(create.body.agent, "ai-review-security");
    assert.deepEqual(create.body.model, { providerID: "anthropic-review", id: "claude-sonnet-5-5", variant: "high" });
    const system = fake.calls.find(c => c.method === "PUT");
    assert.equal(system.body.value, "rules");
    const prompt = fake.calls.find(c => c.url === "/api/session/ses_1/prompt");
    assert.deepEqual(prompt.body, { text: "diff" });
    assert.equal(prompt.auth, `Basic ${Buffer.from("opencode:pw").toString("base64")}`);
    assert.ok(fake.calls.some(c => c.method === "DELETE" && c.url === "/api/session/ses_1"));
  } finally {
    await fake.close();
  }
});

test("ci-full approves a permission prompt once instead of rejecting it", async () => {
  const fake = await fakeOpencode({ idleAfterMs: 200 });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", readOnly: false });
    const result = await client.prompt({ ...PROMPT, timeoutMs: 5000 });
    client.close();
    assert.equal(result.rejectedPermissions, 0);
    const reply = fake.calls.find(c => c.url === "/api/session/ses_1/permission/per_1/reply");
    assert.equal(reply.body.decision, "once");
  } finally {
    await fake.close();
  }
});

test("without the event stream, the idle poll still ends the wait", async () => {
  const fake = await fakeOpencode({ idleAfterMs: 100, eventStream: false });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", statusPollMs: 100 });
    const result = await client.prompt({ ...PROMPT, timeoutMs: 5000 });
    client.close();
    assert.equal(result.text, "<no-issues/>");
  } finally {
    await fake.close();
  }
});

test("a timed-out agent is interrupted server-side and not reported as transient", async () => {
  const fake = await fakeOpencode({ idleAfterMs: null });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    await assert.rejects(
      client.prompt({ ...PROMPT, timeoutMs: 300 }),
      err => {
        assert.equal(err.name, "TimeoutError");
        assert.equal(isTransientError(err), false);
        return true;
      },
    );
    client.close();
    assert.ok(fake.calls.some(c => c.method === "POST" && c.url === "/api/session/ses_1/interrupt"));
    assert.ok(fake.calls.some(c => c.method === "DELETE" && c.url === "/api/session/ses_1"));
  } finally {
    await fake.close();
  }
});

test("a reviewer still running near its timeout is interrupted and asked for its findings in the same session", async () => {
  const fake = await fakeOpencode({ idleAfterMs: null, wrapUpAfterMs: 100 });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", statusPollMs: 100 });
    const started = Date.now();
    const result = await client.prompt({ ...PROMPT, timeoutMs: 3000, wrapUp: { ms: 1000, text: "wrap up now" } });
    client.close();
    assert.ok(Date.now() - started < 3000, "waited for the hard timeout instead of the wrap-up answer");
    assert.equal(result.wrappedUp, true);
    assert.equal(result.text, "<no-issues/>");
    assert.equal(result.info.tokens.input, 2000, "tokens are the whole session's, both prompts included");
    const prompts = fake.calls.filter(c => c.url === "/api/session/ses_1/prompt");
    assert.deepEqual(prompts.map(c => c.body.text), ["", "wrap up now"]);
    assert.equal(fake.calls.filter(c => c.url === "/api/session/ses_1/interrupt").length, 1);
  } finally {
    await fake.close();
  }
});

test("an interrupted event that arrives after the wrap-up prompt went out does not end the wrap-up", async () => {
  // The poll confirms the interrupt first; the stream's interrupted event lands while the follow-up is running.
  const fake = await fakeOpencode({ idleAfterMs: null, wrapUpAfterMs: 600, interruptEventDelayMs: 400 });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", statusPollMs: 100 });
    const result = await client.prompt({ ...PROMPT, timeoutMs: 4000, wrapUp: { ms: 2000, text: "wrap up now" } });
    client.close();
    assert.equal(result.wrappedUp, true);
    assert.equal(result.text, "<no-issues/>");
    assert.equal(fake.calls.filter(c => c.url === "/api/session/ses_1/prompt").length, 2);
  } finally {
    await fake.close();
  }
});

test("a wrap-up that does not answer in its slot still ends as a hard timeout", async () => {
  const fake = await fakeOpencode({ idleAfterMs: null });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", statusPollMs: 100 });
    await assert.rejects(client.prompt({ ...PROMPT, timeoutMs: 1600, wrapUp: { ms: 800, text: "wrap up now" } }), err => err.name === "TimeoutError");
    client.close();
    assert.equal(fake.calls.filter(c => c.url === "/api/session/ses_1/prompt").length, 2);
  } finally {
    await fake.close();
  }
});

test("the wrap-up slot is taken only from a session at least twice its length", () => {
  const wrapUp = { ms: 3 * 60_000, text: "wrap" };
  assert.equal(wrapUpStartMs(20 * 60_000, wrapUp), 17 * 60_000);
  assert.equal(wrapUpStartMs(6 * 60_000, wrapUp), 3 * 60_000);
  assert.equal(wrapUpStartMs(5 * 60_000, wrapUp), 5 * 60_000);
  assert.equal(wrapUpStartMs(20 * 60_000, null), 20 * 60_000);
  assert.equal(wrapUpStartMs(20 * 60_000, { ms: 60_000, text: "" }), 20 * 60_000);
});

test("a provider rate limit surfaced as session.execution.failed is transient", async () => {
  const error = { type: "provider.rate-limit", message: "Too Many Requests", status: 429 };
  const fake = await fakeOpencode({ idleAfterMs: 100, finalEvent: "session.execution.failed", error });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    await assert.rejects(
      client.prompt({ ...PROMPT, timeoutMs: 5000 }),
      err => isTransientError(err) && /Too Many Requests/.test(err.message),
    );
    client.close();
  } finally {
    await fake.close();
  }
});

test("an auth failure is permanent even when its message looks transient", async () => {
  const error = { type: "provider.auth", message: "rate limit: invalid key", status: 401 };
  const fake = await fakeOpencode({ idleAfterMs: 100, finalEvent: "session.execution.failed", error });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    await assert.rejects(client.prompt({ ...PROMPT, timeoutMs: 5000 }), err => !isTransientError(err) && /provider\.auth/.test(err.message));
    client.close();
  } finally {
    await fake.close();
  }
});

test("a run failure emitted before the prompt call returns is not lost", async () => {
  const error = { type: "provider.auth", message: "bad key", status: 401 };
  const fake = await fakeOpencode({ idleAfterMs: null, errorBeforeAck: error });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    const started = Date.now();
    await assert.rejects(
      client.prompt({ ...PROMPT, timeoutMs: 5000 }),
      err => err.name !== "TimeoutError" && /bad key/.test(err.message),
    );
    assert.ok(Date.now() - started < 2000, "waited for the timeout instead of the early error");
    client.close();
  } finally {
    await fake.close();
  }
});

test("a 1.x route answered with the 2.x web app's HTML fails loudly", async () => {
  const fake = await fakeOpencode();
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    await assert.rejects(client.json("GET", "/agent"), /non-JSON.*opencode 2\.x/);
  } finally {
    await fake.close();
  }
});

test("a retry needs room for its own timeout plus the work reserved after it", () => {
  const err = Object.assign(new Error("429 Too Many Requests"), { transient: true });
  const minute = 60_000;
  const base = { err, maxRetries: 2, timeoutMs: 10 * minute, reserveMs: 3 * minute };
  assert.equal(shouldRetry({ ...base, attempt: 1, remainingMs: 19 * minute }), true);
  assert.equal(shouldRetry({ ...base, attempt: 1, remainingMs: 12 * minute }), false, "the coordinator would be pushed past the watchdog");
  assert.equal(shouldRetry({ ...base, attempt: 3, remainingMs: 60 * minute }), false);
  assert.equal(shouldRetry({ ...base, attempt: 1, remainingMs: 60 * minute, err: new Error("schema mismatch") }), false);
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError", transient: true });
  assert.equal(shouldRetry({ ...base, attempt: 1, remainingMs: 60 * minute, err: timeout }), false);
});

test("server env is an allowlist: no GitHub, Actions or trace variables reach opencode", () => {
  const env = buildServerEnv({
    parentEnv: {
      PATH: "/usr/bin",
      GH_TOKEN: "ghs_secret",
      GITHUB_TOKEN: "ghs_secret",
      ACTIONS_RUNTIME_TOKEN: "x",
      O2_TRACE_PASSWORD: "x",
      RUNNER_TEMP: "/tmp",
      ANTHROPIC_REVIEW_API_KEY: "sk-123",
      ANTHROPIC_API_KEY: "sk-789",
      OTHER_API_KEY: "sk-456",
    },
    home: "/tmp/h",
    configPath: "/engine/opencode.jsonc",
    password: "pw",
    providerKeyVars: ["ANTHROPIC_REVIEW_API_KEY", "bad name"],
  });
  assert.equal(env.ANTHROPIC_REVIEW_API_KEY, "sk-123");
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN", "O2_TRACE_PASSWORD", "RUNNER_TEMP", "OTHER_API_KEY", "ANTHROPIC_API_KEY"]) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "true");
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, "true");
  assert.equal(env.OPENCODE_DISABLE_FREE_MODELS, "true");
  assert.equal(env.OPENCODE_CONFIG, "/engine/opencode.jsonc");
  assert.equal(env.HOME, "/tmp/h");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/h/.config");
});

const rule = (action, resource, effect) => ({ action, resource, effect });

test("toolEnabled follows opencode's last-match-wins evaluation", () => {
  const ruleset = [
    rule("*", "*", "allow"),
    rule("read", "*.env", "ask"),
    rule("*", "*", "deny"),
    rule("read", "*", "allow"),
    rule("glob", "*", "allow"),
    rule("grep", "*", "allow"),
    // opencode appends this to every agent; it narrows skill further and must not count as enabling it.
    rule("skill", "browser", "deny"),
  ];
  assert.equal(toolEnabled("read", ruleset), true);
  assert.equal(toolEnabled("shell", ruleset), false);
  assert.equal(toolEnabled("write", ruleset), false);
  assert.equal(toolEnabled("webfetch", ruleset), false);
  assert.equal(toolEnabled("skill", ruleset), false);
  assert.equal(toolEnabled("shell", [...ruleset, rule("shell", "git *", "allow")]), true);
  assert.equal(toolEnabled("write", [...ruleset, rule("edit", "docs/*", "ask")]), true);
});

function fakeClient({ agents, plugins = BUILTIN_PLUGINS, mcp = [] }) {
  const routes = { "/api/agent": { data: agents }, "/api/plugin": { data: plugins }, "/api/mcp": { data: mcp } };
  return { json: async (method, path) => routes[path] };
}

const BUILTIN_PLUGINS = ["opencode.agent", "opencode.skill", ...[...BUILTIN_TOOL_IDS].map(id => `opencode.tool.${id}`)]
  .map(id => ({ id, source: { type: "builtin" }, state: { status: "active" } }));

const BASE = [rule("*", "*", "allow"), rule("read", "*.env", "ask")];
const READ_ONLY = [
  ...BASE,
  rule("*", "*", "deny"),
  rule("read", "*", "allow"),
  rule("glob", "*", "allow"),
  rule("grep", "*", "allow"),
  rule("external_directory", "*", "deny"),
  rule("browser", "*", "deny"),
  rule("skill", "browser", "deny"),
];
const FULL = [...BASE, rule("*", "*", "allow"), rule("browser", "*", "deny")];
const CI_FULL = [
  ...BASE,
  rule("*", "*", "allow"),
  ...["webfetch", "websearch", "subagent", "question", "execute", "skill"].map(id => rule(id, "*", "deny")),
  rule("shell", "*", "deny"),
  rule("shell", "git diff *", "allow"),
  rule("browser", "*", "deny"),
];
const agent = (permissions, id = "ai-review-security") => ({ id, name: id, mode: "primary", permissions });

test("self-check passes only for read-only agents and built-in plugins", async () => {
  const names = ["ai-review-security"];
  await selfCheck(fakeClient({ agents: [agent(READ_ONLY)] }), names);

  await assert.rejects(
    selfCheck(fakeClient({ agents: [agent(READ_ONLY)], plugins: [...BUILTIN_PLUGINS, { id: "x", source: { type: "local", path: "/pr/.opencode/plugin/x.ts" }, state: { status: "active" } }] }), names),
    /non-built-in plugins \(x\)/,
  );
  await assert.rejects(selfCheck(fakeClient({ agents: [agent(READ_ONLY)], mcp: [{ id: "m" }] }), names), /MCP/);
  await assert.rejects(selfCheck(fakeClient({ agents: [agent(READ_ONLY)], plugins: [] }), names), /tools did not load: read, glob, grep/);
  await assert.rejects(
    selfCheck(fakeClient({ agents: [agent(READ_ONLY)], plugins: [...BUILTIN_PLUGINS, { id: "opencode.tool.x", source: { type: "builtin" }, state: { status: "failed", error: "boom" } }] }), names),
    /failed to load: opencode.tool.x: boom/,
  );
  await assert.rejects(selfCheck(fakeClient({ agents: [agent([...READ_ONLY, rule("shell", "*", "allow")])] }), names), /shell allowed/);
  await assert.rejects(selfCheck(fakeClient({ agents: [agent(READ_ONLY)] }), [...names, "ai-review-qa"]), /ai-review-qa: not registered/);
  await assert.rejects(
    selfCheck(fakeClient({ agents: [agent([...READ_ONLY, rule("external_directory", "/proc/*", "allow")])] }), names),
    /external_directory allows \/proc\/\*/,
  );
  await assert.rejects(selfCheck(fakeClient({ agents: [agent(FULL)] }), names), /shell allowed/, "the default config must refuse a full grant");
});

test("ci-full self-check wants file tools granted, web and sub-agent tools denied and the shell allowlisted", async () => {
  const names = ["ai-review-security", "ai-review-correctness"];
  const agents = [agent(CI_FULL), agent(CI_FULL, "ai-review-correctness")];
  const result = await selfCheck(fakeClient({ agents }), names, { readOnly: false });
  assert.equal(result.agents, 2);

  await assert.rejects(selfCheck(fakeClient({ agents: [agent(CI_FULL)] }), names, { readOnly: false }), /ai-review-correctness: not registered/);
  await assert.rejects(
    selfCheck(fakeClient({ agents: [agent(READ_ONLY), agent(CI_FULL, "ai-review-correctness")] }), names, { readOnly: false }),
    /ai-review-security: edit not fully allowed/,
  );
  assert.deepEqual(ciFullProblems(FULL), ["webfetch allowed", "websearch allowed", "subagent allowed", "question allowed", "execute allowed", "skill allowed", "shell allows every command"]);
  assert.deepEqual(ciFullProblems([...CI_FULL, rule("execute", "*", "allow")]), ["execute allowed"]);
  assert.deepEqual(ciFullProblems([...CI_FULL, rule("shell", "*", "deny")]), ["shell denied"]);
  assert.deepEqual(ciFullProblems(CI_FULL), []);
  await assert.rejects(
    selfCheck(fakeClient({ agents, plugins: [...BUILTIN_PLUGINS, { id: "p", source: { type: "package", target: "evil" }, state: { status: "active" } }] }), names, { readOnly: false }),
    /non-built-in plugins/,
  );
  await assert.rejects(
    selfCheck(fakeClient({ agents, plugins: BUILTIN_PLUGINS.filter(p => p.id !== "opencode.tool.shell") }), names, { readOnly: false }),
    /tools did not load: shell/,
  );
});

test("REVIEW_OPENCODE_CONFIG selects the config file and permission mode, and fails closed on anything else", () => {
  assert.deepEqual(resolveOpencodeConfig(undefined), { name: "default", file: "opencode.jsonc", readOnly: true });
  assert.deepEqual(resolveOpencodeConfig(""), { name: "default", file: "opencode.jsonc", readOnly: true });
  assert.deepEqual(resolveOpencodeConfig("default"), { name: "default", file: "opencode.jsonc", readOnly: true });
  assert.deepEqual(resolveOpencodeConfig("ci-full"), { name: "ci-full", file: "opencode.ci.jsonc", readOnly: false });
  assert.throws(() => resolveOpencodeConfig("full"), /unknown REVIEW_OPENCODE_CONFIG "full"/);
});

test("both configs register the same agents, provider and model; only the default denies tools", () => {
  const load = file => JSON.parse(stripJsonc(readFileSync(join(REPO_ROOT, file), "utf-8")));
  const base = load(OPENCODE_CONFIGS.default.file);
  const ci = load(OPENCODE_CONFIGS["ci-full"].file);
  const expected = [
    "ai-review-security", "ai-review-correctness", "ai-review-code-quality", "ai-review-performance", "ai-review-documentation",
    "ai-review-release", "ai-review-frontend", "ai-review-qa", "ai-review-coordinator",
  ];
  assert.deepEqual(Object.keys(base.agents).sort(), [...expected].sort());
  assert.deepEqual(Object.keys(ci.agents).sort(), [...expected].sort());
  assert.deepEqual(ci.providers, base.providers);
  assert.deepEqual(ci.policies, base.policies);
  assert.equal(ci.model, base.model);
  for (const name of expected) {
    assert.equal(ci.agents[name].model, base.agents[name].model, name);
    const readOnly = [...BASE, ...base.agents[name].permissions];
    for (const toolId of BUILTIN_TOOL_IDS) assert.equal(toolEnabled(toolId, readOnly), ["read", "glob", "grep"].includes(toolId), `${name} ${toolId}`);
    assert.equal(externalDirectoryProblem(readOnly), "", name);
    const full = [...BASE, ...ci.agents[name].permissions];
    assert.deepEqual(ciFullProblems(full), [], name);
    // opencode 2.2.0 ends the capped turn on an assistant message, a prefill the model rejects, so no agent sets a step cap.
    for (const config of [base, ci]) for (const key of ["steps", "maxSteps"]) assert.equal(config.agents[name][key], undefined, `${name} ${key}`);
  }
});

// Evaluated as opencode 2.2.0 does: the last rule whose action and resource both match decides.
function shellDecision(rules, command) {
  return [...BASE, ...rules].findLast(r => wildcardMatch("shell", r.action) && wildcardMatch(command, r.resource))?.effect;
}

test("the ci-full shell runs the read-only allowlist and nothing that builds, installs or reaches the network", () => {
  const ci = JSON.parse(stripJsonc(readFileSync(join(REPO_ROOT, OPENCODE_CONFIGS["ci-full"].file), "utf-8")));
  for (const [name, agentConfig] of Object.entries(ci.agents)) {
    for (const command of ["git diff", "git diff origin/main -- src", "git log -5 --oneline", "git show HEAD:src/a.rs", "git blame -L 1,5 a.rs", "rg -n foo src", "cat a.rs", "ls", "ls -la web", "head -50 a.rs", "sed -n 1,40p a.rs", "wc -l a.rs",
      "grep -rn foo src", "tail -n 20 a.rs", "find src -name '*.rs'", "find . -type f -newer a.rs", "find src -name '*-executor*'", "find . -name ok-delete.rs",
      "git ls-files src", "git status", "git status --short", "git rev-parse HEAD", "git merge-base HEAD origin/main", "git cat-file -p HEAD:a.rs", "git cat-file -t HEAD", "git cat-file -s HEAD",
      "git --no-pager diff --stat", "git --no-pager log -3", "git --no-pager show HEAD", "rg -n foo src/env_util.rs"]) {
      assert.equal(shellDecision(agentConfig.permissions, command), "allow", `${name}: ${command}`);
    }
    for (const command of ["cargo build", "cargo test -p config", "npm ci", "npx vitest", "curl https://example.com", "git push", "git fetch origin", "git difftool", "sed -i s/a/b/ a.rs", "make", "python3 x.py", "bash -c ls",
      "find . -exec rm {} ;", "find -execdir sh -c x ;", "find . -name x -ok rm {} ;", "find . -delete", "find . -fprint out.txt", "find . -fls out.txt",
      "tail -f a.log", "tail -n 5 -F a.log", "tail --follow=name a.log", "git grep foo", "git grep -nOsh foo", "git grep --open-files=sh foo", "git --no-pager grep foo",
      "git --no-pager push", "git --no-pager -c core.pager=sh log", "git cat-file --batch", "git cat-file blob HEAD",
      "cat /proc/self/environ", "head -c 100 /proc/1/environ", "tail /dev/stdin", "grep -a KEY /proc/self/environ", "rg KEY /proc", "sed -n p /proc/self/environ",
      "cat ../../proc/self/environ", "cat src/environ", "rg --file=/proc/self/environ x", "wc -c /p*/self/env*", "cat /etc/passwd", "cat a.rs > b.rs", "rg foo src>>out.txt", "cat a.rs 2>/dev/null"]) {
      assert.equal(shellDecision(agentConfig.permissions, command), "deny", `${name}: ${command}`);
    }
  }
});

test("a trailing ' *' also matches the bare command, as in opencode 2.2.0", () => {
  assert.equal(wildcardMatch("git diff", "git diff *"), true);
  assert.equal(wildcardMatch("git diff --stat", "git diff *"), true);
  assert.equal(wildcardMatch("git difftool", "git diff *"), false);
  assert.equal(wildcardMatch("read", "*"), true);
});

test("the review runs on the anthropic-review provider, the only one the policies allow, with the workflow's variant", () => {
  const base = JSON.parse(stripJsonc(readFileSync(join(REPO_ROOT, OPENCODE_CONFIGS.default.file), "utf-8")));
  const allowed = base.policies.filter(p => p.action === "provider.use" && p.effect === "allow").map(p => p.resource);
  assert.deepEqual(allowed, ["anthropic-review"]);
  assert.equal(base.model, "anthropic-review/claude-sonnet-5-5");
  for (const agent of Object.values(base.agents)) assert.equal(agent.model, base.model);
  const provider = base.providers["anthropic-review"];
  assert.equal(provider.package, "@opencode/ai/providers/anthropic");
  assert.deepEqual(provider.env, ["ANTHROPIC_REVIEW_API_KEY"]);
  const model = provider.models["claude-sonnet-5-5"];
  assert.deepEqual(model.variants, ["low", "medium", "high", "xhigh", "max"].map(id => ({ id, settings: { thinking: { type: "adaptive" }, effort: id } })));
  assert.deepEqual(modelVariantIds(base, "anthropic-review", "claude-sonnet-5-5"), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(modelVariantIds(base, "anthropic-review", "no-such-model"), []);
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ai-code-review.yml"), "utf-8");
  assert.match(workflow, /provider_id: anthropic-review\n\s+model_id: claude-sonnet-5-5\n\s+api_key_env: ANTHROPIC_REVIEW_API_KEY\n/);
  assert.doesNotMatch(workflow, /model_variant/, "the effort variable is the only source of the variant");
  assert.match(workflow, /REVIEW_MODEL_VARIANT: \$\{\{ vars\.AI_REVIEW_EFFORT \|\| 'high' \}\}/);
  assert.match(workflow, /REVIEW_COORDINATOR_VARIANT: \$\{\{ vars\.AI_REVIEW_COORDINATOR_EFFORT \|\| vars\.AI_REVIEW_EFFORT \|\| 'high' \}\}/);
  assert.match(workflow, /ANTHROPIC_REVIEW_API_KEY: \$\{\{ secrets\.USAGE_CREDIT_API_KEY \}\}/);
});

test("SSE parser handles split frames, CRLF and multi-line data", () => {
  const events = [];
  const parse = createSseParser(e => events.push(e));
  parse('data: {"type":"a"');
  parse('}\n\nda');
  parse('ta: {"type":"b"}\r\n\r\n');
  parse("data: not json\n\n");
  parse('data: {"type":\ndata: "c"}\n\n');
  assert.deepEqual(events.map(e => e.type), ["a", "b", "c"]);
});

test("the first completed model response reaches the caller once, before the session itself ends", async () => {
  const fake = await fakeOpencode({ idleAfterMs: 700, stepEndedAfterMs: 100 });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    const t0 = Date.now();
    const fired = [];
    const result = await client.prompt({ ...PROMPT, timeoutMs: 10_000, onFirstResponse: () => fired.push(Date.now() - t0) });
    const ended = Date.now() - t0;
    client.close();
    assert.equal(result.text, "<no-issues/>");
    assert.equal(fired.length, 1, "two step.ended events, one signal");
    assert.ok(fired[0] >= 90 && fired[0] < 400, `signalled at ${fired[0]} ms`);
    assert.ok(ended - fired[0] > 300, `the session ended ${ended - fired[0]} ms after the signal, not with it`);
  } finally {
    await fake.close();
  }
});

test("the session's own total is kept apart from the last message's counts, which stay only as the telemetry fallback", async () => {
  const last = { input: 7, output: 3, reasoning: 0, cache: { read: 1, write: 2 } };
  const ok = await fakeOpencode({ idleAfterMs: 100, lastTokens: last });
  try {
    const client = new OpencodeClient({ baseUrl: ok.baseUrl, password: "pw" });
    const result = await client.prompt({ ...PROMPT, timeoutMs: 5000 });
    client.close();
    assert.equal(result.info.tokens.input, 2000);
    assert.deepEqual(result.info.sessionTokens, result.info.tokens, "the session total, as before");
  } finally {
    await ok.close();
  }
  // The totals request fails: only the final message's counts remain, which cover one step of a multi-step session.
  const broken = await fakeOpencode({ idleAfterMs: 100, lastTokens: last, sessionTotals: false });
  try {
    const client = new OpencodeClient({ baseUrl: broken.baseUrl, password: "pw" });
    const result = await client.prompt({ ...PROMPT, timeoutMs: 5000 });
    client.close();
    assert.deepEqual(result.info.tokens, last, "the span still gets the fallback it always had");
    assert.equal(result.info.sessionTokens, undefined, "accounting does not");
  } finally {
    await broken.close();
  }
});

test("a run with no completed model response never signals, and a hook that throws does not end the session", async () => {
  const quiet = await fakeOpencode({ idleAfterMs: 200 });
  try {
    const client = new OpencodeClient({ baseUrl: quiet.baseUrl, password: "pw" });
    let calls = 0;
    await client.prompt({ ...PROMPT, timeoutMs: 5000, onFirstResponse: () => { calls += 1; } });
    client.close();
    assert.equal(calls, 0);
  } finally {
    await quiet.close();
  }
  const loud = await fakeOpencode({ idleAfterMs: 400, stepEndedAfterMs: 50 });
  try {
    const client = new OpencodeClient({ baseUrl: loud.baseUrl, password: "pw" });
    const result = await client.prompt({ ...PROMPT, timeoutMs: 5000, onFirstResponse: () => { throw new Error("hook bug"); } });
    client.close();
    assert.equal(result.text, "<no-issues/>");
  } finally {
    await loud.close();
  }
});

const loadConfig = file => JSON.parse(stripJsonc(readFileSync(join(REPO_ROOT, file), "utf-8")));
const OPENROUTER = { providerId: "openrouter-review", modelId: "anthropic/claude-sonnet-5.5", keyEnv: "OPENROUTER_REVIEW_API_KEY" };

test("both configs register openrouter-review for anthropic/claude-sonnet-5.5 on Anthropic Messages with the same five efforts, and neither policy allows it", () => {
  for (const file of [OPENCODE_CONFIGS.default.file, OPENCODE_CONFIGS["ci-full"].file]) {
    const config = loadConfig(file);
    const provider = config.providers["openrouter-review"];
    assert.equal(provider.package, "@opencode/ai/providers/anthropic", file);
    assert.deepEqual(provider.env, ["OPENROUTER_REVIEW_API_KEY"], file);
    assert.deepEqual(provider.settings, { baseURL: "https://openrouter.ai/api/v1" }, file);
    assert.deepEqual(provider.body, { provider: { order: ["anthropic"], allow_fallbacks: false } }, `${file}: pinned to one upstream so reviewers share its cache`);
    assert.equal(config.providers["anthropic-review"].body, undefined, `${file}: production provider untouched`);
    assert.deepEqual(Object.keys(provider.models), ["anthropic/claude-sonnet-5.5"], file);
    assert.deepEqual(modelVariantIds(config, "openrouter-review", "anthropic/claude-sonnet-5.5"), ["low", "medium", "high", "xhigh", "max"], file);
    assert.deepEqual(provider.models["anthropic/claude-sonnet-5.5"].variants, config.providers["anthropic-review"].models["claude-sonnet-5-5"].variants, file);
    assert.deepEqual(config.policies.filter(p => p.effect === "allow").map(p => p.resource), ["anthropic-review"], `${file}: production may not select it`);
    assert.equal(config.model, "anthropic-review/claude-sonnet-5-5", `${file}: the production default is unchanged`);
  }
});

test("a dry run's private config names the one selected provider, denies every other, and leaves the agents' permissions as trusted", () => {
  for (const file of [OPENCODE_CONFIGS.default.file, OPENCODE_CONFIGS["ci-full"].file]) {
    const trusted = loadConfig(file);
    const before = JSON.stringify(trusted);
    const derived = deriveSelectedConfig(trusted, OPENROUTER);
    assert.equal(JSON.stringify(trusted), before, "the trusted config is not modified");
    assert.deepEqual(Object.keys(derived.providers), ["openrouter-review"], file);
    assert.deepEqual(derived.policies, [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "openrouter-review", effect: "allow" },
    ]);
    assert.equal(derived.model, "openrouter-review/anthropic/claude-sonnet-5.5");
    for (const [name, agent] of Object.entries(derived.agents)) {
      assert.equal(agent.model, derived.model, name);
      assert.deepEqual(agent.permissions, trusted.agents[name].permissions, `${name}: permissions are the trusted ones`);
    }
    assert.deepEqual(Object.keys(derived.agents), Object.keys(trusted.agents));
    for (const key of ["update", "share", "snapshots", "lsp", "formatter"]) assert.equal(derived[key], trusted[key], key);
  }
  // The Anthropic leg can be selected too, still alone.
  const anthropic = deriveSelectedConfig(loadConfig("opencode.jsonc"), { providerId: "anthropic-review", modelId: "claude-sonnet-5-5", keyEnv: "ANTHROPIC_REVIEW_API_KEY" });
  assert.deepEqual(Object.keys(anthropic.providers), ["anthropic-review"]);
});

test("the selection is validated: an unknown provider or model, or another provider's key variable, is refused", () => {
  const trusted = loadConfig("opencode.jsonc");
  assert.throws(() => deriveSelectedConfig(trusted, { ...OPENROUTER, providerId: "nope-review" }), /provider "nope-review" is not registered/);
  assert.throws(() => deriveSelectedConfig(trusted, { ...OPENROUTER, modelId: "claude-sonnet-5-5" }), /model "claude-sonnet-5-5" is not registered for provider "openrouter-review"/);
  assert.throws(() => deriveSelectedConfig(trusted, { ...OPENROUTER, keyEnv: "ANTHROPIC_REVIEW_API_KEY" }), /reads its key from OPENROUTER_REVIEW_API_KEY, not ANTHROPIC_REVIEW_API_KEY/);
  assert.throws(() => deriveSelectedConfig(trusted, { providerId: "anthropic-review", modelId: "claude-sonnet-5-5", keyEnv: "OPENROUTER_REVIEW_API_KEY" }), /not OPENROUTER_REVIEW_API_KEY/);
});

test("only the selected provider's key reaches opencode; the OpenObserve and trace credentials never do", () => {
  const env = buildServerEnv({
    parentEnv: {
      PATH: "/usr/bin",
      OPENROUTER_REVIEW_API_KEY: "sk-or-selected",
      ANTHROPIC_REVIEW_API_KEY: "sk-ant-other",
      OPENOBSERVE_AUTH_TOKEN: "Basic api-token",
      O2_TRACE_AUTH: "Basic trace-token",
      GH_TOKEN: "ghs_read",
      GIT_ASKPASS: "/x",
      HOME: "/home/dev",
    },
    home: "/tmp/fresh",
    configPath: "/tmp/fresh/review-opencode.json",
    password: "pw",
    providerKeyVars: ["OPENROUTER_REVIEW_API_KEY"],
  });
  assert.equal(env.OPENROUTER_REVIEW_API_KEY, "sk-or-selected");
  for (const name of ["ANTHROPIC_REVIEW_API_KEY", "OPENOBSERVE_AUTH_TOKEN", "O2_TRACE_AUTH", "GH_TOKEN", "GIT_ASKPASS"]) assert.equal(env[name], undefined, name);
  assert.equal(env.HOME, "/tmp/fresh", "a fresh HOME, not the developer's");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/fresh/.config");
});

// A stand-in binary that records what opencode would be started with, then waits like the real server.
function fakeBinary(dir) {
  const path = join(dir, "fake-opencode");
  writeFileSync(path, [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    "const config = process.env.OPENCODE_CONFIG;",
    'fs.writeFileSync("probe.json", JSON.stringify({ config, home: process.env.HOME, env: Object.keys(process.env), mode: fs.statSync(config).mode & 0o777, body: JSON.parse(fs.readFileSync(config, "utf-8")) }));',
    'console.log("server listening on http://127.0.0.1:9");',
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

test("a dry run serves a private config from the fresh HOME and removes it with the server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-fake-"));
  try {
    const server = new OpencodeServer({
      binary: fakeBinary(dir),
      cwd: dir,
      configPath: join(REPO_ROOT, "opencode.jsonc"),
      providerKeyVars: [OPENROUTER.keyEnv],
      parentEnv: { PATH: process.env.PATH, OPENROUTER_REVIEW_API_KEY: "sk-or-selected", ANTHROPIC_REVIEW_API_KEY: "sk-ant-other", OPENOBSERVE_AUTH_TOKEN: "Basic api-token" },
      selection: OPENROUTER,
    });
    await server.ensureStarted();
    const probe = JSON.parse(readFileSync(join(dir, "probe.json"), "utf-8"));
    server.stop();
    assert.notEqual(probe.config, join(REPO_ROOT, "opencode.jsonc"), "the trusted file is not the one served");
    assert.ok(probe.config.startsWith(probe.home), "the private config lives in the fresh HOME");
    assert.equal(probe.mode, 0o600);
    assert.deepEqual(Object.keys(probe.body.providers), ["openrouter-review"]);
    assert.equal(probe.body.model, "openrouter-review/anthropic/claude-sonnet-5.5");
    assert.ok(probe.env.includes("OPENROUTER_REVIEW_API_KEY"));
    for (const name of ["ANTHROPIC_REVIEW_API_KEY", "OPENOBSERVE_AUTH_TOKEN"]) assert.equal(probe.env.includes(name), false, name);
    assert.equal(existsSync(probe.config), false, "removed on exit");
    assert.equal(existsSync(probe.home), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a refused selection stops the server before it starts, and leaves nothing behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-fake-"));
  try {
    const server = new OpencodeServer({
      binary: fakeBinary(dir),
      cwd: dir,
      configPath: join(REPO_ROOT, "opencode.jsonc"),
      providerKeyVars: ["OPENROUTER_REVIEW_API_KEY"],
      parentEnv: { PATH: process.env.PATH },
      selection: { ...OPENROUTER, providerId: "unregistered-review" },
    });
    await assert.rejects(server.ensureStarted(), /provider "unregistered-review" is not registered/);
    const home = server.home;
    server.stop();
    assert.equal(existsSync(join(dir, "probe.json")), false, "the binary never ran");
    assert.equal(existsSync(home), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the installer pins both Linux assets at 2.2.0 by digest, takes arm64 only on Linux aarch64, and keeps its checksum and version checks", () => {
  const read = name => readFileSync(join(REPO_ROOT, "scripts/ai-review", name), "utf-8");
  const pin = Object.fromEntries(read("opencode-pin.env").split("\n").filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => l.split("=")));
  assert.deepEqual(pin, {
    OPENCODE_VERSION: "2.2.0",
    OPENCODE_SHA256: "6d597970a8cc448f1b9a9f645532584b339dd3ab9583bb5f063f13d83e54768f",
    OPENCODE_SHA256_ARM64: "1f1ce0fc07b9245a815ffa9d652dbb80e6b0f07e5bf74ea87d2b1c0339fbac52",
  });
  const script = read("install-opencode.sh");
  assert.match(script, /asset="opencode-linux-x64\.tar\.gz"\nsha256="\$OPENCODE_SHA256"/, "x64 stays the default asset and digest");
  assert.match(script, /\[ "\$\(uname -s\)" = "Linux" \] && \{ \[ "\$\(uname -m\)" = "aarch64" \] \|\| \[ "\$\(uname -m\)" = "arm64" \]; \}/);
  assert.match(script, /asset="opencode-linux-arm64\.tar\.gz"\n  sha256="\$OPENCODE_SHA256_ARM64"/);
  assert.match(script, /releases\/download\/v\$\{OPENCODE_VERSION\}\/\$\{asset\}/);
  assert.match(script, /sha256sum --check --strict -/);
  assert.match(script, /"\$installed" != "\$OPENCODE_VERSION"/);
  assert.doesNotMatch(script, /curl[^\n]*\|\s*(ba)?sh/, "never pipes a script to a shell");
});
