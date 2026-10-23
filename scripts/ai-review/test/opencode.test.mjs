import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  OpencodeClient,
  buildServerEnv,
  createSseParser,
  httpRequest,
  isTransientError,
  selfCheck,
  shouldRetry,
  toolEnabled,
} from "../src/opencode.mjs";

const AGENT_RUN_MS = 1500;
const HEADERS_TIMEOUT_MS = 1000;

function fakeOpencode({ idleAfterMs = AGENT_RUN_MS, finalEvent = "session.idle", error = null, errorBeforeAck = null } = {}) {
  const calls = [];
  const streams = new Set();
  const emit = event => {
    for (const res of streams) res.write(`data: ${JSON.stringify(event)}\n\n`);
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
      if (req.url === "/event") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      if (req.method === "POST" && req.url === "/session") return send(200, { id: "s1" });
      if (req.method === "POST" && req.url === "/session/s1/prompt_async") {
        if (errorBeforeAck) {
          emit({ type: "session.error", properties: { sessionID: "s1", error: errorBeforeAck } });
          setTimeout(() => { res.writeHead(204); res.end(); }, 200);
          return;
        }
        res.writeHead(204);
        res.end();
        setTimeout(() => emit({ type: "permission.asked", properties: { id: "p1", sessionID: "s1", permission: "bash", patterns: ["*"] } }), 50);
        if (idleAfterMs !== null) {
          setTimeout(() => emit({ type: finalEvent, properties: { sessionID: "s1", ...(error ? { error } : {}) } }), idleAfterMs);
        }
        return;
      }
      // The pre-fix transport: opencode sends no headers until the agent run ends.
      if (req.method === "POST" && req.url === "/session/s1/message") {
        setTimeout(() => send(200, { info: { id: "m1" }, parts: [] }), AGENT_RUN_MS);
        return;
      }
      if (req.method === "GET" && req.url === "/session/s1/message") {
        return send(200, [
          { info: { role: "user", id: "u1" }, parts: [] },
          {
            info: { role: "assistant", id: "m1", time: { created: 1, completed: 2 }, ...(error && finalEvent === "session.idle" ? { error } : {}) },
            parts: [{ type: "text", text: "<no-issues/>" }],
          },
        ]);
      }
      if (req.method === "GET" && req.url === "/session/status") return send(200, {});
      if (req.method === "POST" && req.url === "/permission/p1/reply") return send(200, true);
      if (req.method === "POST" && req.url === "/session/s1/abort") return send(200, true);
      if (req.method === "DELETE" && req.url === "/session/s1") return send(200, true);
      send(404, { error: "not found" });
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

test("C12 regression: a blocking prompt dies on the headers timeout, the async transport does not", async () => {
  const fake = await fakeOpencode();
  try {
    await assert.rejects(
      httpRequest(fake.baseUrl, "POST", "/session/s1/message", { body: { parts: [] }, headersTimeoutMs: HEADERS_TIMEOUT_MS }),
      err => err.name === "HeadersTimeoutError",
    );

    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw", headersTimeoutMs: HEADERS_TIMEOUT_MS });
    const result = await client.prompt({
      agent: "ai-review-security",
      model: { providerID: "p", modelID: "m" },
      system: "rules",
      text: "diff",
      title: "t",
      timeoutMs: 10_000,
    });
    client.close();

    assert.equal(result.text, "<no-issues/>");
    assert.equal(result.rejectedPermissions, 1);
    const reply = fake.calls.find(c => c.url === "/permission/p1/reply");
    assert.equal(reply.body.reply, "reject");
    const prompt = fake.calls.find(c => c.url === "/session/s1/prompt_async");
    assert.equal(prompt.body.agent, "ai-review-security");
    assert.equal(prompt.auth, `Basic ${Buffer.from("opencode:pw").toString("base64")}`);
    assert.ok(fake.calls.some(c => c.method === "DELETE" && c.url === "/session/s1"));
  } finally {
    await fake.close();
  }
});

test("a timed-out agent is aborted server-side and not reported as transient", async () => {
  const fake = await fakeOpencode({ idleAfterMs: null });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    await assert.rejects(
      client.prompt({ agent: "a", model: {}, system: "", text: "", title: "t", timeoutMs: 300 }),
      err => {
        assert.equal(err.name, "TimeoutError");
        assert.equal(isTransientError(err), false);
        return true;
      },
    );
    client.close();
    assert.ok(fake.calls.some(c => c.method === "POST" && c.url === "/session/s1/abort"));
  } finally {
    await fake.close();
  }
});

test("a provider 429 surfaced as session.error is transient", async () => {
  const error = { name: "APIError", data: { message: "Too Many Requests", statusCode: 429, isRetryable: true } };
  const fake = await fakeOpencode({ idleAfterMs: 100, finalEvent: "session.error", error });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    await assert.rejects(
      client.prompt({ agent: "a", model: {}, system: "", text: "", title: "t", timeoutMs: 5000 }),
      err => isTransientError(err) && /Too Many Requests/.test(err.message),
    );
    client.close();
  } finally {
    await fake.close();
  }
});

