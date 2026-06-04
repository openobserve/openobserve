// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from 'vitest'
import type { EnrichedSpan } from '@/ts/interfaces/traces/span.types'
import {
  calculateExclusiveTime,
  mergeOverlappingIntervals,
  calculateTotalCoverage,
  calculateConcurrentTime,
  detectChildOverlaps,
  calculateTimePercentage,
  validateTimeMetrics,
  type TimeInterval,
  type TimeMetrics
} from './timeCalculations'

// Helper function to create a mock span
const createMockSpan = (
  spanId: string,
  startOffsetMs: number,
  durationMs: number,
  exclusiveTimeMs?: number
): EnrichedSpan => ({
  span_id: spanId,
  trace_id: 'test-trace',
  parent_span_id: undefined,
  start_time: 0,
  end_time: 0,
  duration: durationMs * 1000, // microseconds
  service_name: 'test-service',
  operation_name: 'test-operation',
  _timestamp: 0,
  depth: 0,
  children: [],
  hasChildren: false,
  isExpanded: true,
  isSelected: false,
  isOnCriticalPath: false,
  color: '#9CA3AF',
  durationMs,
  durationPercent: 0,
  startOffsetMs,
  startOffsetPercent: 0,
  serviceName: 'test-service',
  operationName: 'test-operation',
  statusIcon: 'check-circle',
  kindIcon: 'help-outline',
  hasError: false,
  inclusiveTimeMs: durationMs,
  exclusiveTimeMs: exclusiveTimeMs || durationMs,
  childOverlapMs: 0,
  exclusiveTimePercent: 0,
  inclusiveTimePercent: 0
})

