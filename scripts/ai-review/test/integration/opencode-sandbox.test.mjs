import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OPENCODE_CONFIGS, OpencodeServer, selfCheck } from "../../src/opencode.mjs";
import { sanitizePrTree } from "../../src/sanitize.mjs";
import { stripJsonc } from "../jsonc.mjs";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PLANTED = "PLANTED-INSTRUCTION-7f3a";
const REVIEW_AGENTS = [
  "ai-review-security", "ai-review-correctness", "ai-review-code-quality", "ai-review-performance", "ai-review-documentation",
  "ai-review-release", "ai-review-frontend", "ai-review-qa", "ai-review-coordinator",
];
const skip = process.env.OPENCODE_BIN ? false : "set OPENCODE_BIN to the pinned opencode binary";

// By default the first request that offers tools gets one scripted tool call and every later request the final answer; `script` overrides that per request.
function stubProvider(toolCall, { script } = {}) {
  const requests = [];
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed, raw: body });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(event("message_start", { message: {
        id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null,
        usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } }));
      const hasToolResult = (parsed.messages || []).some(m => Array.isArray(m.content) && m.content.some(b => b.type === "tool_result"));
      const step = script ? script(parsed, requests.length) : { tool: parsed.tools?.length && !hasToolResult ? toolCall : null };
      if (step.hangMs) {
        const timer = setTimeout(() => res.end(), step.hangMs);
        res.on("close", () => clearTimeout(timer));
        return;
      }
      if (step.tool) {
        res.write(event("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_${requests.length}`, name: step.tool.name, input: {} } }));
        res.write(event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(step.tool.args) } }));
        res.write(event("content_block_stop", { index: 0 }));
        res.write(event("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 100 } }));
      } else {
        res.write(event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
        res.write(event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "<no-issues/>" } }));
        res.write(event("content_block_stop", { index: 0 }));
        res.write(event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 100 } }));
      }
      res.end(event("message_stop", {}));
    });
  });
  return new Promise(done => server.listen(0, "127.0.0.1", () => done({
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => { server.closeAllConnections(); server.close(); },
  })));
}

const toolResultOf = request => JSON.stringify(
  (request.body.messages || []).flatMap(m => (Array.isArray(m.content) ? m.content : [])).find(b => b.type === "tool_result")?.content ?? "",
);

function plantedPr() {
  const root = mkdtempSync(join(tmpdir(), "ai-review-sandbox-pr-"));
  const canary = `${root}-canary`;
  const toolCanary = `${root}-tool-canary`;
  // Outside the PR tree: the read-only agents must not be able to read it.
  const secret = `${root}-secret`;
  writeFileSync(secret, "SECRET-OUTSIDE-PR-91c2");
  const files = {
    "AGENTS.md": PLANTED,
    "web/AGENTS.md": PLANTED,
    "src/CLAUDE.md": PLANTED,
    "CONTEXT.md": PLANTED,
    "opencode.jsonc": JSON.stringify({ agent: { "ai-review-security": { permission: { bash: "allow" } } } }),
    ".opencode/tool/x.ts": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(toolCanary)}, "x"); export default {};`,
    ".opencode/plugin/x.ts": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(canary)}, "x"); export default async () => ({});`,
    ".agents/skills/x/SKILL.md": `---\nname: x\ndescription: ${PLANTED}\n---\n${PLANTED}`,
    ".claude/skills/x/SKILL.md": `---\nname: x\ndescription: ${PLANTED}\n---\n${PLANTED}`,
    "src/main.rs": "fn main() {}\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  symlinkSync("/proc", join(root, "p"));
  return { root, canary, toolCanary, secret };
}

async function withServer(prDir, configPath, run, { readOnly = true } = {}) {
  const server = new OpencodeServer({
    binary: process.env.OPENCODE_BIN,
    cwd: prDir,
    configPath,
    providerKeyVars: ["ANTHROPIC_REVIEW_API_KEY"],
    parentEnv: { PATH: process.env.PATH, ANTHROPIC_REVIEW_API_KEY: "stub-key", ANTHROPIC_API_KEY: "shared-key-must-not-leak", GH_TOKEN: "ghs_must_not_leak" },
    readOnly,
  });
  try {
    return await run(await server.ensureStarted());
  } finally {
    server.stop();
  }
}

function stubConfig(file, stub, configDir, edit = () => {}) {
  const config = JSON.parse(stripJsonc(readFileSync(join(ENGINE_DIR, file), "utf-8")));
  config.providers["anthropic-review"].settings = { baseURL: stub.url };
  edit(config);
  const configPath = join(configDir, "opencode.json");
  writeFileSync(configPath, JSON.stringify(config));
  return configPath;
}

