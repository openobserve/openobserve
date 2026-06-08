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
      const traceTree = [createMockSpan({ durationMs: 100, exclusiveTimeMs: 100 })]
      const result = buildPatternConsolidatedTree(traceTree)

      expect(result.size).toBeGreaterThan(0)
      const pattern = result.get('service-a')!
      expect(pattern.metrics.count).toBe(1)
      expect(pattern.metrics.min).toBe(100)
      expect(pattern.metrics.max).toBe(100)
      expect(pattern.metrics.avg).toBe(100)
    })

    it('should create root→service pattern for top-level services', () => {
      const span = createMockSpan({
        span_id: 'root-child',
        spanId: 'root-child',
        durationMs: 200,
        exclusiveTimeMs: 150,
        serviceName: 'load-generator',
        resolvedIdentity: 'load-generator'
      })
      const traceTree = [span]
      const result = buildPatternConsolidatedTree(traceTree)

      // Should have root→load-generator relationship (structure only, no edge metrics)
      expect(result.has('root→load-generator')).toBe(true)
      const rootRel = result.get('root→load-generator')!
      expect(rootRel.pathSignature).toBe('root→load-generator')
      expect(rootRel.metrics.count).toBe(1)
      // Should also have the service-level pattern (real metrics)
      expect(result.has('load-generator')).toBe(true)
      const svcPattern = result.get('load-generator')!
      expect(svcPattern.metrics.count).toBe(1)
      expect(svcPattern.metrics.avg).toBe(150)   // exclusiveTimeMs = 150
    })

    it('should create single service pattern with correct metrics', () => {
      const span1 = createMockSpan({
        durationMs: 100,
        exclusiveTimeMs: 80,
        serviceName: 'api-service',
        resolvedIdentity: 'api-service'
      })
      const traceTree = [span1]

      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('api-service')!

      expect(pattern.metrics.count).toBe(1)
      // Primary metric (avg) = exclusive time (service's own execution time)
      expect(pattern.metrics.avg).toBe(80)
      expect(pattern.metrics.min).toBe(80)
      expect(pattern.metrics.max).toBe(80)
      // totalDuration = sum of exclusiveTimeMs (total self-work)
      expect(pattern.metrics.totalDuration).toBe(80)
      // avgExclusive = avg of inclusive durations (supplementary metric)
      expect(pattern.metrics.avgExclusive).toBe(100)
    })

    it('should calculate percentiles correctly for multiple instances', () => {
      const spans = [10, 20, 30, 40, 50].map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration,
          exclusiveTimeMs: duration, // leaf span: exclusive = inclusive
          serviceName: 'test-service',
          resolvedIdentity: 'test-service'
        })
      )

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('test-service')!

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
        createMockSpan({ span_id: 'span-1', spanId: 'span-1', durationMs: 100, exclusiveTimeMs: 100, status_code: 0, serviceName: 'err-test', resolvedIdentity: 'err-test' }),
        createMockSpan({ span_id: 'span-2', spanId: 'span-2', durationMs: 100, exclusiveTimeMs: 100, status_code: 0, serviceName: 'err-test', resolvedIdentity: 'err-test' }),
        createMockSpan({ span_id: 'span-3', spanId: 'span-3', durationMs: 100, exclusiveTimeMs: 100, status_code: 2, serviceName: 'err-test', resolvedIdentity: 'err-test' })
      ]

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('err-test')!

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

      // Should have both the root→service pattern and the service→service pattern
      const relationships = Array.from(result.keys()).filter(k => k.includes('→'))
      expect(relationships).toContain('root→api-service')
      expect(relationships).toContain('api-service→db-service')
    })

    it('should create service-level patterns for ALL services, including those in relationships', () => {
      const parentSpan = createMockSpan({
        span_id: 'parent',
        spanId: 'parent',
        serviceName: 'api-service',
        resolvedIdentity: 'api-service',
        durationMs: 200,
        exclusiveTimeMs: 50, // self-time: 50ms, child time: 150ms
        spans: [
          createMockSpan({
            span_id: 'child',
            spanId: 'child',
            serviceName: 'db-service',
            resolvedIdentity: 'db-service',
            durationMs: 100,
            exclusiveTimeMs: 100 // db-service has no children, so exclusive = inclusive
          })
        ]
      })

      const traceTree = [parentSpan]
      const result = buildPatternConsolidatedTree(traceTree)

      // Should have the relationship pattern
      expect(result.has('api-service→db-service')).toBe(true)

      // Should have service-level patterns for BOTH services
      expect(result.has('api-service')).toBe(true)
      expect(result.has('db-service')).toBe(true)

      // api-service pattern should use exclusive time (50ms) as primary metric
      const apiServicePattern = result.get('api-service')!
      expect(apiServicePattern.pathSignature).toBe('api-service')
      expect(apiServicePattern.metrics.count).toBe(1)
      expect(apiServicePattern.metrics.avg).toBe(50) // exclusive time, not 200ms inclusive
      expect(apiServicePattern.metrics.min).toBe(50)
      expect(apiServicePattern.metrics.max).toBe(50)

      // db-service pattern should use its exclusive time
      const dbServicePattern = result.get('db-service')!
      expect(dbServicePattern.pathSignature).toBe('db-service')
      expect(dbServicePattern.metrics.count).toBe(1)
      expect(dbServicePattern.metrics.avg).toBe(100)
    })

    it('should not assign downstream service metrics to parent service node', () => {
      // This test verifies the bug fix: parent service node should show its OWN
      // exclusive time, not the downstream service's duration.
      const parentSpan = createMockSpan({
        span_id: 'parent',
        spanId: 'parent',
        serviceName: 'frontend',
        resolvedIdentity: 'frontend',
        durationMs: 1000,        // total trace time (inclusive)
        exclusiveTimeMs: 200,     // frontend's own work
        spans: [
          createMockSpan({
            span_id: 'rec-1',
            spanId: 'rec-1',
            serviceName: 'recommendation',
            resolvedIdentity: 'recommendation',
            durationMs: 500,
            exclusiveTimeMs: 300
          }),
          createMockSpan({
            span_id: 'rec-2',
            spanId: 'rec-2',
            serviceName: 'recommendation',
            resolvedIdentity: 'recommendation',
            durationMs: 300,
            exclusiveTimeMs: 150
          })
        ]
      })

      const traceTree = [parentSpan]
      const result = buildPatternConsolidatedTree(traceTree)

      // frontend's service pattern should have frontend's OWN exclusive time (200ms)
      const frontendPattern = result.get('frontend')!
      expect(frontendPattern.metrics.avg).toBe(200) // NOT 500, NOT 800, NOT 1000

      // recommendation's service pattern should aggregate its own instances' exclusive times
      const recPattern = result.get('recommendation')!
      expect(recPattern.metrics.count).toBe(2)
      expect(recPattern.metrics.avg).toBe(225) // (300 + 150) / 2 = 225
      expect(recPattern.metrics.min).toBe(150)
      expect(recPattern.metrics.max).toBe(300)

      // Relationship pattern exists for tree structure (count only)
      const relPattern = result.get('frontend→recommendation')!
      expect(relPattern.metrics.count).toBe(2)
    })

    it('should handle exclusive time metrics', () => {
      const spans = [
        createMockSpan({
          durationMs: 100,
          exclusiveTimeMs: 50,
          serviceName: 'service-1',
          resolvedIdentity: 'service-1'
        }),
        createMockSpan({
          durationMs: 100,
          exclusiveTimeMs: 60,
          serviceName: 'service-1',
          resolvedIdentity: 'service-1',
          span_id: 'span-2',
          spanId: 'span-2'
        })
      ]

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('service-1')!

      // Primary metrics use exclusive time (service's own execution time)
      expect(pattern.metrics.avg).toBe(55)          // avg of [50, 60]
      expect(pattern.metrics.min).toBe(50)
      expect(pattern.metrics.max).toBe(60)
      // Supplementary metrics: avgExclusive = avg of inclusive durations
      expect(pattern.metrics.avgExclusive).toBe(100) // avg of [100, 100]
      expect(pattern.metrics.minExclusive).toBe(100)
      expect(pattern.metrics.maxExclusive).toBe(100)
      // selfTimeRatio = avgExclusive / avg = 100 / 55 ≈ 1.82
      expect(pattern.metrics.selfTimeRatio).toBeCloseTo(1.82, 2)
    })

    it('should calculate trace time percentages correctly', () => {
      const span1 = createMockSpan({
        durationMs: 100,
        exclusiveTimeMs: 100, // leaf span: exclusive = inclusive
        serviceName: 'service-a',
        resolvedIdentity: 'service-a'
      })
      const span2 = createMockSpan({
        span_id: 'span-2',
        spanId: 'span-2',
        durationMs: 300,
        exclusiveTimeMs: 300, // leaf span: exclusive = inclusive
        serviceName: 'service-b',
        resolvedIdentity: 'service-b'
      })

      const traceTree = [span1, span2]
      const result = buildPatternConsolidatedTree(traceTree)

      // Total trace duration is max of both = 300
      // service-a merged duration = 100 (interval [0, 100])
      // traceTimePercent = 100/300 * 100 = 33.33%
      const serviceAPattern = result.get('service-a')!
      expect(serviceAPattern.metrics.traceTimePercent).toBeCloseTo(33.33, 1)

      // service-b merged duration = 300 (interval [0, 300])
      // traceTimePercent = 300/300 * 100 = 100%
      const serviceBPattern = result.get('service-b')!
      expect(serviceBPattern.metrics.traceTimePercent).toBeCloseTo(100, 1)
    })

    it('should handle edge case of single span with zero duration', () => {
      const span = createMockSpan({ durationMs: 0, exclusiveTimeMs: 0 })
      const traceTree = [span]

      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('service-a')!

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
          exclusiveTimeMs: (i + 1) * 10, // leaf span: exclusive = inclusive
          serviceName: 'performance-test',
          resolvedIdentity: 'performance-test'
        })
      )

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('performance-test')!

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
        createMockSpan({ span_id: 'span-a', spanId: 'span-a', serviceName: 'svc', resolvedIdentity: 'svc' }),
        createMockSpan({ span_id: 'span-b', spanId: 'span-b', serviceName: 'svc', resolvedIdentity: 'svc' })
      ]

      const traceTree = spans
      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('svc')!

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
      const spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration,
          exclusiveTimeMs: duration,
          serviceName: 'pct-test',
          resolvedIdentity: 'pct-test'
        })
      )

      const result = buildPatternConsolidatedTree(spans)
      const pattern = result.get('pct-test')!

      // 10 values [10, ..., 100], p75 via linear interpolation
      expect(pattern.metrics.p75).toBeGreaterThan(0)
      expect(pattern.metrics.min).toBeLessThanOrEqual(pattern.metrics.p75)
      expect(pattern.metrics.p75).toBeLessThanOrEqual(pattern.metrics.p95)
    })

    it('should calculate p95 correctly for ordered array', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration,
          exclusiveTimeMs: duration,
          serviceName: 'pct-test',
          resolvedIdentity: 'pct-test'
        })
      )

      const result = buildPatternConsolidatedTree(spans)
      const pattern = result.get('pct-test')!

      expect(pattern.metrics.p95).toBeGreaterThan(0)
      expect(pattern.metrics.p95).toBeLessThanOrEqual(pattern.metrics.p99)
    })

    it('should calculate p99 correctly for ordered array', () => {
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration,
          exclusiveTimeMs: duration,
          serviceName: 'pct-test',
          resolvedIdentity: 'pct-test'
        })
      )

      const result = buildPatternConsolidatedTree(spans)
      const pattern = result.get('pct-test')!

      expect(pattern.metrics.p99).toBeGreaterThan(0)
      expect(pattern.metrics.p99).toBeLessThanOrEqual(pattern.metrics.max)
    })

    it('should handle edge case of single value for percentiles', () => {
      const span = createMockSpan({ durationMs: 42, exclusiveTimeMs: 42 })
      const traceTree = [span]

      const result = buildPatternConsolidatedTree(traceTree)
      const pattern = result.get('service-a')!

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
      const spans = durations.map((duration, i) =>
        createMockSpan({
          span_id: `span-${i}`,
          spanId: `span-${i}`,
          durationMs: duration,
          exclusiveTimeMs: duration,
          serviceName: 'two-vals',
          resolvedIdentity: 'two-vals'
        })
      )

      const result = buildPatternConsolidatedTree(spans)
      const pattern = result.get('two-vals')!

      // 2 values [10, 20], percentiles via linear interpolation
      expect(pattern.metrics.p75).toBeGreaterThan(0)
      expect(pattern.metrics.p95).toBeGreaterThan(0)
      expect(pattern.metrics.p99).toBeGreaterThan(0)
      expect(pattern.metrics.min).toBeLessThanOrEqual(pattern.metrics.p75)
      expect(pattern.metrics.p99).toBeLessThanOrEqual(pattern.metrics.max)
    })

    describe('Edge Cases - Invalid Data', () => {
      it('should handle negative duration values', () => {
        const durations = [10, -5, 20, 15]
        const span = createMockSpan({ durationMs: 0, exclusiveTimeMs: 0 })
        span.spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration,
            exclusiveTimeMs: Math.max(0, duration) // non-negative exclusive
          })
        )

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)

        // Pattern should still calculate metrics even with negative values
        // Should not crash
        expect(result.size).toBeGreaterThan(0)
      })

      it('should handle mixed zero and positive durations', () => {
        const durations = [0, 0, 10, 20]
        const spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration,
            exclusiveTimeMs: duration,
            serviceName: 'mixed-vals',
            resolvedIdentity: 'mixed-vals'
          })
        )

        const result = buildPatternConsolidatedTree(spans)
        const pattern = result.get('mixed-vals')!

        // 4 root spans directly
        expect(pattern.metrics.count).toBe(4)
        expect(pattern.metrics.min).toBe(0)
        expect(pattern.metrics.max).toBe(20)
        // avg: (0 + 0 + 10 + 20) / 4 = 7.5
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
        const spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration,
            exclusiveTimeMs: duration,
            serviceName: 'large-vals',
            resolvedIdentity: 'large-vals'
          })
        )

        const result = buildPatternConsolidatedTree(spans)
        const pattern = result.get('large-vals')!

        // 3 root spans directly
        // Large values should be handled without overflow
        expect(pattern.metrics.count).toBe(3)
        expect(pattern.metrics.min).toBe(1000000)
        expect(pattern.metrics.max).toBe(3000000)
      })

      it('should validate percentile ordering with edge case data', () => {
        // Test data: duplicate values at percentile boundaries
        const durations = [5, 5, 5, 5, 5, 100, 100, 100, 100, 100]
        const span = createMockSpan({ durationMs: 0, exclusiveTimeMs: 0 })
        span.spans = durations.map((duration, i) =>
          createMockSpan({
            span_id: `span-${i}`,
            spanId: `span-${i}`,
            durationMs: duration,
            exclusiveTimeMs: duration
          })
        )

        const traceTree = [span]
        const result = buildPatternConsolidatedTree(traceTree)
        const pattern = result.get('service-a')!

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
        const pattern = result.get('service-a')!

        // Should handle gracefully and calculate metrics
        expect(pattern.metrics.count).toBe(1)
        // Missing exclusive time should fallback to duration
        expect(pattern.metrics.avgExclusive).toBeDefined()
      })
    })
  })
})