test("a session.error emitted before prompt_async returns is not lost", async () => {
  const error = { name: "ProviderAuthError", data: { message: "bad key" } };
  const fake = await fakeOpencode({ idleAfterMs: null, errorBeforeAck: error });
  try {
    const client = new OpencodeClient({ baseUrl: fake.baseUrl, password: "pw" });
    const started = Date.now();
    await assert.rejects(
      client.prompt({ agent: "a", model: {}, system: "", text: "", title: "t", timeoutMs: 5000 }),
      err => err.name !== "TimeoutError" && /bad key/.test(err.message),
    );
    assert.ok(Date.now() - started < 2000, "waited for the timeout instead of the early error");
    client.close();
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
  assert.equal(env.OPENCODE_CONFIG, "/engine/opencode.jsonc");
  assert.equal(env.HOME, "/tmp/h");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/h/.config");
});

test("toolEnabled follows opencode's last-match-wins evaluation", () => {
  const ruleset = [
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "read", pattern: "*.env", action: "ask" },
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
  ];
  assert.equal(toolEnabled("read", ruleset), true);
  assert.equal(toolEnabled("bash", ruleset), false);
  assert.equal(toolEnabled("write", ruleset), false);
  assert.equal(toolEnabled("webfetch", ruleset), false);
  assert.equal(toolEnabled("bash", [...ruleset, { permission: "bash", pattern: "git *", action: "allow" }]), true);
});

function fakeClient(toolIds, agents) {
  return {
    json: async (method, path) => (path === "/experimental/tool/ids" ? toolIds : agents),
  };
}

const READ_ONLY = [
  { permission: "*", pattern: "*", action: "deny" },
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "glob", pattern: "*", action: "allow" },
  { permission: "grep", pattern: "*", action: "allow" },
  { permission: "external_directory", pattern: "*", action: "deny" },
  { permission: "external_directory", pattern: "/tmp/h/.local/share/opencode/tool-output/*", action: "allow" },
];

test("self-check passes only for read-only agents and built-in tools", async () => {
  const tools = ["invalid", "bash", "read", "glob", "grep", "edit", "write", "webfetch", "task"];
  await selfCheck(fakeClient(tools, [{ name: "ai-review-security", permission: READ_ONLY }]), ["ai-review-security"]);

  await assert.rejects(
    selfCheck(fakeClient([...tools, "canary"], [{ name: "ai-review-security", permission: READ_ONLY }]), ["ai-review-security"]),
    /non-built-in tools \(canary\)/,
  );
  await assert.rejects(
    selfCheck(fakeClient(tools, [{ name: "ai-review-security", permission: [...READ_ONLY, { permission: "bash", pattern: "*", action: "allow" }] }]), ["ai-review-security"]),
    /bash allowed/,
  );
  await assert.rejects(
    selfCheck(fakeClient(tools, [{ name: "ai-review-security", permission: READ_ONLY }]), ["ai-review-security", "ai-review-qa"]),
    /ai-review-qa: not registered/,
  );
  await assert.rejects(
    selfCheck(fakeClient(tools, [{ name: "ai-review-security", permission: [...READ_ONLY, { permission: "external_directory", pattern: "/proc/*", action: "allow" }] }]), ["ai-review-security"]),
    /external_directory/,
  );
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