function cleanup(t, stub, pr, configDir) {
  t.after(() => {
    stub.close();
    rmSync(pr.root, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    for (const path of [pr.canary, pr.toolCanary, pr.secret]) rmSync(path, { force: true });
  });
}

const PROMPT = {
  agent: "ai-review-correctness",
  model: { providerID: "anthropic-review", modelID: "claude-sonnet-5-5" },
  variant: "high",
  system: "You are a reviewer.",
  text: "Review src/main.rs",
  timeoutMs: 60_000,
};

test("sanitized PR + sandboxed opencode: planted loaders are inert and reads outside the PR are denied", { skip, timeout: 120_000 }, async t => {
  const pr = plantedPr();
  const stub = await stubProvider({ name: "read", args: { path: pr.secret } });
  const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
  cleanup(t, stub, pr, configDir);
  const configPath = stubConfig(OPENCODE_CONFIGS.default.file, stub, configDir);

  const sanitized = sanitizePrTree(pr.root, ENGINE_DIR);
  assert.ok(sanitized.removed.some(r => r.path === "p" && r.reason === "symlink"));
  assert.ok(sanitized.contextFiles.includes("skills/ui-architect/references"));

  await withServer(pr.root, configPath, async client => {
    await selfCheck(client, REVIEW_AGENTS);
    const result = await client.prompt({ ...PROMPT, title: "sandbox" });
    assert.equal(result.text, "<no-issues/>");
    assert.ok(result.info.tokens?.output > 0, "token counts must reach telemetry so the server can price the call");
  });

  assert.equal(existsSync(pr.canary), false, "a planted plugin ran");
  assert.equal(existsSync(pr.toolCanary), false, "a planted tool ran");
  assert.ok(stub.requests.length >= 2);
  for (const request of stub.requests) {
    assert.equal(request.raw.includes(PLANTED), false, "planted instruction text reached the model");
    assert.equal(request.raw.includes("ghs_must_not_leak"), false);
    assert.equal(request.headers["x-api-key"], "stub-key");
    assert.equal(request.body.model, "claude-sonnet-5-5");
    assert.deepEqual(request.body.output_config, { effort: "high" }, "the high variant must reach the provider");
    assert.equal(request.body.thinking?.type, "adaptive");
    // The model rejects sampling params, a forced tool choice and an assistant prefill with a 400.
    for (const field of ["temperature", "top_p", "top_k", "tool_choice"]) assert.equal(request.body[field], undefined, field);
    assert.equal(request.body.messages.at(-1).role, "user");
  }
  // skill is offered but every skill is denied (opencode lists the tool whenever the action has a narrower rule).
  const toolNames = (stub.requests[0].body.tools || []).map(tool => tool.name).sort();
  assert.deepEqual(toolNames, ["glob", "grep", "read", "skill"]);
  assert.match(JSON.stringify(stub.requests[0].body.system), /You are a reviewer\./);
  const content = toolResultOf(stub.requests.at(-1));
  assert.doesNotMatch(content, /SECRET-OUTSIDE-PR-91c2/);
  assert.match(content, /permission|denied|reject/i);
});

// 2.x has no flag that turns off project plugins or skills by name, so sanitize stays mandatory; this pins what the flags and self-check do guarantee.
test("without sanitize, the env flags still keep project config, tools and agent overrides out", { skip, timeout: 120_000 }, async t => {
  const pr = plantedPr();
  const stub = await stubProvider({ name: "glob", args: { pattern: "*.rs" } });
  const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
  cleanup(t, stub, pr, configDir);
  const configPath = stubConfig(OPENCODE_CONFIGS.default.file, stub, configDir);

  await withServer(pr.root, configPath, async client => {
    await selfCheck(client, REVIEW_AGENTS);
    await client.prompt({ ...PROMPT, title: "flags-only" });
  });
  // 2.2.0 also leaves the planted plugin and AGENTS.md alone here (1.18.x imported the plugin); sanitize stays regardless.
  assert.equal(existsSync(pr.canary), false, "a planted plugin ran");
  assert.equal(existsSync(pr.toolCanary), false, "a planted tool ran");
  for (const request of stub.requests) assert.equal(request.raw.includes(PLANTED), false, "planted instruction text reached the model");
  const toolNames = (stub.requests[0].body.tools || []).map(tool => tool.name).sort();
  assert.deepEqual(toolNames, ["glob", "grep", "read", "skill"]);
});

const allowShell = (...commands) => config => {
  config.agents["ai-review-correctness"].permissions.push(...commands.map(resource => ({ action: "shell", resource, effect: "allow" })));
};

test("ci-full: file tools and the shell are offered without a prompt, and the shell sees no GitHub token", { skip, timeout: 120_000 }, async t => {
  const pr = plantedPr();
  const stub = await stubProvider({ name: "shell", args: { command: "echo ran-$((6*7)); env", description: "probe" } });
  const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
  cleanup(t, stub, pr, configDir);
  // The allowlist refuses echo and env, so this probe of the shell's environment adds them for the test alone.
  const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir, allowShell("echo *", "env *"));
  sanitizePrTree(pr.root, ENGINE_DIR);

  await withServer(pr.root, configPath, async client => {
    await selfCheck(client, REVIEW_AGENTS, { readOnly: false });
    await assert.rejects(selfCheck(client, REVIEW_AGENTS), /self-check failed/, "the read-only check must refuse the ci-full grant");
    const result = await client.prompt({ ...PROMPT, title: "ci-full" });
    assert.equal(result.text, "<no-issues/>");
    assert.equal(result.rejectedPermissions, 0);
  }, { readOnly: false });

  const toolNames = (stub.requests[0].body.tools || []).map(tool => tool.name);
  for (const name of ["read", "glob", "grep", "edit", "write", "shell"]) assert.ok(toolNames.includes(name), name);
  for (const name of ["webfetch", "websearch", "subagent", "question", "execute"]) assert.equal(toolNames.includes(name), false, `${name} is offered`);
  const content = toolResultOf(stub.requests.at(-1));
  assert.match(content, /ran-42/);
  assert.doesNotMatch(content, /ghs_must_not_leak/);
});