describe('timeCalculations', () => {
  describe('mergeOverlappingIntervals', () => {
    it('should return empty array for empty input', () => {
      const result = mergeOverlappingIntervals([])
      expect(result).toEqual([])
    })

    it('should handle single interval', () => {
      const intervals: TimeInterval[] = [
        { start: 10, end: 20, spanId: 'span1' }
      ]
      const result = mergeOverlappingIntervals(intervals)
      expect(result).toEqual([
        { start: 10, end: 20, overlappingSpans: ['span1'] }
      ])
    })

    it('should merge overlapping intervals', () => {
      const intervals: TimeInterval[] = [
        { start: 10, end: 20, spanId: 'span1' },
        { start: 15, end: 25, spanId: 'span2' }
      ]
      const result = mergeOverlappingIntervals(intervals)
      expect(result).toEqual([
        { start: 10, end: 25, overlappingSpans: ['span1', 'span2'] }
      ])
    })

    it('should keep non-overlapping intervals separate', () => {
      const intervals: TimeInterval[] = [
        { start: 10, end: 20, spanId: 'span1' },
        { start: 30, end: 40, spanId: 'span2' }
      ]
      const result = mergeOverlappingIntervals(intervals)
      expect(result).toEqual([
        { start: 10, end: 20, overlappingSpans: ['span1'] },
        { start: 30, end: 40, overlappingSpans: ['span2'] }
      ])
    })

    it('should merge multiple overlapping intervals', () => {
      const intervals: TimeInterval[] = [
        { start: 10, end: 20, spanId: 'span1' },
        { start: 15, end: 25, spanId: 'span2' },
        { start: 22, end: 30, spanId: 'span3' }
      ]
      const result = mergeOverlappingIntervals(intervals)
      expect(result).toEqual([
        { start: 10, end: 30, overlappingSpans: ['span1', 'span2', 'span3'] }
      ])
    })

    it('should handle adjacent intervals (touching)', () => {
      const intervals: TimeInterval[] = [
        { start: 10, end: 20, spanId: 'span1' },
        { start: 20, end: 30, spanId: 'span2' }
      ]
      const result = mergeOverlappingIntervals(intervals)
      expect(result).toEqual([
        { start: 10, end: 30, overlappingSpans: ['span1', 'span2'] }
      ])
    })
  })

  describe('calculateTotalCoverage', () => {
    it('should return 0 for empty intervals', () => {
      const result = calculateTotalCoverage([])
      expect(result).toBe(0)
    })

    it('should calculate coverage for single interval', () => {
      const intervals = [
        { start: 10, end: 20, overlappingSpans: ['span1'] }
      ]
      const result = calculateTotalCoverage(intervals)
      expect(result).toBe(10)
    })

    it('should calculate total coverage for multiple intervals', () => {
      const intervals = [
        { start: 10, end: 20, overlappingSpans: ['span1'] },
        { start: 30, end: 40, overlappingSpans: ['span2'] }
      ]
      const result = calculateTotalCoverage(intervals)
      expect(result).toBe(20) // 10 + 10
    })
  })

  describe('calculateConcurrentTime', () => {
    it('should return 0 when no intervals have overlaps', () => {
      const intervals = [
        { start: 10, end: 20, overlappingSpans: ['span1'] },
        { start: 30, end: 40, overlappingSpans: ['span2'] }
      ]
      const result = calculateConcurrentTime(intervals)
      expect(result).toBe(0)
    })

    it('should calculate concurrent time for overlapping spans', () => {
      const intervals = [
        { start: 10, end: 30, overlappingSpans: ['span1', 'span2'] }
      ]
      const result = calculateConcurrentTime(intervals)
      expect(result).toBe(20)
    })

    it('should sum concurrent time across multiple overlapping intervals', () => {
      const intervals = [
        { start: 10, end: 20, overlappingSpans: ['span1', 'span2'] },
        { start: 30, end: 40, overlappingSpans: ['span3'] },
        { start: 50, end: 60, overlappingSpans: ['span4', 'span5', 'span6'] }
      ]
      const result = calculateConcurrentTime(intervals)
      expect(result).toBe(20) // 10 (first) + 0 (second) + 10 (third)
    })
  })

  describe('detectChildOverlaps', () => {
    it('should detect no overlaps for single child', () => {
      const children = [
        createMockSpan('child1', 10, 20)
      ]
      const result = detectChildOverlaps(children)
      expect(result).toEqual({
        hasOverlaps: false,
        overlappingPairs: [],
        maxConcurrency: 1
      })
    })

    it('should detect no overlaps for sequential children', () => {
      const children = [
        createMockSpan('child1', 10, 20), // 10-30
        createMockSpan('child2', 30, 15)  // 30-45
      ]
      const result = detectChildOverlaps(children)
      expect(result).toEqual({
        hasOverlaps: false,
        overlappingPairs: [],
        maxConcurrency: 1
      })
    })

    it('should detect overlaps for concurrent children', () => {
      const children = [
        createMockSpan('child1', 10, 20), // 10-30
        createMockSpan('child2', 15, 20)  // 15-35
      ]
      const result = detectChildOverlaps(children)
      expect(result.hasOverlaps).toBe(true)
      expect(result.overlappingPairs).toHaveLength(1)
      expect(result.overlappingPairs[0]).toEqual({
        span1: 'child1',
        span2: 'child2',
        overlapMs: 15 // 15-30 overlap
      })
      expect(result.maxConcurrency).toBe(2)
    })

    it('should calculate maximum concurrency correctly', () => {
      const children = [
        createMockSpan('child1', 0, 30),   // 0-30
        createMockSpan('child2', 10, 30),  // 10-40
        createMockSpan('child3', 20, 30)   // 20-50
      ]
      const result = detectChildOverlaps(children)
      expect(result.maxConcurrency).toBe(3) // All three overlap at 20-30
    })
  })

  describe('calculateExclusiveTime', () => {
    it('should return inclusive time for span with no children', () => {
      const span = createMockSpan('parent', 0, 100)
      const children: EnrichedSpan[] = []

      const result = calculateExclusiveTime(span, children)

      expect(result).toEqual({
        inclusiveTimeMs: 100,
        exclusiveTimeMs: 100,
        childOverlapMs: 0,
        concurrentChildrenMs: 0,
        childIntervals: []
      })
    })

    it('should calculate exclusive time with sequential children', () => {
      const span = createMockSpan('parent', 0, 100)
      const children = [
        createMockSpan('child1', 10, 20), // 10-30
        createMockSpan('child2', 40, 30)  // 40-70
      ]

      const result = calculateExclusiveTime(span, children)

      expect(result.inclusiveTimeMs).toBe(100)
      expect(result.childOverlapMs).toBe(50) // 20 + 30
      expect(result.exclusiveTimeMs).toBe(50) // 100 - 50
      expect(result.concurrentChildrenMs).toBe(0)
    })

    it('should calculate exclusive time with overlapping children', () => {
      const span = createMockSpan('parent', 0, 100)
      const children = [
        createMockSpan('child1', 10, 30), // 10-40
        createMockSpan('child2', 25, 30)  // 25-55
      ]

      const result = calculateExclusiveTime(span, children)

      expect(result.inclusiveTimeMs).toBe(100)
      expect(result.childOverlapMs).toBe(45) // 10-55 merged
      expect(result.exclusiveTimeMs).toBe(55) // 100 - 45
      expect(result.concurrentChildrenMs).toBe(15) // 25-40 overlap
    })

    it('should handle child spans that exceed parent span duration', () => {
      const span = createMockSpan('parent', 0, 50)
      const children = [
        createMockSpan('child1', 0, 60) // Exceeds parent duration
      ]

      const result = calculateExclusiveTime(span, children)

      expect(result.exclusiveTimeMs).toBe(0) // Cannot be negative
    })

    it('should handle complex overlapping scenario', () => {
      const span = createMockSpan('parent', 0, 200)
      const children = [
        createMockSpan('child1', 10, 50),  // 10-60
        createMockSpan('child2', 40, 40),  // 40-80
        createMockSpan('child3', 100, 30), // 100-130
        createMockSpan('child4', 110, 40)  // 110-150
      ]

      const result = calculateExclusiveTime(span, children)

      // Merged intervals: 10-80 (70ms) + 100-150 (50ms) = 120ms
      expect(result.childOverlapMs).toBe(120)
      expect(result.exclusiveTimeMs).toBe(80) // 200 - 120
      // Concurrent time: 40-60 (child1&child2) + 110-130 (child3&child4) = 40ms
      expect(result.concurrentChildrenMs).toBe(40)
    })
  })

  describe('calculateTimePercentage', () => {
    it('should return 0 for zero trace duration', () => {
      const result = calculateTimePercentage(50, 0)
      expect(result).toBe(0)
    })

    it('should calculate percentage correctly', () => {
      const result = calculateTimePercentage(25, 100)
      expect(result).toBe(25)
    })

    it('should round to 2 decimal places', () => {
      const result = calculateTimePercentage(33.333, 100)
      expect(result).toBe(33.33)
    })

    it('should handle values larger than trace duration', () => {
      const result = calculateTimePercentage(150, 100)
      expect(result).toBe(150)
    })
  })

  describe('validateTimeMetrics', () => {
    it('should validate correct metrics', () => {
      const metrics: TimeMetrics = {
        inclusiveTimeMs: 100,
        exclusiveTimeMs: 60,
        childOverlapMs: 40,
        concurrentChildrenMs: 20,
        childIntervals: []
      }

      const result = validateTimeMetrics(metrics)
      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should detect negative exclusive time', () => {
      const metrics: TimeMetrics = {
        inclusiveTimeMs: 100,
        exclusiveTimeMs: -10,
        childOverlapMs: 40,
        concurrentChildrenMs: 20,
        childIntervals: []
      }

      const result = validateTimeMetrics(metrics)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Exclusive time cannot be negative')
    })

    it('should detect exclusive time exceeding inclusive time', () => {
      const metrics: TimeMetrics = {
        inclusiveTimeMs: 100,
        exclusiveTimeMs: 150,
        childOverlapMs: 40,
        concurrentChildrenMs: 20,
        childIntervals: []
      }

      const result = validateTimeMetrics(metrics)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Exclusive time cannot exceed inclusive time')
    })

    it('should detect child overlap exceeding inclusive time', () => {
      const metrics: TimeMetrics = {
        inclusiveTimeMs: 100,
        exclusiveTimeMs: 60,
        childOverlapMs: 150,
        concurrentChildrenMs: 20,
        childIntervals: []
      }

      const result = validateTimeMetrics(metrics)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Child overlap cannot exceed inclusive time')
    })

    it('should detect multiple validation errors', () => {
      const metrics: TimeMetrics = {
        inclusiveTimeMs: -50,
        exclusiveTimeMs: -10,
        childOverlapMs: -5,
        concurrentChildrenMs: 20,
        childIntervals: []
      }

      const result = validateTimeMetrics(metrics)
      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors).toContain('Exclusive time cannot be negative')
      expect(result.errors).toContain('Inclusive time cannot be negative')
      expect(result.errors).toContain('Child overlap time cannot be negative')
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero duration spans', () => {
      const span = createMockSpan('parent', 0, 0)
      const children = [
        createMockSpan('child1', 0, 0)
      ]

      const result = calculateExclusiveTime(span, children)
      expect(result.inclusiveTimeMs).toBe(0)
      expect(result.exclusiveTimeMs).toBe(0)
    })

    it('should handle spans starting at the same time', () => {
      const span = createMockSpan('parent', 0, 100)
      const children = [
        createMockSpan('child1', 0, 50),
        createMockSpan('child2', 0, 30)
      ]

      const result = calculateExclusiveTime(span, children)
      // Both children start at 0, child1 ends at 50, child2 at 30
      // Merged: 0-50 = 50ms overlap
      expect(result.childOverlapMs).toBe(50)
      expect(result.exclusiveTimeMs).toBe(50)
      expect(result.concurrentChildrenMs).toBe(30) // 0-30 overlap
    })

    it('should handle identical time spans', () => {
      const span = createMockSpan('parent', 0, 100)
      const children = [
        createMockSpan('child1', 10, 40),
        createMockSpan('child2', 10, 40)
      ]

      const result = calculateExclusiveTime(span, children)
      expect(result.childOverlapMs).toBe(40) // Identical spans merge to 10-50
      expect(result.concurrentChildrenMs).toBe(40) // Full overlap
    })
  })
})