// @vitest-environment jsdom
// Tests for the formatting / parsing helpers used across the eval UI.
// These are pure functions with the exception of `showError`, which is mocked
// at the toast boundary.

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (args: any) => mockToast(args),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defaultOutputSchema,
  defaultTestValue,
  extractTemplateVariables,
  formatDate,
  formatTemplateVariable,
  parseJson,
  parseOptionalJson,
  showError,
  splitCsv,
  statusClass,
  stringifyJson,
} from "./evalFormat";

beforeEach(() => {
  mockToast.mockClear();
});

describe("parseJson", () => {
  it("returns the parsed object on valid JSON", () => {
    expect(parseJson('{"a":1}', "label")).toEqual({ a: 1 });
  });

  it("throws with a label-prefixed message on invalid JSON", () => {
    expect(() => parseJson("{not-json", "Output schema")).toThrow(
      "Output schema must be valid JSON",
    );
  });
});

describe("parseOptionalJson", () => {
  it("returns null for empty string", () => {
    expect(parseOptionalJson("", "label")).toBeNull();
  });

  it("returns null for whitespace-only string — the form treats whitespace as no input", () => {
    expect(parseOptionalJson("   \n", "label")).toBeNull();
  });

  it("parses non-empty input", () => {
    expect(parseOptionalJson('{"b":2}', "label")).toEqual({ b: 2 });
  });

  it("throws on invalid non-empty input", () => {
    expect(() => parseOptionalJson("garbage", "Output schema")).toThrow(
      "Output schema must be valid JSON",
    );
  });
});

describe("stringifyJson", () => {
  // These three values all serialize to "" so the form input reads as empty
  // instead of literally writing "undefined" / "null" / "\"\"" into the
  // textarea on first render.
  it("returns empty string for undefined / null / empty string", () => {
    expect(stringifyJson(undefined)).toBe("");
    expect(stringifyJson(null)).toBe("");
    expect(stringifyJson("")).toBe("");
  });

  it("pretty-prints objects with 2-space indent", () => {
    expect(stringifyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("splitCsv", () => {
  it("splits on commas and trims each part", () => {
    expect(splitCsv("a, b , c")).toEqual(["a", "b", "c"]);
  });

  it("drops empty entries (handles trailing comma / double commas)", () => {
    expect(splitCsv("a,,b,")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(splitCsv("")).toEqual([]);
  });
});

describe("extractTemplateVariables", () => {
  it("extracts simple `{{ name }}` variables", () => {
    expect(extractTemplateVariables("Hello {{ input }} and {{ output }}!")).toEqual([
      "input",
      "output",
    ]);
  });

  it("tolerates inconsistent whitespace inside the braces", () => {
    expect(extractTemplateVariables("{{input}} {{ output  }}")).toEqual([
      "input",
      "output",
    ]);
  });

  it("deduplicates repeated variables", () => {
    expect(extractTemplateVariables("{{ x }} {{ x }} {{ y }}")).toEqual(["x", "y"]);
  });

  it("supports dot-notation variable names (e.g. `trace.id`)", () => {
    expect(extractTemplateVariables("{{ trace.id }}")).toEqual(["trace.id"]);
  });

  it("returns an empty list when no variables present", () => {
    expect(extractTemplateVariables("plain text")).toEqual([]);
  });

  it("ignores single-brace placeholders (must be double)", () => {
    expect(extractTemplateVariables("{ x } and { y }")).toEqual([]);
  });
});

describe("formatTemplateVariable", () => {
  it("wraps a variable name in `{{ name }}` form", () => {
    expect(formatTemplateVariable("input")).toBe("{{ input }}");
  });
});

describe("defaultTestValue", () => {
  // The form pre-fills these scoring-test placeholders so the user can hit
  // "Run test" immediately. They're well-known prompt-engineering variable
  // names — drift here would mean an empty test panel.
  it("returns canned text for known variable names", () => {
    expect(defaultTestValue("input")).toContain("Paris");
    expect(defaultTestValue("output")).toContain("Paris");
    expect(defaultTestValue("context")).toContain("France");
    expect(defaultTestValue("metadata")).toBe("{}");
    expect(defaultTestValue("trace.id")).toBe("test_trace_123");
    expect(defaultTestValue("span.id")).toBe("test_span_456");
  });

  it("returns empty string for unknown variables", () => {
    expect(defaultTestValue("whatever")).toBe("");
  });
});

describe("defaultOutputSchema", () => {
  it("returns the canonical `{score, reasoning}` schema", () => {
    const schema = defaultOutputSchema();
    expect(schema.type).toBe("object");
    expect(schema.properties).toEqual({
      score: { type: "number" },
      reasoning: { type: "string" },
    });
  });

  it("returns a fresh object each call — the form mutates it in-place", () => {
    expect(defaultOutputSchema()).not.toBe(defaultOutputSchema());
  });
});

describe("formatDate", () => {
  // Zero / falsy values mean "never updated"; the helper has to surface that
  // explicitly so the UI doesn't render "Jan 1 1970".
  it("returns 'Never' for 0 / falsy values", () => {
    expect(formatDate(0)).toBe("Never");
    expect(formatDate(null as any)).toBe("Never");
    expect(formatDate(undefined as any)).toBe("Never");
  });

  it("returns a non-empty locale-formatted string for valid timestamps", () => {
    const out = formatDate(1735689600000); // 2025-01-01 UTC
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe("Never");
  });
});

describe("statusClass", () => {
  it("maps healthy statuses to is-good", () => {
    for (const s of ["active", "default", "configured"]) {
      expect(statusClass(s)).toEqual({ "is-good": true, "is-warn": false, "is-muted": false });
    }
  });

  it("maps draft / paused / degraded statuses to is-warn", () => {
    for (const s of ["draft", "paused", "degraded"]) {
      expect(statusClass(s)).toEqual({ "is-good": false, "is-warn": true, "is-muted": false });
    }
  });

  it("maps archived / inactive statuses to is-muted", () => {
    for (const s of ["archived", "inactive"]) {
      expect(statusClass(s)).toEqual({ "is-good": false, "is-warn": false, "is-muted": true });
    }
  });

  it("returns all false for an unknown status", () => {
    expect(statusClass("???")).toEqual({ "is-good": false, "is-warn": false, "is-muted": false });
  });
});

describe("showError", () => {
  // Error message precedence: axios body.message > err.message > fallback.
  // This ordering is intentional — server-supplied messages are most specific.
  it("prefers the server-supplied response.data.message", () => {
    showError(
      {
        response: { data: { message: "server says no" } },
        message: "low-level",
      },
      "fallback",
    );
    expect(mockToast).toHaveBeenCalledWith({ variant: "error", message: "server says no" });
  });

  it("falls back to err.message when no server message is present", () => {
    showError(new Error("low-level"), "fallback");
    expect(mockToast).toHaveBeenCalledWith({ variant: "error", message: "low-level" });
  });

  it("uses the fallback string when the error is empty", () => {
    showError(null, "Failed to do thing");
    expect(mockToast).toHaveBeenCalledWith({ variant: "error", message: "Failed to do thing" });
  });
});
