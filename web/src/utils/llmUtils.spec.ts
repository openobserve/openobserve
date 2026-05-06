// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import {
  isLLMTrace,
  parseUsageDetails,
  parseCostDetails,
  parseModelParameters,
  formatCost,
  formatTokens,
  truncateLLMContent,
  parseEvaluationScores,
  formatScore,
  getQualityScoreColor,
  getObservationTypeColor,
  extractLLMData,
  formatModelParameters,
  truncateSessionId,
} from "./llmUtils";

// ---------------------------------------------------------------------------
// isLLMTrace
// ---------------------------------------------------------------------------
describe("isLLMTrace", () => {
  it("returns false for null", () => {
    expect(isLLMTrace(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isLLMTrace(undefined)).toBe(false);
  });

  it("returns false when no LLM fields are present", () => {
    expect(isLLMTrace({ service_name: "svc", duration: 100 })).toBe(false);
  });

  it("returns false when LLM fields exist but are empty string", () => {
    expect(isLLMTrace({ gen_ai_system: "" })).toBe(false);
  });

  it("returns false when LLM fields exist but are 0", () => {
    expect(isLLMTrace({ gen_ai_usage_input_tokens: 0 })).toBe(false);
  });

  it("returns true for OTEL gen_ai_system", () => {
    expect(isLLMTrace({ gen_ai_system: "openai" })).toBe(true);
  });

  it("returns true for gen_ai_response_model", () => {
    expect(isLLMTrace({ gen_ai_response_model: "gpt-4" })).toBe(true);
  });

  it("returns true for gen_ai_request_model", () => {
    expect(isLLMTrace({ gen_ai_request_model: "gpt-3.5-turbo" })).toBe(true);
  });

  it("returns true for gen_ai_operation_name", () => {
    expect(isLLMTrace({ gen_ai_operation_name: "chat" })).toBe(true);
  });

  it("returns true for gen_ai_input_messages", () => {
    expect(isLLMTrace({ gen_ai_input_messages: "hello" })).toBe(true);
  });

  it("returns true for gen_ai_output_messages", () => {
    expect(isLLMTrace({ gen_ai_output_messages: "world" })).toBe(true);
  });

  it("returns true for gen_ai_usage_input_tokens", () => {
    expect(isLLMTrace({ gen_ai_usage_input_tokens: 100 })).toBe(true);
  });

  it("returns true for gen_ai_usage_output_tokens", () => {
    expect(isLLMTrace({ gen_ai_usage_output_tokens: 50 })).toBe(true);
  });

  it("returns true for gen_ai_usage_cost", () => {
    expect(isLLMTrace({ gen_ai_usage_cost: 0.05 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseUsageDetails
// ---------------------------------------------------------------------------
describe("parseUsageDetails", () => {
  it("returns zeros for null", () => {
    expect(parseUsageDetails(null)).toEqual({ input: 0, output: 0, total: 0 });
  });

  it("returns zeros for undefined", () => {
    expect(parseUsageDetails(undefined)).toEqual({
      input: 0,
      output: 0,
      total: 0,
    });
  });

  it("parses gen_ai usage fields from object", () => {
    expect(parseUsageDetails({ gen_ai_usage_input_tokens: 10, gen_ai_usage_output_tokens: 20, gen_ai_usage_total_tokens: 30 })).toEqual({
      input: 10,
      output: 20,
      total: 30,
    });
  });

  it("computes total from input + output when total is absent", () => {
    expect(parseUsageDetails({ gen_ai_usage_input_tokens: 10, gen_ai_usage_output_tokens: 20 })).toEqual({
      input: 10,
      output: 20,
      total: 30,
    });
  });

  it("parses OTEL gen_ai_usage_* keys", () => {
    const result = parseUsageDetails({
      gen_ai_usage_input_tokens: 100,
      gen_ai_usage_output_tokens: 50,
      gen_ai_usage_total_tokens: 150,
    });
    expect(result).toEqual({ input: 100, output: 50, total: 150 });
  });

  it("computes total from input+output when total is absent", () => {
    const result = parseUsageDetails({
      gen_ai_usage_input_tokens: 100,
      gen_ai_usage_output_tokens: 50,
    });
    expect(result).toEqual({ input: 100, output: 50, total: 150 });
  });

  it("parses a JSON string", () => {
    const result = parseUsageDetails(
      JSON.stringify({ gen_ai_usage_input_tokens: 7, gen_ai_usage_output_tokens: 3, gen_ai_usage_total_tokens: 10 }),
    );
    expect(result).toEqual({ input: 7, output: 3, total: 10 });
  });

  it("returns zeros for invalid JSON string", () => {
    expect(parseUsageDetails("not-json")).toEqual({
      input: 0,
      output: 0,
      total: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// parseCostDetails
// ---------------------------------------------------------------------------
describe("parseCostDetails", () => {
  it("returns zeros for null", () => {
    expect(parseCostDetails(null)).toEqual({ input: 0, output: 0, total: 0 });
  });

  it("parses gen_ai cost fields from object", () => {
    expect(
      parseCostDetails({ gen_ai_usage_cost_input: 0.001, gen_ai_usage_cost_output: 0.002, gen_ai_usage_cost: 0.003 }),
    ).toEqual({
      input: 0.001,
      output: 0.002,
      total: 0.003,
    });
  });

  it("computes total from input + output when total is absent", () => {
    const result = parseCostDetails({ gen_ai_usage_cost_input: 0.001, gen_ai_usage_cost_output: 0.002 });
    expect(result.total).toBeCloseTo(0.003);
  });

  it("parses a JSON string", () => {
    const result = parseCostDetails(
      JSON.stringify({ gen_ai_usage_cost_input: 0.01, gen_ai_usage_cost_output: 0.02, gen_ai_usage_cost: 0.03 }),
    );
    expect(result).toEqual({ input: 0.01, output: 0.02, total: 0.03 });
  });

  it("returns zeros for invalid JSON string", () => {
    expect(parseCostDetails("not-json")).toEqual({
      input: 0,
      output: 0,
      total: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// parseModelParameters
// ---------------------------------------------------------------------------
describe("parseModelParameters", () => {
  it("returns empty object for null", () => {
    expect(parseModelParameters(null)).toEqual({});
  });

  it("returns empty object for undefined", () => {
    expect(parseModelParameters(undefined)).toEqual({});
  });

  it("returns the object as-is when passed an object", () => {
    const params = { temperature: 0.7, max_tokens: 256 };
    expect(parseModelParameters(params)).toEqual(params);
  });

  it("parses a valid JSON string", () => {
    const params = { temperature: 0.5 };
    expect(parseModelParameters(JSON.stringify(params))).toEqual(params);
  });

  it("returns empty object for invalid JSON string", () => {
    expect(parseModelParameters("invalid-json")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------
describe("formatCost", () => {
  it("returns '0.00' for 0", () => {
    expect(formatCost(0)).toBe("0.00");
  });

  it("returns '<0.0001' for values smaller than 0.0001", () => {
    expect(formatCost(0.00005)).toBe("<0.0001");
    expect(formatCost(0.000099)).toBe("<0.0001");
  });

  it("formats normal cost to 4 decimal places", () => {
    expect(formatCost(0.0015)).toBe("0.0015");
    expect(formatCost(1.2345)).toBe("1.2345");
  });

  it("formats exactly 0.0001", () => {
    expect(formatCost(0.0001)).toBe("0.0001");
  });
});

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------
describe("formatTokens", () => {
  it("returns raw number string for counts below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("returns K-suffix for counts >= 1000", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(999999)).toBe("1000.0K");
  });

  it("returns M-suffix for counts >= 1,000,000", () => {
    expect(formatTokens(1_000_000)).toBe("1.00M");
    expect(formatTokens(2_500_000)).toBe("2.50M");
  });
});

// ---------------------------------------------------------------------------
// truncateLLMContent
// ---------------------------------------------------------------------------
describe("truncateLLMContent", () => {
  it("returns 'N/A' for null", () => {
    expect(truncateLLMContent(null as any)).toBe("N/A");
  });

  it("returns 'N/A' for empty string", () => {
    expect(truncateLLMContent("")).toBe("N/A");
  });

  it("returns short plain strings as-is", () => {
    expect(truncateLLMContent("hello world")).toBe("hello world");
  });

  it("truncates long plain strings with '...'", () => {
    const long = "a".repeat(150);
    const result = truncateLLMContent(long, 100);
    expect(result).toHaveLength(103); // 100 + '...'
    expect(result.endsWith("...")).toBe(true);
  });

  it("extracts text from inputs.input format", () => {
    const content = JSON.stringify({ inputs: { input: "What is AI?" } });
    expect(truncateLLMContent(content)).toBe("What is AI?");
  });

  it("extracts text from inputs.question format", () => {
    const content = JSON.stringify({ inputs: { question: "Who are you?" } });
    expect(truncateLLMContent(content)).toBe("Who are you?");
  });

  it("extracts text from inputs.query format", () => {
    const content = JSON.stringify({ inputs: { query: "search query" } });
    expect(truncateLLMContent(content)).toBe("search query");
  });

  it("extracts user message from message array", () => {
    const messages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Tell me a joke." },
    ];
    expect(truncateLLMContent(JSON.stringify(messages))).toBe(
      "Tell me a joke.",
    );
  });

  it("falls back to first message with content when no user message", () => {
    const messages = [{ role: "system", content: "System prompt." }];
    expect(truncateLLMContent(JSON.stringify(messages))).toBe("System prompt.");
  });

  it("extracts text from a single message object {role, content}", () => {
    const msg = { role: "user", content: "Hello!" };
    expect(truncateLLMContent(JSON.stringify(msg))).toBe("Hello!");
  });

  it("extracts text from nested messages array {messages: [...]}", () => {
    const content = {
      tools: [],
      messages: [{ role: "user", content: "Nested user prompt" }],
    };
    expect(truncateLLMContent(JSON.stringify(content))).toBe(
      "Nested user prompt",
    );
  });

  it("extracts text part from multimodal content array", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image_url", url: "..." },
          { type: "text", text: "Describe this image." },
        ],
      },
    ];
    expect(truncateLLMContent(JSON.stringify(messages))).toBe(
      "Describe this image.",
    );
  });

  it("extracts from object with 'prompt' field", () => {
    const content = JSON.stringify({ prompt: "Custom prompt text" });
    expect(truncateLLMContent(content)).toBe("Custom prompt text");
  });

  it("extracts from object with 'query' field", () => {
    const content = JSON.stringify({ query: "my query" });
    expect(truncateLLMContent(content)).toBe("my query");
  });

  it("removes extra whitespace from extracted text", () => {
    const content = "  hello   world  ";
    expect(truncateLLMContent(content)).toBe("hello world");
  });

  it("applies custom maxLength", () => {
    const result = truncateLLMContent("hello world", 5);
    expect(result).toBe("hello...");
  });
});

// ---------------------------------------------------------------------------
// parseEvaluationScores
// ---------------------------------------------------------------------------
describe("parseEvaluationScores", () => {
  it("returns null when no evaluation fields are present", () => {
    expect(parseEvaluationScores({ service_name: "svc" })).toBeNull();
  });

  it("returns scores when quality score is present", () => {
    const result = parseEvaluationScores({
      llm_evaluation_quality_score: 0.85,
    });
    expect(result).not.toBeNull();
    expect(result!.qualityScore).toBe(0.85);
  });

  it("converts numeric strings to numbers", () => {
    const result = parseEvaluationScores({
      llm_evaluation_quality_score: "0.9",
    });
    expect(result!.qualityScore).toBe(0.9);
  });

  it("sets null for absent score fields", () => {
    const result = parseEvaluationScores({ llm_evaluation_quality_score: 0.8 });
    expect(result!.relevance).toBeNull();
    expect(result!.completeness).toBeNull();
  });

  it("parses multiple scores", () => {
    const result = parseEvaluationScores({
      llm_evaluation_quality_score: 0.9,
      llm_evaluation_relevance: 0.8,
      llm_evaluation_safety: 0.95,
    });
    expect(result!.qualityScore).toBe(0.9);
    expect(result!.relevance).toBe(0.8);
    expect(result!.safety).toBe(0.95);
  });

  it("returns null evaluator when no evaluator fields are present", () => {
    const result = parseEvaluationScores({ llm_evaluation_quality_score: 0.7 });
    expect(result!.evaluator).toBeNull();
  });

  it("returns evaluator info when evaluator fields are present", () => {
    const result = parseEvaluationScores({
      llm_evaluation_quality_score: 0.7,
      llm_evaluator_name: "gpt-4",
      llm_evaluator_version: "v1",
      llm_evaluator_type: "model",
    });
    expect(result!.evaluator).toEqual({
      name: "gpt-4",
      version: "v1",
      evaluatorType: "model",
    });
  });

  it("defaults evaluatorType to 'deterministic' when not provided", () => {
    const result = parseEvaluationScores({
      llm_evaluation_quality_score: 0.7,
      llm_evaluator_name: "human",
    });
    expect(result!.evaluator!.evaluatorType).toBe("deterministic");
  });

  it("includes commentary when present", () => {
    const result = parseEvaluationScores({
      llm_evaluation_quality_score: 0.5,
      llm_evaluation_commentary: "Needs improvement",
    });
    expect(result!.commentary).toBe("Needs improvement");
  });
});

// ---------------------------------------------------------------------------
// formatScore
// ---------------------------------------------------------------------------
describe("formatScore", () => {
  it("returns 'N/A' for null", () => {
    expect(formatScore(null)).toBe("N/A");
  });

  it("formats 0 as '0%'", () => {
    expect(formatScore(0)).toBe("0%");
  });

  it("formats 1 as '100%'", () => {
    expect(formatScore(1)).toBe("100%");
  });

  it("formats 0.75 as '75%'", () => {
    expect(formatScore(0.75)).toBe("75%");
  });

  it("rounds to nearest integer", () => {
    expect(formatScore(0.856)).toBe("86%");
  });
});

// ---------------------------------------------------------------------------
// getQualityScoreColor
// ---------------------------------------------------------------------------
describe("getQualityScoreColor", () => {
  it("returns 'grey' for null", () => {
    expect(getQualityScoreColor(null)).toBe("grey");
  });

  it("returns 'green' for score >= 0.7", () => {
    expect(getQualityScoreColor(0.7)).toBe("green");
    expect(getQualityScoreColor(1.0)).toBe("green");
  });

  it("returns 'orange' for score >= 0.4 and < 0.7", () => {
    expect(getQualityScoreColor(0.4)).toBe("orange");
    expect(getQualityScoreColor(0.69)).toBe("orange");
  });

  it("returns 'red' for score < 0.4", () => {
    expect(getQualityScoreColor(0)).toBe("red");
    expect(getQualityScoreColor(0.39)).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// getObservationTypeColor
// ---------------------------------------------------------------------------
describe("getObservationTypeColor", () => {
  it("returns 'green' for GENERATION", () => {
    expect(getObservationTypeColor("GENERATION")).toBe("green");
  });

  it("returns 'blue' for EMBEDDING", () => {
    expect(getObservationTypeColor("EMBEDDING")).toBe("blue");
  });

  it("returns 'purple' for AGENT", () => {
    expect(getObservationTypeColor("AGENT")).toBe("purple");
  });

  it("returns 'orange' for TOOL", () => {
    expect(getObservationTypeColor("TOOL")).toBe("orange");
  });

  it("returns 'red' for GUARDRAIL", () => {
    expect(getObservationTypeColor("GUARDRAIL")).toBe("red");
  });

  it("returns 'grey' for unknown types", () => {
    expect(getObservationTypeColor("UNKNOWN")).toBe("grey");
    expect(getObservationTypeColor("")).toBe("grey");
  });
});

// ---------------------------------------------------------------------------
// extractLLMData
// ---------------------------------------------------------------------------
describe("extractLLMData", () => {
  it("returns null for non-LLM spans", () => {
    expect(extractLLMData({ service_name: "svc" })).toBeNull();
  });

  it("returns LLMData for a valid LLM span", () => {
    const span = {
      gen_ai_system: "openai",
      gen_ai_response_model: "gpt-4",
      gen_ai_usage_input_tokens: 100,
      gen_ai_usage_output_tokens: 50,
    };
    const result = extractLLMData(span);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("openai");
    expect(result!.modelName).toBe("gpt-4");
  });

  it("maps usage tokens correctly", () => {
    const span = {
      gen_ai_system: "anthropic",
      gen_ai_usage_input_tokens: 200,
      gen_ai_usage_output_tokens: 100,
      gen_ai_usage_total_tokens: 300,
    };
    const result = extractLLMData(span)!;
    expect(result.usage.input).toBe(200);
    expect(result.usage.output).toBe(100);
    expect(result.usage.total).toBe(300);
  });

  it("falls back to 'unknown' for missing provider", () => {
    const span = { gen_ai_input_messages: "hello" };
    const result = extractLLMData(span)!;
    expect(result.provider).toBe("unknown");
  });

  it("falls back to 'unknown' for missing model name", () => {
    const span = { gen_ai_input_messages: "hello" };
    const result = extractLLMData(span)!;
    expect(result.modelName).toBe("unknown");
  });

  it("defaults observationType to 'SPAN'", () => {
    const span = { gen_ai_input_messages: "hello" };
    const result = extractLLMData(span)!;
    expect(result.observationType).toBe("SPAN");
  });

  it("captures userId and sessionId", () => {
    const span = {
      gen_ai_system: "openai",
      user_id: "user-123",
      session_id: "session-456",
    };
    const result = extractLLMData(span)!;
    expect(result.userId).toBe("user-123");
    expect(result.sessionId).toBe("session-456");
  });

  it("captures promptName", () => {
    const span = {
      gen_ai_system: "openai",
      gen_ai_prompt_name: "my-prompt",
    };
    const result = extractLLMData(span)!;
    expect(result.promptName).toBe("my-prompt");
  });

  it("includes evaluation data when present", () => {
    const span = {
      gen_ai_system: "openai",
      llm_evaluation_quality_score: 0.9,
    };
    const result = extractLLMData(span)!;
    expect(result.evaluation).not.toBeNull();
    expect(result.evaluation!.qualityScore).toBe(0.9);
  });

  it("sets evaluation to null when no evaluation fields present", () => {
    const span = { gen_ai_system: "openai" };
    const result = extractLLMData(span)!;
    expect(result.evaluation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatModelParameters
// ---------------------------------------------------------------------------
describe("formatModelParameters", () => {
  it("returns 'No parameters' for null", () => {
    expect(formatModelParameters(null as any)).toBe("No parameters");
  });

  it("returns 'No parameters' for empty object", () => {
    expect(formatModelParameters({})).toBe("No parameters");
  });

  it("formats a single parameter", () => {
    expect(formatModelParameters({ temperature: 0.7 })).toBe(
      "temperature: 0.7",
    );
  });

  it("formats multiple parameters with newlines", () => {
    const result = formatModelParameters({ temperature: 0.7, max_tokens: 256 });
    expect(result).toContain("temperature: 0.7");
    expect(result).toContain("max_tokens: 256");
    expect(result.split("\n")).toHaveLength(2);
  });

  it("JSON-serialises complex values", () => {
    const result = formatModelParameters({ stop: ["STOP", "END"] });
    expect(result).toContain('["STOP","END"]');
  });
});

// ---------------------------------------------------------------------------
// truncateSessionId
// ---------------------------------------------------------------------------
describe("truncateSessionId", () => {
  it("returns 'N/A' for empty string", () => {
    expect(truncateSessionId("")).toBe("N/A");
  });

  it("returns 'N/A' for null", () => {
    expect(truncateSessionId(null as any)).toBe("N/A");
  });

  it("returns the full id when shorter than maxLength", () => {
    expect(truncateSessionId("abc123", 16)).toBe("abc123");
  });

  it("returns the full id when equal to maxLength", () => {
    expect(truncateSessionId("a".repeat(16), 16)).toBe("a".repeat(16));
  });

  it("truncates long ids with ellipsis", () => {
    const id = "abcdefghijklmnopqrstuvwxyz"; // 26 chars
    const result = truncateSessionId(id, 16);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(id.length);
  });

  it("shows first and last characters around the ellipsis", () => {
    const id = "AAAAAAAAAAAAAAAA" + "BBBBBBBBBBBBBBBB"; // 32 chars
    const result = truncateSessionId(id, 16);
    expect(result.startsWith("A")).toBe(true);
    expect(result.endsWith("B")).toBe(true);
  });
});