test("the real self-check passes the shipped ci-full config and refuses it with execute or the whole shell re-allowed", { skip, timeout: 120_000 }, async t => {
  for (const [extra, problem] of [[null, null], [{ action: "execute", resource: "*", effect: "allow" }, /ai-review-qa: execute allowed/], [{ action: "shell", resource: "*", effect: "allow" }, /ai-review-qa: shell allows every command/]]) {
    const pr = plantedPr();
    const stub = await stubProvider(null);
    const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
    cleanup(t, stub, pr, configDir);
    const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir, config => { if (extra) config.agents["ai-review-qa"].permissions.push(extra); });
    sanitizePrTree(pr.root, ENGINE_DIR);
    await withServer(pr.root, configPath, async client => {
      const check = selfCheck(client, REVIEW_AGENTS, { readOnly: false });
      if (problem) await assert.rejects(check, problem);
      else assert.equal((await check).agents, REVIEW_AGENTS.length);
    }, { readOnly: false });
  }
});

test("ci-full offers skill only because opencode appends a narrower rule, and refuses every skill", { skip, timeout: 120_000 }, async t => {
  const pr = plantedPr();
  const stub = await stubProvider({ name: "skill", args: { id: "browser" } });
  const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
  cleanup(t, stub, pr, configDir);
  const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir);
  sanitizePrTree(pr.root, ENGINE_DIR);
  await withServer(pr.root, configPath, async client => {
    const result = await client.prompt({ ...PROMPT, title: "skill" });
    assert.equal(result.rejectedPermissions, 0);
  }, { readOnly: false });
  assert.match(toolResultOf(stub.requests.at(-1)), /Permission denied: skill/);
});

test("ci-full shell runs an allowlisted command and refuses a build outright, without asking", { skip, timeout: 120_000 }, async t => {
  // A RegExp is the output an allowed command must print; null means opencode must refuse it.
  const ONE = /\b1\b/;
  const cases = [
    ["cat src/main.rs | wc -l", ONE], ["grep -c main src/main.rs", ONE], ["find src -name '*.rs' | wc -l", ONE], ["tail -n 1 src/main.rs | wc -l", ONE],
    ["ls src && wc -l src/main.rs", ONE], ["find src -name '*-executor*' | wc -l", /\b0\b/], ["cargo build", null], ["ls && touch built.txt", null],
    ["find . -name main.rs -exec touch built.txt ;", null], ["find src -fprint built.txt", null], ["git grep -nOsh main", null],
    ["cat $(touch built.txt)", null], ["cat `touch built.txt`", null], ["cat src/main.rs > built.txt", null], ["cat /proc/self/environ", null],
  ];
  for (const [command, output] of cases) {
    const pr = plantedPr();
    const stub = await stubProvider({ name: "shell", args: { command, description: "probe" } });
    const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
    cleanup(t, stub, pr, configDir);
    const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir);
    sanitizePrTree(pr.root, ENGINE_DIR);
    await withServer(pr.root, configPath, async client => {
      const result = await client.prompt({ ...PROMPT, title: "shell" });
      assert.equal(result.rejectedPermissions, 0, "a denied command must not reach a prompt that ci-full would approve");
    }, { readOnly: false });
    const content = toolResultOf(stub.requests.at(-1));
    assert.match(content, output ?? /Permission denied: shell/, command);
    assert.equal(existsSync(join(pr.root, "built.txt")), false, command);
  }
});

