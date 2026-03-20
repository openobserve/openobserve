import { describe, it, expect } from "vitest";
import { extractValuesFromHits, EXCLUDED_FIELDS } from "./fieldValueUtils";

// ─── EXCLUDED_FIELDS ─────────────────────────────────────────────────────────

describe("EXCLUDED_FIELDS", () => {
  it("contains timestamp fields", () => {
    expect(EXCLUDED_FIELDS.has("_timestamp")).toBe(true);
    expect(EXCLUDED_FIELDS.has("timestamp")).toBe(true);
    expect(EXCLUDED_FIELDS.has("@timestamp")).toBe(true);
  });

  it("contains id fields", () => {
    expect(EXCLUDED_FIELDS.has("_id")).toBe(true);
    expect(EXCLUDED_FIELDS.has("__id")).toBe(true);
  });

  it("contains OO internal fields", () => {
    expect(EXCLUDED_FIELDS.has("_stream")).toBe(true);
    expect(EXCLUDED_FIELDS.has("_all")).toBe(true);
  });

  it("contains free-text fields", () => {
    expect(EXCLUDED_FIELDS.has("log")).toBe(true);
    expect(EXCLUDED_FIELDS.has("message")).toBe(true);
    expect(EXCLUDED_FIELDS.has("msg")).toBe(true);
    expect(EXCLUDED_FIELDS.has("body")).toBe(true);
  });

  it("does not contain regular fields", () => {
    expect(EXCLUDED_FIELDS.has("status")).toBe(false);
    expect(EXCLUDED_FIELDS.has("env")).toBe(false);
    expect(EXCLUDED_FIELDS.has("service")).toBe(false);
  });
});

// ─── extractValuesFromHits ────────────────────────────────────────────────────

