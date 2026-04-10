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

// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  selectDimensionsFromData,
  selectTraceDimensions,
} from "./useDimensionSelector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build N identical log samples each containing the given fields. */
function buildSamples(
  count: number,
  fields: Record<string, string>
): Record<string, string>[] {
  return Array.from({ length: count }, () => ({ ...fields }));
}

/** Build log samples where a field has `uniqueCount` unique values across N rows. */
function buildSamplesWithCardinality(
  total: number,
  fieldName: string,
  uniqueCount: number
): Record<string, string>[] {
  return Array.from({ length: total }, (_, i) => ({
    [fieldName]: `val-${i % uniqueCount}`,
  }));
}

describe("useDimensionSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── selectDimensionsFromData ─────────────────────────────────────────────

  describe("selectDimensionsFromData", () => {
    // --- fallback to schema-only path ---

    it("falls back to schema-based selection when fewer than 10 samples are provided", () => {
      const samples = buildSamples(5, { level: "info" });
      const schema = [{ name: "level" }, { name: "service" }];
      const result = selectDimensionsFromData(samples, schema, 8);
      // With fewer than 10 samples the function delegates to selectDimensionsFromSchema
      expect(result).toContain("level");
    });

    it("falls back to schema-based selection when zero samples are provided", () => {
      const schema = [{ name: "level" }, { name: "environment" }];
      const result = selectDimensionsFromData([], schema, 8);
      expect(result).toContain("level");
    });

    // --- happy path with enough samples ---

    it("returns an array of dimension field names", () => {
      const samples = buildSamples(15, { level: "info", service: "api" });
      const result = selectDimensionsFromData(samples, [], 8);
      expect(Array.isArray(result)).toBe(true);
    });

    it("respects the maxDimensions limit", () => {
      const fields: Record<string, string> = {};
      for (let i = 0; i < 20; i++) fields[`field${i}`] = `val${i % 3}`;
      const samples = buildSamples(20, fields);
      const result = selectDimensionsFromData(samples, [], 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("excludes high-cardinality pattern fields ending in _id", () => {
      const samples = buildSamplesWithCardinality(20, "request_id", 20);
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("request_id");
    });

    it("excludes trace_id fields", () => {
      const samples = buildSamplesWithCardinality(20, "trace_id", 20);
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("trace_id");
    });

    it("excludes timestamp-pattern fields", () => {
      const samples = buildSamples(20, { timestamp: "2024-01-01T00:00:00Z", level: "info" });
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("timestamp");
    });

    it("excludes system fields starting with underscore", () => {
      const samples = buildSamples(20, { _meta: "internal", level: "warn" });
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("_meta");
    });

    it("excludes o2_timestamp system field", () => {
      const samples = buildSamples(20, { o2_timestamp: "12345", level: "error" });
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("o2_timestamp");
    });

    it("excludes FTS (full-text search) fields from schema", () => {
      const samples = buildSamples(20, { body: "some log message here", level: "info" });
      const schema = [{ name: "body", isFTS: true }, { name: "level" }];
      const result = selectDimensionsFromData(samples, schema, 8);
      expect(result).not.toContain("body");
    });

    it("includes fields with low cardinality (2-10 unique values)", () => {
      const samples = buildSamplesWithCardinality(20, "level", 5);
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).toContain("level");
    });

    it("prefers fields whose names match known-good patterns", () => {
      // "level" matches a goodPattern and has low cardinality
      const rows: Record<string, string>[] = Array.from({ length: 20 }, (_, i) => ({
        level: ["info", "warn", "error", "debug"][i % 4],
        randomfield: `r${i}`,
      }));
      const result = selectDimensionsFromData(rows, [], 8);
      expect(result).toContain("level");
    });

    it("gives bonus score to indexed schema fields", () => {
      const samples = buildSamplesWithCardinality(20, "datacenter", 4);
      const schema = [{ name: "datacenter", isIndexed: true }];
      const result = selectDimensionsFromData(samples, schema, 8);
      expect(result).toContain("datacenter");
    });

    it("gives bonus score to interesting schema fields", () => {
      const samples = buildSamplesWithCardinality(20, "region", 3);
      const schema = [{ name: "region", isInteresting: true }];
      const result = selectDimensionsFromData(samples, schema, 8);
      expect(result).toContain("region");
    });

    it("penalises fields where cardinality exceeds 60 and uniqueness ratio > 0.7", () => {
      // 80 unique values in 100 samples → uniqueness ratio = 0.8 > 0.7 → score -= 100
      const samples = buildSamplesWithCardinality(100, "event_uid", 80);
      const result = selectDimensionsFromData(samples, [], 8);
      // score: coverage 1.0 → +50, cardinality 80 > 60 and 80/100=0.8>0.7 → -100 = net -50
      expect(result).not.toContain("event_uid");
    });

    it("falls back to schema selection when no field scores above zero", () => {
      // Only high-cardinality IDs → scores are all ≤ 0, so fallback to schema
      const samples = buildSamplesWithCardinality(20, "request_id", 20);
      const schema = [{ name: "level" }];
      const result = selectDimensionsFromData(samples, schema, 8);
      // Fallback should produce results from schema
      expect(result).toContain("level");
    });

    it("excludes message$ pattern fields", () => {
      const samples = buildSamples(20, { log_message: "some message", level: "info" });
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("log_message");
    });

    it("excludes user_agent fields", () => {
      const samples = buildSamples(20, { user_agent: "Mozilla/5.0", level: "info" });
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result).not.toContain("user_agent");
    });

    it("returns at most maxDimensions=8 by default", () => {
      const fields: Record<string, string> = {};
      for (let i = 0; i < 30; i++) fields[`field${i}`] = `v${i % 5}`;
      const samples = buildSamples(20, fields);
      const result = selectDimensionsFromData(samples, [], 8);
      expect(result.length).toBeLessThanOrEqual(8);
    });
  });

  // ─── selectTraceDimensions ────────────────────────────────────────────────

  describe("selectTraceDimensions", () => {
    it("returns an array", () => {
      const result = selectTraceDimensions([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it("returns the hardcoded fallback list when no schema fields are provided", () => {
      const result = selectTraceDimensions([]);
      expect(result).toEqual(["service_name", "span_kind", "span_status", "operation_name"]);
    });

    it("returns the hardcoded fallback list when none of the schema fields are in the priority list", () => {
      const schema = [{ name: "my_custom_field" }, { name: "another_field" }];
      const result = selectTraceDimensions(schema);
      expect(result).toEqual(["service_name", "span_kind", "span_status", "operation_name"]);
    });

    it("includes service_name when present in schema", () => {
      const schema = [{ name: "service_name" }, { name: "span_kind" }];
      const result = selectTraceDimensions(schema);
      expect(result).toContain("service_name");
    });

    it("includes span_kind when present in schema", () => {
      const schema = [{ name: "service_name" }, { name: "span_kind" }];
      const result = selectTraceDimensions(schema);
      expect(result).toContain("span_kind");
    });

    it("respects the prioritised order: service_name before span_kind before span_status", () => {
      const schema = [
        { name: "span_status" },
        { name: "service_name" },
        { name: "span_kind" },
      ];
      const result = selectTraceDimensions(schema);
      const svcIdx = result.indexOf("service_name");
      const kindIdx = result.indexOf("span_kind");
      const statusIdx = result.indexOf("span_status");
      expect(svcIdx).toBeLessThan(kindIdx);
      expect(kindIdx).toBeLessThan(statusIdx);
    });

    it("respects the maxDimensions limit", () => {
      const schema = [
        { name: "service_name" },
        { name: "span_kind" },
        { name: "span_status" },
        { name: "operation_name" },
        { name: "http_method" },
        { name: "http_status_code" },
      ];
      const result = selectTraceDimensions(schema, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("includes HTTP-related trace fields when present", () => {
      const schema = [
        { name: "service_name" },
        { name: "http_method" },
        { name: "http_status_code" },
        { name: "http_route" },
      ];
      const result = selectTraceDimensions(schema, 8);
      expect(result).toContain("http_method");
      expect(result).toContain("http_status_code");
      expect(result).toContain("http_route");
    });

    it("includes database-related trace fields when present", () => {
      const schema = [
        { name: "service_name" },
        { name: "db_system" },
        { name: "db_operation" },
      ];
      const result = selectTraceDimensions(schema, 8);
      expect(result).toContain("db_system");
    });

    it("includes k8s-related trace fields when present", () => {
      const schema = [
        { name: "service_name" },
        { name: "k8s_namespace_name" },
        { name: "k8s_pod_name" },
      ];
      const result = selectTraceDimensions(schema, 8);
      expect(result).toContain("k8s_namespace_name");
    });

    it("does not include schema fields that are not in the OTel priority list", () => {
      const schema = [
        { name: "service_name" },
        { name: "my_custom_dimension" },
      ];
      const result = selectTraceDimensions(schema, 8);
      expect(result).not.toContain("my_custom_dimension");
    });

    it("uses default maxDimensions of 8 when not specified", () => {
      const schema = Array.from({ length: 25 }, (_, i) => ({
        name: [
          "service_name", "span_kind", "span_status", "operation_name",
          "http_method", "http_status_code", "http_route", "http_target",
          "db_system", "db_operation", "db_name",
          "messaging_system", "messaging_operation",
          "rpc_system", "rpc_service", "rpc_method",
          "host_name", "container_name", "k8s_pod_name", "k8s_namespace_name",
        ][i] || `extra_${i}`,
      }));
      const result = selectTraceDimensions(schema);
      expect(result.length).toBeLessThanOrEqual(8);
    });
  });
});
