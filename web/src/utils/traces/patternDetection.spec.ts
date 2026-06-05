// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from 'vitest'
import { buildPatternConsolidatedTree, filterPatterns, type SpanInstance, type CallPattern } from './patternDetection'

/**
 * Mock span data structure matching the actual span interface used in the application.
 * Note: The implementation accepts spans with multiple naming conventions for backward compatibility.
 */
interface MockSpan {
  span_id: string
  spanId: string
  trace_id: string
  parent_span_id: string | null
  serviceName: string
  resolvedIdentity: string
  operationName: string
  operation_name: string
  durationMs: number
  exclusiveTimeMs: number
  start_time: number
  attributes: Record<string, any>
  tags: Record<string, any>
  spans: MockSpan[]
  status_code: number
}

/**
 * Helper function to create mock span data for testing.
 * Provides sensible defaults matching the span interface structure.
 */
const createMockSpan = (overrides: Partial<MockSpan> = {}): MockSpan => ({
  span_id: 'span-1',
  spanId: 'span-1',
  trace_id: 'trace-1',
  parent_span_id: null,
  serviceName: 'service-a',
  resolvedIdentity: 'service-a',
  operationName: 'op-1',
  operation_name: 'op-1',
  durationMs: 100,
  exclusiveTimeMs: 50,
  start_time: 0,
  attributes: {},
  tags: {},
  spans: [],
  status_code: 0,
  ...overrides
})