describe("extractValuesFromHits", () => {
  const schemaFields = ["status", "env", "service"];

  // ── basic happy path ────────────────────────────────────────────────────────

  it("extracts unique values per field from hits", () => {
    const hits = [
      { status: "200", env: "prod" },
      { status: "404", env: "staging" },
      { status: "200", env: "prod" },
    ];
    const result = extractValuesFromHits(hits, schemaFields, 50);
    expect(result.status).toEqual(expect.arrayContaining(["200", "404"]));
    expect(result.status).toHaveLength(2);
    expect(result.env).toEqual(expect.arrayContaining(["prod", "staging"]));
  });

  it("deduplicates values across rows", () => {
    const hits = [
      { status: "200" },
      { status: "200" },
      { status: "200" },
    ];
    const result = extractValuesFromHits(hits, schemaFields, 50);
    expect(result.status).toEqual(["200"]);
  });

  it("returns empty object when hits is empty", () => {
    expect(extractValuesFromHits([], schemaFields, 50)).toEqual({});
  });

  // ── excluded fields ─────────────────────────────────────────────────────────

  it("skips _timestamp field", () => {
    const hits = [{ _timestamp: "1711000000", status: "200" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result._timestamp).toBeUndefined();
    expect(result.status).toEqual(["200"]);
  });

  it("skips all EXCLUDED_FIELDS", () => {
    const hit: Record<string, any> = {
      status: "200",
      _timestamp: "1711",
      timestamp: "1711",
      "@timestamp": "1711",
      _id: "abc",
      __id: "abc",
      _stream: "logs",
      _all: "all",
      log: "some log",
      message: "some msg",
      msg: "short",
      body: "body text",
    };
    const result = extractValuesFromHits([hit], [], 50);
    expect(Object.keys(result)).toEqual(["status"]);
  });

  // ── schema filtering ────────────────────────────────────────────────────────

  it("restricts to schema fields when schemaFields is non-empty", () => {
    const hits = [{ status: "200", extra_field: "noise", env: "prod" }];
    const result = extractValuesFromHits(hits, ["status"], 50);
    expect(result.status).toBeDefined();
    expect(result.extra_field).toBeUndefined();
    expect(result.env).toBeUndefined();
  });

  it("allows all fields when schemaFields is empty", () => {
    const hits = [{ status: "200", custom_field: "value" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeDefined();
    expect(result.custom_field).toBeDefined();
  });

  // ── value length filter ─────────────────────────────────────────────────────

  it("skips values longer than MAX_VALUE_LENGTH (150 chars)", () => {
    const longValue = "a".repeat(151);
    const hits = [{ status: longValue }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeUndefined();
  });

  it("keeps values exactly at MAX_VALUE_LENGTH (150 chars)", () => {
    const exactValue = "a".repeat(150);
    const hits = [{ status: exactValue }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toEqual([exactValue]);
  });

  it("keeps values shorter than MAX_VALUE_LENGTH", () => {
    const hits = [{ status: "200" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toEqual(["200"]);
  });

  it("skips empty string values", () => {
    const hits = [{ status: "" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeUndefined();
  });

  // ── junk value filter ───────────────────────────────────────────────────────

  it("skips 'null' string values", () => {
    const hits = [{ status: "null" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeUndefined();
  });

  it("skips 'undefined' string values", () => {
    const hits = [{ status: "undefined" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeUndefined();
  });

  it("skips 'NaN' string values", () => {
    const hits = [{ status: "NaN" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeUndefined();
  });

  it("converts non-string values to string (numbers, booleans)", () => {
    const hits = [{ status: 200, active: true }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toEqual(["200"]);
    expect(result.active).toEqual(["true"]);
  });

  it("handles null rawValue by converting to empty string (skipped)", () => {
    const hits = [{ status: null }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toBeUndefined();
  });

  // ── maxValuesPerField cap ───────────────────────────────────────────────────

  it("caps values to maxValuesPerField in final result", () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({ status: `v${i}` }));
    const result = extractValuesFromHits(hits, [], 3);
    expect(result.status).toHaveLength(3);
  });

  it("returns all values when total is below cap", () => {
    const hits = [{ status: "200" }, { status: "404" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.status).toHaveLength(2);
  });

  // ── multiple fields ─────────────────────────────────────────────────────────

  it("handles multiple fields across multiple hits", () => {
    const hits = [
      { status: "200", env: "prod", service: "api" },
      { status: "500", env: "staging", service: "worker" },
    ];
    const result = extractValuesFromHits(hits, schemaFields, 50);
    expect(Object.keys(result).sort()).toEqual(["env", "service", "status"]);
    expect(result.status).toHaveLength(2);
    expect(result.env).toHaveLength(2);
    expect(result.service).toHaveLength(2);
  });

  it("handles hits with missing fields gracefully", () => {
    const hits = [
      { status: "200" },
      { env: "prod" },
      { status: "404", env: "staging" },
    ];
    const result = extractValuesFromHits(hits, schemaFields, 50);
    expect(result.status).toEqual(expect.arrayContaining(["200", "404"]));
    expect(result.env).toEqual(expect.arrayContaining(["prod", "staging"]));
  });

  it("handles 100 hits without errors (max page size)", () => {
    const hits = Array.from({ length: 100 }, (_, i) => ({
      status: i % 5 === 0 ? "200" : "404",
      env: i % 2 === 0 ? "prod" : "staging",
    }));
    const result = extractValuesFromHits(hits, schemaFields, 50);
    expect(result.status).toHaveLength(2);
    expect(result.env).toHaveLength(2);
  });

  it("does not store trace_id-like values if they pass length filter", () => {
    const hits = [{ trace_id: "4bf92f3577b34da6" }];
    const result = extractValuesFromHits(hits, [], 50);
    // 16 chars, within limit, not excluded — should be stored
    expect(result.trace_id).toEqual(["4bf92f3577b34da6"]);
  });

  it("skips stack-trace-like values over 150 chars", () => {
    const hits = [{ error_detail: "Error: at " + "x".repeat(150) }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(result.error_detail).toBeUndefined();
  });

  it("handles empty schemaFields set with no hits matching schema", () => {
    const hits = [{ _timestamp: "1711", log: "text" }];
    const result = extractValuesFromHits(hits, [], 50);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
