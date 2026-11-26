// Copyright 2026 OpenObserve Inc.
// `node --test` checks for the replay proxy; the name avoids Playwright's *.test.* match so the browser suite never loads it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createReplayProxy, loadRecordings, selectStep } from "./server.mjs";

const two = new Map([
  ["complete", { scenario: "complete", steps: [{ content: "a", toolCalls: [] }] }],
  [
    "slow",
    {
      scenario: "slow",
      steps: [
        { content: "", toolCalls: [{ name: "search", arguments: "{}" }] },
        { content: "b", toolCalls: [] },
      ],
    },
  ],
]);

let base;
let proxy;

before(async () => {
  proxy = createReplayProxy(loadRecordings());
  await new Promise((resolve) => proxy.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${proxy.server.address().port}`;
});

after(() => proxy.server.close());

test("every shipped recording loads", () => {
  assert.ok(loadRecordings().has("complete"));
});

test("a malformed recording fails the load with its file name", () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-"));
  try {
    writeFileSync(join(dir, "complete.json"), JSON.stringify({ version: 1, scenario: "complete", steps: [] }));
    assert.throws(() => loadRecordings(dir), /complete\.json: steps/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the first replay tag of the latest user message picks the scenario and assistant rounds pick the step", () => {
  const user = (content) => ({ role: "user", content });
  assert.equal(selectStep([user("why? [replay:slow]")], two).index, 0);
  const afterTool = [user("why? [replay:slow]"), { role: "assistant", tool_calls: [] }, { role: "tool", content: "rows" }];
  assert.equal(selectStep(afterTool, two).step.content, "b");
  assert.equal(selectStep([user("[replay:slow] then [replay:complete]")], two).scenario, "slow");
  assert.equal(selectStep([user("why? [replay:slow]\n\nPage: [logs](/web/logs) [error] [complete]")], two).scenario, "slow");
  assert.equal(selectStep([user("see [slow] and [logs](/web/logs)")], two).scenario, "complete");
  assert.equal(selectStep([user([{ type: "text", text: "no tag" }])], two).scenario, "complete");
  assert.match(selectStep([user("[replay:missing]")], two).error, /no recording/);
});

test("a streamed answer is OpenAI chunks ending in [DONE] with usage when asked", async () => {
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "replay", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "hi [replay:complete]" }] }),
  });
  assert.equal(response.status, 200);
  const frames = (await response.text()).split("\n\n").filter(Boolean).map((f) => f.replace(/^data: /, ""));
  assert.equal(frames.at(-1), "[DONE]");
  const chunks = frames.slice(0, -1).map((f) => JSON.parse(f));
  assert.equal(chunks[0].choices[0].delta.role, "assistant");
  assert.equal(chunks.at(-2).choices[0].finish_reason, "stop");
  assert.ok(chunks.at(-1).usage.total_tokens > 0);
  assert.ok(chunks.slice(1, -2).map((c) => c.choices[0].delta.content).join("").startsWith("## Replayed answer"));
});

test("a plain answer, an unknown scenario, a bad body and the served log", async () => {
  const post = (body) =>
    fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const plain = await (await post(JSON.stringify({ messages: [{ role: "user", content: "hi" }] }))).json();
  assert.equal(plain.choices[0].finish_reason, "stop");
  assert.equal((await post(JSON.stringify({ messages: [{ role: "user", content: "[replay:nope]" }] }))).status, 404);
  assert.equal((await post("{not json")).status, 400);
  const served = await (await fetch(`${base}/__replay/served`)).json();
  assert.ok(served.every((s) => Object.keys(s).sort().join() === "scenario,step,stream"));
  assert.equal((await fetch(`${base}/v1/models`)).status, 200);
});
