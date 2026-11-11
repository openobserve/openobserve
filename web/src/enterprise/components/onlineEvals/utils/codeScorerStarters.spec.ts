// Copyright 2026 OpenObserve Inc.
// Calls each starter's score(...) with the mapped variables, as the backend sandbox does.

import { describe, expect, it } from "vitest";
import { CODE_SCORER_STARTERS, scoreFunctionParams } from "./codeScorerStarters";

function source(key: string) {
  const starter = CODE_SCORER_STARTERS.find((s) => s.key === key);
  if (!starter) throw new Error(`no starter ${key}`);
  return starter.source;
}

function run(code: string, ...args: unknown[]) {
  return new Function("args", `${code}\nreturn score(...args);`)(args);
}

// The sandbox rejects source containing any of these (js_security.rs).
const FORBIDDEN = [
  "eval(",
  "Function(",
  "import(",
  "globalThis",
  "window.",
  "self.",
  "global.",
  "__proto__",
  "constructor.prototype",
  "constructor.constructor",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "XMLHttpRequest",
  "fetch(",
  "WebSocket",
  "require(",
  "process.",
  "__dirname",
  "__filename",
  "module.",
  "exports.",
  "Reflect.",
  "Proxy(",
];

describe("code scorer starters", () => {
  it("ships the six checks, each runnable by the sandbox", () => {
    expect(CODE_SCORER_STARTERS.map((s) => s.key)).toEqual([
      "json_is_valid",
      "matches_json_schema",
      "matches_regex",
      "cost_at_most",
      "latency_at_most",
      "exact_match",
    ]);
    for (const starter of CODE_SCORER_STARTERS) {
      expect(scoreFunctionParams(starter.source), starter.key).not.toBeNull();
      expect(
        FORBIDDEN.filter((pattern) => starter.source.includes(pattern)),
        starter.key,
      ).toEqual([]);
    }
  });

  it("JSON is valid", () => {
    expect(run(source("json_is_valid"), '{"answer": "Paris"}')).toBe(true);
    expect(run(source("json_is_valid"), 'Sure! {"answer": "Paris"}')).toBe(false);
  });

  it("Matches JSON schema", () => {
    const code = source("matches_json_schema");
    expect(run(code, '{"answer": "Paris"}')).toBe(true);
    expect(run(code, '{"answer": 42}')).toBe(false);
    expect(run(code, '{"city": "Paris"}')).toBe(false);
    expect(run(code, "not json")).toBe(false);
    const list = code.replace(
      /const SCHEMA = \{[\s\S]*?\n\};/,
      'const SCHEMA = { type: "array", items: { type: "integer", enum: [1, 2] } };',
    );
    expect(run(list, "[1, 2, 1]")).toBe(true);
    expect(run(list, "[1, 3]")).toBe(false);
  });

  it("Matches regex, must and must not", () => {
    const mustNot = source("matches_regex");
    expect(run(mustNot, "Paris is the capital.")).toBe(true);
    expect(run(mustNot, "Sorry, I cannot help with that.")).toBe(false);

    const must = mustNot.replace("MUST_MATCH = false", "MUST_MATCH = true");
    expect(run(must, "Sorry, I cannot help with that.")).toBe(true);
    expect(run(must, "Paris is the capital.")).toBe(false);
  });

  it("Cost at most $0.05", () => {
    const code = source("cost_at_most");
    expect(run(code, "0.05")).toBe(true);
    expect(run(code, "0.0501")).toBe(false);
    expect(run(code, "")).toBe(false);
  });

  it("Latency at most 10 s, from a duration in microseconds", () => {
    const code = source("latency_at_most");
    expect(run(code, "9500000")).toBe(true);
    expect(run(code, "10000001")).toBe(false);
    expect(run(code, "")).toBe(false);
  });

  it("Exact match against the expected output", () => {
    const code = source("exact_match");
    expect(scoreFunctionParams(code)).toEqual(["output", "expected_output"]);
    expect(run(code, " Paris\n", "Paris")).toBe(true);
    expect(run(code, "paris", "Paris")).toBe(false);
  });
});

describe("scoreFunctionParams", () => {
  it("reads plain parameter names and rejects what it cannot map", () => {
    expect(scoreFunctionParams("function score( a, b_2 ) {}")).toEqual(["a", "b_2"]);
    expect(scoreFunctionParams("function score() {}")).toEqual([]);
    expect(scoreFunctionParams("function score(a, limit = 5) {}")).toBeNull();
    expect(scoreFunctionParams("const score = (a) => a;")).toBeNull();
  });

  it("reads the declared signature, not one in comments, strings or nested functions", () => {
    for (const code of [
      '/* usage: function score(expected) */\nfunction score(output) { return output === "x"; }',
      "// function score(a, b = 2)\nfunction score(output) { return true; }",
      "var doc = 'function score(expected)';\nfunction score(output) { return true; }",
      "var doc = `function score(\n expected)`;\nfunction score(output) { return true; }",
      "var re = /function score\\(expected\\)/;\nfunction score(output) { return re.test(output); }",
      // A regex after a keyword, holding a brace, is not a division.
      "function isJson(s) { return /^\\{/.test(s); }\nfunction score(output) { return isJson(output); }",
      "function half(n) { return n / 2; }\nfunction score(output) { return half(output) / 2; }",
      "function wrap() { function score(expected) {} }\nfunction score(output) { return 1 / 2; }",
      "function score(expected) { return 1; }\nfunction score(output) { return 2; }",
    ]) {
      expect(scoreFunctionParams(code), code).toEqual(["output"]);
    }
    expect(scoreFunctionParams("// function score(output) {}")).toBeNull();
    expect(scoreFunctionParams('var s = "function score(output)";')).toBeNull();
  });
});
