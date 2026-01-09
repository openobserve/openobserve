// Copyright 2023 OpenObserve Inc.
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
import { createPromQLChunkProcessor } from "./promqlChunkProcessor";

/**
 * Test the core optimization: PromQL chunk processor with series limiting
 *
 * This test verifies that:
 * 1. Metrics are limited at the data loader level (not after)
 * 2. O(1) metric matching works correctly
 * 3. Statistics are tracked properly
 */
describe("PromQL Chunk Processor", () => {
  // Helper to create mock PromQL data
  const createMockChunk = (metricCount: number, valuesPerMetric: number = 10) => {
    const result: any[] = [];

    for (let i = 0; i < metricCount; i++) {
      const values: [number, string][] = [];
      for (let t = 0; t < valuesPerMetric; t++) {
        values.push([1640000000 + t * 60, String(Math.random() * 100)]);
      }

      result.push({
        metric: {
          __name__: "test_metric",
          instance: `instance_${i}`,
          job: "test_job",
        },
        values,
      });
    }

    return {
      result_type: "matrix",
      result,
    };
  };

  it("should limit first chunk to maxSeries", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 100,
      enableLogging: false, // Disable logs for tests
    });

    // First chunk with 500 metrics
    const chunk1 = createMockChunk(500, 10);

    const result = processor.processChunk(null, chunk1);

    // Should be limited to 100
    expect(result.result.length).toBe(100);

    const stats = processor.getStats();
    expect(stats.chunkCount).toBe(1);
    expect(stats.totalMetricsReceived).toBe(500);
    expect(stats.metricsStored).toBe(100);
  });

  it("should merge values for existing metrics in subsequent chunks", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 10,
      enableLogging: false,
    });

    // First chunk: 10 metrics with 5 values each
    const chunk1 = createMockChunk(10, 5);
    const result1 = processor.processChunk(null, chunk1);

    expect(result1.result.length).toBe(10);
    expect(result1.result[0].values.length).toBe(5);

    // Second chunk: same 10 metrics with 5 more values
    const chunk2 = createMockChunk(10, 5);
    const result2 = processor.processChunk(result1, chunk2);

    // Still 10 metrics
    expect(result2.result.length).toBe(10);

    // But now each has 10 values (5 + 5)
    expect(result2.result[0].values.length).toBe(10);

    const stats = processor.getStats();
    expect(stats.chunkCount).toBe(2);
    expect(stats.metricsStored).toBe(10);
    expect(stats.valuesAppended).toBe(50); // 10 metrics × 5 values
  });

  it("should skip new metrics once limit is reached", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 50,
      enableLogging: false,
    });

    // First chunk: 30 metrics
    const chunk1 = createMockChunk(30, 10);
    const result1 = processor.processChunk(null, chunk1);
    expect(result1.result.length).toBe(30);

    // Second chunk: 40 new metrics (different instances)
    const chunk2 = createMockChunk(40, 10);
    // Change instance names to make them different
    chunk2.result.forEach((metric: any, idx: number) => {
      metric.metric.instance = `new_instance_${idx}`;
    });

    const result2 = processor.processChunk(result1, chunk2);

    // Should add only 20 more (to reach 50 limit)
    expect(result2.result.length).toBe(50);

    const stats = processor.getStats();
    expect(stats.metricsStored).toBe(50);
    expect(stats.totalMetricsReceived).toBe(70); // 30 + 40
  });

  it("should handle mixed chunks (existing + new metrics)", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 100,
      enableLogging: false,
    });

    // First chunk: 50 metrics
    const chunk1 = createMockChunk(50, 5);
    const result1 = processor.processChunk(null, chunk1);

    // Second chunk: 25 existing + 25 new
    const chunk2 = createMockChunk(50, 5);
    // First 25 are same as chunk1, last 25 are new
    chunk2.result.slice(25).forEach((metric: any, idx: number) => {
      metric.metric.instance = `new_instance_${idx}`;
    });

    const result2 = processor.processChunk(result1, chunk2);

    // Should have 75 total (50 original + 25 new)
    expect(result2.result.length).toBe(75);

    // First 25 should have 10 values (5 + 5)
    expect(result2.result[0].values.length).toBe(10);
    expect(result2.result[24].values.length).toBe(10);

    // Next 25 should have 5 values (only from chunk1)
    expect(result2.result[25].values.length).toBe(5);

    // Last 25 should have 5 values (only from chunk2)
    expect(result2.result[50].values.length).toBe(5);
  });

  it("should generate deterministic metric signatures", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 100,
      enableLogging: false,
    });

    // Create two chunks with same metrics (same labels)
    const chunk1 = createMockChunk(10, 5);
    const chunk2 = createMockChunk(10, 5);

    const result1 = processor.processChunk(null, chunk1);
    const result2 = processor.processChunk(result1, chunk2);

    // Should recognize as same metrics (not add duplicates)
    expect(result2.result.length).toBe(10);

    // Should merge values
    expect(result2.result[0].values.length).toBe(10);
  });

  it("should track statistics correctly", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 50,
      enableLogging: false,
    });

    // Process 3 chunks
    const chunk1 = createMockChunk(30, 10);
    const result1 = processor.processChunk(null, chunk1);

    const chunk2 = createMockChunk(30, 10);
    const result2 = processor.processChunk(result1, chunk2);

    const chunk3 = createMockChunk(30, 10);
    processor.processChunk(result2, chunk3);

    const stats = processor.getStats();

    expect(stats.chunkCount).toBe(3);
    expect(stats.totalMetricsReceived).toBe(90); // 30 × 3
    expect(stats.metricsStored).toBe(30); // All chunks have same 30 metrics
    expect(stats.valuesAppended).toBe(600); // 30 metrics × 10 values × 2 chunks
    expect(stats.totalTime).toBeGreaterThan(0);
  });

  it("should handle empty chunks gracefully", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 100,
      enableLogging: false,
    });

    const emptyChunk = {
      result_type: "matrix",
      result: [],
    };

    const result = processor.processChunk(null, emptyChunk);

    expect(result.result.length).toBe(0);

    const stats = processor.getStats();
    expect(stats.chunkCount).toBe(1);
    expect(stats.totalMetricsReceived).toBe(0);
    expect(stats.metricsStored).toBe(0);
  });

  it("should handle large datasets efficiently", () => {
    const processor = createPromQLChunkProcessor({
      maxSeries: 100,
      enableLogging: false,
    });

    // Simulate real scenario: 12 chunks with 2500 metrics each
    let result = null;
    for (let i = 0; i < 12; i++) {
      const chunk = createMockChunk(2500, 20);
      result = processor.processChunk(result, chunk);
    }

    // Should be limited to 100 metrics
    expect(result.result.length).toBe(100);

    const stats = processor.getStats();
    expect(stats.chunkCount).toBe(12);
    expect(stats.totalMetricsReceived).toBe(30000); // 2500 × 12
    expect(stats.metricsStored).toBe(100);

    console.log(`✅ Processed 30,000 metrics across 12 chunks (limited to 100)`);
  });

  it("should produce identical data when limiting early vs late", () => {
    // This test verifies that limiting at data loader produces the SAME chart data
    // as limiting after loading all metrics (the old behavior)

    // Create consistent test data
    const createConsistentChunk = (startIdx: number, count: number) => {
      const result: any[] = [];
      for (let i = 0; i < count; i++) {
        const metricIdx = startIdx + i;
        result.push({
          metric: {
            __name__: "test_metric",
            instance: `instance_${metricIdx}`,
            job: "test_job",
            id: String(metricIdx), // Deterministic ID
          },
          values: [
            [1640000000, String(metricIdx * 10)],
            [1640000060, String(metricIdx * 10 + 1)],
            [1640000120, String(metricIdx * 10 + 2)],
          ],
        });
      }
      return { result_type: "matrix", result };
    };

    // Scenario 1: Old behavior - load all 9832 metrics, then limit to 100
    const allMetrics: any[] = [];
    for (let i = 0; i < 9832; i++) {
      allMetrics.push({
        metric: {
          __name__: "test_metric",
          instance: `instance_${i}`,
          job: "test_job",
          id: String(i),
        },
        values: [
          [1640000000, String(i * 10)],
          [1640000060, String(i * 10 + 1)],
          [1640000120, String(i * 10 + 2)],
        ],
      });
    }
    const limitedOldWay = allMetrics.slice(0, 100);

    // Scenario 2: New behavior - limit at data loader to 100
    const processor = createPromQLChunkProcessor({
      maxSeries: 100,
      enableLogging: false,
    });

    let result = null;
    let totalMetricsSent = 0;

    // Simulate streaming: send metrics in chunks
    const chunkSize = 2500;
    for (let start = 0; start < 9832; start += chunkSize) {
      const count = Math.min(chunkSize, 9832 - start);
      const chunk = createConsistentChunk(start, count);
      result = processor.processChunk(result, chunk);
      totalMetricsSent += count;
    }

    const limitedNewWay = result.result;

    // Both should have exactly 100 metrics
    expect(limitedNewWay.length).toBe(100);
    expect(limitedOldWay.length).toBe(100);

    // Verify the first 100 metrics are IDENTICAL
    for (let i = 0; i < 100; i++) {
      const oldMetric = limitedOldWay[i];
      const newMetric = limitedNewWay[i];

      // Metric labels should match
      expect(newMetric.metric.instance).toBe(oldMetric.metric.instance);
      expect(newMetric.metric.job).toBe(oldMetric.metric.job);
      expect(newMetric.metric.__name__).toBe(oldMetric.metric.__name__);

      // Values should match
      expect(newMetric.values.length).toBe(oldMetric.values.length);
      expect(newMetric.values[0]).toEqual(oldMetric.values[0]);
      expect(newMetric.values[1]).toEqual(oldMetric.values[1]);
      expect(newMetric.values[2]).toEqual(oldMetric.values[2]);
    }

    console.log(`✅ Data correctness verified: First 100 metrics are IDENTICAL`);
    console.log(`   Old way: Load 9832 → limit to 100`);
    console.log(`   New way: Limit during streaming → 100`);
    console.log(`   Result: Perfect match! Chart will render identically.`);
  });
});
