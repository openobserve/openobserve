// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { ref } from "vue";
import {
  useTraceProcessing,
  formatDuration,
  formatTimestamp,
} from "./useTraceProcessing";
import { SpanKind, SpanStatus } from "@/types/traces/span.types";

// Helpers to create test spans
const makeSpan = (overrides: Record<string, any> = {}) => ({
  span_id: "span-1",
  trace_id: "trace-1",
  parent_span_id: "",
  start_time: 1_000_000_000_000, // nanoseconds
  end_time: 1_000_001_000_000,
  duration: 1_000_000, // microseconds (1 second)
  service_name: "svc-a",
  operation_name: "op-a",
  span_kind: SpanKind.SERVER,
  span_status: SpanStatus.OK,
  attributes: {},
  _timestamp: 0,
  ...overrides,
});

describe("useTraceProcessing", () => {
  describe("buildSpanTree", () => {
    it("should return empty array for empty input", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      expect(buildSpanTree([])).toEqual([]);
    });

    it("should return a single root span", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const span = makeSpan({ span_id: "root", parent_span_id: "" });
      const tree = buildSpanTree([span]);
      expect(tree).toHaveLength(1);
      expect(tree[0].span_id).toBe("root");
      expect(tree[0].depth).toBe(0);
    });

    it("should build a parent-child hierarchy", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const parent = makeSpan({ span_id: "parent", parent_span_id: "" });
      const child = makeSpan({
        span_id: "child",
        parent_span_id: "parent",
        start_time: 1_000_000_100_000,
        end_time: 1_000_000_500_000,
      });
      const tree = buildSpanTree([parent, child]);
      expect(tree).toHaveLength(1);
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].span_id).toBe("child");
      expect(tree[0].children[0].depth).toBe(1);
    });

    it("should handle multiple root spans", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const root1 = makeSpan({ span_id: "root1", parent_span_id: "" });
      const root2 = makeSpan({
        span_id: "root2",
        parent_span_id: "non-existent",
      });
      const tree = buildSpanTree([root1, root2]);
      expect(tree).toHaveLength(2);
    });

    it("should sort children by start_time", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const parent = makeSpan({ span_id: "parent", parent_span_id: "" });
      const child1 = makeSpan({
        span_id: "child1",
        parent_span_id: "parent",
        start_time: 1_000_000_200_000,
      });
      const child2 = makeSpan({
        span_id: "child2",
        parent_span_id: "parent",
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([parent, child1, child2]);
      expect(tree[0].children[0].span_id).toBe("child2");
      expect(tree[0].children[1].span_id).toBe("child1");
    });

    it("should compute durationMs from duration in microseconds", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const span = makeSpan({ span_id: "root", duration: 2_000_000 }); // 2s in us
      const tree = buildSpanTree([span]);
      expect(tree[0].durationMs).toBe(2000); // 2000ms
    });

    it("should set hasError true for ERROR status spans", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const span = makeSpan({
        span_id: "root",
        span_status: SpanStatus.ERROR,
      });
      const tree = buildSpanTree([span]);
      expect(tree[0].hasError).toBe(true);
    });

    it("should set hasError false for OK status spans", () => {
      const spans = ref([]);
      const { buildSpanTree } = useTraceProcessing(spans);
      const span = makeSpan({ span_id: "root", span_status: SpanStatus.OK });
      const tree = buildSpanTree([span]);
      expect(tree[0].hasError).toBe(false);
    });
  });

  describe("flattenSpanTree", () => {
    it("should return flat list including children", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree } = useTraceProcessing(spans);
      const parent = makeSpan({ span_id: "parent", parent_span_id: "" });
      const child = makeSpan({
        span_id: "child",
        parent_span_id: "parent",
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([parent, child]);
      const flat = flattenSpanTree(tree);
      expect(flat).toHaveLength(2);
      expect(flat[0].span_id).toBe("parent");
      expect(flat[1].span_id).toBe("child");
    });

    it("should skip collapsed children (isExpanded=false)", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree } = useTraceProcessing(spans);
      const parent = makeSpan({ span_id: "parent", parent_span_id: "" });
      const child = makeSpan({
        span_id: "child",
        parent_span_id: "parent",
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([parent, child]);
      tree[0].isExpanded = false;
      const flat = flattenSpanTree(tree);
      expect(flat).toHaveLength(1);
      expect(flat[0].span_id).toBe("parent");
    });

    it("should return empty array for empty tree", () => {
      const spans = ref([]);
      const { flattenSpanTree } = useTraceProcessing(spans);
      expect(flattenSpanTree([])).toEqual([]);
    });
  });

  describe("findCriticalPath", () => {
    it("should return empty array for empty tree", () => {
      const spans = ref([]);
      const { findCriticalPath } = useTraceProcessing(spans);
      expect(findCriticalPath([])).toEqual([]);
    });

    it("should return single span id for single span", () => {
      const spans = ref([]);
      const { buildSpanTree, findCriticalPath } = useTraceProcessing(spans);
      const span = makeSpan({ span_id: "root", duration: 1_000_000 });
      const tree = buildSpanTree([span]);
      const path = findCriticalPath(tree);
      expect(path).toContain("root");
    });

    it("should return path through longest duration branch", () => {
      const spans = ref([]);
      const { buildSpanTree, findCriticalPath } = useTraceProcessing(spans);
      const parent = makeSpan({ span_id: "parent", duration: 1_000_000 });
      const shortChild = makeSpan({
        span_id: "short",
        parent_span_id: "parent",
        duration: 500_000,
        start_time: 1_000_000_100_000,
      });
      const longChild = makeSpan({
        span_id: "long",
        parent_span_id: "parent",
        duration: 900_000,
        start_time: 1_000_000_200_000,
      });
      const tree = buildSpanTree([parent, shortChild, longChild]);
      const path = findCriticalPath(tree);
      expect(path).toContain("parent");
      expect(path).toContain("long");
      expect(path).not.toContain("short");
    });
  });

  describe("calculateMetadata", () => {
    it("should throw for empty trace", () => {
      const spans = ref([]);
      const { calculateMetadata } = useTraceProcessing(spans);
      expect(() => calculateMetadata("trace-1", [])).toThrow();
    });

    it("should calculate basic metadata for a single span", () => {
      const spans = ref([]);
      const { buildSpanTree, calculateMetadata } = useTraceProcessing(spans);
      const span = makeSpan({
        span_id: "root",
        service_name: "svc-a",
        span_status: SpanStatus.OK,
        duration: 1_000_000, // 1s in us
      });
      const tree = buildSpanTree([span]);
      const meta = calculateMetadata("trace-1", tree);

      expect(meta.trace_id).toBe("trace-1");
      expect(meta.total_spans).toBe(1);
      expect(meta.error_spans).toBe(0);
      expect(meta.service_count).toBe(1);
      expect(meta.services).toContain("svc-a");
      expect(meta.has_errors).toBe(false);
    });

    it("should count error spans correctly", () => {
      const spans = ref([]);
      const { buildSpanTree, calculateMetadata } = useTraceProcessing(spans);
      const root = makeSpan({ span_id: "root", span_status: SpanStatus.OK });
      const error = makeSpan({
        span_id: "err",
        parent_span_id: "root",
        span_status: SpanStatus.ERROR,
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([root, error]);
      const meta = calculateMetadata("trace-1", tree);

      expect(meta.error_spans).toBe(1);
      expect(meta.has_errors).toBe(true);
      expect(meta.error_services).toContain("svc-a");
    });

    it("should count multiple services", () => {
      const spans = ref([]);
      const { buildSpanTree, calculateMetadata } = useTraceProcessing(spans);
      const span1 = makeSpan({ span_id: "s1", service_name: "svc-a" });
      const span2 = makeSpan({
        span_id: "s2",
        service_name: "svc-b",
        parent_span_id: "s1",
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([span1, span2]);
      const meta = calculateMetadata("trace-1", tree);

      expect(meta.service_count).toBe(2);
      expect(meta.services).toContain("svc-a");
      expect(meta.services).toContain("svc-b");
    });

    it("should identify top 5 slowest spans", () => {
      const spans = ref([]);
      const { buildSpanTree, calculateMetadata } = useTraceProcessing(spans);
      const root = makeSpan({ span_id: "root", duration: 1_000_000 });
      const spansArr = [root];
      for (let i = 0; i < 6; i++) {
        spansArr.push(
          makeSpan({
            span_id: `child-${i}`,
            parent_span_id: "root",
            duration: (i + 1) * 100_000,
            start_time: 1_000_000_100_000 + i * 1000,
          }),
        );
      }
      const tree = buildSpanTree(spansArr);
      const meta = calculateMetadata("trace-1", tree);
      expect(meta.slowest_spans).toHaveLength(5);
    });
  });

  describe("calculateServiceBreakdown", () => {
    it("should return a breakdown per service", () => {
      const spans = ref([]);
      const { buildSpanTree, calculateMetadata, calculateServiceBreakdown } =
        useTraceProcessing(spans);
      const span1 = makeSpan({
        span_id: "s1",
        service_name: "svc-a",
        duration: 1_000_000,
      });
      const span2 = makeSpan({
        span_id: "s2",
        service_name: "svc-b",
        parent_span_id: "s1",
        duration: 500_000,
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([span1, span2]);
      const meta = calculateMetadata("trace-1", tree);
      const breakdown = calculateServiceBreakdown(meta);

      expect(breakdown).toHaveLength(2);
      const svcA = breakdown.find((b) => b.service_name === "svc-a");
      expect(svcA).toBeDefined();
      expect(svcA!.span_count).toBe(1);
      expect(svcA!.color).toMatch(/^var\(--o2-span-\d+\)$/);
    });

    it("should sort by total duration descending", () => {
      const spans = ref([]);
      const { buildSpanTree, calculateMetadata, calculateServiceBreakdown } =
        useTraceProcessing(spans);
      const span1 = makeSpan({
        span_id: "s1",
        service_name: "slow-svc",
        duration: 2_000_000,
      });
      const span2 = makeSpan({
        span_id: "s2",
        service_name: "fast-svc",
        parent_span_id: "s1",
        duration: 100_000,
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([span1, span2]);
      const meta = calculateMetadata("trace-1", tree);
      const breakdown = calculateServiceBreakdown(meta);
      expect(breakdown[0].service_name).toBe("slow-svc");
    });
  });

  describe("filterSpans", () => {
    it("should return all spans when filter is empty", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const span = makeSpan({ span_id: "root" });
      const tree = buildSpanTree([span]);
      const flat = flattenSpanTree(tree);
      const result = filterSpans(flat, {});
      expect(result).toHaveLength(1);
    });

    it("should filter by service name", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const span1 = makeSpan({ span_id: "s1", service_name: "svc-a" });
      const span2 = makeSpan({
        span_id: "s2",
        service_name: "svc-b",
        parent_span_id: "s1",
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([span1, span2]);
      const flat = flattenSpanTree(tree);
      const result = filterSpans(flat, { services: ["svc-a"] });
      expect(result).toHaveLength(1);
      expect(result[0].service_name).toBe("svc-a");
    });

    it("should filter by error status", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const ok = makeSpan({ span_id: "ok", span_status: SpanStatus.OK });
      const err = makeSpan({
        span_id: "err",
        span_status: SpanStatus.ERROR,
        parent_span_id: "ok",
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([ok, err]);
      const flat = flattenSpanTree(tree);
      const result = filterSpans(flat, { errorOnly: true });
      expect(result).toHaveLength(1);
      expect(result[0].span_id).toBe("err");
    });

    it("should filter by searchText matching service name", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const span = makeSpan({ span_id: "root", service_name: "my-unique-svc" });
      const tree = buildSpanTree([span]);
      const flat = flattenSpanTree(tree);
      const found = filterSpans(flat, { searchText: "unique" });
      const notFound = filterSpans(flat, { searchText: "other-thing" });
      expect(found).toHaveLength(1);
      expect(notFound).toHaveLength(0);
    });

    it("should filter by min duration", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const shortSpan = makeSpan({
        span_id: "short",
        duration: 100, // 0.1ms (100µs ÷ 1000 = 0.1ms)
      });
      const longSpan = makeSpan({
        span_id: "long",
        parent_span_id: "short",
        duration: 2_000_000, // 2000ms
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([shortSpan, longSpan]);
      const flat = flattenSpanTree(tree);
      const result = filterSpans(flat, { minDuration: 100 }); // min 100ms
      expect(result).toHaveLength(1);
      expect(result[0].span_id).toBe("long");
    });

    it("should filter by max duration", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const shortSpan = makeSpan({
        span_id: "short",
        duration: 100_000, // 0.1ms
      });
      const longSpan = makeSpan({
        span_id: "long",
        parent_span_id: "short",
        duration: 2_000_000, // 2000ms
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([shortSpan, longSpan]);
      const flat = flattenSpanTree(tree);
      const result = filterSpans(flat, { maxDuration: 1000 }); // max 1000ms
      expect(result).toHaveLength(1);
      expect(result[0].span_id).toBe("short");
    });

    it("should filter by attribute filters", () => {
      const spans = ref([]);
      const { buildSpanTree, flattenSpanTree, filterSpans } =
        useTraceProcessing(spans);
      const span1 = makeSpan({
        span_id: "s1",
        attributes: { env: "prod" },
      });
      const span2 = makeSpan({
        span_id: "s2",
        parent_span_id: "s1",
        attributes: { env: "dev" },
        start_time: 1_000_000_100_000,
      });
      const tree = buildSpanTree([span1, span2]);
      const flat = flattenSpanTree(tree);
      const result = filterSpans(flat, { attributeFilters: { env: "prod" } });
      expect(result).toHaveLength(1);
      expect(result[0].span_id).toBe("s1");
    });
  });

  describe("spanTree and flatSpans computed", () => {
    it("spanTree should return empty for empty spans", () => {
      const spans = ref([]);
      const { spanTree } = useTraceProcessing(spans);
      expect(spanTree.value).toEqual([]);
    });

    it("flatSpans should return empty for empty spans", () => {
      const spans = ref([]);
      const { flatSpans } = useTraceProcessing(spans);
      expect(flatSpans.value).toEqual([]);
    });

    it("flatSpans should flatten new-format spans", () => {
      const span = makeSpan({ span_id: "root" });
      const spans = ref([span]);
      const { flatSpans } = useTraceProcessing(spans);
      expect(flatSpans.value).toHaveLength(1);
      expect(flatSpans.value[0].span_id).toBe("root");
    });

    it("flatSpans should handle old tree format (spanId key)", () => {
      const oldTreeSpan = {
        spanId: "old-root",
        operationName: "op",
        serviceName: "svc",
        durationMs: 100,
        spans: [],
        lowestStartTime: 1000,
        startTimeUs: 1000,
        endTimeUs: 2000,
        durationUs: 1000,
      };
      const spans = ref([oldTreeSpan]);
      const { flatSpans } = useTraceProcessing(spans);
      expect(flatSpans.value).toHaveLength(1);
      expect(flatSpans.value[0].span_id).toBe("old-root");
    });
  });
});

describe("formatDuration", () => {
  it("should format sub-millisecond durations in microseconds", () => {
    expect(formatDuration(0.5)).toBe("500µs");
  });

  it("should format millisecond durations", () => {
    expect(formatDuration(1.5)).toBe("1.50ms");
  });

  it("should format durations under 1 second", () => {
    expect(formatDuration(999)).toBe("999.00ms");
  });

  it("should format durations in seconds", () => {
    expect(formatDuration(1000)).toBe("1.00s");
  });

  it("should format durations under 1 minute", () => {
    expect(formatDuration(59000)).toBe("59.00s");
  });

  it("should format minute-level durations", () => {
    expect(formatDuration(61000)).toBe("1m 1s");
  });

  it("should format exactly 1 minute", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });
});

describe("formatTimestamp", () => {
  it("should return a formatted string with relative time", () => {
    const nowNs = Date.now() * 1_000_000; // current time in nanoseconds
    const result = formatTimestamp(nowNs);
    expect(result).toMatch(/\d+ \w+ \d{2}:\d{2}:\d{2}:\d{3}/);
    expect(result).toContain("(");
    expect(result).toContain("ago)");
  });

  it("should include seconds ago for recent timestamps", () => {
    const nowNs = Date.now() * 1_000_000;
    const result = formatTimestamp(nowNs - 30 * 1_000_000_000); // 30s ago
    expect(result).toContain("s ago");
  });

  it("should include minutes ago for older timestamps", () => {
    const nowNs = Date.now() * 1_000_000;
    const result = formatTimestamp(nowNs - 5 * 60 * 1_000_000_000); // 5m ago
    expect(result).toContain("m ago");
  });
});
