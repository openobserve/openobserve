import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cleanAttributeValue,
  genAiRequestAttributes,
  genAiResponseAttributes,
  sha256,
} from "../telemetry.mjs";

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
        modelID: "deepseek-v4-pro",
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
  assert.equal(attributes["gen_ai.usage.input_tokens"], 1234);
  assert.equal(attributes["gen_ai.usage.output_tokens"], 56);
  assert.equal(attributes["gen_ai.usage.total_tokens"], 1290);
  assert.equal(attributes["gen_ai.usage.cache_read_tokens"], 78);
  assert.equal(attributes["gen_ai.usage.cache_write_tokens"], 9);
  assert.equal(attributes["gen_ai.usage.cost"], 0.42);
  assert.equal(attributes["ai.review.usage.reasoning_tokens"], 12);
  assert.equal(
    Object.keys(attributes).some(key => key.startsWith("gen_ai.completion.")),
    false,
  );
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
