import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTIN_TOOL_IDS,
  OPENCODE_CONFIGS,
  OpencodeClient,
  buildServerEnv,
  createSseParser,
  externalDirectoryProblem,
  httpRequest,
  isTransientError,
  resolveOpencodeConfig,
  selfCheck,
  shouldRetry,
  toolAllowedWithoutAsking,
  toolEnabled,
} from "../src/opencode.mjs";
import { stripJsonc } from "./jsonc.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const AGENT_RUN_MS = 1500;
const HEADERS_TIMEOUT_MS = 1000;

function fakeOpencode({ idleAfterMs = AGENT_RUN_MS, finalEvent = "session.execution.succeeded", error = null, errorBeforeAck = null, eventStream = true } = {}) {
  const calls = [];
  const streams = new Set();
  let idle = null;
  const emit = (type, data) => {
    for (const res of streams) res.write(`data: ${JSON.stringify({ id: "evt", type, data })}\n\n`);
  };
  const finishRun = () => {
    idle = { type: "idle", outcome: finalEvent === "session.execution.succeeded" ? "succeeded" : "failed", ...(error ? { error } : {}) };
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
        send(200, { data: { id: "msg_u1" } });
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
            cost: 0.001,
            ...(error && finalEvent === "session.execution.succeeded" ? { error } : {}),
          }],
        });
      }
      if (req.method === "GET" && req.url === "/api/session/ses_1/message?type=idle&order=desc&limit=1") return send(200, { data: idle ? [idle] : [] });
      if (req.method === "GET" && req.url === "/api/session/ses_1") return send(200, { data: { id: "ses_1", cost: 0.003, tokens: { input: 2000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } } } });
      if (req.method === "POST" && req.url === "/api/session/ses_1/permission/per_1/reply") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/api/session/ses_1/interrupt") return send(200, { interrupted: true });
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
      model: { providerID: "deepseek-review", modelID: "deepseek-flash" },
      variant: "max",
      system: "rules",
      text: "diff",
      title: "t",
      timeoutMs: 10_000,
    });
    client.close();

    assert.equal(result.text, "<no-issues/>");
    assert.equal(result.responseId, "msg_a2");
    assert.equal(result.info.cost, 0.003, "cost is the session total, not the last step");
    assert.equal(result.info.tokens.input, 2000);
    assert.equal(result.rejectedPermissions, 1);
    const reply = fake.calls.find(c => c.url === "/api/session/ses_1/permission/per_1/reply");
    assert.equal(reply.body.decision, "reject");
    const create = fake.calls.find(c => c.method === "POST" && c.url === "/api/session");
    assert.equal(create.body.agent, "ai-review-security");
    assert.deepEqual(create.body.model, { providerID: "deepseek-review", id: "deepseek-flash", variant: "max" });
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
      DEEPSEEK_API_KEY: "sk-123",
      OTHER_API_KEY: "sk-456",
    },
    home: "/tmp/h",
    configPath: "/engine/opencode.jsonc",
    password: "pw",
    providerKeyVars: ["DEEPSEEK_API_KEY", "bad name"],
  });
  assert.equal(env.DEEPSEEK_API_KEY, "sk-123");
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN", "O2_TRACE_PASSWORD", "RUNNER_TEMP", "OTHER_API_KEY"]) {
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

test("ci-full self-check wants every agent registered with the full grant, and still refuses foreign plugins", async () => {
  const names = ["ai-review-security", "ai-review-correctness"];
  const agents = [agent(FULL), agent(FULL, "ai-review-correctness")];
  const result = await selfCheck(fakeClient({ agents }), names, { readOnly: false });
  assert.equal(result.agents, 2);

  await assert.rejects(selfCheck(fakeClient({ agents: [agent(FULL)] }), names, { readOnly: false }), /ai-review-correctness: not registered/);
  await assert.rejects(
    selfCheck(fakeClient({ agents: [agent(READ_ONLY), agent(FULL, "ai-review-correctness")] }), names, { readOnly: false }),
    /ai-review-security: edit not fully allowed/,
  );
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
    for (const toolId of BUILTIN_TOOL_IDS) assert.equal(toolAllowedWithoutAsking(toolId, full), true, `${name} ${toolId}`);
  }
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