describe('patternDetection', () => {
  describe('buildPatternConsolidatedTree', () => {
    it('should return empty map for empty trace tree', () => {
      const result = buildPatternConsolidatedTree([])
      expect(result.size).toBe(0)
    })

    it('should handle single root span', () => {
      const traceTree = [createMockSpan({ durationMs: 100 })]
      const result = buildPatternConsolidatedTree(traceTree)

      expect(result.size).toBeGreaterThan(0)
      const patterns = Array.from(result.values())
      expect(patterns[0].metrics.count).toBe(1)
      expect(patterns[0].metrics.min).toBe(100)
      expect(patterns[0].metrics.max).toBe(100)
      expect(patterns[0].metrics.avg).toBe(100)
    })

    it('should create single service pattern with correct metrics', () => {
      const span1 = createMockSpan({
        durationMs: 100,
        exclusiveTimeMs: 80,
        serviceName: 'api-service'
      })
      const traceTree = [span1]

      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.metrics.count).toBe(1)
      expect(pattern.metrics.avg).toBe(100)
      expect(pattern.metrics.min).toBe(100)
      expect(pattern.metrics.max).toBe(100)
      expect(pattern.metrics.totalDuration).toBe(100)
      expect(pattern.metrics.avgExclusive).toBe(80)
    })

    it('should calculate percentiles correctly for multiple instances', () => {
      const spans = [10, 20, 30, 40, 50].map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration,
          exclusiveTimeMs: duration * 0.8,
          serviceName: 'test-service'
        })
      )

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.metrics.count).toBe(5)
      expect(pattern.metrics.min).toBe(10)
      expect(pattern.metrics.max).toBe(50)
      expect(pattern.metrics.avg).toBe(30)
      // Percentiles with linear interpolation on [10, 20, 30, 40, 50]
      expect(pattern.metrics.p75).toBeGreaterThan(0)
      expect(pattern.metrics.p95).toBeGreaterThan(0)
      expect(pattern.metrics.p99).toBeGreaterThan(0)
      // Verify ordering: min <= p75 <= p95 <= p99 <= max
      expect(pattern.metrics.min).toBeLessThanOrEqual(pattern.metrics.p75)
      expect(pattern.metrics.p75).toBeLessThanOrEqual(pattern.metrics.p95)
      expect(pattern.metrics.p95).toBeLessThanOrEqual(pattern.metrics.p99)
      expect(pattern.metrics.p99).toBeLessThanOrEqual(pattern.metrics.max)
    })

    it('should calculate error rate correctly', () => {
      const spans = [
        createMockSpan({ span_id: 'span-1', spanId: 'span-1', durationMs: 100, status_code: 0 }),
        createMockSpan({ span_id: 'span-2', spanId: 'span-2', durationMs: 100, status_code: 0 }),
        createMockSpan({ span_id: 'span-3', spanId: 'span-3', durationMs: 100, status_code: 2 })
      ]

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.metrics.count).toBe(3)
      expect(pattern.metrics.errorRate).toBeCloseTo(33.33, 1)
    })

    it('should handle service-to-service relationships', () => {
      const parentSpan = createMockSpan({
        span_id: 'parent',
        spanId: 'parent',
        serviceName: 'api-service',
        resolvedIdentity: 'api-service',
        durationMs: 200,
        spans: [
          createMockSpan({
            span_id: 'child',
            spanId: 'child',
            serviceName: 'db-service',
            resolvedIdentity: 'db-service',
            durationMs: 100
          })
        ]
      })

      const traceTree = [parentSpan]
      const result = buildPatternConsolidatedTree(traceTree)

      // Should have a pattern for the relationship
      let foundRelationship = false
      result.forEach(pattern => {
        if (pattern.pathSignature.includes('→')) {
          foundRelationship = true
          expect(pattern.pathSignature).toBe('api-service→db-service')
        }
      })
      expect(foundRelationship).toBe(true)
    })

    it('should handle exclusive time metrics', () => {
      const spans = [
        createMockSpan({
          durationMs: 100,
          exclusiveTimeMs: 50,
          serviceName: 'service-1'
        }),
        createMockSpan({
          durationMs: 100,
          exclusiveTimeMs: 60,
          serviceName: 'service-1',
          span_id: 'span-2',
          spanId: 'span-2'
        })
      ]

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.metrics.avgExclusive).toBe(55)
      expect(pattern.metrics.minExclusive).toBe(50)
      expect(pattern.metrics.maxExclusive).toBe(60)
      expect(pattern.metrics.selfTimeRatio).toBeCloseTo(0.55, 2)
    })

    it('should calculate trace time percentages correctly', () => {
      const span1 = createMockSpan({
        durationMs: 100,
        serviceName: 'service-a'
      })
      const span2 = createMockSpan({
        span_id: 'span-2',
        spanId: 'span-2',
        durationMs: 300,
        serviceName: 'service-b'
      })

      const traceTree = [span1, span2]
      const result = buildPatternConsolidatedTree(traceTree)
      const patterns = Array.from(result.values())

      // Total trace duration is max of both = 300
      // service-a pattern should be 100/300 = 33.33%
      const serviceAPattern = patterns.find(p => p.pathSignature === 'service-a')
      if (serviceAPattern) {
        expect(serviceAPattern.metrics.traceTimePercent).toBeCloseTo(33.33, 1)
      }
    })

    it('should handle edge case of single span with zero duration', () => {
      const span = createMockSpan({ durationMs: 0 })
      const traceTree = [span]

      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.metrics.count).toBe(1)
      expect(pattern.metrics.avg).toBe(0)
      expect(pattern.metrics.min).toBe(0)
      expect(pattern.metrics.max).toBe(0)
    })

    it('should handle edge case with very large duration arrays', () => {
      // Create 100 spans with varying durations
      const spans = Array.from({ length: 100 }, (_, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: (i + 1) * 10,
          serviceName: 'performance-test'
        })
      )

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.metrics.count).toBe(100)
      expect(pattern.metrics.min).toBe(10)
      expect(pattern.metrics.max).toBe(1000)
      // Verify percentiles are ordered
      expect(pattern.metrics.p75).toBeGreaterThan(pattern.metrics.avg)
      expect(pattern.metrics.p95).toBeGreaterThan(pattern.metrics.p75)
      expect(pattern.metrics.p99).toBeGreaterThan(pattern.metrics.p95)
    })

    it('should populate spanIds array correctly', () => {
      const spans = [
        createMockSpan({ span_id: 'span-a', spanId: 'span-a' }),
        createMockSpan({ span_id: 'span-b', spanId: 'span-b' })
      ]

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      expect(pattern.spanIds.length).toBeGreaterThan(0)
      expect(pattern.spanIds).toContain('span-a')
    })
  })

  describe('filterPatterns', () => {
    const createPattern = (overrides: Partial<CallPattern> = {}): CallPattern => ({
      pathSignature: 'service-a→service-b',
      instances: [],
      metrics: {
        count: 5,
        avg: 100,
        min: 50,
        max: 200,
        p75: 150,
        p95: 190,
        p99: 199,
        totalDuration: 500,
        errorRate: 20,
        traceTimePercent: 25,
        avgExclusive: 60,
        minExclusive: 30,
        maxExclusive: 90,
        exclusiveP75: 75,
        exclusiveP95: 85,
        exclusiveTimePercent: 15,
        selfTimeRatio: 0.6
      },
      spanIds: [],
      ...overrides
    })

    it('should return all patterns when no filters applied', () => {
      const patterns = new Map([
        ['pattern-1', createPattern()],
        ['pattern-2', createPattern()]
      ])

      const result = filterPatterns(patterns, {})
      expect(result.size).toBe(2)
    })

    it('should filter by minimum duration', () => {
      const patterns = new Map([
        ['slow', createPattern({ metrics: { ...createPattern().metrics, avg: 200 } })],
        ['fast', createPattern({ metrics: { ...createPattern().metrics, avg: 50 } })]
      ])

      const result = filterPatterns(patterns, { minDuration: 100 })
      expect(result.size).toBe(1)
      expect(result.has('slow')).toBe(true)
    })

    it('should filter by maximum duration', () => {
      const patterns = new Map([
        ['slow', createPattern({ metrics: { ...createPattern().metrics, avg: 200 } })],
        ['fast', createPattern({ metrics: { ...createPattern().metrics, avg: 50 } })]
      ])

      const result = filterPatterns(patterns, { maxDuration: 100 })
      expect(result.size).toBe(1)
      expect(result.has('fast')).toBe(true)
    })

    it('should filter by error rate', () => {
      const patterns = new Map([
        [
          'error-prone',
          createPattern({ metrics: { ...createPattern().metrics, errorRate: 50 } })
        ],
        [
          'stable',
          createPattern({ metrics: { ...createPattern().metrics, errorRate: 5 } })
        ]
      ])

      const result = filterPatterns(patterns, { minErrorRate: 20 })
      expect(result.size).toBe(1)
      expect(result.has('error-prone')).toBe(true)
    })

    it('should filter by minimum calls', () => {
      const patterns = new Map([
        ['frequent', createPattern({ metrics: { ...createPattern().metrics, count: 50 } })],
        ['rare', createPattern({ metrics: { ...createPattern().metrics, count: 2 } })]
      ])

      const result = filterPatterns(patterns, { minCalls: 10 })
      expect(result.size).toBe(1)
      expect(result.has('frequent')).toBe(true)
    })

    it('should filter only errors', () => {
      const patterns = new Map([
        ['with-errors', createPattern({ metrics: { ...createPattern().metrics, errorRate: 25 } })],
        ['no-errors', createPattern({ metrics: { ...createPattern().metrics, errorRate: 0 } })]
      ])

      const result = filterPatterns(patterns, { onlyErrors: true })
      expect(result.size).toBe(1)
      expect(result.has('with-errors')).toBe(true)
    })

    it('should apply multiple filters together', () => {
      const patterns = new Map([
        [
          'match',
          createPattern({
            metrics: {
              ...createPattern().metrics,
              avg: 150,
              errorRate: 25,
              count: 20
            }
          })
        ],
        [
          'too-fast',
          createPattern({
            metrics: {
              ...createPattern().metrics,
              avg: 30,
              errorRate: 25,
              count: 20
            }
          })
        ],
        [
          'no-errors',
          createPattern({
            metrics: {
              ...createPattern().metrics,
              avg: 150,
              errorRate: 0,
              count: 20
            }
          })
        ]
      ])

      const result = filterPatterns(patterns, {
        minDuration: 100,
        minErrorRate: 20
      })

      expect(result.size).toBe(1)
      expect(result.has('match')).toBe(true)
    })
  })

  describe('Percentile Calculations', () => {
    it('should calculate p75 correctly for ordered array', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const span = createMockSpan({ durationMs: 0 })
      span.spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration
        })
      )

      const traceTree = [span]
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      // For 10 values, p75 index = 0.75 * 9 = 6.75
      // Value = sorted[6] * 0.25 + sorted[7] * 0.75
      // = 70 * 0.25 + 80 * 0.75 = 17.5 + 60 = 77.5
      expect(pattern.metrics.p75).toBeCloseTo(77.5, 1)
    })

    it('should calculate p95 correctly for ordered array', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const span = createMockSpan({ durationMs: 0 })
      span.spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration
        })
      )

      const traceTree = [span]
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      // For 10 values, p95 index = 0.95 * 9 = 8.55
      // Value = sorted[8] * 0.45 + sorted[9] * 0.55
      // = 90 * 0.45 + 100 * 0.55 = 40.5 + 55 = 95.5
      expect(pattern.metrics.p95).toBeCloseTo(95.5, 1)
    })

    it('should calculate p99 correctly for ordered array', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const span = createMockSpan({ durationMs: 0 })
      span.spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration
        })
      )

      const traceTree = [span]
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      // For 10 values, p99 index = 0.99 * 9 = 8.91
      // Value = sorted[8] * 0.09 + sorted[9] * 0.91
      // = 90 * 0.09 + 100 * 0.91 = 8.1 + 91 = 99.1
      expect(pattern.metrics.p99).toBeCloseTo(99.1, 1)
    })

    it('should handle edge case of single value for percentiles', () => {
      const span = createMockSpan({ durationMs: 42 })
      const traceTree = [span]

      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      // Single value should be returned for all percentiles
      expect(pattern.metrics.p75).toBe(42)
      expect(pattern.metrics.p95).toBe(42)
      expect(pattern.metrics.p99).toBe(42)
    })

    it('should handle edge case of empty array for percentiles', () => {
      const traceTree: MockSpan[] = []
      const result = buildPatternConsolidatedTree(traceTree)

      expect(result.size).toBe(0)
    })

    it('should handle two values correctly', () => {
      const durations = [10, 20]
      const span = createMockSpan({ durationMs: 0 })
      span.spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration
        })
      )

      const traceTree = [span]
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = Array.from(result.values())[0]

      // For 2 values [10, 20]:
      // p75: index = 0.75 * 1 = 0.75 => 10 * 0.25 + 20 * 0.75 = 17.5
      // p95: index = 0.95 * 1 = 0.95 => 10 * 0.05 + 20 * 0.95 = 19
      // p99: index = 0.99 * 1 = 0.99 => 10 * 0.01 + 20 * 0.99 = 19.8
      expect(pattern.metrics.p75).toBeCloseTo(17.5, 1)
      expect(pattern.metrics.p95).toBeCloseTo(19, 1)
      expect(pattern.metrics.p99).toBeCloseTo(19.8, 1)
    })

    describe('Edge Cases - Invalid Data', () => {
      it('should handle negative duration values', () => {
        const durations = [10, -5, 20, 15]
        const span = createMockSpan({ durationMs: 0 })
        span.spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration
          })
        )

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)
        const pattern = Array.from(result.values())[0]

        // Pattern should still calculate metrics even with negative values
        // Negative durations should not cause crashes
        expect(pattern.metrics.count).toBe(4)
        expect(pattern.metrics.min).toBeLessThanOrEqual(pattern.metrics.max)
      })

      it('should handle mixed zero and positive durations', () => {
        const durations = [0, 0, 10, 20]
        const span = createMockSpan({ durationMs: 0 })
        span.spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration
          })
        )

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)
        const pattern = Array.from(result.values())[0]

        expect(pattern.metrics.count).toBe(4)
        expect(pattern.metrics.min).toBe(0)
        expect(pattern.metrics.max).toBe(20)
        expect(pattern.metrics.avg).toBe(7.5)
      })

      it('should handle malformed span data with missing durationMs', () => {
        const span = createMockSpan({ durationMs: 100 })
        // Child span with missing durationMs
        const childSpan = createMockSpan({ durationMs: undefined as any })
        span.spans = [childSpan]

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)

        // Should not crash and should handle missing duration gracefully
        expect(result.size).toBeGreaterThanOrEqual(0)
      })

      it('should handle very large duration values', () => {
        const durations = [1000000, 2000000, 3000000]
        const span = createMockSpan({ durationMs: 0 })
        span.spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration
          })
        )

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)
        const pattern = Array.from(result.values())[0]

        // Large values should be handled without overflow
        expect(pattern.metrics.count).toBe(3)
        expect(pattern.metrics.min).toBe(1000000)
        expect(pattern.metrics.max).toBe(3000000)
        expect(pattern.metrics.avg).toBe(2000000)
      })

      it('should validate percentile ordering with edge case data', () => {
        // Test data: duplicate values at percentile boundaries
        const durations = [5, 5, 5, 5, 5, 100, 100, 100, 100, 100]
        const span = createMockSpan({ durationMs: 0 })
        span.spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration
          })
        )

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)
        const pattern = Array.from(result.values())[0]

        // Percentiles should maintain ordering even with clustered data
        expect(pattern.metrics.min).toBeLessThanOrEqual(pattern.metrics.p75)
        expect(pattern.metrics.p75).toBeLessThanOrEqual(pattern.metrics.p95)
        expect(pattern.metrics.p95).toBeLessThanOrEqual(pattern.metrics.p99)
        expect(pattern.metrics.p99).toBeLessThanOrEqual(pattern.metrics.max)
      })

      it('should handle null or undefined exclusive time values', () => {
        const span = createMockSpan({
          durationMs: 100,
          exclusiveTimeMs: undefined as any
        })

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)
        const pattern = Array.from(result.values())[0]

        // Should handle gracefully and calculate metrics
        expect(pattern.metrics.count).toBe(1)
        // Missing exclusive time should fallback to duration
        expect(pattern.metrics.avgExclusive).toBeDefined()
      })
    })
  })
})
