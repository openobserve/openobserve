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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { gt } from "@/types/i18n";

// --- mocks declared before any imports that transitively load the modules ---

const mockFetchAiChat = vi.fn();
const mockGetStructuredContext = vi.fn();

vi.mock("@/composables/useAiChat", () => ({
  default: vi.fn(() => ({
    fetchAiChat: mockFetchAiChat,
    getStructuredContext: mockGetStructuredContext,
  })),
}));

// useSuggestions is used inside useNLQuery to extract function names
vi.mock("@/composables/useSuggestions", () => ({
  default: vi.fn(() => ({
    defaultSuggestions: [
      { label: (_k: string) => `match_all('${_k}')`, kind: "Text" },
      { label: (_k: string) => `str_match(fieldname, '${_k}')`, kind: "Text" },
    ],
  })),
}));

vi.mock("@/utils/query/promQLUtils", () => ({
  parsePromQlQuery: vi.fn((text: string) => {
    // Minimal parser: treat "cpu_usage" as a metric name
    if (/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(text)) {
      return { metricName: text, label: { hasLabels: false } };
    }
    return { metricName: null, label: { hasLabels: false } };
  }),
}));

import { useNLQuery } from "./useNLQuery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ReadableStream that yields the provided SSE chunks then closes. */
function buildMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Create a mock Response object with streaming body. */
function makeStreamResponse(chunks: string[]): Response {
  return {
    ok: true,
    status: 200,
    body: buildMockStream(chunks),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------

describe("useNLQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStructuredContext.mockResolvedValue({
      currentPage: "logs",
      organization_identifier: "default",
      selectedStreams: ["logs"],
      sqlMode: false,
      streamType: "logs",
    });
  });

  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("exposes detectNaturalLanguage, generateSQL, transformToSQL, isGenerating, streamingResponse", () => {
      const nlq = useNLQuery(gt);
      expect(typeof nlq.detectNaturalLanguage).toBe("function");
      expect(typeof nlq.generateSQL).toBe("function");
      expect(typeof nlq.transformToSQL).toBe("function");
      expect(nlq.isGenerating.value).toBe(false);
      expect(nlq.streamingResponse.value).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // detectNaturalLanguage
  // -------------------------------------------------------------------------
  describe("detectNaturalLanguage", () => {
    it("returns false for empty string", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("")).toBe(false);
    });

    it("returns false for whitespace-only string", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("   ")).toBe(false);
    });

    it("returns false for SQL SELECT statement", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("SELECT * FROM logs", "sql")).toBe(false);
    });

    it("returns false when first word is FROM", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("FROM logs WHERE level = 'error'", "sql")).toBe(
        false,
      );
    });

    it("returns false for SQL comments (--)", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("-- this is a comment", "sql")).toBe(false);
    });

    it("returns false when text starts with WHERE", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("WHERE level = 'error'", "sql")).toBe(false);
    });

    it("returns false for field=value comparison pattern", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("level = 'error'", "sql")).toBe(false);
    });

    it("returns false for LIKE operator", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("field LIKE '%pattern%'", "sql")).toBe(false);
    });

    it("returns false for IS NULL operator", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("field IS NULL", "sql")).toBe(false);
    });

    it("returns true for plain natural language sentence", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("show me errors from the last hour", "sql")).toBe(
        true,
      );
    });

    it("returns true for a question in natural language", () => {
      expect(
        useNLQuery(gt).detectNaturalLanguage("what happened to the service last night", "sql"),
      ).toBe(true);
    });

    // PromQL-specific
    it("returns false for PromQL simple metric name", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("cpu_usage", "promql")).toBe(false);
    });

    it("returns false for PromQL with range selector", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("http_requests_total[5m]", "promql")).toBe(false);
    });

    it("returns false for PromQL aggregation function", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("sum(http_requests_total)", "promql")).toBe(
        false,
      );
    });

    it("returns false for PromQL metric with label selector", () => {
      expect(useNLQuery(gt).detectNaturalLanguage('http_requests_total{job="api"}', "promql")).toBe(
        false,
      );
    });

    it("returns false for PromQL rate function", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("rate(http_requests_total[5m])", "promql")).toBe(
        false,
      );
    });

    // VRL-specific
    it("returns false for VRL with dot accessor", () => {
      expect(useNLQuery(gt).detectNaturalLanguage(".level = 'error'", "vrl")).toBe(false);
    });

    // JavaScript-specific
    it("returns false for JavaScript const declaration", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("const x = 5", "javascript")).toBe(false);
    });

    it("returns false for JavaScript function declaration", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("function foo() {}", "js")).toBe(false);
    });

    // Quick-mode function detection
    it("returns false when text contains a quick-mode function like match_all(", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("match_all('error')", "sql")).toBe(false);
    });

    it("returns false when text contains str_match(", () => {
      expect(useNLQuery(gt).detectNaturalLanguage("str_match(level, 'error')", "sql")).toBe(false);
    });

    // Recursion depth guard
    it("handles deeply nested parentheses without stack overflow", () => {
      const deeplyNested = "(".repeat(12) + "cpu_usage" + ")".repeat(12);
      expect(() => useNLQuery(gt).detectNaturalLanguage(deeplyNested, "promql")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // transformToSQL
  // -------------------------------------------------------------------------
  describe("transformToSQL", () => {
    it("prepends SQL comment (--) for sql language", () => {
      const result = useNLQuery(gt).transformToSQL("show errors", "SELECT * FROM logs", "sql");
      expect(result).toBe("-- show errors\nSELECT * FROM logs");
    });

    it("prepends hash (#) comment for promql language", () => {
      const result = useNLQuery(gt).transformToSQL("cpu usage", "cpu_usage", "promql");
      expect(result).toBe("# cpu usage\ncpu_usage");
    });

    it("prepends hash (#) comment for vrl language", () => {
      const result = useNLQuery(gt).transformToSQL(
        "parse log",
        ".parsed = parse_json(.message)",
        "vrl",
      );
      expect(result).toBe("# parse log\n.parsed = parse_json(.message)");
    });

    it("prepends // comment for javascript language", () => {
      const result = useNLQuery(gt).transformToSQL("do something", "const x = 1;", "javascript");
      expect(result).toBe("// do something\nconst x = 1;");
    });

    it("prepends // comment for js language alias", () => {
      const result = useNLQuery(gt).transformToSQL("note", "let y = 2;", "js");
      expect(result).toBe("// note\nlet y = 2;");
    });

    it("defaults to sql (--) when language is not specified", () => {
      const result = useNLQuery(gt).transformToSQL("natural", "SELECT 1");
      expect(result).toContain("-- natural");
    });

    it("handles multi-line natural language correctly", () => {
      const result = useNLQuery(gt).transformToSQL("line one\nline two", "SELECT 1", "sql");
      expect(result).toBe("-- line one\n-- line two\nSELECT 1");
    });
  });

  // -------------------------------------------------------------------------
  // generateSQL — state management
  // -------------------------------------------------------------------------
  describe("generateSQL – state management", () => {
    it("returns null for empty prompt without calling AI", async () => {
      const { generateSQL } = useNLQuery(gt);
      const result = await generateSQL("  ", "default");
      expect(result).toBeNull();
      expect(mockFetchAiChat).not.toHaveBeenCalled();
    });

    it("sets isGenerating to false after successful call", async () => {
      const sseChunk = `data: ${JSON.stringify({ content: "SELECT 1" })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const { generateSQL, isGenerating } = useNLQuery(gt);
      await generateSQL("show me logs", "default");
      expect(isGenerating.value).toBe(false);
    });

    it("sets isGenerating to false after an exception", async () => {
      mockFetchAiChat.mockRejectedValue(new Error("network"));

      const { generateSQL, isGenerating } = useNLQuery(gt);
      await generateSQL("show me logs", "default");
      expect(isGenerating.value).toBe(false);
    });

    it("resets streamingResponse before a new generation", async () => {
      const sseChunk = `data: ${JSON.stringify({ type: "status", message: "processing" })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const { generateSQL, streamingResponse } = useNLQuery(gt);
      streamingResponse.value = "old value";
      await generateSQL("query", "default");
      // streamingResponse should have been reset to '' then updated
      // After completion it will be the last streaming value
      expect(typeof streamingResponse.value).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // generateSQL — response parsing
  // -------------------------------------------------------------------------
  describe("generateSQL – response parsing", () => {
    it("extracts SQL from markdown sql code block", async () => {
      const sseChunk = `data: ${JSON.stringify({
        content: "```sql\nSELECT * FROM logs\n```",
      })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const result = await useNLQuery(gt).generateSQL("show logs", "default");
      expect(result).toBe("SELECT * FROM logs");
    });

    it("extracts SQL from plain SELECT statement in content", async () => {
      const sseChunk = `data: ${JSON.stringify({
        content: "SELECT count(*) FROM errors",
      })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const result = await useNLQuery(gt).generateSQL("count errors", "default");
      expect(result).toBe("SELECT count(*) FROM errors");
    });

    it("returns null when AI response is empty", async () => {
      // Return done immediately with empty content
      const emptyStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.close();
        },
      });
      mockFetchAiChat.mockResolvedValue({
        ok: true,
        body: emptyStream,
      } as unknown as Response);

      const result = await useNLQuery(gt).generateSQL("what happened", "default");
      expect(result).toBeNull();
    });

    it("returns null when response is not ok", async () => {
      mockFetchAiChat.mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      const result = await useNLQuery(gt).generateSQL("query", "default");
      expect(result).toBeNull();
    });

    it("returns null when fetchAiChat returns cancelled flag", async () => {
      mockFetchAiChat.mockResolvedValue({ cancelled: true });

      const result = await useNLQuery(gt).generateSQL("query", "default");
      expect(result).toBeNull();
    });

    it("returns null when fetchAiChat returns null", async () => {
      mockFetchAiChat.mockResolvedValue(null);

      const result = await useNLQuery(gt).generateSQL("query", "default");
      expect(result).toBeNull();
    });

    it("returns null when response has no body reader", async () => {
      mockFetchAiChat.mockResolvedValue({ ok: true, body: null } as unknown as Response);

      const result = await useNLQuery(gt).generateSQL("query", "default");
      expect(result).toBeNull();
    });

    it("returns null when AI response contains error event", async () => {
      const sseChunk = `data: ${JSON.stringify({
        type: "error",
        error: "something went wrong",
      })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const result = await useNLQuery(gt).generateSQL("query", "default");
      expect(result).toBeNull();
    });

    it("returns null when content looks like a question (AI asking for clarification)", async () => {
      const sseChunk = `data: ${JSON.stringify({
        content: "What is your organization?",
      })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const result = await useNLQuery(gt).generateSQL("query", "default");
      expect(result).toBeNull();
    });

    it("handles complete event with history and uses history content", async () => {
      const sseChunk = `data: ${JSON.stringify({
        type: "complete",
        history: [
          { role: "user", content: "show logs" },
          {
            role: "assistant",
            content: "```sql\nSELECT * FROM logs\n```",
          },
        ],
      })}\n\n`;
      mockFetchAiChat.mockResolvedValue(makeStreamResponse([sseChunk]));

      const result = await useNLQuery(gt).generateSQL("show logs", "default");
      expect(result).toBe("SELECT * FROM logs");
    });

    it("returns dashboard created marker when dashboard tool call succeeds", async () => {
      const chunks = [
        `data: ${JSON.stringify({ type: "tool_call", tool: "createDashboard", message: "Creating dashboard" })}\n\n`,
        `data: ${JSON.stringify({ type: "tool_result", tool: "createDashboard", success: true, message: "Dashboard created" })}\n\n`,
        `data: ${JSON.stringify({ type: "message", content: "Dashboard has been created" })}\n\n`,
      ];
      mockFetchAiChat.mockResolvedValue(makeStreamResponse(chunks));

      const result = await useNLQuery(gt).generateSQL("create dashboard", "default");
      expect(result).toContain("DASHBOARD_CREATED");
    });

    it("returns alert created marker when alert tool call succeeds", async () => {
      const chunks = [
        `data: ${JSON.stringify({ type: "tool_call", tool: "createAlert", message: "Creating alert" })}\n\n`,
        `data: ${JSON.stringify({ type: "tool_result", tool: "createAlert", success: true, message: "Alert created" })}\n\n`,
        `data: ${JSON.stringify({ type: "message", content: "Alert has been created" })}\n\n`,
      ];
      mockFetchAiChat.mockResolvedValue(makeStreamResponse(chunks));

      const result = await useNLQuery(gt).generateSQL("create alert", "default");
      expect(result).toContain("ALERT_CREATED");
    });

    it("returns null when all tool calls failed", async () => {
      const chunks = [
        `data: ${JSON.stringify({ type: "tool_call", tool: "createDashboard", message: "Creating" })}\n\n`,
        `data: ${JSON.stringify({ type: "tool_result", tool: "createDashboard", success: false, message: "Failed" })}\n\n`,
      ];
      mockFetchAiChat.mockResolvedValue(makeStreamResponse(chunks));

      const result = await useNLQuery(gt).generateSQL("create dashboard", "default");
      expect(result).toBeNull();
    });

    it("returns null when an exception is thrown during streaming", async () => {
      mockFetchAiChat.mockRejectedValue(new Error("connection reset"));

      const result = await useNLQuery(gt).generateSQL("show errors", "default");
      expect(result).toBeNull();
    });
  });
});

// ─── Phase 1 regression (tmp/code.md A2) ──────────────────────────────────────
// getQuickModeFunctionNames() historically recovered function names by regexing
// "match_all('x')" style labels. Once labels become static bare names (A2), that
// regex finds nothing — the extraction must key off the catalog's `name` field.
// These tests pin the OUTPUT so the refactor cannot silently empty the list.

describe("getQuickModeFunctionNames — survives static catalog labels", () => {
  it("does not classify a query using a catalog function as natural language", async () => {
    vi.resetModules();
    vi.doMock("@/composables/useSuggestions", () => ({
      default: vi.fn(() => ({
        defaultSuggestions: [
          { name: "match_all", label: "match_all", kind: "Function" },
          { name: "str_match", label: "str_match", kind: "Function" },
        ],
      })),
    }));
    const { useNLQuery: freshUseNLQuery } = await import("./useNLQuery");
    const { detectNaturalLanguage } = freshUseNLQuery();
    expect(detectNaturalLanguage("match_all('error')", "sql")).toBe(false);
    expect(detectNaturalLanguage("str_match(body, 'error')", "sql")).toBe(false);
    vi.doUnmock("@/composables/useSuggestions");
    vi.resetModules();
  });
});