// Why neither config sets `steps`: if opencode ever stops ending the capped turn on an assistant message, this fails and the cap can come back.
test("opencode 2.2.0's step cap ends the capped turn on an assistant prefill, which the model rejects with thinking on", { skip, timeout: 120_000 }, async t => {
  const pr = plantedPr();
  // Asks for another tool call on every turn that allows one, so only the cap can end the loop.
  const stub = await stubProvider(null, { script: parsed => ({ tool: parsed.tool_choice?.type === "none" ? null : { name: "glob", args: { pattern: "*.rs" } } }) });
  const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
  cleanup(t, stub, pr, configDir);
  const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir, config => { config.agents["ai-review-correctness"].steps = 3; });
  sanitizePrTree(pr.root, ENGINE_DIR);
  await withServer(pr.root, configPath, client => client.prompt({ ...PROMPT, title: "steps" }), { readOnly: false });
  assert.equal(stub.requests.length, 3);
  const capped = stub.requests.at(-1).body;
  assert.deepEqual(capped.tool_choice, { type: "none" });
  assert.equal(capped.messages.at(-1).role, "assistant");
  assert.match(JSON.stringify(capped.messages.at(-1).content), /MAXIMUM STEPS REACHED/);
  for (const request of stub.requests.slice(0, -1)) assert.equal(request.body.messages.at(-1).role, "user");
});

test("each effort variant reaches the provider as its own effort level", { skip, timeout: 120_000 }, async t => {
  for (const variant of ["low", "medium", "xhigh", "max"]) {
    const pr = plantedPr();
    const stub = await stubProvider({ name: "glob", args: { pattern: "*.rs" } });
    const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
    cleanup(t, stub, pr, configDir);
    const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir);
    sanitizePrTree(pr.root, ENGINE_DIR);
    await withServer(pr.root, configPath, client => client.prompt({ ...PROMPT, variant, title: variant }), { readOnly: false });
    for (const request of stub.requests) {
      assert.deepEqual(request.body.output_config, { effort: variant });
      assert.equal(request.body.thinking?.type, "adaptive");
      for (const field of ["temperature", "top_p", "top_k", "tool_choice"]) assert.equal(request.body[field], undefined, field);
    }
  }
});

test("a session still running at its soft deadline is interrupted and answers the wrap-up prompt from the same context", { skip, timeout: 120_000 }, async t => {
  const pr = plantedPr();
  const wrapText = "WRAP-UP-NOW-5d1e";
  // A tool step, then a model turn that never returns; only the wrap-up prompt gets an answer.
  const stub = await stubProvider(null, {
    script: (parsed, n) => {
      if (parsed.messages?.some(m => JSON.stringify(m.content).includes(wrapText))) return { tool: null };
      return n === 1 ? { tool: { name: "glob", args: { pattern: "*.rs" } } } : { hangMs: 60_000 };
    },
  });
  const configDir = mkdtempSync(join(tmpdir(), "ai-review-config-"));
  cleanup(t, stub, pr, configDir);
  const configPath = stubConfig(OPENCODE_CONFIGS["ci-full"].file, stub, configDir);
  sanitizePrTree(pr.root, ENGINE_DIR);
  await withServer(pr.root, configPath, async client => {
    const result = await client.prompt({ ...PROMPT, title: "wrap-up", timeoutMs: 20_000, wrapUp: { ms: 10_000, text: wrapText } });
    assert.equal(result.wrappedUp, true);
    assert.equal(result.text, "<no-issues/>");
  }, { readOnly: false });
  const last = stub.requests.at(-1);
  assert.match(last.raw, new RegExp(wrapText));
  assert.ok(last.body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === "tool_result")), "the wrap-up lost the steps the agent had already run");
  for (const request of stub.requests) {
    for (const field of ["temperature", "top_p", "top_k", "tool_choice"]) assert.equal(request.body[field], undefined, field);
    assert.equal(request.body.messages.at(-1).role, "user", "the wrap-up must not end on an assistant prefill");
  }
});
